// 单份资料 → 单元原文 {paragraphs, para_pages, pages}：
//   PDF 文字层直接拼段落；扫描页渲染成图（media/pages/NNN/<页>.jpg，阅读器「原页」也用它）再看图转写，
//   转写结果缓存在 ocr/NNN/<页>.md，同一份文件重跑跳过。Word 与纯文本按行成段。
import fs from 'node:fs';
import path from 'node:path';
import WordExtractor from 'word-extractor';
import { chatVision } from '../kg/llm.js';
import { topicDir } from '../kg/domains/topics.js';
import { filesDir } from './manifest.js';
import { linesToParagraphs, openPdf, readPdfLines, renderPage, splitLong, squeezeCjk } from './pdf.js';

const OCR_PARALLEL = Number(process.env.TOPIC_OCR_PARALLEL || 6);
const pad = (no) => String(no).padStart(3, '0');

const OCR_PROMPT = `这是一页标准规范、法规或制度文件的扫描页。请原样转写页面上的正文，要求：
1. 标题、条款编号保持原样（如「5.2.1 ……」「第十条 ……」「a) ……」），一个条款或一个自然段占一行。
2. 表格用简单的竖线表格；插图不描述，只保留图号和图名。
3. 页眉、页脚、页码、水印、装订线文字不要输出；不要加任何解释。
4. 这一页没有正文（空白页、封底、只有图）就只输出「（空白）」。`;

function aborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('已停止'), { code: 'aborted' });
}

/** 转写稿 → 段落：去掉 Markdown 标记，一行一段 */
export function ocrParagraphs(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1'))
    .filter((l) => l && !/^-{3,}$/.test(l) && !/^\|?[\s:|-]+\|?$/.test(l) && !/^[（(]空白[）)]$/.test(l))
    .map(squeezeCjk)
    .flatMap((l) => splitLong(l));
}

/** 文件换了内容，旧的页图和转写稿作废 */
function freshCache(id, no, sha1) {
  const dir = path.join(topicDir(id), 'ocr', pad(no));
  const mark = path.join(dir, '.sha1');
  const old = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : '';
  if (old !== sha1) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(topicDir(id), 'media', 'pages', pad(no)), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mark, sha1);
  }
  return dir;
}

async function ocrPage(id, entry, full, pageNo, ocrDir) {
  const mdFile = path.join(ocrDir, `${pageNo}.md`);
  if (fs.existsSync(mdFile)) return fs.readFileSync(mdFile, 'utf8');
  const img = path.join(topicDir(id), 'media', 'pages', pad(entry.no), `${pageNo}.jpg`);
  if (!fs.existsSync(img)) await renderPage(full, pageNo, img);
  const { text } = await chatVision({ prompt: OCR_PROMPT, image: fs.readFileSync(img), maxTokens: 6000 });
  fs.writeFileSync(mdFile, text, 'utf8');
  return text;
}

async function convertPdf(id, entry, full, { signal, onOcr }) {
  const doc = await openPdf(full);
  try {
    const pages = await readPdfLines(doc);
    const paras = linesToParagraphs(pages);
    const scanned = pages.filter((p) => p.scanned).map((p) => p.no);
    const ocr = new Map();
    if (scanned.length) {
      const ocrDir = freshCache(id, entry.no, entry.sha1);
      let next = 0;
      let done = 0;
      onOcr?.(0, scanned.length);
      const worker = async () => {
        while (next < scanned.length) {
          aborted(signal);
          const n = scanned[next++];
          ocr.set(n, ocrParagraphs(await ocrPage(id, entry, full, n, ocrDir)));
          onOcr?.(++done, scanned.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(OCR_PARALLEL, scanned.length) }, worker));
    }
    const paragraphs = [];
    const paraPages = [];
    for (const p of paras) {
      const texts = p.scan ? ocr.get(p.scan) || [] : [p.text];
      for (const t of texts) {
        paragraphs.push(t);
        paraPages.push(p.page);
      }
    }
    const imagePages = scanned.map((n) => ({ page: n, image: `/media/${id}/pages/${pad(entry.no)}/${n}.jpg` }));
    return { paragraphs, para_pages: paraPages, pages: imagePages, page_count: pages.length, ocr_pages: scanned.length };
  } finally {
    await doc.destroy();
  }
}

function textParagraphs(text) {
  return text.split(/\r?\n/).map((l) => squeezeCjk(l)).filter((l) => l.length >= 2).flatMap((l) => splitLong(l));
}

async function convertWord(full) {
  const doc = await new WordExtractor().extract(full);
  return { paragraphs: textParagraphs(doc.getBody()), para_pages: null, pages: [], page_count: null, ocr_pages: 0 };
}

function convertText(full) {
  const buf = fs.readFileSync(full);
  let text = new TextDecoder('utf-8').decode(buf);
  // 老的中文纯文本多是 GBK
  if ((text.match(/\ufffd/g) || []).length > 5) text = new TextDecoder('gbk').decode(buf);
  return { paragraphs: textParagraphs(text), para_pages: null, pages: [], page_count: null, ocr_pages: 0 };
}

const shortTitle = (t) => (t.length > 16 ? `${t.slice(0, 15)}…` : t);

/** 清单里的一项 → data/topics/<id>/chapters/NNN.json 的内容 */
export async function convertFile(id, entry, { signal, onOcr } = {}) {
  aborted(signal);
  const full = path.join(filesDir(id), entry.path);
  if (!fs.existsSync(full)) throw Object.assign(new Error('原件不见了'), { code: 'file_missing' });
  let body;
  if (entry.kind === 'pdf') body = await convertPdf(id, entry, full, { signal, onOcr });
  else if (entry.kind === 'doc' || entry.kind === 'docx') body = await convertWord(full);
  else body = convertText(full);
  const chars = body.paragraphs.reduce((s, p) => s + p.length, 0);
  if (chars < 50) throw Object.assign(new Error('没有提取到文字'), { code: 'no_text' });
  return {
    chapter: {
      no: entry.no,
      title: entry.title,
      label: entry.code || shortTitle(entry.title),
      part: entry.category || '',
      url: `/media/${id}/files/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
      paragraphs: body.paragraphs,
      para_pages: body.para_pages,
      pages: body.pages,
      char_count: chars,
      source: { file: entry.path, sha1: entry.sha1 },
    },
    stats: { chars, page_count: body.page_count, ocr_pages: body.ocr_pages, paragraphs: body.paragraphs.length },
  };
}
