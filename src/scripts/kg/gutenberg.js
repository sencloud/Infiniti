// Project Gutenberg 英文原著：下载 HTML 版（缓存到 data/<graph>/source.html），按书的标题规律拆成单元。
// 正文只取 *** START … *** END 之间的段落；首字下沉的图片还原成字母，页码、插图说明不算正文。
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const UA = 'InfinitiKG/1.0 (local knowledge-graph demo)';

export const ebookUrl = (n) => `https://www.gutenberg.org/cache/epub/${n}/pg${n}-images.html`;
export const ebookImageUrl = (n, src) => new URL(src, ebookUrl(n)).href;

export async function fetchEbook(n, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(ebookUrl(n), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, html);
      }
      return html;
    } catch (e) {
      if (i >= 3) throw new Error(`下载 Gutenberg #${n} 失败：${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
export function roman(s) {
  let total = 0;
  const up = String(s).toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const v = ROMAN[up[i]] || 0;
    total += v < (ROMAN[up[i + 1]] || 0) ? -v : v;
  }
  return total;
}

const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'or']);
const titleCase = (s) => s.toLowerCase().replace(/[a-z][a-z’']*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));

export const squashSpace = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** 正文区：START 与 END 分隔之间，取不到就用整页 */
function bodyHtml(html) {
  const start = html.search(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG/i);
  const end = html.search(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i);
  if (start < 0 || end < start) return html;
  return html.slice(html.indexOf('\n', start), html.lastIndexOf('<', end));
}

const CAPTION_BOX = /fig|caption|illus|blk|image/i;

/** 按文档顺序列出标题与段落：[{kind:'head', tag, text} | {kind:'p', text}] */
export function linearize(html) {
  const $ = cheerio.load(bodyHtml(html));
  $('span.pagenum, .pagenum, script, style, table').remove();
  // 首字下沉：<img alt="M">、<span class="dropcap">T</span>
  $('img').each((_, el) => {
    const alt = $(el).attr('alt') || '';
    $(el).replaceWith(/^[A-Za-z“"‘']{1,2}$/.test(alt.trim()) ? alt.trim() : '');
  });
  $('br').replaceWith(' ');
  const out = [];
  $('h1, h2, h3, h4, p').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'p') {
      if (node.parents().filter((_, a) => CAPTION_BOX.test($(a).attr('class') || '')).length) return;
      const text = squashSpace(node.text());
      if (text) out.push({ kind: 'p', text });
      return;
    }
    const clone = node.clone();
    clone.find('.caption').remove();
    out.push({ kind: 'head', tag: el.tagName, text: squashSpace(clone.text()), caption: squashSpace(node.find('.caption').text()) });
  });
  return out;
}

/**
 * 各书的拆分规则：head(item, state) 返回
 *   { start: {title, label?} }  开始新单元
 *   { carry: true }             之后的段落并入下一个单元（剧本的开场诗、致辞）
 *   { skip: true }              之后的段落丢弃（目录、版权页）
 *   null                        普通标题，忽略
 */
const SPLITS = {
  pride: {
    head: (h) => {
      const m = h.tag === 'h2' && h.text.match(/CHAPTER\s*([IVXLC]+)\.?/i);
      return m ? { start: { title: h.caption.replace(/[“”"]/g, '').replace(/\.$/, '') } } : h.tag === 'h2' ? { skip: true } : null;
    },
  },
  alice: {
    head: (h) => {
      const m = h.tag === 'h2' && h.text.match(/^CHAPTER\s+([IVXLC]+)\.\s*(.+)$/i);
      return m ? { start: { title: m[2] } } : h.tag === 'h2' ? { skip: true } : null;
    },
  },
  sherlock: {
    head: (h) => {
      const m = h.tag === 'h2' && h.text.match(/^([IVXLC]+)\.\s*(.+)$/);
      return m ? { start: { title: titleCase(m[2]) } } : h.tag === 'h2' ? { skip: true } : null;
    },
  },
  gatsby: {
    head: (h) => (h.tag === 'h2' ? (/^[IVX]+$/.test(h.text) ? { start: { title: '' } } : { skip: true }) : null),
  },
  janeeyre: {
    head: (h) => {
      const m = h.tag === 'h2' && h.text.match(/^CHAPTER\s+([IVXLC]+)/i);
      return m ? { start: { title: '' } } : h.tag === 'h2' ? { skip: true } : null;
    },
  },
  romeo: {
    head: (h, state) => {
      const act = h.tag === 'h2' && h.text.match(/^ACT\s+([IVX]+)/i);
      if (act) {
        state.act = roman(act[1]);
        return null;
      }
      if (h.tag !== 'h3') return h.tag === 'h2' ? { skip: true } : null;
      if (/PROLOGUE|CHORUS/i.test(h.text)) return { carry: true };
      const scene = h.text.match(/^SCENE\s+([IVX]+)\.\s*(.*)$/i);
      if (!scene || !state.act) return { skip: true };
      const zh = '〇一二三四五六七八九十';
      return { start: { title: scene[2].replace(/\.$/, ''), label: `第${zh[state.act]}幕第${zh[roman(scene[1])]}场` } };
    },
  },
};

// 装饰图：封面、出版社标、书脊、扉页、首字下沉
const DECOR = /cover|logo|colophon|title|spine|endpaper|front\.|drop_|letra|ornament|decor|(^|\/)[a-z](-quote)?\.(png|jpg)$/i;
const TRIVIAL_CAPTION = /^(?:illo\d*|frontispiece|\[?pg?\s*\d+\]?|\{?\w{1,4}\}?|image|illustration)$/i;

function cleanCaption(s) {
  return squashSpace(s)
    .replace(/\[(?:Copyright|Page|Pg)[^\]]*\]/gi, '')
    .replace(/^\s*[“"]|[”"]\s*$/g, '')
    .replace(/\s*(?:Chap(?:ter)?\.?|Page)\s*\d+\.?\s*$/i, '')
    .trim();
}

/**
 * 插图本里的插图：[{src, caption, anchor}]，anchor 是图后（没有就图前）最近的一段正文，用来在原文里定位章节。
 * 说明取 alt、同一图框里的 .caption 或说明段落。
 */
export function illustrations(html) {
  const $ = cheerio.load(bodyHtml(html));
  $('span.pagenum, .pagenum').remove();
  const seq = [];
  $('img, p').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'img') {
      const src = node.attr('src') || '';
      const alt = squashSpace(node.attr('alt'));
      if (!src || DECOR.test(src) || /^[“"‘']?[A-Z]$/.test(alt)) return;
      const box = node.closest('figure, div, h2, h3');
      const boxed = box.find('.caption, figcaption').first().text() || (box.is('figure, div') ? box.find('p').first().text() : '');
      const raw = alt.length > 3 && !TRIVIAL_CAPTION.test(alt) ? alt : boxed;
      const chap = raw.match(/Chap(?:ter)?\.?\s*(\d+)/i);
      const href = node.closest('a').attr('href');
      seq.push({
        kind: 'img', src, full: href && /\.(jpe?g|png)$/i.test(href) ? href : null, caption: cleanCaption(raw), chapter: chap ? Number(chap[1]) : null,
      });
      return;
    }
    if (node.parents().filter((_, a) => CAPTION_BOX.test($(a).attr('class') || '')).length) return;
    const text = squashSpace(node.text());
    if (text.length > 80) seq.push({ kind: 'p', text });
  });
  const out = [];
  seq.forEach((item, i) => {
    if (item.kind !== 'img' || !item.caption || TRIVIAL_CAPTION.test(item.caption)) return;
    const after = seq.slice(i + 1).filter((x) => x.kind === 'p').slice(0, 3).map((x) => x.text);
    const before = seq.slice(0, i).filter((x) => x.kind === 'p').slice(-2).map((x) => x.text);
    out.push({ src: item.src, full: item.full, caption: item.caption, chapter: item.chapter, anchors: [...after, ...before.reverse()] });
  });
  return out;
}

const letters = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

/** 用正文片段在本书各单元里找位置：返回 {no, para} 或 null（不同版本标点、换行不同，只比字母） */
export function locateText(chapters, anchors) {
  const index = chapters.map((c) => ({ no: c.no, paras: c.paragraphs.map(letters) }));
  const find = (probe) => {
    for (const c of index) {
      const para = c.paras.findIndex((p) => p.includes(probe));
      if (para >= 0) return { no: c.no, para };
    }
    return null;
  };
  for (const anchor of anchors) {
    const flat = letters(anchor);
    if (flat.length < 40) continue;
    const hit = find(flat.slice(Math.floor(flat.length / 3), Math.floor(flat.length / 3) + 40));
    if (hit) return hit;
  }
  return null;
}

/** 插图位置：说明多是原文里的一句话，先按说明找；再看说明里标的章号；最后按图旁的段落找 */
export function locateIllustration(chapters, ill) {
  const cap = letters(ill.caption);
  const findIn = (list) => {
    for (const c of list) {
      const para = c.paragraphs.findIndex((p) => letters(p).includes(cap.slice(0, 60)));
      if (para >= 0) return { no: c.no, para };
    }
    return null;
  };
  // 标了章号的，短说明（「Mr. Darcy with him」）也能在该章里找到原句
  const hinted = ill.chapter && chapters.find((c) => c.no === ill.chapter);
  const hit = (hinted && cap.length >= 8 && findIn([hinted])) || (cap.length >= 20 && findIn(chapters));
  if (hit) return hit;
  if (hinted) return { no: hinted.no, para: 0 };
  // 章首图紧挨着该章开头，按图旁段落定到章，再在章里找说明原句
  const near = locateText(chapters, ill.anchors);
  const chapter = near && chapters.find((c) => c.no === near.no);
  return (chapter && cap.length >= 8 && findIn([chapter])) || near;
}

/** 没有标题的章（傲慢与偏见、简·爱、盖茨比）用首句前几个词作回目，便于在列表里认出来 */
function fallbackTitle(paragraphs) {
  const first = paragraphs.find((p) => p.length > 30) || paragraphs[0] || '';
  const sentence = first.split(/(?<=[.!?])\s/)[0];
  const words = sentence.split(' ');
  return words.length > 9 ? `${words.slice(0, 9).join(' ')}…` : sentence;
}

// 星号分隔行、印刷所落款、THE END
const NOT_TEXT = /^(?:[*\s]+|THE END\.?|CHISWICK PRESS.*)$/i;

export function splitEbook(graphId, html) {
  const rule = SPLITS[graphId];
  if (!rule) throw new Error(`${graphId} 没有 Gutenberg 拆分规则`);
  const units = [];
  const state = {};
  let current = null;
  let carry = null;
  let mode = 'skip';
  for (const item of linearize(html)) {
    if (item.kind === 'head') {
      const r = rule.head(item, state);
      if (!r) continue;
      if (r.start) {
        current = { title: r.start.title, label: r.start.label || null, paragraphs: carry || [] };
        carry = null;
        units.push(current);
        mode = 'unit';
      } else if (r.carry) {
        carry = [];
        mode = 'carry';
      } else if (r.skip) {
        mode = 'skip';
      }
      continue;
    }
    if (/^THE FULL PROJECT GUTENBERG/i.test(item.text)) break;
    if (NOT_TEXT.test(item.text)) continue;
    if (mode === 'unit') current.paragraphs.push(item.text);
    else if (mode === 'carry') carry.push(item.text);
  }
  return units
    .filter((u) => u.paragraphs.length)
    .map((u, i) => ({ no: i + 1, title: u.title || fallbackTitle(u.paragraphs), label: u.label, paragraphs: u.paragraphs }));
}
