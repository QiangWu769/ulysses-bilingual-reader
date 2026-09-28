'use strict';
const $ = id => document.getElementById(id);
const pages = JSON.parse($('reader-data').textContent);
const contextNotes = JSON.parse($('context-data').textContent);
const normaliseWord = value => value.trim().toLowerCase().replace(/[’‘]/g, "'");
let queryController = null, querySequence = 0, currentQuery = '', lookupHistory = [];
let pageIndex = 0, fontSize = 18, activeWord = null, press = null, returnFocus = null;
let lastPointerType = '', ignoreClickUntil = 0;
const dialog = $('lookup-dialog');
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
// Played inside the tap so mobile browsers allow the recording that arrives after the network request.
const SILENT_WAV = 'data:audio/wav;base64,UklGRvQHAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YdAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const player = new Audio();
let voice = null, speakingEls = [], speakToken = 0, accent = 'us', toastTimer = 0;
// Pre-generated paragraph recordings (see tools/generate-audio.mjs); the manifest lists which files exist.
const audioNames = new Set();
fetch('audio/manifest.json').then(response => response.ok ? response.json() : null).then(manifest => {
  if (manifest && Array.isArray(manifest.files)) manifest.files.forEach(item => audioNames.add(item));
}).catch(() => {});
try { if (localStorage.getItem('ulysses-reader-accent') === 'uk') accent = 'uk'; } catch (e) {}
function pickVoice() {
  const english = speechSynthesis.getVoices().filter(item => /^en/i.test(item.lang));
  voice = english.find(item => /^en[-_]US$/i.test(item.lang) && !/compact/i.test(item.name)) || english[0] || null;
}
function markSpeaking(els) {
  speakingEls.forEach(el => el.classList.remove('speaking'));
  speakingEls = els.filter(Boolean);
  speakingEls.forEach(el => el.classList.add('speaking'));
}
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
function stopSpeaking() {
  speakToken++;
  player.pause();
  if (canSpeak) speechSynthesis.cancel();
  markSpeaking([]);
}
function speakSynthetic(spoken, token) {
  if (token !== speakToken) return;
  if (!canSpeak) { markSpeaking([]); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = 'en-US';
  utterance.rate = 0.85;
  if (voice) utterance.voice = voice;
  utterance.onend = utterance.onerror = () => { if (token === speakToken) markSpeaking([]); };
  speechSynthesis.speak(utterance);
}
function playRecording(url, token) {
  return new Promise((resolve, reject) => {
    player.onended = () => { if (token === speakToken) markSpeaking([]); resolve(); };
    player.onerror = () => reject(new Error('audio'));
    player.src = url;
    player.play().catch(reject);
  });
}
// Human recording first (Free Dictionary API); the browser's built-in voice when there is none.
// Order: human recording -> browser voice.
function speak(text, marks = [], preferred = accent) {
  const spoken = text.replace(/^-+|-+$/g, '').trim();
  if (!spoken) return;
  stopSpeaking();
  const token = speakToken;
  markSpeaking(marks);
  if (/^-|-$/.test(text.trim())) { speakSynthetic(spoken, token); return; }
  player.src = SILENT_WAV;
  player.play().catch(() => {});
  speakRecorded(spoken, token, preferred);
}
function speakRecorded(spoken, token, preferred) {
  Promise.race([UlyssesPronunciation.lookup(spoken), new Promise(resolve => setTimeout(resolve, 2500, null))]).then(info => {
    if (token !== speakToken) return;
    const url = UlyssesPronunciation.choose(info, preferred);
    if (!url) { speakSynthetic(spoken, token); return; }
    return playRecording(url, token).catch(() => speakSynthetic(spoken, token));
  });
}
const DOG_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><g fill="#fff" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M6.4 8.2C3.7 8.4 2.9 13 4.6 15.6 6.3 15.2 7 12.2 7.6 10z"/><path d="M17.6 8.2C20.3 8.4 21.1 13 19.4 15.6 17.7 15.2 17 12.2 16.4 10z"/><circle cx="12" cy="12.6" r="6.6"/></g><g fill="currentColor"><circle cx="9.5" cy="11.8" r=".95"/><circle cx="14.5" cy="11.8" r=".95"/><ellipse cx="12" cy="14.6" rx="1.6" ry="1.15"/></g><path d="M12 15.7v1.1m0 0c-.7.9-1.8.9-2.3.3m2.3-.3c.7.9 1.8.9 2.3.3" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';
// Reads a whole paragraph sentence by sentence (long single utterances get cut off in some browsers). Click again to stop.
function speakSentences(plain, token) {
  if (token !== speakToken) return;
  if (!canSpeak) { markSpeaking([]); showToast('这个浏览器不支持朗读。'); return; }
  const sentences = plain.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [plain];
  sentences.forEach((sentence, index) => {
    const utterance = new SpeechSynthesisUtterance(sentence.trim());
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    if (voice) utterance.voice = voice;
    const finish = () => { if (token === speakToken && index === sentences.length - 1) markSpeaking([]); };
    utterance.onend = finish;
    utterance.onerror = event => { if (event.error !== 'canceled' && event.error !== 'interrupted') finish(); };
    speechSynthesis.speak(utterance);
  });
}
// Reads a whole paragraph: pre-generated recording, then the browser voice sentence by sentence.
function speakParagraph(text, marks, name) {
  const wasReading = marks.some(el => speakingEls.includes(el));
  stopSpeaking();
  if (wasReading) return;
  const token = speakToken;
  markSpeaking(marks);
  const plain = text.replace(/\s+/g, ' ').trim();
  if (name && audioNames.has(name)) {
    playRecording('audio/' + name + '.mp3', token).catch(() => { if (token === speakToken) speakSentences(plain, token); });
    return;
  }
  speakSentences(plain, token);
}
function renderPronunciation(info, query) {
  const audio = info?.audio || {};
  const us = audio.us || audio.other, uk = audio.uk;
  $('lookup-pron').hidden = !info || !(info.ipa || us || uk);
  $('lookup-ipa').textContent = info?.ipa || '';
  $('pron-us').hidden = !us;
  $('pron-us').textContent = audio.us ? '美式录音' : '真人录音';
  $('pron-uk').hidden = !uk;
  $('lookup-pron').dataset.query = query;
}
if (canSpeak) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}
$('lookup-speak').hidden = false;
$('lookup-speak').addEventListener('click', () => speak(currentQuery, [$('lookup-speak')]));
for (const [id, name] of [['pron-us', 'us'], ['pron-uk', 'uk']]) {
  $(id).addEventListener('click', () => {
    accent = name;
    try { localStorage.setItem('ulysses-reader-accent', name); } catch (e) {}
    speak(currentQuery, [$(id), $('lookup-speak')], name);
  });
}
const THEMES = { paper: '#cfc6b6', sepia: '#a89272', mist: '#a9b8a6', white: '#edf1f5', night: '#0b0c0e' };
const themeMenu = $('theme-menu');
function applyTheme(name, save = false) {
  if (!(name in THEMES)) name = 'paper';
  document.documentElement.dataset.theme = name;
  document.querySelector('meta[name=theme-color]').content = THEMES[name];
  for (const button of themeMenu.querySelectorAll('[data-theme-choice]')) {
    button.setAttribute('aria-checked', String(button.dataset.themeChoice === name));
  }
  if (save) try { localStorage.setItem('ulysses-reader-theme', name); } catch (e) {}
}
function toggleThemeMenu(open) {
  themeMenu.hidden = !open;
  $('theme-open').setAttribute('aria-expanded', String(open));
  if (open) themeMenu.querySelector('[aria-checked=true]').focus({ preventScroll: true });
}
try {
  const stored = Number(localStorage.getItem('ulysses-reader-font'));
  if (stored >= 16 && stored <= 28) fontSize = stored;
} catch (e) {}
pages.forEach((page, i) => {
  const option = document.createElement('option');
  option.value = i;
  option.textContent = `正文 ${i + 1} / ${pages.length}`;
  $('page').append(option);
});
function updateFont() {
  document.documentElement.style.setProperty('--text-size', fontSize + 'px');
  $('size').textContent = fontSize;
  $('smaller').disabled = fontSize <= 16;
  $('larger').disabled = fontSize >= 28;
  try { localStorage.setItem('ulysses-reader-font', fontSize); } catch (e) {}
}
function appendEnglish(element, text) {
  const token = /\b(?:[A-Za-z]\.){2,}|[A-Za-z]+(?:[’'-][A-Za-z]+)*/g;
  let offset = 0;
  for (const match of text.matchAll(token)) {
    element.append(document.createTextNode(text.slice(offset, match.index)));
    const word = document.createElement('span');
    word.className = 'word';
    word.dataset.word = normaliseWord(match[0]);
    word.textContent = match[0];
    element.append(word);
    offset = match.index + match[0].length;
  }
  element.append(document.createTextNode(text.slice(offset)));
}
function renderPage(i) {
  cancelPress();
  stopSpeaking();
  if (dialog.open) dialog.close();
  pageIndex = Math.min(pages.length - 1, Math.max(0, i));
  const page = pages[pageIndex];
  const content = document.createDocumentFragment();
  const pageNo = pageIndex;
  page.paragraphs.forEach((pair, paragraphNo) => {
    const row = document.createElement('div');
    row.className = 'pair';
    const en = document.createElement('p');
    en.lang = 'en';
    appendEnglish(en, pair.en);
    {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'para-speak';
      button.innerHTML = DOG_ICON + '<span aria-hidden="true">♪</span>';
      button.title = '朗读本段 · 再点一次停止';
      button.setAttribute('aria-label', '朗读本段英文');
      button.addEventListener('click', () => speakParagraph(pair.en, [en, button], UlyssesAudioKey.name(pageNo, paragraphNo, pair.en)));
      en.append(button);
    }
    const zh = document.createElement('p');
    zh.className = 'zh';
    zh.lang = 'zh-CN';
    zh.textContent = pair.zh;
    row.append(en, zh);
    content.append(row);
  });
  $('parallel').replaceChildren(content);
  $('page').value = pageIndex;
  $('source-page').textContent = `PDF 第 ${page.pdfPage} 页`;
  $('prev').disabled = pageIndex === 0;
  $('next').disabled = pageIndex === pages.length - 1;
  const intro = document.querySelector('.intro');
  intro.hidden = !page.sectionStart && pageIndex !== 0;
  intro.querySelector('h2').textContent = `— ${page.heading} —`;
  $('continuation').textContent = pageIndex === pages.length - 1 ? `本次内容到此 · 正文前 ${pages.length} 页` : page.endsMidParagraph ? '本页末句接续至下一页' : '';
  $('parallel').classList.toggle('opening', pageIndex === 0);
  $('progress').style.width = ((pageIndex + 1) / pages.length * 100) + '%';
  $('reading').scrollTop = 0;
  $('announcement').textContent = `正文第 ${pageIndex + 1} 页，PDF 第 ${page.pdfPage} 页`;
}
function openDialog(origin) {
  if (dialog.open) return;
  returnFocus = origin || document.activeElement;
  dialog.showModal();
  // Keep the keyboard closed for a word selected in the text.
  $('lookup-close').focus({ preventScroll: true });
  dialog.scrollTop = 0;
}
function chooseTab(name, focus = false) {
  for (const tab of ['roots', 'meaning']) {
    const selected = tab === name;
    $('tab-' + tab).setAttribute('aria-selected', String(selected));
    $('tab-' + tab).tabIndex = selected ? 0 : -1;
    $('panel-' + tab).hidden = !selected;
  }
  if (focus) $('tab-' + name).focus();
}
function makeText(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function makeSource(url, label) {
  const link = makeText('a', label, 'source-link');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
function addTermButtons(container, terms, caption) {
  const distinct = [...new Set(terms.map(term => typeof term === 'string' ? term : term.word))]
    .filter(word => word && normaliseWord(word) !== normaliseWord(currentQuery)).slice(0, 16);
  if (!distinct.length) return;
  container.append(makeText('p', caption, 'terms-caption'));
  const buttons = document.createElement('div');
  buttons.className = 'word-terms';
  for (const word of distinct) {
    const button = makeText('button', word);
    button.type = 'button';
    button.lang = 'en';
    button.addEventListener('click', () => showWord(word, null, { fromLink: true }));
    buttons.append(button);
  }
  container.append(buttons);
}
function renderEtymologies(source, heading, target) {
  if (source?.state !== 'ok') return 0;
  let count = 0;
  for (const etymology of source.entry.etymologies || []) {
    if (!etymology.text) continue;
    const section = document.createElement('section');
    section.className = 'word-section';
    const number = source.entry.etymologies.length > 1 ? ` ${count + 1}` : '';
    section.append(makeText('h4', heading + number));
    const text = makeText('p', etymology.text, source.entry.lang === 'zh' ? '' : 'original-text');
    text.lang = source.entry.lang === 'zh' ? 'zh' : 'en';
    section.append(text);
    addTermButtons(section, (etymology.terms || []).filter(term => term.language === 'en'), '词源中提到 · 点词继续查');
    section.append(makeSource(source.entry.sourceUrl, '查看这一词条的来源 ↗'));
    target.append(section);
    count++;
  }
  return count;
}
function renderDefinitions(source, heading, target) {
  target.replaceChildren();
  if (source?.state !== 'ok' || !source.entry.definitions?.length) return false;
  const section = document.createElement('section');
  section.className = 'word-section';
  section.append(makeText('h4', heading));
  const list = document.createElement('ol');
  for (const definition of source.entry.definitions.slice(0, 12)) {
    const prefix = definition.partOfSpeech ? `${definition.partOfSpeech} · ` : '';
    const item = makeText('li', prefix + definition.text);
    item.lang = source.entry.lang === 'zh' ? 'zh' : 'en';
    list.append(item);
  }
  section.append(list);
  if (source.entry.definitions.length > 12) section.append(makeText('p', '此处显示前 12 条释义，其余可查看完整词条。', 'terms-caption'));
  target.append(section);
  return true;
}
function displayOnlineResult(result) {
  const sources = [result.en, result.zh, result.lemma].filter(Boolean);
  const errors = sources.filter(source => source.state === 'error');
  const successes = sources.filter(source => source.state === 'ok');
  $('lookup-refresh').disabled = false;
  if (errors.length) {
    $('lookup-status').textContent = `${successes.length ? '已显示可用结果。' : ''}${errors[0].error?.message || '在线词典暂时无法连接，请重试。'}`;
  } else if (!successes.length) {
    $('lookup-status').textContent = '在线词典未收录这个词形，请检查拼写或查询原形。';
  } else {
    $('lookup-status').textContent = successes.every(source => source.cached) ? '在线词典缓存 · 24 小时内可复用，点击重新查询可更新' : '在线查询完成 · 维基词典';
  }
  const primary = result.en.state === 'ok' ? result.en.entry : result.zh.state === 'ok' ? result.zh.entry : null;
  $('lookup-lemma').textContent = primary ? `词条：${primary.title} · 词典原文节选` : '可通过下方链接打开完整词典查询';
  $('lookup-roots').replaceChildren();
  let roots = renderEtymologies(result.zh, '中文词源', $('lookup-roots'));
  roots += renderEtymologies(result.en, '英文构词与词源', $('lookup-roots'));
  roots += renderEtymologies(result.lemma, `原形 ${result.lemma?.entry?.title || ''} 的词源`, $('lookup-roots'));
  if (!roots) {
    $('lookup-roots').append(makeText('p', errors.length && !successes.length ? '连接恢复后将显示在线词根词缀与词源。' : '当前词条未提供词源说明。可切换到“词义”，或继续查询原形。', 'lookup-empty'));
  }
  $('lookup-lemmas').replaceChildren();
  if (result.en.state === 'ok') addTermButtons($('lookup-lemmas'), result.en.entry.lemmaCandidates || [], '词典标注的原形 · 点词继续查');
  let hasZh = renderDefinitions(result.zh, '中文释义', $('lookup-zh-definitions'));
  if (!hasZh && result.en.state === 'ok' && result.en.entry.chineseTranslations?.length) {
    const section = document.createElement('section');
    section.className = 'word-section';
    section.append(makeText('h4', '中文译词 · 来自英文词条'));
    for (const translation of result.en.entry.chineseTranslations) {
      section.append(makeText('p', translation.terms.join(' / ')));
      if (translation.sense) section.append(makeText('p', translation.sense, 'terms-caption'));
    }
    section.append(makeSource(result.en.entry.sourceUrl, '查看中文译词来源 ↗'));
    $('lookup-zh-definitions').append(section);
    hasZh = true;
  }
  const hasEn = renderDefinitions(result.en, '英文释义', $('lookup-en-definitions'));
  if (!hasZh) $('lookup-zh-definitions').append(makeText('p', result.zh.state === 'error' ? '中文词典暂时无法连接。' : '中文词典暂未提供此词的释义。', 'lookup-empty'));
  if (!hasEn) $('lookup-en-definitions').append(makeText('p', result.en.state === 'error' ? '英文词典暂时无法连接。' : '英文词典暂未提供此词形的释义。', 'lookup-empty'));
  if (result.en.state === 'ok') $('lookup-wiktionary').href = result.en.entry.sourceUrl;
  if (result.zh.state === 'ok') $('lookup-zh-source').href = result.zh.entry.sourceUrl;
}
async function showWord(raw, element = null, options = {}) {
  const query = ++querySequence;
  if (queryController) queryController.abort();
  let term;
  try { term = UlyssesOnlineDictionary.normaliseTerm(raw); } catch (e) { term = ''; }
  if (!term) {
    $('lookup-entry').hidden = true;
    $('lookup-welcome').hidden = false;
    $('lookup-refresh').hidden = true;
    $('lookup-status').textContent = '请输入一个英文单词或词缀，例如 unbelievable、un-、-able。';
    openDialog(element ? $('reading') : $('lookup-open'));
    return;
  }
  queryController = new AbortController();
  if (options.fromLink && currentQuery) lookupHistory.push(currentQuery);
  else if (!options.back && !options.refresh) lookupHistory = [];
  currentQuery = term;
  if (activeWord) activeWord.classList.remove('is-active');
  activeWord = element;
  if (activeWord) activeWord.classList.add('is-active');
  $('lookup-input').value = term;
  $('lookup-welcome').hidden = true;
  $('lookup-entry').hidden = false;
  $('lookup-word').textContent = term;
  $('lookup-lemma').textContent = '正在加载在线词条…';
  $('lookup-status').textContent = '正在查询维基词典…';
  $('lookup-refresh').hidden = false;
  $('lookup-refresh').disabled = true;
  $('lookup-back').hidden = lookupHistory.length === 0;
  $('lookup-back').textContent = lookupHistory.length ? `‹ 返回 ${lookupHistory.at(-1)}` : '‹ 返回上个词';
  $('lookup-roots').replaceChildren(makeText('p', '正在获取词根词缀与词源…', 'lookup-empty'));
  renderPronunciation(null, term);
  if (!/^-|-$/.test(term)) UlyssesPronunciation.lookup(term).then(info => { if (query === querySequence && dialog.open) renderPronunciation(info, term); });
  $('lookup-lemmas').replaceChildren();
  $('lookup-zh-definitions').replaceChildren();
  $('lookup-en-definitions').replaceChildren();
  const context = contextNotes[normaliseWord(term)];
  $('lookup-context').hidden = typeof context !== 'string';
  $('lookup-context-text').textContent = typeof context === 'string' ? context : '';
  $('lookup-wiktionary').href = 'https://en.wiktionary.org/wiki/' + encodeURIComponent(term.replace(/ /g, '_')) + '#English';
  $('lookup-zh-source').href = 'https://zh.wiktionary.org/wiki/' + encodeURIComponent(term.replace(/ /g, '_')) + '#英语';
  $('lookup-etymonline').href = 'https://www.etymonline.com/search?q=' + encodeURIComponent(term);
  if (!options.refresh) chooseTab(/^-|-$/.test(term) ? 'meaning' : 'roots');
  openDialog(element ? $('reading') : $('lookup-open'));
  if (options.fromLink || options.back) $('lookup-close').focus({ preventScroll: true });
  dialog.scrollTop = 0;
  try {
    const result = await UlyssesOnlineDictionary.lookupWord(term, { signal: queryController.signal, refresh: !!options.refresh });
    if (query !== querySequence || !dialog.open) return;
    displayOnlineResult(result);
  } catch (error) {
    if (query !== querySequence || error.name === 'AbortError' || !dialog.open) return;
    $('lookup-status').textContent = '在线词典暂时无法连接，请重新查询。';
    $('lookup-lemma').textContent = '查询未完成';
    $('lookup-roots').replaceChildren(makeText('p', '暂时无法取得词源数据。', 'lookup-empty'));
    $('lookup-refresh').disabled = false;
  }
}

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}
$('parallel').addEventListener('pointerdown', event => {
  cancelPress();
  lastPointerType = event.pointerType;
  if (!event.isPrimary || event.button !== 0) return;
  const word = event.target.closest('.word');
  if (!word) return;
  const started = { id: event.pointerId, x: event.clientX, y: event.clientY, word, timer: null };
  started.timer = setTimeout(() => {
    if (press !== started) return;
    press = null;
    ignoreClickUntil = Date.now() + 900;
    showWord(word.textContent, word);
  }, 500);
  press = started;
}, { passive: true });
document.addEventListener('pointerdown', event => {
  if (press && event.pointerId !== press.id) cancelPress();
}, { passive: true });
document.addEventListener('pointermove', event => {
  if (press && event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancelPress();
}, { passive: true });
document.addEventListener('pointerup', cancelPress, { passive: true });
document.addEventListener('pointercancel', cancelPress, { passive: true });
$('reading').addEventListener('scroll', cancelPress, { passive: true });
window.addEventListener('blur', cancelPress);
document.addEventListener('visibilitychange', cancelPress);
$('parallel').addEventListener('contextmenu', event => {
  if (event.target.closest('.word')) event.preventDefault();
});
$('parallel').addEventListener('click', event => {
  const word = event.target.closest('.word');
  if (!word || Date.now() < ignoreClickUntil) return;
  speak(word.textContent, [word]);
  const pointerType = event.pointerType || lastPointerType;
  if (pointerType === 'touch' || pointerType === 'pen') return;
  showWord(word.textContent, word);
});
$('lookup-open').addEventListener('click', () => {
  $('lookup-welcome').hidden = false;
  $('lookup-entry').hidden = true;
  $('lookup-input').value = '';
  $('lookup-status').textContent = '';
  $('lookup-refresh').hidden = true;
  lookupHistory = [];
  openDialog($('lookup-open'));
});
$('lookup-close').addEventListener('click', () => dialog.close());
let backdropPress = false;
dialog.addEventListener('pointerdown', event => { backdropPress = event.target === dialog; });
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (backdropPress && event.target === dialog && outside) dialog.close();
  backdropPress = false;
});
dialog.addEventListener('close', () => {
  cancelPress();
  stopSpeaking();
  querySequence++;
  if (queryController) queryController.abort();
  if (activeWord) activeWord.classList.remove('is-active');
  activeWord = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
});
$('lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  showWord($('lookup-input').value);
  $('lookup-input').blur();
  $('lookup-close').focus({ preventScroll: true });
});
$('lookup-refresh').addEventListener('click', () => showWord(currentQuery, null, { refresh: true }));
$('lookup-back').addEventListener('click', () => {
  const previous = lookupHistory.pop();
  if (previous) showWord(previous, null, { back: true });
});
for (const name of ['roots', 'meaning']) {
  $('tab-' + name).addEventListener('click', () => chooseTab(name));
  $('tab-' + name).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    chooseTab(event.key === 'Home' ? 'roots' : event.key === 'End' ? 'meaning' : name === 'roots' ? 'meaning' : 'roots', true);
  });
}
$('prev').addEventListener('click', () => renderPage(pageIndex - 1));
$('next').addEventListener('click', () => renderPage(pageIndex + 1));
$('page').addEventListener('change', event => renderPage(Number(event.target.value)));
$('smaller').addEventListener('click', () => { fontSize = Math.max(16, fontSize - 1); updateFont(); });
$('larger').addEventListener('click', () => { fontSize = Math.min(28, fontSize + 1); updateFont(); });
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.closest('select,input,textarea,button') || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); renderPage(pageIndex + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); renderPage(pageIndex - 1); }
});
$('theme-open').addEventListener('click', () => toggleThemeMenu(themeMenu.hidden));
themeMenu.addEventListener('click', event => {
  const button = event.target.closest('[data-theme-choice]');
  if (!button) return;
  applyTheme(button.dataset.themeChoice, true);
  toggleThemeMenu(false);
  $('theme-open').focus({ preventScroll: true });
});
document.addEventListener('pointerdown', event => {
  if (!themeMenu.hidden && !event.target.closest('#theme-menu, #theme-open')) toggleThemeMenu(false);
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !themeMenu.hidden) { toggleThemeMenu(false); $('theme-open').focus({ preventScroll: true }); }
});
applyTheme(document.documentElement.dataset.theme);
updateFont();
renderPage(0);
