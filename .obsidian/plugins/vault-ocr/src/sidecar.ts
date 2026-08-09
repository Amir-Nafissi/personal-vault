import { existsSync, mkdirSync, promises as fsp, readdirSync } from "fs";
import { join } from "path";

/**
 * The agent writes its transcription to `.ocr/out/<jobId>.md` and the plugin
 * splices it into the note. Obsidian's vault API skips dot-folders, so this
 * uses node fs directly — which also keeps these scratch files out of search
 * and the file explorer.
 */
export class SidecarStore {
	readonly dir: string;

	constructor(vaultPath: string) {
		this.dir = join(vaultPath, ".ocr", "out");
	}

	ensureDir(): void {
		if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
	}

	pathFor(jobId: string): string {
		return join(this.dir, `${jobId}.md`);
	}

	/**
	 * Read a result. The CLI has already exited by the time we call this, but
	 * a brief retry covers the window where the write hasn't hit disk yet.
	 */
	async read(jobId: string, attempts = 6): Promise<string | null> {
		const file = this.pathFor(jobId);
		for (let i = 0; i < attempts; i++) {
			try {
				const text = await fsp.readFile(file, "utf8");
				if (text.trim() !== "") return text;
			} catch {
				// not written yet
			}
			await new Promise((r) => setTimeout(r, 250));
		}
		return null;
	}

	async remove(jobId: string): Promise<void> {
		try {
			await fsp.unlink(this.pathFor(jobId));
		} catch {
			// already gone
		}
	}

	/** Drop stale sidecars left behind by crashes or cancelled jobs. */
	async purgeOlderThan(hours: number): Promise<void> {
		if (!existsSync(this.dir)) return;
		const cutoff = Date.now() - hours * 3600_000;
		for (const name of readdirSync(this.dir)) {
			const file = join(this.dir, name);
			try {
				const stat = await fsp.stat(file);
				if (stat.mtimeMs < cutoff) await fsp.unlink(file);
			} catch {
				// ignore
			}
		}
	}
}
