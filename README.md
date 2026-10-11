# JanitorAI Character Card Exporter

A draggable download button for JanitorAI. Export a bot as **CCv2 JSON**, **readable TXT**, or a **portrait PNG with the character card embedded**.

Sister project to [JannyAI Character Card Exporter](https://github.com/transientclover-ui/JannyAI-Character-Card-Exporter). This version uses the supplied **JanitorAI Character Card Scraper (Minimal)** extraction workflow, with a floating launcher and bot-based filenames.

## Install

Download `JanitorAI-Reference-Engine.user.js` from [Releases](https://github.com/transientclover-ui/JanitorAI-Character-Card-Exporter/releases/latest) and install it in your userscript manager. Disable older JanitorAI exporters and the original Minimal scraper so only one version runs. Your JannyAI script is separate.

Open an existing JanitorAI chat, reload, and click **💾 Download Card**. Choose JSON, TXT or PNG. Drag the button to move it. The T shortcut also opens the export menu.

## Dummy proxy — card extraction only

**These are bogus connection details, not a working chat API. No real API key is required.**

In JanitorAI, select **Provider → Proxy**, add this profile, save it, select it, and reload the chat:

| Field | Value |
|---|---|
| Name | `Character Card Export` |
| Proxy URL | `https://card-export.invalid/v1` |
| Append `/chat/completions` | Enabled, if offered |
| API key | `sk-export-only-not-a-real-api-key` |
| Model | `gpt-4` — placeholder only |
| Custom prompt | None |

The same details and copy buttons are included in the export menu. Everyone can reuse this dummy profile/key; it grants no admin access and authenticates to no service.

A proxy error can appear after a successful extraction. That is expected with a dummy connection. **The downloaded file is the success signal**, not a model reply. Switch back to your normal provider when you want to chat.

The `.invalid` suffix is [reserved for names that should not resolve](https://www.rfc-editor.org/rfc/rfc6761.html#section-6.4). There is no real proxy website to bombard. Another dummy name, such as `https://export-only.invalid/v1`, serves the same purpose. If JanitorAI changes proxy validation or the generation payload, changing the name alone may not fix extraction. JanitorAI still receives the requests needed to prepare the payload.

## How extraction works

Public definitions are read from exposed character-page data. The hidden path uses an existing proxy-enabled chat: the script submits `extract-char`, intercepts the site's prepared generation payload, and reads its character definition, scenario and examples. It tries to suppress the configured proxy Fetch request, including an appended `/chat/completions` endpoint, during a separate one-request, 30-second window.

The model's answer to `extract-char` is not the source card. The probe may remain in chat history. Unfinished drafts are protected, and messages are not automatically deleted. Characters with `allow_proxy === false` retain the supplied scraper's restriction.

The PNG uses the first `/bot-avatars/` portrait found by the reference selector, with CCv2 metadata embedded. JSON, TXT and PNG use the detected bot name; when it is unavailable, the filename falls back to a chat-specific name.

## Beta status and limits

v0.3.3-beta passed **14 local checks and 4 offline Chromium scenarios**, including actual JSON/TXT/PNG downloads, filenames, portrait pixels and embedded card metadata. Firefox Nightly/Greasemonkey is the intended user workflow, but this release was not independently tested against live JanitorAI, a live proxy, or SillyTavern. See [TEST-RESULTS.md](TEST-RESULTS.md).

Site authentication, page-state and `generateAlpha` assumptions come from the supplied reference and may change. The script uses persistent Fetch/XHR/history wrappers and reads the site's existing session cookie and page user/proxy settings for that workflow. Ordinary page-script injection is subject to site policy.

The reference sets `character_book` to null: **this release does not export lorebooks**. Its greeting selection and fallback prompt parsing are retained. When expected tags are missing, that fallback can include additional system context; inspect exports before sharing. The copy buttons offer manual selection if clipboard access is unavailable.

## Attribution and license

Based on **JanitorAI Character Card Scraper (Minimal), v1.0**, supplied with an MIT declaration. Its supplied metadata has no author name. Reference namespace: [JanitorAI Character Card Scraper](https://sleazyfork.org/en/scripts/537206-janitorai-character-card-scraper). The original is preserved in `tests/reference-minimal.txt` for comparison; it is not another script to install.

Launcher and integration changes: copyright 2026 thornviolet, MIT. See [LICENSE](LICENSE). MIT covers the software; character writing and portraits retain their creators' rights.

## Development tests

With Node.js/npm:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

All browser fixture requests are mocked or blocked. Test dependencies are not required by the installed userscript.
