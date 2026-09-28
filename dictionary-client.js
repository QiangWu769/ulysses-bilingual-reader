/* Live dictionary transport. Wiktionary text remains CC BY-SA 4.0. */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ulysses-online-dictionary-v2';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const MISSING_TTL = 5 * 60 * 1000;
  const CACHE_LIMIT = 100;
  const REQUEST_TIMEOUT = 8000;
  const cache = new Map();
  let storageLoaded = false;
  let queue = Promise.resolve();
  let rateLimitedUntil = 0;

  function normaliseTerm(raw) {
    if (typeof raw !== 'string') return '';
    const word = raw.normalize('NFKC').replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u2010\u2011]/g, '-').trim().replace(/\s+/g, ' ');
    // Keep case and meaningful leading/trailing hyphens, including un- and -ing.
    const plainWord = /^[\p{L}\p{M}' -]+$/u.test(word);
    const initialism = /^\p{L}(?:\.\p{L})+\.?$/u.test(word);
    return word.length <= 80 && /\p{L}/u.test(word) && (plainWord || initialism) ? word : '';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function abortError() {
    if (typeof DOMException === 'function') return new DOMException('查询已取消', 'AbortError');
    const error = new Error('查询已取消');
    error.name = 'AbortError';
    return error;
  }

  function checkAbort(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  function failure(kind, message, retryAfter) {
    const error = { kind, message };
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
    return { state: 'error', error };
  }

  function isUsableEntry(entry) {
    return entry && entry.hasEnglish !== false &&
      ((Array.isArray(entry.definitions) && entry.definitions.some(item => String(item.text || '').trim())) ||
       (Array.isArray(entry.etymologies) && entry.etymologies.some(item => String(item.text || '').trim())));
  }

  function pruneCache() {
    const now = Date.now();
    for (const [key, item] of cache) if (item.expiresAt <= now) cache.delete(key);
    while (cache.size > CACHE_LIMIT) {
      let oldestKey;
      let oldestTime = Infinity;
      for (const [key, item] of cache) {
        if (item.usedAt < oldestTime) { oldestKey = key; oldestTime = item.usedAt; }
      }
      cache.delete(oldestKey);
    }
  }

  function loadStorage() {
    if (storageLoaded) return;
    storageLoaded = true;
    try {
      const saved = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || saved.version !== 1 || !Array.isArray(saved.entries)) return;
      const now = Date.now();
      for (const item of saved.entries.slice(-CACHE_LIMIT)) {
        if (!item || typeof item.key !== 'string' || !/^(en|zh)\u0000/.test(item.key) ||
            !Number.isFinite(item.expiresAt) || item.expiresAt <= now ||
            !Number.isFinite(item.usedAt) || !item.result ||
            item.result.state !== 'ok' || !isUsableEntry(item.result.entry)) continue;
        cache.set(item.key, {
          expiresAt: Math.min(item.expiresAt, now + CACHE_TTL),
          usedAt: item.usedAt,
          result: { state: 'ok', entry: item.result.entry }
        });
      }
      pruneCache();
    } catch (_) { /* Private browsing or full storage must not prevent lookup. */ }
  }

  function saveStorage() {
    try {
      const entries = [];
      for (const [key, item] of cache) {
        if (item.result.state === 'ok') entries.push({ key, ...item });
      }
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
    } catch (_) { /* The in-memory cache still works when storage is unavailable. */ }
  }

  function getCached(key) {
    loadStorage();
    const item = cache.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) { cache.delete(key); return null; }
    item.usedAt = Date.now();
    return { ...clone(item.result), cached: true };
  }

  function putCached(key, result) {
    if (result.state !== 'ok' && result.state !== 'missing') return;
    const now = Date.now();
    cache.set(key, {
      expiresAt: now + (result.state === 'ok' ? CACHE_TTL : MISSING_TTL),
      usedAt: now,
      result: clone(result)
    });
    pruneCache();
    saveStorage();
  }

  function rateLimitResult() {
    const seconds = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
    return failure('rate-limit', `词典暂时限制查询，请在 ${seconds} 秒后重试。`, seconds);
  }

  function noteRateLimit(response) {
    const raw = response && response.headers && response.headers.get('Retry-After');
    let delay = 60000;
    if (raw && /^\d+(?:\.\d+)?$/.test(raw.trim())) {
      delay = Number(raw) * 1000;
    } else if (raw) {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) delay = Math.max(0, date - Date.now());
    }
    // Respect Retry-After; even zero must not trigger an immediate retry loop.
    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + Math.max(1000, delay));
    return rateLimitResult();
  }

  function waitWithAbort(promise, signal) {
    if (!signal) return promise;
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(abortError()); };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      if (signal.aborted) onAbort();
    });
  }

  function serialRequest(run, signal) {
    const pending = queue.then(() => { checkAbort(signal); return run(); });
    // A failure or cancelled queued request never poisons the next lookup.
    queue = pending.then(() => undefined, () => undefined);
    return waitWithAbort(pending, signal);
  }

  async function requestEntry(word, lang, signal) {
    checkAbort(signal);
    if (rateLimitedUntil > Date.now()) return rateLimitResult();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
    const params = new URLSearchParams({
      action: 'parse', page: word, prop: 'text|revid', format: 'json',
      formatversion: '2', redirects: '1', origin: '*'
    });
    try {
      // The tested Api-User-Agent preflight was rejected; a simple anonymous GET
      // avoids that preflight and is supported by Wiktionary's public CORS API.
      const response = await root.fetch(`https://${lang}.wiktionary.org/w/api.php?${params}`, {
        method: 'GET', mode: 'cors', credentials: 'omit', signal: controller.signal
      });
      if (response.status === 429) return noteRateLimit(response);
      if (response.status === 404) return { state: 'missing' };
      if (!response.ok) return failure('network', `词典服务暂时无法访问（HTTP ${response.status}），请稍后重试。`);
      let data;
      try { data = await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        return failure('parse', '词典返回的数据无法读取，请稍后重试。');
      }
      if (data && data.error) {
        if (data.error.code === 'missingtitle') return { state: 'missing' };
        if (data.error.code === 'ratelimited' || data.error.code === 'maxlag') return noteRateLimit(response);
        return failure('parse', '词典暂时无法提供此词条，请稍后重试。');
      }
      if (!data || !data.parse || typeof data.parse.text !== 'string' ||
          !root.UlyssesDictionaryParser || typeof root.UlyssesDictionaryParser.parseWiktionary !== 'function') {
        return failure('parse', '词典返回的数据格式暂不支持，请稍后重试。');
      }
      let entry;
      try {
        entry = root.UlyssesDictionaryParser.parseWiktionary(data.parse.text, {
          title: data.parse.title || word, lang, revid: data.parse.revid
        });
      } catch (_) {
        return failure('parse', '无法解析此词条，请打开来源词典查看。');
      }
      if (!isUsableEntry(entry)) return { state: 'missing' };
      entry.sourceUrl = `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(entry.title || data.parse.title || word)}`;
      return { state: 'ok', entry: clone(entry) };
    } catch (error) {
      if (signal && signal.aborted) throw abortError();
      if (timedOut) return failure('timeout', '查询超过 8 秒，请检查网络后重试。');
      return failure('network', '暂时连接不到词典，请检查网络后重试。');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function readEntry(word, lang, options) {
    checkAbort(options.signal);
    const key = `${lang}\u0000${word}`;
    if (!options.refresh) {
      const hit = getCached(key);
      if (hit) return hit;
    } else loadStorage();
    return serialRequest(async () => {
      if (!options.refresh) {
        const hit = getCached(key);
        if (hit) return hit;
      }
      const result = await requestEntry(word, lang, options.signal);
      checkAbort(options.signal);
      putCached(key, result);
      return result;
    }, options.signal);
  }

  async function readWithCaseFallback(word, lang, options) {
    const exact = await readEntry(word, lang, options);
    const lower = word.toLowerCase();
    if (exact.state === 'missing' && lower !== word) return readEntry(lower, lang, options);
    return exact;
  }

  function hasSubstantiveEtymology(entry) {
    return (entry.etymologies || []).some(item => {
      const text = String(item.text || '').replace(/\s+/g, ' ').trim();
      return text && !/^See the etymology of the corresponding (?:lemma|main) form\.?$/i.test(text);
    });
  }

  async function lookupWord(raw, { signal, refresh = false } = {}) {
    checkAbort(signal);
    const word = normaliseTerm(raw);
    if (!word) {
      return { word: '', en: failure('input', '请输入英文单词或词缀，例如 believe、un- 或 -ing。'),
        zh: failure('input', '请输入英文单词或词缀，例如 believe、un- 或 -ing。') };
    }
    const options = { signal, refresh: Boolean(refresh) };
    const en = await readWithCaseFallback(word, 'en', options);
    const zh = await readWithCaseFallback(word, 'zh', options);
    const result = { word, en, zh };
    if (en.state === 'ok' && !hasSubstantiveEtymology(en.entry)) {
      const candidates = en.entry.lemmaCandidates || [];
      if (candidates.length === 1) {
        const lemma = normaliseTerm(candidates[0].word);
        if (lemma && lemma.toLowerCase() !== word.toLowerCase()) {
          result.lemma = await readEntry(lemma, 'en', options);
        }
      }
    }
    checkAbort(signal);
    return result;
  }

  root.UlyssesOnlineDictionary = { lookupWord, normaliseTerm };
})(globalThis);
