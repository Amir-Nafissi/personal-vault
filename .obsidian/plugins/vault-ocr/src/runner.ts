import { spawn } from "child_process";
import { existsSync } from "fs";
import { delimiter, join } from "path";
import { homedir } from "os";
import type { VaultOcrSettings } from "./settings";

export interface RunResult {
	ok: boolean;
	/** Populated when ok === false. */
	error?: string;
	stdout: string;
	stderr: string;
}

const EXE = process.platform === "win32" ? "claude.exe" : "claude";

export class ClaudeRunner {
	private cached: string | null = null;

	constructor(
		private vaultPath: string,
		private getSettings: () => VaultOcrSettings,
	) {}

	/**
	 * Locate the Claude Code CLI. Checks the usual install locations first —
	 * Obsidian's process environment does not always inherit the shell PATH,
	 * which is why we don't rely on PATH resolution alone.
	 */
	detectBinary(): string | null {
		if (this.cached && existsSync(this.cached)) return this.cached;

		const candidates = [
			join(homedir(), ".local", "bin", EXE),
			join(homedir(), ".claude", "local", EXE),
			join(homedir(), "AppData", "Local", "Programs", "claude", EXE),
			"/usr/local/bin/claude",
			"/opt/homebrew/bin/claude",
		];

		const pathVar = process.env.PATH ?? "";
		for (const dir of pathVar.split(delimiter)) {
			if (dir) candidates.push(join(dir, EXE));
		}

		for (const candidate of candidates) {
			if (candidate && existsSync(candidate)) {
				this.cached = candidate;
				return candidate;
			}
		}
		return null;
	}

	private resolveBinary(): string | null {
		const configured = this.getSettings().claudeBinary;
		if (configured) {
			return existsSync(configured) ? configured : null;
		}
		return this.detectBinary();
	}

	/**
	 * Run one extraction. The agent reads the image and writes its result to
	 * `.ocr/out/<jobId>.md`; we never let it edit the note directly, so an open
	 * editor buffer is never clobbered by an external write.
	 */
	run(
		jobId: string,
		imagePath: string,
		signal: AbortSignal,
	): Promise<RunResult> {
		const settings = this.getSettings();
		const binary = this.resolveBinary();

		if (!binary) {
			return Promise.resolve({
				ok: false,
				error: settings.claudeBinary
					? `Claude Code not found at ${settings.claudeBinary}`
					: "Claude Code CLI not found — set its path in Vault OCR settings",
				stdout: "",
				stderr: "",
			});
		}

		const prompt = [
			`/ocr-extract`,
			`job_id=${jobId}`,
			`image=${imagePath}`,
			`describe_diagrams=${settings.describeDiagrams ? "yes" : "no"}`,
		].join(" ");

		const args = [
			"-p",
			prompt,
			"--model",
			settings.model,
			"--permission-mode",
			"acceptEdits",
			"--allowedTools",
			"Read",
			"Write",
			"--output-format",
			"text",
		];

		return new Promise<RunResult>((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;

			const child = spawn(binary, args, {
				cwd: this.vaultPath,
				windowsHide: true,
				shell: false,
				env: process.env,
				// stdin must be closed, not an idle pipe: the CLI waits ~3s for
				// piped input before giving up, which would add that delay to
				// every single image.
				stdio: ["ignore", "pipe", "pipe"],
			});

			const finish = (result: RunResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				resolve(result);
			};

			const timer = setTimeout(() => {
				child.kill();
				finish({
					ok: false,
					error: `timed out after ${settings.timeoutSeconds}s`,
					stdout,
					stderr,
				});
			}, settings.timeoutSeconds * 1000);

			const onAbort = () => {
				child.kill();
				finish({ ok: false, error: "cancelled", stdout, stderr });
			};
			signal.addEventListener("abort", onAbort);

			child.stdout?.on("data", (d: Buffer) => {
				stdout += d.toString();
			});
			child.stderr?.on("data", (d: Buffer) => {
				stderr += d.toString();
			});

			child.on("error", (err: Error) => {
				finish({ ok: false, error: err.message, stdout, stderr });
			});

			child.on("close", (code: number | null) => {
				if (code === 0) {
					finish({ ok: true, stdout, stderr });
				} else {
					const detail =
						stderr.trim().split("\n").slice(-3).join(" ") ||
						stdout.trim().split("\n").slice(-3).join(" ") ||
						`exit code ${code}`;
					finish({ ok: false, error: detail, stdout, stderr });
				}
			});
		});
	}
}
