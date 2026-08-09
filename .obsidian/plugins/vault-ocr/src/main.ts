import {
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	normalizePath,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	VaultOcrSettingTab,
	type VaultOcrSettings,
} from "./settings";
import { ClaudeRunner } from "./runner";
import { JobQueue, type OcrJob } from "./queue";
import { SidecarStore } from "./sidecar";
import {
	buildFailedCallout,
	buildResultCallout,
	calloutBlockRange,
	findEmbeds,
	findMarkerByJob,
	findMarkers,
	findUncoveredEmbeds,
	insertPendingCallout,
	matchEmbed,
	newJobId,
	replaceCalloutBlock,
	type EmbedRef,
} from "./placeholder";

export default class VaultOcrPlugin extends Plugin {
	settings: VaultOcrSettings = DEFAULT_SETTINGS;
	runner!: ClaudeRunner;
	queue!: JobQueue;
	sidecar!: SidecarStore;
	private statusBar: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		const vaultPath = this.vaultBasePath();
		this.runner = new ClaudeRunner(vaultPath, () => this.settings);
		this.sidecar = new SidecarStore(vaultPath);
		this.sidecar.ensureDir();
		void this.sidecar.purgeOlderThan(24);

		this.queue = new JobQueue(
			this.settings.maxConcurrent,
			(job, signal) => this.runJob(job, signal),
			() => this.updateStatusBar(),
		);

		this.statusBar = this.addStatusBarItem();
		this.updateStatusBar();

		this.addSettingTab(new VaultOcrSettingTab(this.app, this));

		this.addRibbonIcon("scan-text", "Extract text from images in this note", () => {
			void this.extractNote();
		});

