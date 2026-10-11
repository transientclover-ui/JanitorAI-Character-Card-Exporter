// ==UserScript==
// @name         JanitorAI Character Card Exporter (Reference Engine)
// @version      0.3.3-beta
// @description  Minimal chara_card_v2 exporter for JanitorAI – press T to export as TXT/PNG/JSON.
// @match        https://janitorai.com/*
// @icon         https://images.dwncdn.net/images/t_app-icon-l/p/46413ec0-e1d8-4eab-a0bc-67eadabb2604/3920235030/janitor-ai-logo
// @grant        none
// @namespace    https://greasyfork.org/users/thornviolet/janitorai-reference-engine
// @inject-into  auto
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/*
Derived from the user-supplied JanitorAI Character Card Scraper (Minimal), v1.0, MIT.
Original author was not specified in the supplied metadata.
Reference namespace: https://sleazyfork.org/en/scripts/537206-janitorai-character-card-scraper
Floating launcher modifications: copyright (c) 2026 thornviolet, MIT.
This version retains the reference extraction engine, including its limitations.
*/
/*
MIT License
Copyright (c) 2026 thornviolet
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(function() {
    'use strict';

    function runInPageContext() {
        "use strict";

        // ---------- Core variables ----------
        let viewActive = false;
        let shouldInterceptNext = false;
        let suppressProxyUntil = 0;
        let networkInterceptActive = false;
        let exportFormat = null;
        let chatData = null;
        let cachedUserName = "";
        let cachedProxyUrl = "";
        let jaiStateObserver;

        const blankMeta = {
            creatorUrl: "",
            characterVersion: "",
            characterCardUrl: "",
            name: "",
            creatorNotes: "",
            personality: "",
            scenario: "",
            firstMessage: "",
            exampleDialogs: "",
            definitionExposed: false,
        };
        const characterMetaCache = { id: null, ...blankMeta };

        // ---------- Debug logging (optional) ----------
        function debugLog(...args) {
            // Enable if you want logs – otherwise comment out
            // console.log(...args);
        }
        function debugError(...args) { console.error(...args); }

        // ---------- Helpers (extracted from original) ----------
        function makeElement(tag, attrs = {}, styles = {}) {
            const el = document.createElement(tag);
            Object.entries(attrs).forEach(([k, v]) => (el[k] = v));
            Object.entries(styles).forEach(([k, v]) => (el.style[k] = v));
            return el;
        }

        function getCharacterCardUrl(id) { return `https://janitorai.com/characters/${id}`; }

        function characterName(preferred='',fallback='') {
            const valid=value=>{const name=String(value || '').trim();return name && !/^(character|char|unknown|janitor\s*ai|avatar|character avatar)$/i.test(name)?name:'';};
            for(const value of [preferred,chatData?.character?.name,chatData?.character?.chat_name,fallback]){const name=valid(value);if(name)return name;}
            for(const el of document.querySelectorAll('h1,h2,header p,header a,p.chakra-text')){
                const text=(el.textContent || '').trim();const match=text.match(/^Chat with\s+(.{1,200})$/i);if(match && valid(match[1]))return valid(match[1]);
            }
            const portrait=document.querySelector('img[src*="/bot-avatars/"]');const alt=valid(portrait?.alt);if(alt)return alt;
            const title=document.title.replace(/\s*[-|–—]\s*Janitor\s*AI.*$/i,'').trim();if(valid(title))return title;
            const chatId=location.pathname.match(/\/chats\/(\d+)/)?.[1];return chatId?'JanitorAI-chat-'+chatId:'JanitorAI-card';
        }
        function cardFilename(preferred,fallback,extension) {
            const name=characterName(preferred,fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\s+/g,' ').replace(/[. ]+$/,'').slice(0,180);
            return (name || 'JanitorAI-card')+'.'+extension;
        }

        function stripWatermark(text) {
            if (!text) return "";
            return text.split(/\r?\n/).filter(l => !/^created/i.test(l) || !/janitorai\.com"?$/i.test(l.trim())).join("\n").trim();
        }

        function tokenizeField(text, charName, userName) {
            if (!text) return text;
            let out = text;
            const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (userName) out = out.replace(new RegExp(`\\b${esc(userName)}('s?)?(?!\\w)`, "gi"), (m, s) => `{{user}}${s || ""}`);
            if (charName) out = out.replace(new RegExp(`\\b${esc(charName)}('s?)?(?!\\w)`, "gi"), (m, s) => `{{char}}${s || ""}`);
            return out;
        }

        // ---------- Early chat data prefetch ----------
        function findChatId() {
            const m = window.location.href.match(/\/chats\/(\d+)/);
            if (m) return m[1];
            const scripts = document.querySelectorAll("script");
            for (const s of scripts) {
                if (!s.textContent.includes("window._storeState_")) continue;
                const match = s.textContent.match(/JSON\.parse\("([\s\S]*?)"\)/);
                if (!match) continue;
                try {
                    const decoded = JSON.parse(`"${match[1]}"`);
                    const obj = JSON.parse(decoded);
                    const walk = (o) => {
                        if (!o || typeof o !== "object") return null;
                        if (o.chatId && typeof o.chatId === "number") return o.chatId;
                        for (const k in o) { const r = walk(o[k]); if (r) return r; }
                        return null;
                    };
                    const cid = walk(obj);
                    if (cid) return cid;
                } catch (_) {}
            }
            return null;
        }

        function getAuthHeader() {
            const m = document.cookie.match(/sb-auth-auth-token\.\d+=([^;]+)/);
            if (!m) return null;
            let raw = decodeURIComponent(m[1]);
            if (raw.startsWith("base64-")) raw = raw.slice(7);
            try {
                const json = JSON.parse(atob(raw));
                if (json.access_token) return `Bearer ${json.access_token}`;
            } catch (_) {
                if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(raw))
                    return `Bearer ${raw}`;
            }
            return null;
        }

        function getAppVersion() {
            const s = [...document.querySelectorAll("script[src]")].find(s => /\bv=([\w.-]+)/.test(s.src));
            return s ? s.src.match(/\bv=([\w.-]+)/)[1] : "2025-06-24.81a918c33";
        }

        async function prefetchChatData() {
            if (chatData) return;
            const chatId = findChatId();
            if (!chatId) return;
            const endpoint = `https://janitorai.com/hampter/chats/${chatId}`;
            const appVer = getAppVersion();
            const auth = getAuthHeader();
            const headers = { "x-app-version": appVer, accept: "application/json, text/plain, */*" };
            if (auth) headers["Authorization"] = auth;
            try {
                let res = await fetch(endpoint, { method: "GET", credentials: "include", headers });
                if (res.status === 401 && auth) {
                    res = await fetch(endpoint, { method: "GET", credentials: "include", headers: { ...headers, Authorization: auth } });
                }
                if (res.ok) {
                    const json = await res.json();
                    if (json && json.character) chatData = json;
                }
            } catch (_) {}
        }

        // ---------- Extract initial user/proxy data ----------
        function extractAndCacheInitialData(scriptNode) {
            if (cachedUserName && cachedProxyUrl) { if (jaiStateObserver) jaiStateObserver.disconnect(); return; }
            try {
                const match = scriptNode.textContent.match(/JSON\.parse\("([\s\S]*?)"\)/);
                if (match) {
                    const storeState = JSON.parse(JSON.parse(`"${match[1]}"`));
                    if (storeState?.user?.profile?.name && !cachedUserName)
                        cachedUserName = storeState.user.profile.name.trim();
                    if (storeState?.user?.config?.open_ai_reverse_proxy && !cachedProxyUrl)
                        cachedProxyUrl = storeState.user.config.open_ai_reverse_proxy;
                    if (cachedUserName && cachedProxyUrl && jaiStateObserver) jaiStateObserver.disconnect();
                }
            } catch (_) {}
        }

        // Initial scan
        document.querySelectorAll('script').forEach(s => {
            if (s.textContent.includes('window._storeState_')) extractAndCacheInitialData(s);
        });
        jaiStateObserver = new MutationObserver(mutations => {
            for (const m of mutations) for (const n of m.addedNodes) {
                if (n.tagName === 'SCRIPT' && n.textContent.includes('window._storeState_')) extractAndCacheInitialData(n);
            }
        });
        jaiStateObserver.observe(document.documentElement, { childList: true, subtree: true });

        // ---------- Network interception ----------
        function matchesProxyRequest(url) {
            if (!cachedProxyUrl || !url) return false;
            try {
                const configured=new URL(cachedProxyUrl,location.href),target=new URL(url,location.href);
                const base=configured.pathname.replace(/\/+$/,'');
                return target.origin===configured.origin && target.search===configured.search && (target.pathname.replace(/\/+$/,'')===base || target.pathname===base+'/chat/completions');
            } catch {return false;}
        }

        function interceptNetwork() {
            if (networkInterceptActive) return;
            networkInterceptActive = true;
            const origXHR = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
                this.addEventListener("load", () => {
                    if (url.includes("generateAlpha")) modifyResponse(this.responseText);
                    if (url.includes("/hampter/chats/")) modifyChatResponse(this.responseText);
                });
                return origXHR.apply(this, arguments);
            };
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
                const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                if (Date.now() < suppressProxyUntil && matchesProxyRequest(reqUrl)) {
                    suppressProxyUntil = 0;
                    return new Response('{"choices":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                const res = await origFetch(...args);
                if (res.ok) {
                    if (res.url?.includes("generateAlpha")) res.clone().text().then(modifyResponse).catch(()=>{});
                    if (res.url?.includes("/hampter/chats/")) res.clone().text().then(modifyChatResponse).catch(()=>{});
                }
                return res;
            };
        }

        function modifyResponse(text) {
            if (!shouldInterceptNext) return;
            shouldInterceptNext = false;
            try {
                const json = JSON.parse(text);
                const sys = json.messages.find(m => m.role === "system")?.content || "";
                const initMsg = chatData?.chatMessages?.findLast(m => m.is_bot === true)?.message || "";
                const header = document.querySelector("p.chakra-text.css-1nj33dt");
                const headerName = header?.textContent.match(/Chat with\s+(.*)$/)?.[1]?.trim();
                const fullName = (chatData?.character?.chat_name || chatData?.character?.name || "").trim();
                const charName = characterName(fullName,headerName);

                let content = typeof sys === "string" ? sys : "";
                content = content.replace(/^\s*\[System note:[\s\S]*?\]\s*/, "");

                const botPersonaMatch = content.match(/<(?!UserPersona\b)([^>]*?Persona)>([\s\S]*?)<\/\1>/i);
                const scenarioMatch = content.match(/<Scenario>([\s\S]*?)<\/Scenario>/i);
                const exampleDialogsMatch = content.match(/<example_dialogs>([\s\S]*?)<\/example_dialogs>/i);

                let charBlock = "", scen = "", exs = "";
                if (botPersonaMatch && scenarioMatch) {
                    charBlock = botPersonaMatch[2].trim();
                    scen = scenarioMatch[1].trim();
                } else if (botPersonaMatch && !scenarioMatch) {
                    charBlock = botPersonaMatch[2].trim();
                    const afterPersona = content.substring(content.indexOf(botPersonaMatch[0]) + botPersonaMatch[0].length);
                    const beforeUser = afterPersona.match(/^([\s\S]*?)(?:<UserPersona>|<example_dialogs>|$)/i);
                    if (beforeUser && beforeUser[1].trim()) charBlock += "\n" + beforeUser[1].trim();
                } else {
                    const beforeUser = content.match(/^([\s\S]*?)(?:<UserPersona>|<example_dialogs>|$)/i);
                    if (beforeUser) charBlock = beforeUser[1].trim();
                }
                if (exampleDialogsMatch) exs = exampleDialogsMatch[1].trim();

                const userName = cachedUserName;
                switch (exportFormat) {
                    case "txt": saveAsTxt(charBlock, scen, initMsg, exs, charName, userName); break;
                    case "png": saveAsPng(charName, charBlock, scen, initMsg, exs, userName); break;
                    case "json": saveAsJson(charName, charBlock, scen, initMsg, exs, userName); break;
                }
                exportFormat = null;
            } catch (err) { debugError("Error processing response:", err); }
        }

        function modifyChatResponse(text) {
            try { if (text && typeof text === "string") { const data = JSON.parse(text); if (data?.character) chatData = data; } } catch (_) {}
        }

        // ---------- Core metadata extraction ----------
        async function getCharacterMeta() {
            const charId = chatData?.character?.id;
            if (!charId) return { ...blankMeta };
            if (characterMetaCache.id === charId) return { ...characterMetaCache };

            const characterCardUrl = getCharacterCardUrl(charId);
            let meta = { ...blankMeta, characterVersion: characterCardUrl, characterCardUrl };
            try {
                const response = await fetch(characterCardUrl);
                const html = await response.text();
                const doc = new DOMParser().parseFromString(html, "text/html");

                // Try to find JSON with showdefinition=true
                const scripts = Array.from(doc.querySelectorAll("script"));
                for (const s of scripts) {
                    const txt = s.textContent || "";
                    if (!txt.includes("window.mbxM.push(JSON.parse(")) continue;
                    const start = txt.indexOf("JSON.parse(") + "JSON.parse(".length;
                    if (start === "JSON.parse(".length - 1) continue;
                    let parenCount = 1, end = -1;
                    for (let i = start; i < txt.length; i++) {
                        if (txt[i] === '(') parenCount++;
                        else if (txt[i] === ')') { parenCount--; if (parenCount === 0) { end = i; break; } }
                    }
                    if (end === -1) continue;
                    const jsonArgString = txt.substring(start, end).trim();
                    try {
                        const jsonContent = JSON.parse(jsonArgString);
                        const dataObject = JSON.parse(jsonContent);
                        const findChar = (obj, visited = new Set()) => {
                            if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
                            visited.add(obj);
                            if (obj.showdefinition && obj.id && obj.name && obj.personality && obj.first_message) return obj;
                            for (const k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k) && typeof obj[k] === 'object') { const r = findChar(obj[k], visited); if (r) return r; } }
                            return null;
                        };
                        const charObj = findChar(dataObject);
                        if (charObj) {
                            meta = {
                                ...meta,
                                name: (charObj.name || charObj.chat_name || "").trim(),
                                creatorNotes: charObj.description || "",
                                personality: stripWatermark(charObj.personality || ""),
                                scenario: stripWatermark(charObj.scenario || ""),
                                firstMessage: stripWatermark(charObj.first_message || ""),
                                exampleDialogs: stripWatermark(charObj.example_dialogs || ""),
                                definitionExposed: true,
                            };
                            break;
                        }
                    } catch (_) {}
                }

                // Extract creator URL
                const creatorLink = doc.querySelector("a.chakra-link.css-15sl5jl");
                if (creatorLink) {
                    const href = creatorLink.getAttribute("href");
                    if (href) meta.creatorUrl = `https://janitorai.com${href}`;
                }
                // Fallback notes from chatData if not exposed
                if (!meta.definitionExposed) {
                    meta.creatorNotes = chatData?.character?.description || "";
                }
            } catch (_) {}

            Object.assign(characterMetaCache, { id: charId, ...meta });
            return { ...meta };
        }

        async function getFilenameTokens(meta) {
            const charId = chatData?.character?.id || "";
            let creatorName = meta.creatorUrl ? meta.creatorUrl.split("/").pop() || "" : "";
            let tagsForCard = [];

            try {
                const response = await fetch(meta.characterCardUrl);
                const html = await response.text();
                const match = html.match(/window\.mbxM\.push\(JSON\.parse\("([\s\S]*?)"\)\)/);
                if (match) {
                    const decoded = JSON.parse(`"${match[1]}"`);
                    const storeState = JSON.parse(decoded);
                    let characterData = null;
                    for (const key in storeState) {
                        if (storeState[key]?.character?.tags) { characterData = storeState[key].character; break; }
                    }
                    if (characterData) {
                        const allTags = [];
                        if (characterData.tags) allTags.push(...characterData.tags.filter(t => typeof t.id === "number" && t.id >= 2).map(t => t.name));
                        if (characterData.custom_tags) allTags.push(...characterData.custom_tags);
                        tagsForCard = [...new Set(allTags)].map(tag => tag.replace(/[\p{Emoji}]/gu, "").trim()).filter(t => t);
                        if (characterData.creator_name) creatorName = characterData.creator_name;
                    }
                }
            } catch (_) {}

            return {
                id: charId,
                creator: creatorName,
                name: meta.name || chatData?.character?.name || "",
                chat_name: chatData?.character?.chat_name || "",
                tagsArray: tagsForCard,
            };
        }

        // ---------- chara_card_v2 builder ----------
        async function buildCharaCardV2(charName, charBlock, scen, initMsg, exs, userName, tagsArray) {
            const meta = await getCharacterMeta();
            const tokenizedDesc = tokenizeField(charBlock, charName, userName);
            const tokenizedScen = tokenizeField(scen, charName, userName);
            const tokenizedExs = tokenizeField(exs, charName, userName);
            const displayName = characterName(meta.name,charName).replace(/"/g, '').replace(/[|]/g, '').substring(0, 235);

            // Creator notes: plain text
            const notes = meta.creatorNotes ? meta.creatorNotes : "";

            // Alternate greetings
            let alternateGreetings = [];
            if (chatData?.character?.first_messages && Array.isArray(chatData.character.first_messages)) {
                const firstMsgNorm = stripWatermark(chatData.character.first_message || "").trim();
                alternateGreetings = chatData.character.first_messages
                    .map(msg => typeof msg === 'string' ? stripWatermark(msg).trim() : null)
                    .filter(msg => msg && msg !== firstMsgNorm)
                    .map(msg => tokenizeField(msg, charName, userName));
            }

            // Avatar URL (for PNG embedding later)
            const avatarImg = document.querySelector('img[src*="/bot-avatars/"]');
            const avatarUrl = avatarImg ? avatarImg.src : 'none';

            return {
                spec: "chara_card_v2",
                spec_version: "2.0",
                data: {
                    name: displayName,
                    description: tokenizedDesc.trim(),
                    personality: "",
                    scenario: tokenizedScen.trim(),
                    first_mes: initMsg.trim(),
                    mes_example: tokenizedExs.trim(),
                    creator_notes: notes,
                    system_prompt: "",
                    post_history_instructions: "",
                    alternate_greetings: alternateGreetings,
                    character_book: null,
                    tags: tagsArray || [],
                    creator: meta.creatorUrl,
                    character_version: meta.characterVersion,
                    avatar: avatarUrl,
                    extensions: {},
                },
            };
        }

        // ---------- Save functions (simplified, always regular download) ----------
        function saveFile(filename, blob) {
            const url = URL.createObjectURL(blob);
            const a = makeElement("a", { href: url, download: filename });
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        async function saveAsJson(charName, charBlock, scen, initMsg, exs, userName) {
            const tokens = await getFilenameTokens(await getCharacterMeta());
            const card = await buildCharaCardV2(charName, charBlock, scen, initMsg, exs, userName, tokens.tagsArray);
            const fileName = cardFilename(tokens.name,charName,'json');
            saveFile(fileName, new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }));
        }

        async function saveAsPng(charName, charBlock, scen, initMsg, exs, userName) {
            const tokens = await getFilenameTokens(await getCharacterMeta());
            const card = await buildCharaCardV2(charName, charBlock, scen, initMsg, exs, userName, tokens.tagsArray);
            const avatarImg = document.querySelector('img[src*="/bot-avatars/"]');
            if (!avatarImg) { alert("Character avatar not found."); return; }

            const avatarResponse = await fetch(avatarImg.src);
            const avatarBlob = await avatarResponse.blob();
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(async (blob) => {
                    const arrayBuffer = await blob.arrayBuffer();
                    const pngData = new Uint8Array(arrayBuffer);

                    const jsonString = JSON.stringify(card);
                    const base64Data = btoa(unescape(encodeURIComponent(jsonString)));
                    const keyword = "chara";
                    const keywordBytes = new TextEncoder().encode(keyword);
                    const nullByte = new Uint8Array([0]);
                    const textBytes = new TextEncoder().encode(base64Data);
                    const chunkType = new Uint8Array([116, 69, 88, 116]); // "tEXt"
                    const dataLength = keywordBytes.length + nullByte.length + textBytes.length;

                    const lengthBytes = new Uint8Array(4);
                    lengthBytes[0] = (dataLength >>> 24) & 0xff;
                    lengthBytes[1] = (dataLength >>> 16) & 0xff;
                    lengthBytes[2] = (dataLength >>> 8) & 0xff;
                    lengthBytes[3] = dataLength & 0xff;

                    const crcData = new Uint8Array(chunkType.length + keywordBytes.length + nullByte.length + textBytes.length);
                    crcData.set(chunkType, 0);
                    crcData.set(keywordBytes, chunkType.length);
                    crcData.set(nullByte, chunkType.length + keywordBytes.length);
                    crcData.set(textBytes, chunkType.length + keywordBytes.length + nullByte.length);
                    const crc = computeCrc32(crcData, 0, crcData.length);
                    const crcBytes = new Uint8Array(4);
                    crcBytes[0] = (crc >>> 24) & 0xff;
                    crcBytes[1] = (crc >>> 16) & 0xff;
                    crcBytes[2] = (crc >>> 8) & 0xff;
                    crcBytes[3] = crc & 0xff;

                    let pos = 8;
                    while (pos < pngData.length - 12) {
                        const length = (pngData[pos] << 24) | (pngData[pos+1] << 16) | (pngData[pos+2] << 8) | pngData[pos+3];
                        const type = String.fromCharCode(pngData[pos+4], pngData[pos+5], pngData[pos+6], pngData[pos+7]);
                        if (type === "IEND") break;
                        pos += 12 + length;
                    }

                    const finalSize = pngData.length + lengthBytes.length + chunkType.length + dataLength + crcBytes.length;
                    const finalPNG = new Uint8Array(finalSize);
                    finalPNG.set(pngData.subarray(0, pos));
                    let writePos = pos;
                    finalPNG.set(lengthBytes, writePos); writePos += lengthBytes.length;
                    finalPNG.set(chunkType, writePos); writePos += chunkType.length;
                    finalPNG.set(keywordBytes, writePos); writePos += keywordBytes.length;
                    finalPNG.set(nullByte, writePos); writePos += nullByte.length;
                    finalPNG.set(textBytes, writePos); writePos += textBytes.length;
                    finalPNG.set(crcBytes, writePos); writePos += crcBytes.length;
                    finalPNG.set(pngData.subarray(pos), writePos);

                    const fileName = cardFilename(tokens.name,charName,'png');
                    saveFile(fileName, new Blob([finalPNG], { type: "image/png" }));
                }, "image/png");
            };
            img.src = URL.createObjectURL(avatarBlob);
        }

        function computeCrc32(data, start, length) {
            let crc = 0xffffffff;
            for (let i = 0; i < length; i++) {
                crc = (crc >>> 8) ^ crc32Table[(crc ^ data[start + i]) & 0xff];
            }
            return ~crc >>> 0;
        }
        const crc32Table = (() => {
            const table = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                table[i] = c;
            }
            return table;
        })();

        async function saveAsTxt(charBlock, scen, initMsg, exs, charName, userName) {
            const meta = await getCharacterMeta();
            const tokens = await getFilenameTokens(meta);
            const sections = [
                `==== Name ====\n${meta.name || chatData?.character?.name || "Unknown"}`,
                `==== Chat Name ====\n${chatData?.character?.chat_name || ""}`,
                charBlock ? `==== Description ====\n${charBlock.trim()}` : null,
                scen ? `==== Scenario ====\n${scen.trim()}` : null,
                initMsg ? `==== Initial Message ====\n${initMsg.trim()}` : null,
                exs ? `==== Example Dialogs ====\n${exs.trim()}` : null,
                `==== Character Card ====\n${meta.characterCardUrl}`,
                `==== Creator ====\n${meta.creatorUrl}`,
                meta.creatorNotes ? `==== Creator Notes ====\n${meta.creatorNotes}` : null,
            ].filter(Boolean);
            const content = sections.join("\n\n");
            const tokenized = tokenizeField(content, charName, userName);
            const fileName = cardFilename(tokens.name,charName,'txt');
            saveFile(fileName, new Blob([tokenized], { type: "text/plain" }));
        }

        // ---------- Extraction trigger ----------
        function extraction() {
            if (!exportFormat) return;
            if (chatData && chatData.character && chatData.character.allow_proxy === false) {
                alert("Proxy disabled – cannot extract hidden definition.");
                return;
            }
            (async () => {
                const meta = await getCharacterMeta();
                if (meta.definitionExposed) {
                    const userName = cachedUserName;
                    switch (exportFormat) {
                        case "txt": saveAsTxt(meta.personality, meta.scenario, meta.firstMessage, meta.exampleDialogs, meta.name, userName); break;
                        case "png": saveAsPng(meta.name, meta.personality, meta.scenario, meta.firstMessage, meta.exampleDialogs, userName); break;
                        case "json": saveAsJson(meta.name, meta.personality, meta.scenario, meta.firstMessage, meta.exampleDialogs, userName); break;
                    }
                    exportFormat = null;
                    return;
                }
                shouldInterceptNext = true;
                suppressProxyUntil = Date.now() + 30000;
                interceptNetwork();
                callApi();
            })();
        }

        function callApi() {
            try {
                const textarea = document.querySelector("textarea");
                if (!textarea) {shouldInterceptNext=false;suppressProxyUntil=0;alert('Chat composer not found. No extraction request sent.');return;}
                if (textarea.value.trim()) {shouldInterceptNext=false;suppressProxyUntil=0;alert('Save or send your unfinished draft first. No extraction request sent.');return;}
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, "extract-char");
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                ["keydown", "keyup"].forEach(type => textarea.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true })));
            } catch (_) {}
        }

        // ---------- Minimal UI ----------
        function createUI() {
            if (document.getElementById("char-export-gui")) return;
            viewActive = true;

            const gui = makeElement("div", { id: "char-export-gui" }, {
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                background: "#222", color: "white", padding: "20px", borderRadius: "8px",
                boxShadow: "0 0 20px rgba(0,0,0,0.5)", zIndex: "10000", width: "min(440px, 90vw)", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box",
                display: "flex", flexDirection: "column", gap: "15px", textAlign: "center"
            });

            const title = makeElement("h2", { textContent: "Export Character Card" }, { margin: "0", fontSize: "18px" });
            gui.appendChild(title);
            const setup = makeElement('details', {}, {textAlign:'left',fontSize:'13px',lineHeight:'1.5'});
            const summary = makeElement('summary',{textContent:'Dummy proxy setup for hidden cards'},{cursor:'pointer',fontWeight:'bold'});
            const instructions = makeElement('p',{textContent:'Select Provider → Proxy in JanitorAI, add the profile below, save and reload this chat. Export JSON, TXT or portrait PNG here. A dummy-proxy error after extraction is expected; the downloaded file is the success signal. Switch back to your normal provider afterward.'});
            const profileText = 'Name: Character Card Export\nProxy URL: https://card-export.invalid/v1\nAppend /chat/completions: enabled\nAPI key: sk-export-only-not-a-real-api-key\nModel: gpt-4\nCustom prompt: None';
            const profile = makeElement('textarea',{readOnly:true,value:profileText,rows:7,'ariaLabel':'Dummy extraction proxy profile'},{width:'100%',boxSizing:'border-box',background:'#181421',color:'#fff',border:'1px solid #777',borderRadius:'8px',padding:'8px',resize:'vertical'});
            const copy = makeElement('button',{type:'button',textContent:'Copy dummy proxy details'},{padding:'8px',background:'#5734a0',color:'white',borderRadius:'8px',border:'1px solid #aaa',cursor:'pointer'});
            copy.onclick=async()=>{try{await navigator.clipboard.writeText(profileText);copy.textContent='Copied';}catch{profile.focus();profile.select();copy.textContent='Selected — copy with Ctrl+C';}};
            const urlCopy = makeElement('button',{type:'button',textContent:'Copy proxy URL'},{padding:'8px',background:'#5734a0',color:'white',borderRadius:'8px',border:'1px solid #aaa',cursor:'pointer'});
            urlCopy.onclick=async()=>{try{await navigator.clipboard.writeText('https://card-export.invalid/v1');urlCopy.textContent='Copied URL';}catch{profile.focus();profile.select();urlCopy.textContent='Copy URL from selected details';}};
            setup.append(summary,instructions,profile,copy,urlCopy);gui.appendChild(setup);
            const modeNote=makeElement('p',{textContent:cachedProxyUrl ? 'A proxy setting was detected. Verify Proxy is the selected provider before hidden extraction.' : 'Hidden extraction needs the dummy Proxy profile; expand setup above. Public definitions do not need it.'},{fontSize:'12px',margin:'0',color:'#ddd'});gui.appendChild(modeNote);


            const btnStyle = {
                background: "#3a3a3a", border: "none", color: "white", padding: "12px 20px",
                borderRadius: "6px", cursor: "pointer", fontSize: "16px", fontWeight: "bold"
            };
            const btnHover = "background: #4a4a4a;";

            const txtBtn = makeElement("button", { textContent: "Export TXT" }, btnStyle);
            txtBtn.onmouseover = () => (txtBtn.style.background = "#4a4a4a");
            txtBtn.onmouseout = () => (txtBtn.style.background = "#3a3a3a");
            txtBtn.onclick = () => { exportFormat = "txt"; closeUI(); extraction(); };
            gui.appendChild(txtBtn);

            const pngBtn = makeElement("button", { textContent: "Export PNG" }, btnStyle);
            pngBtn.onmouseover = () => (pngBtn.style.background = "#4a4a4a");
            pngBtn.onmouseout = () => (pngBtn.style.background = "#3a3a3a");
            pngBtn.onclick = () => { exportFormat = "png"; closeUI(); extraction(); };
            gui.appendChild(pngBtn);

            const jsonBtn = makeElement("button", { textContent: "Export JSON" }, btnStyle);
            jsonBtn.onmouseover = () => (jsonBtn.style.background = "#4a4a4a");
            jsonBtn.onmouseout = () => (jsonBtn.style.background = "#3a3a3a");
            jsonBtn.onclick = () => { exportFormat = "json"; closeUI(); extraction(); };
            gui.appendChild(jsonBtn);

            const closeBtn = makeElement("button", { textContent: "Close" }, { ...btnStyle, background: "#c0392b" });
            closeBtn.onmouseover = () => (closeBtn.style.background = "#e74c3c");
            closeBtn.onmouseout = () => (closeBtn.style.background = "#c0392b");
            closeBtn.onclick = closeUI;
            gui.appendChild(closeBtn);

            document.body.appendChild(gui);
        }

        function closeUI() {
            const gui = document.getElementById("char-export-gui");
            if (gui) gui.remove();
            viewActive = false;
        }

        // ---------- Route detection & key handling ----------
        function inChats() { return /^\/chats\/\d+/.test(window.location.pathname); }

        function handleKeyDown(e) {
            if (!inChats()) return;
            if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
            viewActive = !viewActive;
            if (viewActive) createUI(); else closeUI();
        }

        function installLauncher() {
            if (!document.body || document.getElementById('jai-reference-launcher')) return;
            const host=makeElement('div',{id:'jai-reference-launcher'},{position:'fixed',right:'18px',bottom:'18px',zIndex:'2147483000',display:'flex',gap:'5px',touchAction:'none'});
            const style={background:'linear-gradient(135deg,#a86eee,#5734a0 55%,#ce87ac)',border:'1px solid #d2b6ff',borderRadius:'14px',color:'white',padding:'12px 16px',font:'bold 14px system-ui',boxShadow:'0 5px 25px #9b5bf266,inset 0 1px 0 #ffffff66',cursor:'grab'};
            const primary=makeElement('button',{type:'button',textContent:'💾 Download Card',title:'Click for JSON, TXT or PNG export. Drag to move.'},style);
            const formats=makeElement('button',{type:'button',textContent:'⋯',title:'Export JSON or TXT'},{...style,cursor:'pointer'});
            host.append(primary);document.body.append(host);
            let drag=null,suppress=false;
            function place(x,y){Object.assign(host.style,{left:Math.max(0,Math.min(x,innerWidth-host.offsetWidth))+'px',top:Math.max(0,Math.min(y,innerHeight-host.offsetHeight))+'px',right:'auto',bottom:'auto'});}
            try{const p=JSON.parse(localStorage.getItem('jai.reference.position'));if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))place(p.x,p.y);}catch{}
            primary.onpointerdown=e=>{if(e.button!==0)return;suppress=false;const r=host.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};primary.setPointerCapture(e.pointerId);};
            primary.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>6)drag.moved=true;if(drag.moved)place(drag.left+dx,drag.top+dy);};
            primary.onpointerup=e=>{if(!drag||drag.id!==e.pointerId)return;suppress=drag.moved;if(suppress){const r=host.getBoundingClientRect();try{localStorage.setItem('jai.reference.position',JSON.stringify({x:r.left,y:r.top}));}catch{}}drag=null;};
            primary.onpointercancel=()=>{drag=null;suppress=true;};
            primary.onclick=e=>{if(suppress&&e.detail!==0){suppress=false;return;}createUI();};
            formats.onclick=()=>createUI();
        }

        function initialize() {
            if (!inChats()) return;
            document.removeEventListener("keydown", handleKeyDown);
            document.addEventListener("keydown", handleKeyDown);
            installLauncher();
            interceptNetwork();
            prefetchChatData(); // try to load chatData early
        }

        function cleanup() {
            document.getElementById('jai-reference-launcher')?.remove();
            closeUI();
            document.removeEventListener("keydown", handleKeyDown);
        }

        function handleRoute() {
            if (inChats()) initialize(); else cleanup();
        }

        // ---------- Start ----------
        window.addEventListener("load", handleRoute, { once: true });
        window.addEventListener("popstate", handleRoute);
        ["pushState", "replaceState"].forEach(fn => {
            const orig = history[fn];
            history[fn] = function(...args) {
                const r = orig.apply(this, args);
                setTimeout(handleRoute, 50);
                return r;
            };
        });
        handleRoute();
    }

    // Inject into page context
    try {
        const pageWindow = window.wrappedJSObject;
        if ((!pageWindow || pageWindow === window) && (typeof unsafeWindow === 'undefined' || unsafeWindow === window)) {
            runInPageContext();
        } else {
            const s = document.createElement('script');
            s.textContent = '(' + runInPageContext.toString() + ')();';
            document.documentElement.appendChild(s);
            s.remove();
        }
    } catch (e) {
        const s = document.createElement('script');
        s.textContent = '(' + runInPageContext.toString() + ')();';
        document.documentElement.appendChild(s);
        s.remove();
    }
})();
