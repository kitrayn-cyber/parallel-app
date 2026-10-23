# Parallel — Gura PWA

Parallel retains its existing interface, Gemini AI Worker integration, photos, sounds, Berkeley schedule, conversation archive and memory notebook.

Background messaging and iPhone Web Push are implemented as an opt-in extension under `background/`. Review [background/README.md](background/README.md) for inspection findings, manual setup, testing and deployment approval boundaries. The background Worker has not been deployed; the live `parallel-memory` UUID, schema and existing AI Worker binding were verified on 2026-10-23. Production deployment and secrets setup still require approval.

The PWA remains compatible with the existing GitHub Pages publishing flow. Publish `index.html`, `background-client.js`, `manifest.webmanifest`, `sw.js` and the icon files at the same paths as before. Do not replace the repository or clear browser storage. Never publish `.dev.vars`, `.vapid-keys.local`, passwords or API keys.
