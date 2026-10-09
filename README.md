# Infographic Studio

Type a topic, get an infographic video (or a still page): Qwen3.8 researches facts and writes the script,
ElevenLabs voices it and scores it, and a Claude Code routine designs, checks and renders the final MP4.

- App: Cloudflare Pages (`public/` + `functions/`), storage in Workers KV.
- Builder: a Claude Code routine fired by the app (see `routine/ROUTINE.md`, `docs/COMPOSITION.md`).
- Developer notes: `CLAUDE.md`.
