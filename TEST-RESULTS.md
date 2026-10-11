# v0.3.1 test results — 2026-10-11

13 local checks passed, including exact reference equality for network interception/public metadata extraction, format menu behavior, JSON/TXT generation and field mapping, original proxy suppression, draft guard, names for all formats, missing metadata with captured-name fallback, page-title fallback, and Unicode/filename sanitization.

Four offline Chromium scenarios passed: actual drag without accidental export, JSON download, TXT download, and primary portrait PNG with expected pixels/dimensions and embedded CCv2 fields. The browser tests now assert actual downloaded filenames for all three formats (`Test Bot 雪.json`, `.txt`, `.png`). JavaScript syntax passed. No uncaught browser errors occurred.

Live JanitorAI/Firefox Nightly/Greasemonkey and SillyTavern import remain unverified. Tests use synthetic intercepted fixture responses; no real chat message was sent. This build changes filename/card-name resolution and retains the reference extraction behavior.

## v0.3.2 dummy-profile support

14 local checks passed, including appended proxy endpoint matching, rejection of other origins/paths, and suppression after the generation response has already been captured. Four offline browser scenarios still pass. Syntax passed. A dummy `.invalid` configuration is supplied in README; no external proxy is hosted and no real API key was used or inspected. JanitorAI's current UI validation and live Firefox/Greasemonkey proxy capture remain unverified.

## v0.3.3 setup panel

The local UI check now verifies that the dummy profile URL and expected-error explanation appear in the same menu as JSON/TXT/PNG. All 14 local checks and four offline browser scenarios passed. The new copy buttons include a manual-selection fallback; browser clipboard permissions were not tested. JanitorAI provider settings were not changed.
