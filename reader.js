'use strict';
const $ = id => document.getElementById(id);
const pages = JSON.parse($('reader-data').textContent);
const chapters = JSON.parse($('chapter-data').textContent);
// Chapter breaks may fall inside a PDF page. Keep source indices intact for paragraph audio.
const readingPages = [];
chapters.forEach((chapter, chapterIndex) => {
  const next = chapters[chapterIndex + 1];
  chapter.firstView = readingPages.length;
  for (let sourcePage = chapter.startPage; sourcePage < pages.length; sourcePage++) {
    if (next && sourcePage > next.startPage) break;
    const startParagraph = sourcePage === chapter.startPage ? chapter.startParagraph : 0;
    const endParagraph = next && sourcePage === next.startPage ? next.startParagraph : pages[sourcePage].paragraphs.length;
    if (endParagraph > startParagraph) readingPages.push({ chapterIndex, sourcePage, startParagraph, endParagraph });
    if (next && sourcePage === next.startPage) break;
  }
  chapter.lastView = readingPages.length - 1;
});
let selectedChapter = -1;
const chapterDialog = $('chapter-dialog');
let chapterJumped = false;
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
// Pre-generated word clips live in audio/words/N.bin shards (see tools/generate-words.mjs); a shard is fetched on first use.
let wordMeta = null;
const wordShards = new Map();
function loadWordMeta() {
  if (!wordMeta) wordMeta = fetch('audio/words/index.json').then(response => response.ok ? response.json() : null).catch(() => null);
  return wordMeta;
}
function parseShard(buffer) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  return { header, buffer, base: 4 + headerLength };
}
async function loadWordClip(word) {
  const key = UlyssesAudioKey.wordKey(word);
  const meta = key && await loadWordMeta();
  if (!meta || !meta.shards) return null;
  const shard = UlyssesAudioKey.shardOf(key, meta.shards);
  if (!wordShards.has(shard)) {
    wordShards.set(shard, fetch('audio/words/' + shard + '.bin').then(response => response.ok ? response.arrayBuffer() : null).then(buffer => buffer && parseShard(buffer)).catch(() => null));
  }
  const pack = await wordShards.get(shard);
  if (!pack) { wordShards.delete(shard); return null; }
  const position = pack.header[key];
  return position ? new Blob([pack.buffer.slice(pack.base + position[0], pack.base + position[0] + position[1])], { type: 'audio/mpeg' }) : null;
}
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
// Order: pre-generated word clip (same voice as the paragraphs) -> human recording -> browser voice.
function speak(text, marks = [], preferred = accent, recordingOnly = false) {
  const spoken = text.replace(/^-+|-+$/g, '').trim();
  if (!spoken) return;
  stopSpeaking();
  const token = speakToken;
  markSpeaking(marks);
  if (/^-|-$/.test(text.trim())) { speakSynthetic(spoken, token); return; }
  player.src = SILENT_WAV;
  player.play().catch(() => {});
  if (recordingOnly) { speakRecorded(spoken, token, preferred); return; }
  Promise.race([loadWordClip(spoken), new Promise(resolve => setTimeout(resolve, 2500, null))]).then(clip => {
    if (token !== speakToken) return;
    if (!clip) { speakRecorded(spoken, token, preferred); return; }
    const url = URL.createObjectURL(clip);
    return playRecording(url, token)
      .catch(() => { if (token === speakToken) speakRecorded(spoken, token, preferred); })
      .finally(() => URL.revokeObjectURL(url));
  });
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
    speak(currentQuery, [$(id), $('lookup-speak')], name, true);
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
function updateChapterNavigation(chapterIndex) {
  if (selectedChapter === chapterIndex) return;
  selectedChapter = chapterIndex;
  const chapter = chapters[chapterIndex];
  const options = document.createDocumentFragment();
  for (let i = chapter.firstView; i <= chapter.lastView; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = `本章 ${i - chapter.firstView + 1} / ${chapter.lastView - chapter.firstView + 1}`;
    options.append(option);
  }
  $('page').replaceChildren(options);
  $('current-chapter').textContent = `第 ${chapter.id} 章 · ${chapter.zh}`;
  $('current-chapter').title = `${chapter.zh} · ${chapter.en}`;
  document.title = `${chapter.zh} · 尤利西斯中英对照`;
  for (const button of $('chapter-list').querySelectorAll('[data-chapter-index]')) {
    const active = Number(button.dataset.chapterIndex) === chapterIndex;
    if (active) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
    button.querySelector('.chapter-state').textContent = active ? '正在阅读' : '';
  }
}
function buildChapterDirectory() {
  let part = 0, list;
  for (const [chapterIndex, chapter] of chapters.entries()) {
    if (chapter.part !== part) {
      part = chapter.part;
      $('chapter-list').append(makeText('h3', part === 1 ? '第一部' : '第二部'));
      list = document.createElement('ol');
      $('chapter-list').append(list);
    }
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chapter-link';
    button.dataset.chapterIndex = chapterIndex;
    button.append(makeText('span', String(chapter.id).padStart(2, '0'), 'chapter-number'));
    const name = document.createElement('span');
    name.append(makeText('span', chapter.zh, 'chapter-name'));
    const english = makeText('span', chapter.en, 'chapter-en');
    english.lang = 'en';
    name.append(english);
    const meta = document.createElement('span');
    meta.className = 'chapter-meta';
    const firstPDF = pages[readingPages[chapter.firstView].sourcePage].pdfPage;
    const lastPDF = pages[readingPages[chapter.lastView].sourcePage].pdfPage;
    meta.append(makeText('span', `PDF ${firstPDF}–${lastPDF}`));
    if (chapter.incomplete) meta.append(makeText('span', '部分收录 · 未完'));
    meta.append(makeText('span', '', 'chapter-state'));
    button.append(name, meta);
    button.addEventListener('click', () => {
      chapterJumped = true;
      chapterDialog.close();
      renderPage(chapter.firstView);
    });
    item.append(button);
    list.append(item);
  }
  $('chapter-list').append(makeText('p', '第 11 章尚未收录完整，第 12–18 章不在当前 PDF 中。章名采用通行的荷马式标题；PDF 页内的章节交界已按段落分开。', 'chapter-scope'));
}
function updateFont() {
  document.documentElement.style.setProperty('--text-size', fontSize + 'px');
  $('size').textContent = fontSize;
  $('smaller').disabled = fontSize <= 16;
  $('larger').disabled = fontSize >= 28;
  try { localStorage.setItem('ulysses-reader-font', fontSize); } catch (e) {}
}
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|etc|No)\.\s*$/;
function splitSentences(text) {
  const raw = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g);
  if (!raw || raw.join('') !== text) return [text];
  const merged = [];
  for (const part of raw) {
    if (merged.length && ABBREVIATION.test(merged[merged.length - 1])) merged[merged.length - 1] += part;
    else merged.push(part);
  }
  return merged;
}
function appendEnglish(element, text) {
  for (const part of splitSentences(text)) {
    const sentence = document.createElement('span');
    sentence.className = 'sent';
    appendWords(sentence, part);
    element.append(sentence);
  }
}
function appendWords(element, text) {
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
  pageIndex = Math.min(readingPages.length - 1, Math.max(0, i));
  const view = readingPages[pageIndex];
  const chapter = chapters[view.chapterIndex];
  const page = pages[view.sourcePage];
  updateChapterNavigation(view.chapterIndex);
  const content = document.createDocumentFragment();
  const pageNo = view.sourcePage;
  page.paragraphs.slice(view.startParagraph, view.endParagraph).forEach((pair, offset) => {
    const paragraphNo = view.startParagraph + offset;
    const row = document.createElement('div');
    row.className = 'pair';
    row.dataset.page = pageNo;
    row.dataset.paragraph = paragraphNo;
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
      const note = document.createElement('button');
      note.type = 'button';
      note.className = 'para-note';
      note.textContent = '✎';
      note.title = '选句加入笔记本';
      note.setAttribute('aria-label', '选择本段句子加入笔记本');
      note.setAttribute('aria-pressed', 'false');
      note.addEventListener('click', () => {
        const on = !en.classList.contains('selecting');
        en.classList.toggle('selecting', on);
        note.setAttribute('aria-pressed', String(on));
        note.textContent = on ? '完成' : '✎';
        if (on) showToast('点句子即可加入或移出笔记本');
      });
      en.append(button, note);
    }
    const zh = document.createElement('p');
    zh.className = 'zh';
    zh.lang = 'zh-CN';
    zh.textContent = pair.zh;
    row.append(en, zh);
    content.append(row);
  });
  $('parallel').replaceChildren(content);
  refreshSavedMarks();
  $('page').value = pageIndex;
  $('source-page').textContent = `PDF 第 ${page.pdfPage} 页`;
  $('prev').disabled = pageIndex === 0;
  $('next').disabled = pageIndex === readingPages.length - 1;
  const first = pageIndex === chapter.firstView;
  const last = pageIndex === chapter.lastView;
  const intro = document.querySelector('.intro');
  intro.hidden = !first;
  $('chapter-part').textContent = `${chapter.part === 1 ? '第一部' : '第二部'} · 第 ${chapter.id} 章`;
  $('chapter-title').textContent = chapter.zh;
  $('chapter-subtitle').textContent = chapter.en + (chapter.incomplete ? ' · 部分收录' : '');
  $('prev').textContent = first && pageIndex > 0 ? '‹ 上一章' : '‹ 上一页';
  $('prev').setAttribute('aria-label', first && pageIndex > 0 ? '上一章末页' : '上一页');
  $('next').textContent = last && pageIndex < readingPages.length - 1 ? '下一章 ›' : '下一页 ›';
  $('next').setAttribute('aria-label', last && pageIndex < readingPages.length - 1 ? '下一章' : '下一页');
  $('continuation').textContent = last
    ? chapter.incomplete ? '当前 PDF 收录至此 · 第 11 章尚未结束'
      : `第 ${chapter.id} 章完 · 下一章：${chapters[view.chapterIndex + 1].zh}`
    : page.endsMidParagraph ? '本页末句接续至下一页' : '';
  $('parallel').classList.toggle('opening', pageIndex === 0);
  $('progress').style.width = ((pageIndex - chapter.firstView + 1) / (chapter.lastView - chapter.firstView + 1) * 100) + '%';
  $('reading').scrollTop = 0;
  $('announcement').textContent = `第 ${chapter.id} 章，${chapter.zh}，本章第 ${pageIndex - chapter.firstView + 1} 页，PDF 第 ${page.pdfPage} 页`;
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
  const firstDefinition = source => source?.state === 'ok' ? source.entry.definitions?.[0] : null;
  const translation = result.en?.state === 'ok' ? result.en.entry.chineseTranslations?.[0] : null;
  currentGloss = currentGloss || (firstDefinition(result.zh)?.text || (translation ? translation.terms.join(' / ') : '') || firstDefinition(result.en)?.text || '').slice(0, 140);
  const savedWord = notebook.get(notebook.wordId(currentQuery));
  if (savedWord && !savedWord.gloss && currentGloss) notebook.update(savedWord.id, { gloss: currentGloss });
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
  currentSource = element ? sourceOf(element) : options.refresh ? currentSource : null;
  currentGloss = typeof context === 'string' ? context : '';
  updateSaveButton();
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
  if (!word || word.closest('p.selecting')) return;
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
  const sentence = event.target.closest('.sent');
  if (sentence && sentence.closest('p.selecting')) { toggleSentence(sentence); return; }
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
const notebook = UlyssesNotebook;
const notebookDialog = $('notebook-dialog');
let notebookTab = 'word', clearTimer = 0, currentSource = null, currentGloss = '';
function viewIndexFor(sourcePage, paragraph) {
  const index = readingPages.findIndex(view => view.sourcePage === sourcePage && paragraph >= view.startParagraph && paragraph < view.endParagraph);
  return index < 0 ? 0 : index;
}
function sourceOf(element) {
  const pair = element.closest('.pair');
  if (!pair) return null;
  const sentence = element.closest('.sent');
  return { page: Number(pair.dataset.page), paragraph: Number(pair.dataset.paragraph), context: sentence ? sentence.textContent.trim() : '' };
}
function refreshSavedMarks() {
  document.querySelectorAll('#parallel .word').forEach(el => el.classList.toggle('saved-word', notebook.has(notebook.wordId(el.dataset.word))));
  document.querySelectorAll('#parallel .sent').forEach(el => el.classList.toggle('saved', notebook.has(notebook.sentenceId(el.textContent))));
}
function updateNotebookCount() {
  const total = notebook.count();
  $('notebook-count').textContent = total > 99 ? '99+' : String(total);
  $('notebook-count').hidden = total === 0;
}
function updateSaveButton() {
  const saved = !!currentQuery && notebook.has(notebook.wordId(currentQuery));
  $('lookup-save').setAttribute('aria-pressed', String(saved));
  $('lookup-save').textContent = saved ? '★ 已在笔记本' : '☆ 加入笔记本';
}
const STORAGE_FAILED = '浏览器无法保存笔记，请检查是否开启了无痕模式或存储已满。';
function toggleSentence(element) {
  const text = element.textContent.trim();
  const source = sourceOf(element);
  if (!text || !source) return;
  const id = notebook.sentenceId(text);
  if (notebook.has(id)) {
    notebook.remove(id);
    showToast('已从笔记本移出这个句子');
  } else {
    const page = pages[source.page];
    const ok = notebook.add({ id, type: 'sentence', text, zh: page.paragraphs[source.paragraph].zh, page: source.page, paragraph: source.paragraph, pdfPage: page.pdfPage });
    showToast(ok ? '已加入笔记本 · 句子' : STORAGE_FAILED);
  }
  refreshSavedMarks();
  updateNotebookCount();
}
$('lookup-save').addEventListener('click', () => {
  if (!currentQuery) return;
  const id = notebook.wordId(currentQuery);
  if (notebook.has(id)) {
    notebook.remove(id);
  } else {
    const source = currentSource;
    const ok = notebook.add({ id, type: 'word', text: currentQuery, gloss: currentGloss, context: source?.context || '', page: source?.page, paragraph: source?.paragraph, pdfPage: source ? pages[source.page].pdfPage : undefined });
    if (!ok) $('lookup-status').textContent = STORAGE_FAILED;
  }
  updateSaveButton();
  refreshSavedMarks();
  updateNotebookCount();
});
function noteButton(label, onClick, className) {
  const button = makeText('button', label, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}
function locateNote(item) {
  notebookDialog.close();
  renderPage(viewIndexFor(item.page, item.paragraph));
  const pair = [...document.querySelectorAll('#parallel .pair')].find(row => Number(row.dataset.page) === item.page && Number(row.dataset.paragraph) === item.paragraph);
  if (!pair) return;
  pair.scrollIntoView({ block: 'center' });
  pair.classList.add('flash');
  setTimeout(() => pair.classList.remove('flash'), 1900);
}
function noteItem(item) {
  const article = document.createElement('article');
  article.className = 'note-item' + (item.type === 'sentence' ? ' is-sentence' : '');
  const main = document.createElement('div');
  main.className = 'note-main';
  const text = makeText('b', item.text, 'note-text');
  text.lang = 'en';
  main.append(text);
  if (item.gloss) main.append(makeText('span', item.gloss, 'note-gloss'));
  article.append(main);
  if (item.type === 'word' && item.context) {
    const context = makeText('p', item.context, 'note-context');
    context.lang = 'en';
    article.append(context);
  }
  if (item.type === 'sentence' && item.zh) {
    const details = document.createElement('details');
    details.className = 'note-zh';
    details.append(makeText('summary', '对应中文段落'), makeText('p', item.zh));
    article.append(details);
  }
  const date = new Date(item.addedAt).toLocaleDateString('zh-CN');
  article.append(makeText('p', (item.pdfPage ? `PDF 第 ${item.pdfPage} 页 · ` : '') + date, 'note-meta'));
  const actions = document.createElement('div');
  actions.className = 'note-actions';
  const speakButton = noteButton('朗读', () => (item.type === 'word' ? speak(item.text, [speakButton]) : speakParagraph(item.text, [speakButton])));
  actions.append(speakButton);
  if (item.type === 'word') actions.append(noteButton('查词', () => { notebookDialog.close(); showWord(item.text); }));
  if (Number.isInteger(item.page) && Number.isInteger(item.paragraph)) actions.append(noteButton('原文', () => locateNote(item)));
  actions.append(noteButton('删除', () => {
    notebook.remove(item.id);
    renderNotebook();
    refreshSavedMarks();
    updateNotebookCount();
    updateSaveButton();
  }, 'note-delete'));
  article.append(actions);
  return article;
}
function renderNotebook() {
  const items = notebook.list(notebookTab);
  for (const tab of document.querySelectorAll('[data-notebook-tab]')) {
    const on = tab.dataset.notebookTab === notebookTab;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    tab.textContent = (tab.dataset.notebookTab === 'word' ? '单词 ' : '句子 ') + notebook.count(tab.dataset.notebookTab);
  }
  $('notebook-list').replaceChildren(...items.map(noteItem));
  $('notebook-empty').hidden = items.length > 0;
  $('notebook-empty').textContent = notebookTab === 'word' ? '还没有单词。查词时点“☆ 加入笔记本”。' : '还没有句子。点段落末尾的 ✎，再点想收藏的句子。';
  const any = notebook.count() > 0;
  for (const id of ['notebook-copy', 'notebook-csv', 'notebook-clear']) $(id).disabled = !any;
  $('notebook-clear').textContent = '清空';
  clearTimeout(clearTimer);
}
$('notebook-open').addEventListener('click', () => {
  cancelPress();
  stopSpeaking();
  toggleThemeMenu(false);
  $('notebook-status').textContent = '';
  renderNotebook();
  notebookDialog.showModal();
});
$('notebook-close').addEventListener('click', () => notebookDialog.close());
notebookDialog.addEventListener('close', () => { stopSpeaking(); $('notebook-open').focus({ preventScroll: true }); });
let notebookBackdropPress = false;
notebookDialog.addEventListener('pointerdown', event => { notebookBackdropPress = event.target === notebookDialog; });
notebookDialog.addEventListener('click', event => {
  const rect = notebookDialog.getBoundingClientRect();
  if (notebookBackdropPress && event.target === notebookDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) notebookDialog.close();
  notebookBackdropPress = false;
});
for (const tab of document.querySelectorAll('[data-notebook-tab]')) {
  tab.addEventListener('click', () => { notebookTab = tab.dataset.notebookTab; renderNotebook(); });
}
$('notebook-copy').addEventListener('click', () => {
  const done = ok => { $('notebook-status').textContent = ok ? '已复制到剪贴板。' : '复制失败，请改用导出 CSV。'; };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(notebook.toText()).then(() => done(true), () => done(false));
  else done(false);
});
$('notebook-csv').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([notebook.toCSV()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ulysses-notebook.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('notebook-status').textContent = '已导出 CSV。';
});
$('notebook-clear').addEventListener('click', () => {
  if (!clearTimer) {
    $('notebook-clear').textContent = '再点一次确认清空';
    clearTimer = setTimeout(() => { clearTimer = 0; $('notebook-clear').textContent = '清空'; }, 4000);
    return;
  }
  clearTimeout(clearTimer);
  clearTimer = 0;
  notebook.clear();
  renderNotebook();
  refreshSavedMarks();
  updateNotebookCount();
  updateSaveButton();
  $('notebook-status').textContent = '笔记本已清空。';
});
$('chapter-open').addEventListener('click', () => {
  cancelPress();
  stopSpeaking();
  toggleThemeMenu(false);
  chapterJumped = false;
  chapterDialog.showModal();
  const current = $('chapter-list').querySelector('[aria-current=location]');
  current?.focus({ preventScroll: true });
  current?.scrollIntoView({ block: 'center' });
});
$('chapter-close').addEventListener('click', () => chapterDialog.close());
chapterDialog.addEventListener('close', () => {
  (chapterJumped ? $('reading') : $('chapter-open')).focus({ preventScroll: true });
});
let chapterBackdropPress = false;
chapterDialog.addEventListener('pointerdown', event => { chapterBackdropPress = event.target === chapterDialog; });
chapterDialog.addEventListener('click', event => {
  const rect = chapterDialog.getBoundingClientRect();
  if (chapterBackdropPress && event.target === chapterDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) chapterDialog.close();
  chapterBackdropPress = false;
});
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
buildChapterDirectory();
updateFont();
updateNotebookCount();
renderPage(0);
