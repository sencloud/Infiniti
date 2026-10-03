// PDF → 按页的行与段落。文字层用 pdfjs 取字块坐标自己拼行（标准文件常有字距拉开、旋转水印，
// 直接取纯文本会碎成单字），扫描页（没有文字层）交给调用方用 renderPage 渲染后看图转写。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));
const CMAP_URL = `${path.join(PDFJS_DIR, 'cmaps')}${path.sep}`;
const FONT_URL = `${path.join(PDFJS_DIR, 'standard_fonts')}${path.sep}`;

/** 一页正文少于这么多字就当扫描页 */
export const SCAN_CHARS = 20;

export async function openPdf(file) {
  const data = new Uint8Array(await fs.promises.readFile(file));
  return getDocument({
    data, cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: FONT_URL,
    useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise;
}

const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;

/** 拼接两段文字：两边都是西文字母数字才补空格 */
function joinText(a, b) {
  if (!a) return b;
  if (!b) return a;
  return /[A-Za-z0-9,;)]$/.test(a) && /^[A-Za-z0-9(]/.test(b) ? `${a} ${b}` : a + b;
}

/** 中文字之间被字距拉开的空格去掉（「纳 入 单 位」→「纳入单位」） */
export function squeezeCjk(text) {
  return text
    .replace(/([\u3000-\u303f\u3400-\u9fff\uff00-\uffef])[ \t\u00a0]+(?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/g, '$1')
    .replace(/[ \t\u00a0]{2,}/g, ' ')
    .trim();
}

/** 一页的文字行：[{text, x0, x1, top, size}]，自上而下 */
async function pageLines(page) {
  const [, , , y1] = page.view;
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, x, y] = it.transform;
    // 旋转的字（斜铺水印、竖排边注）不是正文
    if (Math.abs(b) > Math.abs(a) * 0.05 + 0.01 || Math.abs(c) > Math.abs(d) * 0.05 + 0.01 || a <= 0) continue;
    const size = Math.abs(d) || Math.abs(a) || 10;
    items.push({ str: it.str, x, w: it.width || 0, top: y1 - y, size });
  }
  items.sort((p, q) => p.top - q.top || p.x - q.x);
  const lines = [];
  for (const it of items) {
    const line = lines.at(-1);
    if (line && Math.abs(it.top - line.top) <= Math.min(it.size, line.size) * 0.55) line.items.push(it);
    else lines.push({ top: it.top, size: it.size, items: [it] });
  }
  return lines.map((line) => {
    line.items.sort((p, q) => p.x - q.x);
    let text = '';
    let end = null;
    for (const it of line.items) {
      if (end != null && it.x - end > line.size * 0.3 && !text.endsWith(' ')) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    const first = line.items[0];
    return {
      text: squeezeCjk(text),
      x0: first.x,
      x1: Math.max(...line.items.map((it) => it.x + it.w)),
      top: line.top,
      size: Math.max(...line.items.map((it) => it.size)),
    };
  }).filter((l) => l.text);
}

/** 每页的行 + 页高；扫描页 lines 为空 */
export async function readPdfLines(doc) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const height = page.view[3] - page.view[1];
    const lines = await pageLines(page);
    page.cleanup();
    const chars = lines.reduce((s, l) => s + l.text.length, 0);
    pages.push({ no: n, height, lines: chars >= SCAN_CHARS ? lines : [], scanned: chars < SCAN_CHARS });
  }
  return pages;
}

// ───────────── 段落重建 ─────────────

const PAGE_NO = /^[-—–\s]*(?:\d{1,4}|[IVXLivxl]{1,6}|[Ⅰ-Ⅻ])[-—–\s]*$/;
const TOC_LINE = /[.…·．\s]{4,}\s*\d{1,4}\s*$/;
const CLAUSE_ONLY = /^(?:[A-Z]\.)?\d+(?:\.\d+)*$/;
const CLAUSE_START = new RegExp([
  '^\\d+(?:\\.\\d+)+\\s', '^\\d{1,2}\\s+[\\u4e00-\\u9fff]', '^[A-Z]\\.\\d+(?:\\.\\d+)*\\s',
  '^附\\s*录\\s*[A-Z]', '^第[一二三四五六七八九十百零〇\\d]+[章节条款]', '^[a-z][)）]', '^[(（]\\d+[)）]',
  '^[(（][一二三四五六七八九十]+[)）]', '^[一二三四五六七八九十]+、', '^[①-⑳]', '^注\\s*\\d*\\s*[:：]',
  '^示例\\s*\\d*\\s*[:：]', '^表\\s*[A-Z]?\\.?\\d+', '^图\\s*[A-Z]?\\.?\\d+', '^——', '^前\\s*言$', '^引\\s*言$',
].join('|'));

