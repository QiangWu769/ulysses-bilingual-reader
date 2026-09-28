#!/usr/bin/env node
// Pre-generates one MP3 per English paragraph with Google Cloud Text-to-Speech, so visitors need no API key.
// Run it on your own computer; the key is read from GOOGLE_TTS_API_KEY and never written anywhere.
//
//   export GOOGLE_TTS_API_KEY=...            (PowerShell: $env:GOOGLE_TTS_API_KEY="...")
//   node tools/generate-audio.mjs --dry-run  count characters only, no requests
//   node tools/generate-audio.mjs --pages 1-3
//   node tools/generate-audio.mjs            everything (already generated files are skipped)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { name: audioName, normalise } = require('../audio-key.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'audio');

const args = process.argv.slice(2);
const flag = (key, fallback) => { const i = args.indexOf('--' + key); return i >= 0 ? (args[i + 1] ?? true) : fallback; };
const dryRun = args.includes('--dry-run');
const voiceName = flag('voice', 'en-US-Chirp3-HD-Aoede');
const rate = Number(flag('rate', 0.95));
const concurrency = Number(flag('concurrency', 3));
const endpoint = process.env.TTS_ENDPOINT || 'https://texttospeech.googleapis.com/v1/text:synthesize';
const apiKey = process.env.GOOGLE_TTS_API_KEY || '';
const languageCode = voiceName.split('-').slice(0, 2).join('-');
const MAX_CHUNK = 2500;

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/<script id="reader-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw new Error('reader-data not found in index.html');
const pages = JSON.parse(match[1]);

const range = String(flag('pages', `1-${pages.length}`)).match(/^(\d+)(?:-(\d+))?$/);
if (!range) throw new Error('--pages must look like 3 or 1-5');
const first = Math.max(1, Number(range[1])), last = Math.min(pages.length, Number(range[2] || range[1]));

const jobs = [];
for (let p = first - 1; p < last; p++) {
  pages[p].paragraphs.forEach((pair, q) => {
    const text = normalise(pair.en);
    if (text) jobs.push({ name: audioName(p, q, pair.en), text });
  });
}
const chars = jobs.reduce((sum, job) => sum + job.text.length, 0);
console.log(`Pages ${first}-${last}: ${jobs.length} paragraphs, ${chars.toLocaleString()} characters, voice ${voiceName}`);
if (dryRun) { console.log('Dry run: nothing sent. Compare the character count with your monthly free quota.'); process.exit(0); }
if (!apiKey) { console.error('Set GOOGLE_TTS_API_KEY first.'); process.exit(1); }

function chunks(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [text];
  const out = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + sentence).length > MAX_CHUNK) { out.push(current.trim()); current = ''; }
    current += sentence;
    while (current.length > MAX_CHUNK) { out.push(current.slice(0, MAX_CHUNK)); current = current.slice(MAX_CHUNK); }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function synthesize(text) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({ input: { text }, voice: { languageCode, name: voiceName }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } })
    });
    if (response.ok) return Buffer.from((await response.json()).audioContent, 'base64');
    if (response.status === 429 || response.status >= 500) { await new Promise(r => setTimeout(r, 1500 * 2 ** attempt)); continue; }
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  throw new Error('too many retries');
}

fs.mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, 'manifest.json');
let existing = [];
try { existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || []; } catch (e) {}
const files = new Set(existing.filter(n => fs.existsSync(path.join(outDir, n + '.mp3'))));
const writeManifest = () => fs.writeFileSync(manifestPath, JSON.stringify({ voice: voiceName, files: [...files].sort() }));

const queue = jobs.filter(job => !files.has(job.name));
console.log(`${jobs.length - queue.length} already done, ${queue.length} to generate.`);
let done = 0, failed = 0, stop = false;
async function worker() {
  while (queue.length && !stop) {
    const job = queue.shift();
    try {
      const parts = [];
      for (const piece of chunks(job.text)) parts.push(await synthesize(piece));
      fs.writeFileSync(path.join(outDir, job.name + '.mp3'), Buffer.concat(parts));
      files.add(job.name);
      done++;
      if (done % 10 === 0) { writeManifest(); console.log(`  ${done}/${done + queue.length + failed}`); }
    } catch (error) {
      failed++;
      console.error(`Failed ${job.name}: ${error.message}`);
      if (/HTTP (400|401|403)/.test(error.message)) { stop = true; console.error('Stopping: check the key, that the Text-to-Speech API is enabled, and the voice name.'); }
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
writeManifest();
console.log(`Finished: ${done} generated, ${failed} failed. Manifest lists ${files.size} files.`);
process.exit(failed ? 1 : 0);
