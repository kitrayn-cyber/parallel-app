# Parallel — PWA prototype

**This is a fictional simulator, not yet an AI chatbot.** Replies use predefined lines and randomized delays while the app is open. It uses a *simulated* California schedule and a manually chosen location, **not real GPS**. Chats are saved only in your current browser's local storage. There is no backend, synchronization, push notifications, or voice/photo generation yet.

## Put it on GitHub Pages

1. Create a **new repository** named `parallel-app` on GitHub. Make it **Public** to use GitHub Pages on a free account. **Never add API keys, private information, or GPS logs to this repository.**
2. Use **Add file → Upload files** and upload the *contents* of this folder (index.html, manifest.webmanifest, sw.js, and the three PNG icons, README optional). They must be at the repository root, not nested in a folder.
3. Commit the files to `main`.
4. Open **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, branch `main`, folder `/(root)`, and Save.
5. When GitHub shows the site URL, open `https://YOURUSERNAME.github.io/parallel-app/` on your iPhone in Safari.
6. Safari → Share → Add to Home Screen → enable **Open as Web App** → Add.

GitHub Pages sites are **public**. In particular, do not add an AI API key to JavaScript. For actual AI, schedules that run with the app closed, images, or voice messages, a secure backend will be needed.

## Updating

Upload changed files and commit. The service worker caches the basic interface but uses a network-first strategy when online. Reload the app after publishing changes.
