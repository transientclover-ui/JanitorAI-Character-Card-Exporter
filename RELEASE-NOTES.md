A floating draggable download button for JanitorAI character cards, using the supplied Minimal scraper workflow. Exports CCv2 JSON, readable TXT, and a portrait PNG with the card embedded, with bot-based filenames and an integrated dummy-proxy setup panel.

**Card extraction only — not a working chat API. Proxy errors are expected with the dummy connection, including after a successful export. The downloaded file is the success signal; an error without a downloaded file is not a confirmed export.**

Use the bogus profile details in the attached **README.md**, also included in the release ZIP. The `.invalid` URL has no real proxy server, and the placeholder key grants no API/admin access. Save/select the profile in JanitorAI and reload the chat before hidden extraction.

Validation: 14 local checks and 4 offline Chromium scenarios passed, covering downloads, filenames, portrait pixels, CCv2 metadata, proxy suppression, and the setup menu. Live Firefox Nightly/Greasemonkey and current JanitorAI compatibility remain unverified. Lorebooks are not exported by this reference-engine beta.

Install the attached userscript with only one JanitorAI exporter enabled. MIT applies to the software, with attribution to the supplied JanitorAI Character Card Scraper (Minimal); character writing and images retain their creators' rights.
