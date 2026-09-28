(function (global) {
  'use strict';

  const MAX_DEFINITIONS = 40;
  const MAX_ETYMOLOGIES = 6;
  const MAX_TERMS = 16;
  const EN_PARTS = /^(?:noun|proper noun|verb|adjective|adverb|pronoun|determiner|article|numeral|number|conjunction|interjection|preposition|postposition|particle|participle|prefix|suffix|infix|circumfix|interfix|combining form|root|phrase|proverb|contraction|abbreviation|acronym|initialism|letter|symbol|punctuation mark)(?:\s+\d+)?$/i;
  const ZH_PARTS = /^(?:名[词詞]|专有名词|專有名詞|动词|動詞|形容[词詞]|副[词詞]|代[词詞]|限定[词詞]|冠[词詞]|数词|數詞|连词|連詞|感[叹嘆]词|感[叹嘆]詞|介[词詞]|助[词詞]|分[词詞]|前[缀綴]|后缀|後綴|中[缀綴]|[词詞]根|短[语語]|[谚諺][语語]|缩写|縮寫|字母|符号|符號|成[语語])(?:\s*\d+)?$/;
  const OMIT = 'script,style,iframe,object,embed,ul,ol,dl,table,.mw-editsection,.reference,.citation-whole,.h-quotation,.h-usage-example,.usage-example,.quotation,.maintenance-line,.NavFrame,.noprint';

  function cleanText(value, limit) {
    const text = String(value || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    return limit && text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
  }

  function plainClone(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(OMIT).forEach(node => node.remove());
    return clone;
  }

  function safeWord(value) {
    const word = cleanText(value);
    return word.length > 0 && word.length <= 80 && /\p{L}/u.test(word) && /^[-\p{L}\p{M}\d'’ ]+$/u.test(word) ? word : null;
  }

  function linkedWord(link) {
    const href = link.getAttribute('href') || '';
    // Only extract internal dictionary titles, never arbitrary URLs or namespaces.
    const match = href.match(/^(?:https:\/\/(?:en|zh)\.wiktionary\.org)?\/wiki\/([^?#]+)(?:#[^?]*)?$/);
    if (!match || link.classList.contains('new')) return null;
    try { return safeWord(decodeURIComponent(match[1]).replace(/_/g, ' ')); }
    catch (_) { return null; }
  }

  function headingText(heading) {
    return cleanText(plainClone(heading).textContent);
  }

  function blocks(container) {
    const result = [];
    for (const child of container.children) {
      if (/^H[2-6]$/.test(child.tagName)) result.push(child);
      else if (child.classList.contains('mw-heading')) {
        const heading = child.querySelector('h2,h3,h4,h5,h6');
        if (heading) result.push(heading);
      } else if (child.tagName === 'SECTION') result.push(...blocks(child));
      else result.push(child);
    }
    return result;
  }

  function parseWiktionary(html, options = {}) {
    const lang = options.lang === 'zh' ? 'zh' : 'en';
    const output = {
      title: cleanText(options.title, 120),
      lang,
      revid: Number.isSafeInteger(Number(options.revid)) && Number(options.revid) > 0 ? Number(options.revid) : null,
      hasEnglish: false,
      definitions: [], etymologies: [], lemmaCandidates: [], chineseTranslations: []
    };
    if (typeof html !== 'string' || !html || html.length > 4000000) return output;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('.mw-parser-output') || doc.body;
    let inEnglish = false;
    let seenSubheading = false;
    let inEtymology = false;
    let inTranslations = false;
    let etymology = null;
    let partOfSpeech = null;
    let skippedEtymology = false;
    const lemmaSeen = new Set();
    const fallbackDefinitions = [];

    for (const block of blocks(root)) {
      if (/^H[2-6]$/.test(block.tagName)) {
        const label = headingText(block);
        if (block.tagName === 'H2') {
          if (inEnglish) break;
          inEnglish = lang === 'en' ? label === 'English' : /^(?:英语|英語)$/.test(label);
          if (inEnglish) output.hasEnglish = true;
          continue;
        }
        if (!inEnglish) continue;
        seenSubheading = true;
        partOfSpeech = null;
        inTranslations = lang === 'en' && /^Translations(?:\s+\d+)?$/i.test(label);
        inEtymology = lang === 'en' ? /^Etymology(?:\s+\d+)?$/i.test(label) : /^(?:词源|詞源)(?:\s*\d+)?$/.test(label);
        if (inEtymology) {
          skippedEtymology = output.etymologies.length >= MAX_ETYMOLOGIES;
          if (skippedEtymology) { etymology = null; continue; }
          const headline = block.querySelector('.mw-headline');
          const id = cleanText(block.id || (headline && headline.id) || `etymology-${output.etymologies.length + 1}`, 100);
          etymology = { id, label, text: '', terms: [] };
          output.etymologies.push(etymology);
        } else if ((lang === 'en' ? EN_PARTS : ZH_PARTS).test(label)) {
          partOfSpeech = label;
        }
        continue;
      }
      if (!inEnglish || skippedEtymology) continue;

      if (inTranslations && output.chineseTranslations.length < 8) {
        const frames = block.classList.contains('NavFrame') ? [block] : Array.from(block.querySelectorAll('.NavFrame'));
        for (const frame of frames) {
          if (output.chineseTranslations.length >= 8) break;
          const head = Array.from(frame.children).find(node => node.classList.contains('NavHead'));
          if (!head) continue;
          const sense = cleanText(plainClone(head).textContent, 300);
          const terms = [];
          for (const termNode of frame.querySelectorAll('[lang="cmn"],[lang="zh"]')) {
            if (termNode.closest('.NavFrame') !== frame || termNode.closest('.NavHead')) continue;
            const termClone = plainClone(termNode);
            termClone.querySelectorAll('.tr,[lang$="-Latn"]').forEach(node => node.remove());
            const term = cleanText(termClone.textContent, 80);
            if (/\p{Script=Han}/u.test(term) && !terms.includes(term) && terms.length < 8) terms.push(term);
          }
          if (terms.length) output.chineseTranslations.push({ sense, terms });
        }
      }

      if (inEtymology && etymology && block.tagName === 'P') {
        const paragraph = plainClone(block);
        const text = cleanText(paragraph.textContent);
        if (!text) continue;
        const remaining = 2400 - etymology.text.length;
        if (remaining > 0) etymology.text += (etymology.text ? '\n\n' : '') + cleanText(text, remaining);
        // These are terms explicitly mentioned by the source, not an invented decomposition.
        for (const mention of paragraph.querySelectorAll('.mention[lang="en"]')) {
          const link = mention.querySelector('a');
          const word = link && linkedWord(link);
          if (word && !etymology.terms.some(term => term.word === word) && etymology.terms.length < MAX_TERMS) {
            etymology.terms.push({ word, language: 'en' });
          }
        }
      } else if (partOfSpeech && block.tagName === 'OL') {
        for (const item of block.children) {
          if (item.tagName !== 'LI' || output.definitions.length >= MAX_DEFINITIONS) continue;
          const definition = plainClone(item);
          const text = cleanText(definition.textContent, 600);
          if (!text) continue;
          output.definitions.push({ partOfSpeech, text, etymologyId: etymology ? etymology.id : null });
          for (const link of definition.querySelectorAll('.form-of-definition-link a')) {
            const languageNode = link.closest('[lang]');
            if (!languageNode || languageNode.getAttribute('lang') !== 'en') continue;
            const word = linkedWord(link);
            if (word && word !== output.title && !lemmaSeen.has(word) && output.lemmaCandidates.length < 6) {
              lemmaSeen.add(word);
              output.lemmaCandidates.push({ word, definition: text });
            }
          }
        }
      } else if (lang === 'zh' && !seenSubheading && block.tagName === 'P' && fallbackDefinitions.length < 4) {
        // Some short Chinese Wiktionary entries contain only a paragraph below 英语.
        if (block.querySelector('.headword-line,.headword')) continue;
        const text = cleanText(plainClone(block).textContent, 600);
        if (/\p{Script=Han}/u.test(text)) fallbackDefinitions.push({ partOfSpeech: '释义', text, etymologyId: null });
      }
    }
    if (!output.definitions.length) output.definitions = fallbackDefinitions;
    return output;
  }

  global.UlyssesDictionaryParser = { parseWiktionary };
})(typeof window !== 'undefined' ? window : globalThis);
