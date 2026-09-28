#!/usr/bin/env node
// Pre-generates a clip for every distinct word in the book with Google Cloud Text-to-Speech and packs them into
// small shard files (audio/words/N.bin), so tapping a word plays the same voice as the paragraphs with no key.
//
//   export GOOGLE_TTS_API_KEY=...            (PowerShell: $env:GOOGLE_TTS_API_KEY="...")
//   node tools/generate-words.mjs --dry-run  count words only
//   node tools/generate-words.mjs            generate + pack; finished words are cached, so it can be resumed
//   node tools/generate-words.mjs --pack-only   rebuild shards from the cache without any requests
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { wordKey, shardOf } = require('../audio-key.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'audio', 'words');

const args = process.argv.slice(2);
const flag = (key, fallback) => { const i = args.indexOf('--' + key); return i >= 0 ? (args[i + 1] ?? true) : fallback; };
const dryRun = args.includes('--dry-run');
const packOnly = args.includes('--pack-only');
const voiceName = flag('voice', 'en-US-Chirp3-HD-Aoede');
const rate = Number(flag('rate', 0.95));
const concurrency = Number(flag('concurrency', 8));
const SHARDS = Number(flag('shards', 256));
const cacheDir = path.resolve(root, flag('cache', 'tools/.word-cache'));
const endpoint = process.env.TTS_ENDPOINT || 'https://texttospeech.googleapis.com/v1/text:synthesize';
const apiKey = process.env.GOOGLE_TTS_API_KEY || '';
const languageCode = voiceName.split('-').slice(0, 2).join('-');

// Keep this pattern identical to the tokenizer in reader.js (appendWords).
const TOKEN = /\b(?:[A-Za-z]\.){2,}|[A-Za-z]+(?:[’'-][A-Za-z]+)*/g;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/<script id="reader-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw new Error('reader-data not found in index.html');
const words = new Set();
for (const page of JSON.parse(match[1])) for (const pair of page.paragraphs) for (const token of pair.en.matchAll(TOKEN)) {
  const key = wordKey(token[0]);
  if (key) words.add(key);
}
const list = [...words].sort();
const chars = list.reduce((sum, word) => sum + word.length, 0);
console.log(`${list.length} distinct words, ${chars.toLocaleString()} characters, voice ${voiceName}, ${SHARDS} shards`);
if (dryRun) { console.log('Dry run: nothing sent.'); process.exit(0); }

const fileFor = word => path.join(cacheDir, encodeURIComponent(word).replace(/'/g, '%27') + '.mp3');
fs.mkdirSync(cacheDir, { recursive: true });

async function synthesize(text) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({ input: { text }, voice: { languageCode, name: voiceName }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } })
    });
    if (response.ok) return Buffer.from((await response.json()).audioContent, 'base64');
    if (response.status === 429 || response.status >= 500) { await new Promise(r => setTimeout(r, 1500 * 2 ** attempt)); continue; }
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  throw new Error('too many retries');
}

let done = 0, failed = 0, stop = false;
if (!packOnly) {
  if (!apiKey) { console.error('Set GOOGLE_TTS_API_KEY first.'); process.exit(1); }
  const queue = list.filter(word => !fs.existsSync(fileFor(word)));
  console.log(`${list.length - queue.length} cached, ${queue.length} to generate.`);
  const total = queue.length;
  async function worker() {
    while (queue.length && !stop) {
      const word = queue.shift();
      try {
        fs.writeFileSync(fileFor(word), await synthesize(word));
        if (++done % 200 === 0) console.log(`  ${done}/${total}`);
      } catch (error) {
        failed++;
        console.error(`Failed ${word}: ${error.message}`);
        if (/HTTP (400|401|403)/.test(error.message)) { stop = true; console.error('Stopping: check the key, that the Text-to-Speech API is enabled, and the voice name.'); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

// Shard format: uint32 LE header length, JSON header {word: [offset, length]}, then the concatenated MP3 bytes.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const buckets = Array.from({ length: SHARDS }, () => []);
let packed = 0, bytes = 0;
for (const word of list) if (fs.existsSync(fileFor(word))) buckets[shardOf(word, SHARDS)].push(word);
buckets.forEach((bucket, index) => {
  const header = {};
  const chunks = [];
  let offset = 0;
  for (const word of bucket) {
    const data = fs.readFileSync(fileFor(word));
    header[word] = [offset, data.length];
    chunks.push(data);
    offset += data.length;
    packed++;
  }
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(head.length, 0);
  const file = Buffer.concat([prefix, head, ...chunks]);
  bytes += file.length;
  fs.writeFileSync(path.join(outDir, index + '.bin'), file);
});
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ voice: voiceName, shards: SHARDS, count: packed }));
console.log(`Packed ${packed}/${list.length} words into ${SHARDS} shards (${(bytes / 1048576).toFixed(1)} MB). Generated ${done}, failed ${failed}.`);
process.exit(failed || packed < list.length ? 1 : 0);
