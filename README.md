# personal-vault

An Obsidian vault built around one idea: **you should be able to take notes as
fast as screenshots, and still find them later.**

## The problem this solves

In a fast lecture or a dense meeting there isn't time to write things down, so
you screenshot the slide and move on. It works right up until you need something
back. Obsidian's search reads the text in your `.md` files — a pasted image is
one link line and nothing else, so a semester of screenshot notes is effectively
a semester of blank pages.

This vault ships a plugin, **Vault OCR**, that fixes that. Paste a screenshot and
the text inside it is transcribed into a folded callout underneath, as ordinary
markdown:

```markdown
![[Attachments/lecture-7.png]]

> [!ocr]- Extracted text
> ## Lecture 7: Zeeman Effect
> The splitting of spectral lines in a magnetic field.
> …
```

The callout starts collapsed, so reading view stays clean — but the words are
really in the file, so `Ctrl+Shift+F` finds them. Diagrams get a written
description *and* a Mermaid reconstruction, because a flowchart otherwise
contributes only a few floating labels to the index.

Nothing is destroyed along the way. The image stays unless you explicitly run
**Delete image, keep extracted text** on it — the point being that a wall of
text is worth replacing with its transcription, while a diagram is usually worth
keeping both.

**Transcription runs on your own Claude Code subscription**, not a metered API
key. There is no API key anywhere in this repo, and the plugin never contacts
Anthropic directly — it shells out to the `claude` CLI you already have.

---

## Getting started on a new machine

### 1. Prerequisites

| You need | Why | Check with |
| --- | --- | --- |
| [Obsidian](https://obsidian.md) desktop | The plugin uses OS-level process spawning, unavailable on mobile | — |
| [Claude Code](https://claude.com/claude-code), signed in | Does the actual image reading | `claude --version` |

Node.js is **not** required. The compiled plugin (`main.js`) is committed, so a
clone works as-is. You only need Node if you intend to modify the plugin's
source.

Confirm Claude Code is signed in before anything else — run `claude` once in a
terminal and complete the login if prompted. An unauthenticated CLI is the most
common cause of every extraction failing.

### 2. Clone and open

```bash
git clone https://github.com/Amir-Nafissi/personal-vault
```

In Obsidian: **Open folder as vault** → pick the cloned directory.

### 3. Allow the plugin to run

Obsidian disables third-party plugins on a new vault until you say otherwise:

**Settings → Community plugins → turn off Restricted mode.**

Vault OCR is already listed and enabled in the committed config, so it should
start immediately. If it doesn't appear, toggle it on in that same screen.

### 4. Check it works

Open **`Start here.md`** and read the two worked examples, then paste any
screenshot into a note. Expect:

- a folded `Extracting text…` callout appearing under the image right away
- `OCR 1/1` in the status bar
- the callout filling with the transcription about 10–15 seconds later

Then search for a phrase that only exists inside the picture. If it comes back,
you're done.

---

## Where things are

| Path | What it is |
| --- | --- |
| `Start here.md` | Worked examples, the full command list, and what each setting does |
| `ARCHITECTURE.md` | How the whole thing works, written for non-developers. Read this second. |
| `.claude/skills/ocr-extract/` | Plain-English instructions telling Claude how to transcribe. **Edit this to change output style — no rebuild needed.** |
| `.obsidian/plugins/vault-ocr/` | The plugin. `src/` is TypeScript source; `main.js` is the compiled build Obsidian loads. |
| `Attachments/` | Pasted images. The two `*-test.png` files are demos for `Start here.md` — delete them once you've seen it work. |
| `.ocr/out/` | Short-lived handoff files between Claude and the plugin. Gitignored, self-cleaning, safe to ignore. |

---

## Tuning it

Most of what you'll want to change is in **Settings → Community plugins → Vault
OCR**:

- **Model** — Sonnet by default. Switch to **Opus** for handwriting or bad phone
  photos of a whiteboard.
- **Extract automatically on paste** — turn it off during a fast lecture, then
  run *Extract text for all images in this note* afterwards to do it in one go.
- **Max concurrent extractions** — 2. Each image is one short Claude Code
  session, so raise this for bulk backfilling and lower it to be gentle on your
  quota.
- **Also delete the attachment file** — off by default, so "delete image" only
  removes the embed from the note and the file stays on disk.

To change *what the transcription looks like* — extra rules, translation,
summaries instead of verbatim text — edit
`.claude/skills/ocr-extract/SKILL.md`. It's a plain markdown document, it takes
effect on the next extraction, and it needs no rebuild.

---

## Modifying the plugin

Only if you're changing behaviour in `src/`. Requires Node 18+.

```bash
cd .obsidian/plugins/vault-ocr
npm install
npm run build      # type-checks, then bundles src/ into main.js
```

Then reload Obsidian (`Ctrl+R`). **Editing `src/` without rebuilding changes
nothing** — `main.js` is what actually runs, and it's a generated file.

Use `npm run dev` to rebuild automatically while you work.

---

## Worth knowing

**Your images are sent to Anthropic.** Transcription happens by having Claude
look at each screenshot, so anything you paste leaves your machine. Don't paste
material you can't share with a model provider.

**Desktop only.** The plugin launches an external program, which Obsidian mobile
can't do. On a phone your pastes get a placeholder callout and sit there; open
the vault on a desktop and run *Extract text for all images in the vault* to
catch up.

**It costs subscription usage, not money per image.** Every screenshot is one
short Claude Code session drawing on your existing plan. Bulk-backfilling a
year of notes in one command is real usage — the concurrency cap keeps it from
happening all at once, but it's worth doing deliberately.

**Nothing is silently lost.** A failed extraction rewrites its callout to
`⚠ Extraction failed — <reason>` and stays retryable via *Retry failed
extractions in this note*.

---

## If it isn't working

| Symptom | Cause |
| --- | --- |
| Nothing happens on paste | Restricted mode still on, or the plugin isn't enabled |
| Every image fails immediately | Claude Code isn't signed in — run `claude` in a terminal |
| `Claude Code CLI not found` | Set the binary path explicitly in Vault OCR settings |
| Callouts stuck on "Extracting text…" | Obsidian restarted mid-job; run *Extract text for all images in this note* to pick up orphans |
| Edited `src/` and nothing changed | You skipped `npm run build` |

`ARCHITECTURE.md` §10 covers these in more detail.
