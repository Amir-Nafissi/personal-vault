export interface OcrJob {
	jobId: string;
	/** Vault-relative path of the note holding the placeholder. */
	notePath: string;
	/** Vault-relative path of the image to read. */
	imagePath: string;
	attempt: number;
}

export type JobExecutor = (
	job: OcrJob,
	signal: AbortSignal,
) => Promise<{ ok: boolean; error?: string }>;

/**
 * FIFO queue with a concurrency cap. One retry per job — transient CLI
 * failures (a busy machine, a dropped session) are common enough to be worth
 * retrying once, while a real failure shouldn't loop forever.
 */
export class JobQueue {
	private pending: OcrJob[] = [];
	private running = new Map<string, AbortController>();
	private concurrency: number;
	private onChange: () => void;
	private executor: JobExecutor;

	constructor(concurrency: number, executor: JobExecutor, onChange: () => void) {
		this.concurrency = Math.max(1, concurrency);
		this.executor = executor;
		this.onChange = onChange;
	}

	setConcurrency(n: number): void {
		this.concurrency = Math.max(1, n);
		this.pump();
	}

	get activeCount(): number {
		return this.running.size;
	}

	get pendingCount(): number {
		return this.pending.length;
	}

	get totalCount(): number {
		return this.running.size + this.pending.length;
	}

	has(jobId: string): boolean {
		return (
			this.running.has(jobId) || this.pending.some((j) => j.jobId === jobId)
		);
	}

	enqueue(job: Omit<OcrJob, "attempt">): void {
		if (this.has(job.jobId)) return;
		this.pending.push({ ...job, attempt: 0 });
		this.onChange();
		this.pump();
	}

	cancelAll(): void {
		this.pending = [];
		for (const controller of this.running.values()) controller.abort();
		this.running.clear();
		this.onChange();
	}

	private pump(): void {
		while (this.running.size < this.concurrency && this.pending.length > 0) {
			const job = this.pending.shift();
			if (!job) break;
			void this.start(job);
		}
	}

	private async start(job: OcrJob): Promise<void> {
		const controller = new AbortController();
		this.running.set(job.jobId, controller);
		this.onChange();

		try {
			const result = await this.executor(job, controller.signal);
			if (!result.ok && job.attempt === 0 && !controller.signal.aborted) {
				this.pending.push({ ...job, attempt: 1 });
			}
		} finally {
			this.running.delete(job.jobId);
			this.onChange();
			this.pump();
		}
	}
}
