/**
 * The placeholder block is the contract between the plugin and the agent.
 *
 * Pending:
 *   > [!ocr]- Extracting text… <!--ocr:job:a1b2c3d4:Attachments/Pasted image.png-->
 *
 * Failed (marker preserved so retry can find it):
 *   > [!ocr]- ⚠ Extraction failed — timed out <!--ocr:job:a1b2c3d4:Attachments/Pasted image.png-->
 *
 * Done (marker gone — a callout without a marker is never touched again):
 *   > [!ocr]- Extracted text
 *   > …transcription…
 */

export const IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"avif",
	"svg",
];

const EXT_GROUP = IMAGE_EXTENSIONS.join("|");

/** `![[path.png]]` or `![[path.png|300]]` */
const WIKI_EMBED = new RegExp(
	`!\\[\\[([^\\]|#]+?\\.(?:${EXT_GROUP}))(?:[|#][^\\]]*)?\\]\\]`,
	"i",
);
/** `![alt](path.png)` — including URL-encoded spaces and <> wrapping */
const MD_EMBED = new RegExp(
	`!\\[[^\\]]*\\]\\(\\s*<?([^)>\\s]+?\\.(?:${EXT_GROUP}))(?:\\s+"[^"]*")?\\s*>?\\)`,
	"i",
);

export interface EmbedRef {
	/** 0-based line number of the embed in the note. */
	line: number;
	/** Link target exactly as written in the note (may be URL-encoded). */
	rawTarget: string;
	/** Decoded target, suitable for resolving against the vault. */
	target: string;
}

export interface MarkerRef {
	/** 0-based line number of the callout title line carrying the marker. */
	line: number;
	jobId: string;
	/** Image path as recorded when the placeholder was written. */
	imagePath: string;
	failed: boolean;
}

const MARKER = /<!--ocr:job:([A-Za-z0-9]+):(.*?)-->/;

export function newJobId(): string {
	return (
		Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
	).toLowerCase();
}

function decodeTarget(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

/** Find an image embed on a specific line, if any. */
export function matchEmbed(line: string): { rawTarget: string } | null {
	const m = line.match(WIKI_EMBED) ?? line.match(MD_EMBED);
	if (!m) return null;
	return { rawTarget: m[1] };
}

/** All image embeds in a note, in document order. */
export function findEmbeds(lines: string[]): EmbedRef[] {
	const out: EmbedRef[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = matchEmbed(lines[i]);
		if (m) {
			out.push({
				line: i,
				rawTarget: m.rawTarget,
				target: decodeTarget(m.rawTarget),
			});
		}
	}
	return out;
}

/** All pending/failed markers in a note. */
export function findMarkers(lines: string[]): MarkerRef[] {
	const out: MarkerRef[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(MARKER);
		if (m) {
			out.push({
				line: i,
				jobId: m[1],
				imagePath: m[2],
				failed: lines[i].includes("⚠"),
			});
		}
	}
	return out;
}

export function findMarkerByJob(
	lines: string[],
	jobId: string,
): MarkerRef | null {
	return findMarkers(lines).find((m) => m.jobId === jobId) ?? null;
}

/**
 * Does this embed already have an OCR callout attached?
 * Looks at the next two non-empty lines — an embed is "covered" if the first
 * callout-looking line after it is an `[!ocr]` block.
 */
export function embedHasCallout(lines: string[], embedLine: number): boolean {
	for (let i = embedLine + 1; i < Math.min(lines.length, embedLine + 4); i++) {
		const line = lines[i].trim();
		if (line === "") continue;
		return /^>\s*\[!ocr\]/i.test(line);
	}
	return false;
}

/** Embeds in this note that have no callout yet — the backfill worklist. */
export function findUncoveredEmbeds(lines: string[]): EmbedRef[] {
	return findEmbeds(lines).filter((e) => !embedHasCallout(lines, e.line));
}

export function buildPendingCallout(jobId: string, imagePath: string): string {
	return `> [!ocr]- Extracting text… <!--ocr:job:${jobId}:${imagePath}-->`;
}

export function buildFailedCallout(
	jobId: string,
	imagePath: string,
	reason: string,
): string {
	const clean = reason.replace(/\s+/g, " ").trim().slice(0, 160);
	return `> [!ocr]- ⚠ Extraction failed — ${clean} <!--ocr:job:${jobId}:${imagePath}-->`;
}

/** Prefix every line with `> ` so the body lives inside the callout. */
export function quoteBody(body: string): string[] {
	return body
		.replace(/\r\n/g, "\n")
		.trimEnd()
		.split("\n")
		.map((line) => (line.trim() === "" ? ">" : `> ${line}`));
}

export function buildResultCallout(label: string, body: string): string[] {
	return [`> [!ocr]- ${label}`, ...quoteBody(body)];
}

/**
 * Insert a pending callout after `embedLine`, leaving a blank line between
 * image and callout. Returns the new lines array.
 */
export function insertPendingCallout(
	lines: string[],
	embedLine: number,
	jobId: string,
	imagePath: string,
): string[] {
	const block: string[] = [];
	const next = lines[embedLine + 1];
	if (next !== undefined && next.trim() !== "") {
		block.push("", buildPendingCallout(jobId, imagePath), "");
	} else {
		block.push("", buildPendingCallout(jobId, imagePath));
	}
	const out = lines.slice();
	out.splice(embedLine + 1, 0, ...block);
	return out;
}

/**
 * Replace the whole callout block starting at `markerLine` with `replacement`.
 * The block extends through every following line that starts with `>`.
 */
export function replaceCalloutBlock(
	lines: string[],
	markerLine: number,
	replacement: string[],
): string[] {
	let end = markerLine;
	while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1])) end++;
	const out = lines.slice();
	out.splice(markerLine, end - markerLine + 1, ...replacement);
	return out;
}

/** Extent of the callout block that starts at `startLine` (inclusive). */
export function calloutBlockRange(
	lines: string[],
	startLine: number,
): { start: number; end: number } {
	let end = startLine;
	while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1])) end++;
	return { start: startLine, end };
}
