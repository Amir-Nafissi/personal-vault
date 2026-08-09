# Personal vault

An Obsidian vault where notes are largely **screenshots**. The Vault OCR plugin
makes them searchable by transcribing each pasted image into a folded callout
beneath it.

## Conventions — do not "tidy" these away

- `> [!ocr]- Extracted text` callouts hold machine transcriptions of the image
  above them. They are intentionally verbose and intentionally folded. Leave
  them alone unless asked; they are what makes search work.
- A callout whose title line ends in `<!--ocr:job:...-->` is **pending or
  failed**, not finished. The plugin keys retries off that marker — do not
  delete it, and do not fill it in by hand.
- `.ocr/out/` holds short-lived handoff files between the agent and the plugin.
  Never commit them; never edit a note from a `/ocr-extract` run.

## Layout

- `.obsidian/plugins/vault-ocr/` — the plugin (TypeScript, esbuild → `main.js`).
  Rebuild with `npm run build` in that directory after changing `src/`.
- `.claude/skills/ocr-extract/` — the skill the plugin invokes headlessly for
  each image.

## Extraction flow

Paste image → plugin inserts a pending callout → plugin spawns
`claude -p "/ocr-extract job_id=… image=… describe_diagrams=…"` → skill reads the
image and writes `.ocr/out/<job_id>.md` → plugin splices that into the note and
deletes the sidecar.

The sidecar hop exists so that only Obsidian ever writes to a `.md` note. If the
agent edited notes directly, an open editor buffer would be reloaded mid-typing
and unsaved keystrokes lost.
