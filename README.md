# domscribr

a DOM scribe that records and exports LLM chat pages.

A Chromium extension that records DOM-based chat conversations from LLM interfaces and exports them as rich JSON transcripts.

## Features

- **One-click recorder** – start and stop capturing directly from the extension popup.
- **DOM aware** – observes mutation events to collect new chat messages in real time without polling.
- **Role detection** – infers whether a message came from the assistant, user, or system via semantic hints in the DOM.
- **Lossless exports** – stores both the rendered text and raw HTML for each captured node together with timestamps.
- **Resilient state** – keeps the capture buffer in extension storage so accidental popup closes do not lose work.

## Load the extension locally

1. Run `npm run package` (or `pnpm package`/`yarn package`) to produce `dist/domscribr.zip`. The script simply zips the `extension/` directory; you can also run `zip -r dist/domscribr.zip extension` manually.
2. Open `chrome://extensions` (or the equivalent in any Chromium-based browser).
3. Toggle **Developer mode** and choose **Load unpacked**.
4. Select the `extension/` directory from this repository.

## Using the recorder

1. Navigate to an LLM chat page (e.g. ChatGPT, Claude, Copilot, Gemini).
2. Open the domscribr popup and click **Start recording**. The extension injects a lightweight content script into the active tab and begins observing DOM updates.
3. Interact with the chat as normal. Captured message counts update inside the popup.
4. Press **Stop** to pause observation, or leave it running while you continue the conversation.
5. Click **Export JSON** to download a transcript that includes:
   - `id`, `sequence`, and `role` for each message.
   - `text` and `html` payloads.
   - `capturedAt` ISO timestamps along with the source page title and URL.

The resulting file is compatible with downstream tooling or custom scripts for archival and analysis.

## Development notes

- The extension targets Manifest V3 and uses a background service worker to coordinate recording sessions.
- Captured state is persisted via `chrome.storage.local`, allowing the service worker to sleep without losing data.
- Message fingerprints are derived from DOM attributes when present, falling back to hashed content, which keeps duplicates out of the export buffer.
- Styling in the popup relies on modern CSS (flexbox and gradients) but does not require a bundler or build pipeline.

Contributions are welcome—feel free to open issues or submit pull requests with improvements.
