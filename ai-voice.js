/* Optional AI read-aloud through the Gemini API. The key stays in this browser's localStorage. */
(function (root) {
  'use strict';

  const CONFIG_KEY = 'ulysses-ai-voice-v1';
  const DEFAULTS = { enabled: false, apiKey: '', model: 'gemini-3.8-flash-tts', voice: 'Kore' };
  const DB_NAME = 'ulysses-ai-voice';
  const STORE = 'clips';
  const CLIP_LIMIT = 120;
  let shapeIndex = 0;
  let dbPromise = null;

  function getConfig() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function setConfig(patch) {
    const next = Object.assign(getConfig(), patch);
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }
  function isReady() {
    const config = getConfig();
    return !!config.enabled && config.apiKey.length >= 10;
  }

  function fail(kind, message) {
    const error = new Error(message);
    error.kind = kind;
    return error;
  }

  // The 3.x TTS models and the older ones describe the voice differently, so try both request shapes.
  function requestBodies(text, voice) {
    const base = { contents: [{ role: 'user', parts: [{ text }] }] };
    return [
      Object.assign({ generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }, base),
      Object.assign({ generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } } }, base)
    ];
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Gemini returns raw 16-bit mono PCM (audio/L16;rate=24000); browsers need a WAV header.
  function pcmToWav(pcm, rate) {
    const header = new DataView(new ArrayBuffer(44));
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); header.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE'); write(12, 'fmt ');
    header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
    header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
    write(36, 'data'); header.setUint32(40, pcm.length, true);
    return new Blob([header, pcm], { type: 'audio/wav' });
  }

  function audioFromResponse(data) {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
    const part = parts.find(item => item.inlineData && item.inlineData.data);
    if (!part) throw fail('empty', 'no audio');
    const mime = String(part.inlineData.mimeType || '');
    const bytes = base64ToBytes(part.inlineData.data);
    if (/^audio\/(?:l16|pcm)/i.test(mime) || /pcm/i.test(mime) || !mime) {
      const rate = Number((/rate=(\d+)/i.exec(mime) || [])[1]) || 24000;
      return pcmToWav(bytes, rate);
    }
    return new Blob([bytes], { type: mime });
  }

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          const request = indexedDB.open(DB_NAME, 1);
          request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbPromise;
  }
  async function clipGet(key) {
    const db = await openDb();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const request = db.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result ? request.result.blob : null);
        request.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function clipPut(key, blob) {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, blob, at: Date.now() });
      const all = store.getAll();
      all.onsuccess = () => {
        all.result.sort((a, b) => a.at - b.at).slice(0, Math.max(0, all.result.length - CLIP_LIMIT)).forEach(item => store.delete(item.key));
      };
    } catch (e) {}
  }

  // Resolves to an audio Blob. Rejects with an Error whose kind is key | quota | server | network | empty | config.
  async function synthesize(text, options) {
    const config = getConfig();
    const signal = options && options.signal;
    if (!/^[A-Za-z0-9._-]+$/.test(config.model) || !/^[A-Za-z]+$/.test(config.voice) || config.apiKey.length < 10) throw fail('config', 'bad config');
    const cacheKey = config.model + '|' + config.voice + '|' + text;
    const cached = await clipGet(cacheKey);
    if (cached) return cached;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + config.model + ':generateContent';
    const bodies = requestBodies(text, config.voice);
    for (let attempt = 0; attempt < bodies.length; attempt++) {
      const index = (shapeIndex + attempt) % bodies.length;
      let response;
      try {
        response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey }, body: JSON.stringify(bodies[index]) });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw fail('network', 'network');
      }
      if (response.status === 400 && attempt < bodies.length - 1) continue;
      if (response.status === 401 || response.status === 403) throw fail('key', 'key');
      if (response.status === 429) throw fail('quota', 'quota');
      if (!response.ok) throw fail('server', 'HTTP ' + response.status);
      shapeIndex = index;
      const blob = audioFromResponse(await response.json());
      clipPut(cacheKey, blob);
      return blob;
    }
    throw fail('server', 'unsupported request');
  }

  const MESSAGES = {
    key: 'AI 语音密钥无效或没有权限，已改用备用发音。',
    quota: 'AI 语音额度用完或请求太频繁，已改用备用发音。',
    network: '连不上 Google 语音服务，已改用备用发音。',
    empty: 'AI 语音没有返回声音，已改用备用发音。',
    config: 'AI 语音设置不完整，已改用备用发音。',
    server: 'AI 语音服务出错，已改用备用发音。'
  };
  function describe(error) { return MESSAGES[error && error.kind] || MESSAGES.server; }

  root.UlyssesAIVoice = { getConfig, setConfig, isReady, synthesize, describe, pcmToWav, audioFromResponse };
})(typeof window !== 'undefined' ? window : globalThis);
