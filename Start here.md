# Start here

Paste a screenshot into any note. A folded **Extracted text** callout appears
under it within ~15 seconds, and everything inside it becomes searchable.

The two examples below were produced by the real pipeline — click the arrows to
unfold them, then try searching (`Ctrl+Shift+F`) for a phrase that only exists
inside a picture, like `Lande g-factor` or `Server SYN-ACK`.

## A slide of text

![[Attachments/zeeman-test.png]]

> [!ocr]- Extracted text
> ## Lecture 7: Zeeman Effect
>
> The splitting of spectral lines in a magnetic field.
>
> - Normal Zeeman effect: triplet, spin-zero systems
> - Anomalous Zeeman effect: involves electron spin
>
> Energy shift: $dE = \mu_B \cdot g_J \cdot m_J \cdot B$
>
> Exam note: memorise the Lande g-factor derivation.

## A diagram

Diagrams get a written description *and* a Mermaid reconstruction, so the shape
of the figure is searchable too — not just its stray labels.

![[Attachments/tcp-diagram-test.png]]

> [!ocr]- Extracted text
> ## TCP Handshake
>
> Connection established after three messages.
>
> **Diagram:** Flowchart of the TCP three-way handshake, showing three sequential steps connected left to right by arrows. It starts with "Client SYN", flows to "Server SYN-ACK", then flows to "Client ACK".
>
> ```mermaid
> graph LR
>   A[Client SYN] --> B[Server SYN-ACK]
>   B --> C[Client ACK]
> ```

## Commands

Open the palette (`Ctrl+P`) and search "Vault OCR":

| Command | Use |
| --- | --- |
| Extract text for image under cursor | Manual run, or retry a failed one |
| Extract text for all images in this note | Backfill a lecture you already pasted |
| Extract text for all images in the vault | Backfill everything, once |
| **Delete image, keep extracted text** | Drop the screenshot, keep the words |
| Retry failed extractions in this note | After fixing a problem |
| Cancel all running extractions | Stop a runaway batch |

**Delete image, keep text** is the deliberate choice you asked for: put the
cursor on a screenshot that was just a wall of text, run it, and the picture
goes while the transcription stays. Leave diagrams alone and you keep both.

## Settings

Settings → Community plugins → Vault OCR. Worth knowing:

- **Model** — Sonnet by default. Switch to **Opus** for dense handwriting or
  bad phone photos of a whiteboard.
- **Extract automatically on paste** — turn off during a fast lecture, then run
  *Extract all images in this note* afterwards so it all happens at once.
- **Max concurrent extractions** — 2. Raise it if you're backfilling a lot and
  don't mind the quota; each image is one short Claude Code session.
- **Also delete the attachment file** — off, so "delete image" only removes the
  embed and the file stays in `Attachments/`. Nothing is destroyed until you
  say so.

## If something breaks

A callout reading `⚠ Extraction failed` shows the reason on its title line.
Most likely causes: Claude Code isn't logged in (run `claude` once in a
terminal), or the binary path is wrong (set it explicitly in settings).
Fix, then run *Retry failed extractions in this note*.
