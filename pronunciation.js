/* Human pronunciation recordings from the Free Dictionary API (audio: Wikimedia/Wiktionary, CC BY-SA). */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ulysses-pronunciation-v1';
  const HIT_TTL = 7 * 24 * 60 * 60 * 1000;
  const MISS_TTL = 60 * 60 * 1000;
  const CACHE_LIMIT = 300;
  const cache = new Map();
  const inflight = new Map();
  let loaded = false;
  let blockedUntil = 0;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const now = Date.now();
      for (const [key, item] of Object.entries(saved)) if (item && item.expiresAt > now) cache.set(key, item);
    } catch (e) {}
  }

  function save() {
    try {
      const entries = [...cache].sort((a, b) => b[1].usedAt - a[1].usedAt).slice(0, CACHE_LIMIT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (e) {}
  }

  function normalise(raw) {
    const word = String(raw || '').normalize('NFKC').replace(/[‘’]/g, "'").trim().toLowerCase();
    return /^[a-z]+(?:['-][a-z]+)*$/.test(word) && word.length <= 40 ? word : '';
  }

  function accentOf(url) {
    if (/-us\.mp3(\?|$)/i.test(url)) return 'us';
    if (/-uk\.mp3(\?|$)/i.test(url)) return 'uk';
    return 'other';
  }

  function parse(data) {
    const result = { ipa: '', audio: {} };
    if (!Array.isArray(data)) return result;
    for (const entry of data) {
      if (!result.ipa && typeof entry.phonetic === 'string') result.ipa = entry.phonetic;
      for (const item of entry.phonetics || []) {
        if (!result.ipa && typeof item.text === 'string') result.ipa = item.text;
        if (typeof item.audio !== 'string' || !/^https:\/\/[^\s]+\.(?:mp3|ogg|wav)(?:\?[^\s]*)?$/i.test(item.audio)) continue;
        const accent = accentOf(item.audio);
        if (!result.audio[accent]) result.audio[accent] = item.audio;
      }
    }
    return result;
  }

  async function fetchInfo(word) {
    if (Date.now() < blockedUntil) return null;
    const response = await fetch('https://api.dictionaryapi.dev/v2/entries/en/' + encodeURIComponent(word), { headers: { Accept: 'application/json' } });
    if (response.status === 404) return { ipa: '', audio: {}, missing: true };
    if (response.status === 429) { blockedUntil = Date.now() + 60000; return null; }
    if (!response.ok) return null;
    return parse(await response.json());
  }

  // Resolves to { ipa, audio: { us?, uk?, other? } }, or null when unavailable. Never rejects.
  function lookup(raw) {
    const word = normalise(raw);
    if (!word) return Promise.resolve(null);
    load();
    const hit = cache.get(word);
    if (hit && hit.expiresAt > Date.now()) { hit.usedAt = Date.now(); return Promise.resolve(hit.info); }
    if (inflight.has(word)) return inflight.get(word);
    const request = fetchInfo(word).then(info => {
      if (info) {
        const empty = !info.ipa && !Object.keys(info.audio).length;
        cache.set(word, { info, usedAt: Date.now(), expiresAt: Date.now() + (empty ? MISS_TTL : HIT_TTL) });
        save();
      }
      return info;
    }).catch(() => null).finally(() => inflight.delete(word));
    inflight.set(word, request);
    return request;
  }

  function choose(info, preferred) {
    if (!info || !info.audio) return '';
    const order = preferred === 'uk' ? ['uk', 'other', 'us'] : ['us', 'other', 'uk'];
    for (const accent of order) if (info.audio[accent]) return info.audio[accent];
    return '';
  }

  root.UlyssesPronunciation = { lookup, choose, normalise, parse };
})(typeof window !== 'undefined' ? window : globalThis);