const zoneKey = (text) => text.replace(/\d+/g, '#').replace(/\s+/g, '');

function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

/** 页眉页脚：页面上下边缘、在多页重复出现的行（数字归一后比较），以及边缘的页码 */
function dropMargins(pages) {
  const textPages = pages.filter((p) => p.lines.length);
  const inZone = (p, l) => l.top < p.height * 0.1 || l.top > p.height * 0.9;
  const counts = new Map();
  for (const p of textPages) {
    for (const key of new Set(p.lines.filter((l) => inZone(p, l)).map((l) => zoneKey(l.text)))) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const repeated = Math.max(3, Math.ceil(textPages.length * 0.3));
  for (const p of textPages) {
    p.lines = p.lines.filter((l) => {
      if (!inZone(p, l)) return true;
      if (PAGE_NO.test(l.text)) return false;
      return textPages.length < 3 || (counts.get(zoneKey(l.text)) || 0) < repeated;
    });
  }
}

const MAX_PARA = 1200;

/** 太长的段落（大表格、无标点的列表）按句切开，抽取窗口和原文片段才切得动 */
export function splitLong(text, limit = MAX_PARA) {
  if (text.length <= limit) return [text];
  const out = [];
  let buf = '';
  for (const s of text.split(/(?<=[。；;！？])/)) {
    if (buf.length + s.length > limit && buf) {
      out.push(buf);
      buf = '';
    }
    buf += s;
    while (buf.length > limit * 1.5) {
      out.push(buf.slice(0, limit));
      buf = buf.slice(limit);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 行 → 段落：新段的信号是条款编号开头、上一行没写满、明显的段间距或首行缩进。
 * 返回 [{text, page}]；扫描页的位置用 {scan: 页号} 占位，由调用方换成转写结果。
 */
export function linesToParagraphs(pages) {
  dropMargins(pages);
  const all = pages.flatMap((p) => p.lines);
  const left = percentile(all.map((l) => l.x0), 0.1);
  const right = percentile(all.map((l) => l.x1), 0.9);
  const out = [];
  let cur = null;
  let prev = null;
  let prefix = '';
  const flush = () => {
    if (cur && cur.text.trim().length >= 2) out.push(cur);
    cur = null;
  };
  for (const p of pages) {
    if (p.scanned) {
      flush();
      prev = null;
      out.push({ scan: p.no, page: p.no });
      continue;
    }
    for (const l of p.lines) {
      if (TOC_LINE.test(l.text)) continue;
      if (CLAUSE_ONLY.test(l.text)) {
        prefix = prefix ? `${prefix}.${l.text}`.replace(/\.\./g, '.') : l.text;
        continue;
      }
      const text = prefix ? `${prefix} ${l.text}` : l.text;
      const fresh = Boolean(prefix);
      prefix = '';
      const samePage = prev && prev.page === p.no;
      const startNew = !cur || fresh || CLAUSE_START.test(l.text)
        || prev.x1 < right - prev.size * 2
        || (samePage && l.top - prev.top > Math.max(prev.size, l.size) * 2.1)
        // 首行缩进；悬挂缩进的续行也会缩进，所以要求上一行已经句末收尾
        || (l.x0 - left > l.size * 1.5 && /[。；！？：:;]$/.test(prev.text));
      if (startNew) {
        flush();
        cur = { text, page: p.no };
      } else {
        cur.text = joinText(cur.text, text);
      }
      prev = { ...l, page: p.no };
    }
  }
  flush();
  return out.flatMap((para) => (para.scan ? [para] : splitLong(squeezeCjk(para.text)).map((t) => ({ text: t, page: para.page }))));
}

// ───────────── 扫描页渲染 ─────────────

function popplerBin(name) {
  const dir = process.env.POPPLER_BIN;
  return dir ? path.join(dir, name) : name;
}

/** 用 poppler 的 pdftoppm 把一页渲染成 JPEG（扫描页看图转写、阅读器里看原页） */
export async function renderPage(file, pageNo, outFile, dpi = 120) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const prefix = outFile.replace(/\.jpg$/i, '');
  try {
    await run(popplerBin('pdftoppm'), [
      '-f', String(pageNo), '-l', String(pageNo), '-r', String(dpi), '-jpeg', '-jpegopt', 'quality=82', '-singlefile', file, prefix,
    ], { timeout: 120_000, windowsHide: true });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw Object.assign(new Error('没找到 pdftoppm：扫描版 PDF 需要安装 poppler（或用 POPPLER_BIN 指定其 bin 目录）'), { code: 'poppler_missing' });
    }
    throw e;
  }
  return outFile;
}
