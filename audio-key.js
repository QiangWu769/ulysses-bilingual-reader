/* Shared by the browser and tools/generate-audio.mjs so both derive the same file name for a paragraph. */
(function (root) {
  'use strict';
  function normalise(text) { return String(text).replace(/\s+/g, ' ').trim(); }
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  // page and paragraph are 0-based; the hash makes an edited paragraph stop matching its old recording.
  function name(page, paragraph, text) { return page + '-' + paragraph + '-' + hash(normalise(text)); }
  // Word clips: lowercase key, or '' when the text is not a plain English word (then callers fall back).
  function wordKey(raw) {
    const word = String(raw).normalize('NFKC').trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
    return /^[a-z](?:[a-z'.-]*[a-z.])?$/.test(word) && word.length <= 60 ? word : '';
  }
  function shardOf(word, shards) { return parseInt(hash(word), 16) % shards; }
  const api = { normalise, hash, name, wordKey, shardOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.UlyssesAudioKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