		this.registerCommands();
		this.registerPasteHandlers();
	}

	onunload(): void {
		this.queue?.cancelAll();
	}

	// ---------------------------------------------------------------- settings

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private vaultBasePath(): string {
		// Desktop-only plugin, so the adapter is always a FileSystemAdapter.
		const adapter = this.app.vault.adapter as unknown as {
			getBasePath?: () => string;
		};
		return adapter.getBasePath ? adapter.getBasePath() : "";
	}

	private updateStatusBar(): void {
		if (!this.statusBar) return;
		const total = this.queue.totalCount;
		if (total === 0) {
			this.statusBar.setText("");
			this.statusBar.removeClass("vault-ocr-active");
			return;
		}
		this.statusBar.addClass("vault-ocr-active");
		this.statusBar.setText(`OCR ${this.queue.activeCount}/${total}`);
	}

	// -------------------------------------------------------- paste detection

	private registerPasteHandlers(): void {
		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt, _editor, view) => {
				if (!this.hasImage(evt.clipboardData?.files)) return;
				this.scheduleScan(view);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-drop", (evt, _editor, view) => {
				if (!this.hasImage(evt.dataTransfer?.files)) return;
				this.scheduleScan(view);
			}),
		);
	}

	private hasImage(files: FileList | null | undefined): boolean {
		if (!files || files.length === 0) return false;
		for (let i = 0; i < files.length; i++) {
			if (files[i].type.startsWith("image/")) return true;
		}
		return false;
	}

	/**
	 * We let Obsidian save the attachment itself — that keeps the user's
	 * attachment-folder settings and naming intact — then diff the note to see
	 * which embed appeared. Handles both `![[...]]` and `![](...)` styles
	 * without having to reimplement any of Obsidian's paste logic.
	 */
	private scheduleScan(view: MarkdownView | { file?: TFile | null }): void {
		const file = (view as MarkdownView).file ?? null;
		if (!file) return;

		const before = new Set(
			findEmbeds(this.app.workspace.activeEditor?.editor?.getValue().split("\n") ?? [])
				.map((e) => e.target),
		);

		let tries = 0;
		const tick = async () => {
			tries++;
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const fresh = findEmbeds(lines).filter((e) => !before.has(e.target));

			if (fresh.length === 0) {
				if (tries < 12) window.setTimeout(() => void tick(), 250);
				return;
			}
			await this.addPlaceholders(file, fresh, this.settings.autoExtractOnPaste);
		};
		window.setTimeout(() => void tick(), 250);
	}

	// --------------------------------------------------------- placeholders

	/**
	 * Insert pending callouts under each embed and optionally queue them.
	 * Inserting bottom-up keeps the earlier line numbers valid.
	 */
	private async addPlaceholders(
		file: TFile,
		embeds: EmbedRef[],
		enqueue: boolean,
	): Promise<number> {
		if (embeds.length === 0) return 0;

		const queued: { jobId: string; imagePath: string }[] = [];

		await this.app.vault.process(file, (content) => {
			let lines = content.split("\n");
			const sorted = [...embeds].sort((a, b) => b.line - a.line);
			for (const embed of sorted) {
				const current = lines[embed.line];
				if (!current || !matchEmbed(current)) continue;
				const resolved = this.resolveImage(embed.target, file.path);
				if (!resolved) continue;
				const jobId = newJobId();
				lines = insertPendingCallout(lines, embed.line, jobId, resolved.path);
				queued.push({ jobId, imagePath: resolved.path });
			}
			return lines.join("\n");
		});

		if (enqueue) {
			for (const job of queued) {
				this.queue.enqueue({
					jobId: job.jobId,
					notePath: file.path,
					imagePath: job.imagePath,
				});
			}
		}
		return queued.length;
	}

	private resolveImage(target: string, sourcePath: string): TFile | null {
		const direct = this.app.metadataCache.getFirstLinkpathDest(
			target,
			sourcePath,
		);
		if (direct) return direct;
		const byPath = this.app.vault.getAbstractFileByPath(normalizePath(target));
		return byPath instanceof TFile ? byPath : null;
	}

	// ------------------------------------------------------------ job running

	private async runJob(
		job: OcrJob,
		signal: AbortSignal,
	): Promise<{ ok: boolean; error?: string }> {
		const result = await this.runner.run(job.jobId, job.imagePath, signal);

		if (!result.ok) {
			if (result.error !== "cancelled") {
				await this.markFailed(job, result.error ?? "unknown error");
				new Notice(`Vault OCR failed: ${result.error}`, 8000);
			}
			return { ok: false, error: result.error };
		}

		const body = await this.sidecar.read(job.jobId);
		if (body === null) {
			await this.markFailed(job, "agent produced no output");
			return { ok: false, error: "no output" };
		}

		await this.applyResult(job, body);
		await this.sidecar.remove(job.jobId);
		return { ok: true };
	}

	private async applyResult(job: OcrJob, body: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(job.notePath);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const marker = findMarkerByJob(lines, job.jobId);
			if (!marker) return content;
			const block = buildResultCallout(this.settings.calloutLabel, body);
			return replaceCalloutBlock(lines, marker.line, block).join("\n");
		});
	}

	private async markFailed(job: OcrJob, reason: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(job.notePath);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const marker = findMarkerByJob(lines, job.jobId);
			if (!marker) return content;
			const block = [buildFailedCallout(job.jobId, job.imagePath, reason)];
			return replaceCalloutBlock(lines, marker.line, block).join("\n");
		});
	}

	// ---------------------------------------------------------------- commands

	private registerCommands(): void {
		this.addCommand({
			id: "extract-under-cursor",
			name: "Extract text for image under cursor",
			editorCallback: (editor, view) => {
				void this.extractUnderCursor(editor, view as MarkdownView);
			},
		});

		this.addCommand({
			id: "extract-note",
			name: "Extract text for all images in this note",
			callback: () => void this.extractNote(),
		});

		this.addCommand({
			id: "extract-vault",
			name: "Extract text for all images in the vault",
			callback: () => void this.extractVault(),
		});

		this.addCommand({
			id: "retry-failed",
			name: "Retry failed extractions in this note",
			callback: () => void this.retryFailed(),
		});

		this.addCommand({
			id: "delete-image-keep-text",
			name: "Delete image, keep extracted text",
			editorCallback: (editor, view) => {
				void this.deleteImageKeepText(editor, view as MarkdownView);
			},
		});

		this.addCommand({
			id: "cancel-all",
			name: "Cancel all running extractions",
			callback: () => {
				this.queue.cancelAll();
				new Notice("Vault OCR: queue cleared");
			},
		});
	}

	/** Nearest embed at or above the cursor. */
	private embedNearCursor(editor: Editor): EmbedRef | null {
		const lines = editor.getValue().split("\n");
		const cursor = editor.getCursor().line;
		const embeds = findEmbeds(lines);
		if (embeds.length === 0) return null;

		const onLine = embeds.find((e) => e.line === cursor);
		if (onLine) return onLine;

		const above = embeds.filter((e) => e.line <= cursor);
		return above.length > 0 ? above[above.length - 1] : embeds[0];
	}

	private async extractUnderCursor(
		editor: Editor,
		view: MarkdownView,
	): Promise<void> {
		const file = view.file;
		if (!file) return;

		const lines = editor.getValue().split("\n");
		const cursorLine = editor.getCursor().line;

		// Cursor sitting on a failed/pending callout — re-run that job.
		const marker = findMarkers(lines).find(
			(m) => Math.abs(m.line - cursorLine) <= 1,
		);
		if (marker) {
			this.queue.enqueue({
				jobId: marker.jobId,
				notePath: file.path,
				imagePath: marker.imagePath,
			});
			new Notice("Vault OCR: re-running extraction");
			return;
		}

		const embed = this.embedNearCursor(editor);
		if (!embed) {
			new Notice("Vault OCR: no image found near the cursor");
			return;
		}

		const uncovered = findUncoveredEmbeds(lines).find(
			(e) => e.line === embed.line,
		);
		if (!uncovered) {
			new Notice("Vault OCR: this image already has extracted text");
			return;
		}

		const count = await this.addPlaceholders(file, [uncovered], true);
		new Notice(
			count > 0
				? "Vault OCR: extracting…"
				: "Vault OCR: could not resolve that image",
		);
	}

	private async extractNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("Vault OCR: no active note");
			return;
		}
		const count = await this.queueFile(file);
		new Notice(
			count > 0
				? `Vault OCR: queued ${count} image${count === 1 ? "" : "s"}`
				: "Vault OCR: nothing to extract in this note",
		);
	}

	private async extractVault(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		let total = 0;
		for (const file of files) {
			total += await this.queueFile(file);
		}
		new Notice(
			total > 0
				? `Vault OCR: queued ${total} image${total === 1 ? "" : "s"} across the vault`
				: "Vault OCR: no images awaiting extraction",
		);
	}

	/** Queue every uncovered embed plus any leftover pending markers. */
	private async queueFile(file: TFile): Promise<number> {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		let count = 0;

		// Placeholders written earlier but never completed (auto-extract off,
		// or a crash mid-run).
		for (const marker of findMarkers(lines)) {
			if (this.queue.has(marker.jobId)) continue;
			this.queue.enqueue({
				jobId: marker.jobId,
				notePath: file.path,
				imagePath: marker.imagePath,
			});
			count++;
		}

		const uncovered = findUncoveredEmbeds(lines);
		count += await this.addPlaceholders(file, uncovered, true);
		return count;
	}

	private async retryFailed(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const failed = findMarkers(content.split("\n")).filter((m) => m.failed);

		for (const marker of failed) {
			this.queue.enqueue({
				jobId: marker.jobId,
				notePath: file.path,
				imagePath: marker.imagePath,
			});
		}
		new Notice(
			failed.length > 0
				? `Vault OCR: retrying ${failed.length}`
				: "Vault OCR: no failed extractions in this note",
		);
	}

	/**
	 * Removes the image embed but keeps its transcription — the "was this a
	 * diagram worth keeping, or just a wall of text?" decision, made per image.
	 */
	private async deleteImageKeepText(
		editor: Editor,
		view: MarkdownView,
	): Promise<void> {
		const file = view.file;
		if (!file) return;

		const embed = this.embedNearCursor(editor);
		if (!embed) {
			new Notice("Vault OCR: no image found near the cursor");
			return;
		}

		const target = this.resolveImage(embed.target, file.path);
		let removed = false;

		await this.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			if (!lines[embed.line] || !matchEmbed(lines[embed.line])) return content;

			// Unfold the callout that follows, if asked for.
			if (this.settings.unfoldOnImageDelete) {
				for (
					let i = embed.line + 1;
					i < Math.min(lines.length, embed.line + 4);
					i++
				) {
					if (lines[i].trim() === "") continue;
					if (/^>\s*\[!ocr\]-/i.test(lines[i])) {
						const { start } = calloutBlockRange(lines, i);
						lines[start] = lines[start].replace(/\[!ocr\]-/i, "[!ocr]");
					}
					break;
				}
			}

			// Drop the embed line, and a blank line left dangling above it.
			lines.splice(embed.line, 1);
			if (
				embed.line > 0 &&
				lines[embed.line - 1]?.trim() === "" &&
				lines[embed.line]?.trim() === ""
			) {
				lines.splice(embed.line, 1);
			}
			removed = true;
			return lines.join("\n");
		});

		if (!removed) {
			new Notice("Vault OCR: could not remove that image");
			return;
		}

		if (this.settings.deleteAttachmentFile && target) {
			await this.app.fileManager.trashFile(target);
			new Notice("Vault OCR: image moved to trash, text kept");
		} else {
			new Notice("Vault OCR: image removed from note, text kept");
		}
	}
}
