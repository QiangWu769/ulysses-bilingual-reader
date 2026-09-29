/* Personal notebook of saved words and sentences, kept in this browser's localStorage. */
(function (root) {
  'use strict';

  let KEY = 'ulysses-notebook-v1';
  let bookTitle = '尤利西斯';
  const key = root.UlyssesAudioKey;
  let items = null;

  function wordId(text) { return 'w:' + String(text).normalize('NFKC').replace(/[‘’]/g, "'").trim().toLowerCase(); }
  function sentenceId(text) { return 's:' + key.hash(key.normalise(text)); }

  function valid(item) {
    return item && (item.type === 'word' || item.type === 'sentence') && typeof item.id === 'string' && typeof item.text === 'string' && item.text;
  }
  function load() {
    if (items) return items;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      items = Array.isArray(saved) ? saved.filter(valid) : [];
    } catch (e) { items = []; }
    return items;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); return true; } catch (e) { return false; }
  }

  function has(id) { return load().some(item => item.id === id); }
  function get(id) { return load().find(item => item.id === id) || null; }
  function list(type) { return load().filter(item => !type || item.type === type).sort((a, b) => b.addedAt - a.addedAt); }
  function count(type) { return load().filter(item => !type || item.type === type).length; }

  // Returns false when the browser refuses to store (private mode, quota).
  function add(item) {
    load();
    if (!valid(item) || has(item.id)) return true;
    items.push(Object.assign({ addedAt: Date.now() }, item));
    if (!persist()) { items.pop(); return false; }
    return true;
  }
  function remove(id) {
    load();
    const before = items.length;
    items = items.filter(item => item.id !== id);
    if (items.length !== before) persist();
  }
  function update(id, patch) {
    const item = get(id);
    if (!item) return;
    Object.assign(item, patch);
    persist();
  }
  function clear() { items = []; persist(); }

  function csvCell(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
  function toCSV() {
    const rows = [['书名', '类型', '内容', '释义', '原句', '对应中文段落', '页码', '添加时间']];
    for (const item of list().reverse()) {
      rows.push([bookTitle, item.type === 'word' ? '单词' : '句子', item.text, item.gloss || '', item.context || '', item.zh || '',
        item.pdfPage ? 'PDF 第 ' + item.pdfPage + ' 页' : Number.isInteger(item.page) ? '阅读第 ' + (item.page + 1) + ' 页' : '', new Date(item.addedAt).toISOString().slice(0, 10)]);
    }
    return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  function toText() {
    const words = list('word').reverse(), sentences = list('sentence').reverse();
    const out = [];
    if (words.length) out.push('【单词】', ...words.map(item => item.text + (item.gloss ? ' — ' + item.gloss : '') + (item.context ? '\n  ' + item.context : '')), '');
    if (sentences.length) out.push('【句子】', ...sentences.map(item => item.text + (item.zh ? '\n  ' + item.zh : '')));
    return out.join('\n').trim();
  }

  function selectBook(id, title) { KEY = id === 'ulysses' ? 'ulysses-notebook-v1' : 'reader-notebook-v1:' + id; bookTitle = title; items = null; }

  root.UlyssesNotebook = { selectBook, wordId, sentenceId, has, get, list, count, add, remove, update, clear, toCSV, toText };
})(typeof window !== 'undefined' ? window : globalThis);
