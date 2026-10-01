// 初中数学（苏科版 2022 课标修订）6 册教材：国家中小学智慧教育平台 → 页面原图 → deepseek-flash 看图转写 → 按册/章/节切单元。
//   平台的 PDF 需要登录才能下载，但每页的转码图片是公开的（r1-ndr.ykt.cbern.com.cn）。
//   data/math/media/<册>/<n>.jpg      页面原图（/media/math/<册>/<n>.jpg，原文抽屉「教材原页」）
//   data/math/ocr/<册>/<n>.md         每页转写缓存（重跑跳过）
//   data/math/chapters/NNN.json       一节一个单元：{no, title, label「九上·1.2」, part, paragraphs, para_pages, pages}
//   data/covers/math.jpg              首页卡片封面（七上封面页）
//   node src/scripts/math/fetch.js            全流程（已完成的跳过）
//   node src/scripts/math/fetch.js 9a         只处理一册（7a 7b 8a 8b 9a 9b）
import fs from 'node:fs';
import path from 'node:path';
import { chatVision } from '../../kg/llm.js';
import { graphPaths, isMain, writeJson } from '../kg/paths.js';

const GRAPH = 'math';
const paths = graphPaths(GRAPH);
const MEDIA_DIR = path.join(paths.DATA_DIR, 'media');
const OCR_DIR = path.join(paths.DATA_DIR, 'ocr');
const PARALLEL = Number(process.env.MATH_OCR_PARALLEL || 6);

export const BOOKS = [
  { key: '7a', label: '七上', id: '01e365c7-9178-4155-8640-c862c5eff5e6' },
  { key: '7b', label: '七下', id: 'f156dcad-f112-4937-a4bc-f4fa349beed6' },
  { key: '8a', label: '八上', id: '898de31a-e932-43ea-96af-83df3300020b' },
  { key: '8b', label: '八下', id: 'e2eb2248-6d8e-44fc-a1ef-a1eaead72992' },
  { key: '9a', label: '九上', id: 'bd633723-cfca-47c7-bea3-7496e1648a91' },
  { key: '9b', label: '九下', id: '33f1be2a-c063-4669-ba44-341c2b17a091' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const detailUrl = (id) => `https://basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId=${id}&catalogType=tchMaterial&subCatalog=tchMaterial`;

async function fetchRetry(url, init = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (r.status >= 500 || r.status === 429) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(2000 * i);
    }
  }
}

/** 教材详情 → 公开的页面图目录 */
async function imageFolder(book) {
  const r = await fetchRetry(`https://s-file-1.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details/${book.id}.json`);
  const d = await r.json();
  const item = (d.ti_items || []).find((i) => i.ti_file_flag === 'image');
  if (!item) throw new Error(`${book.label} 详情里没有页面图目录`);
  return { title: d.title, folder: item.ti_storages[0].replace('r1-ndr-private', 'r1-ndr') };
}

const pageExists = async (folder, n) => {
  const r = await fetchRetry(`${folder}/${n}.jpg`, { headers: { range: 'bytes=0-15' } });
  return r.status === 200 || r.status === 206;
};

/** 页数：倍增找上界再二分 */
async function pageCount(folder) {
  let hi = 64;
  while (await pageExists(folder, hi)) hi *= 2;
  let lo = hi / 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await pageExists(folder, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const OCR_PROMPT = `这是一页初中数学教材。请原样转写页面上的文字，要求：
1. 第一行单独输出「页码：N」，N 是页面上印的页码数字；没有印页码就写「页码：无」。
2. 章标题写成「# 第N章 标题」，节标题写成「## N.M 标题」（N.M 是教材里的节号），其它小标题（如「练一练」「习题」「数学活动」「小结与思考」）写成「### 标题」。
3. 公式用 LaTeX（行内 $…$），表格用简单的竖线表格。
4. 插图不要描述，只保留图号，如「（图1-2）」。
5. 页眉页脚、装饰文字不要输出；不要加任何解释。`;

async function ocrPage(book, folder, n) {
  const mdFile = path.join(OCR_DIR, book.key, `${n}.md`);
  if (fs.existsSync(mdFile)) return fs.readFileSync(mdFile, 'utf8');
  const imgFile = path.join(MEDIA_DIR, book.key, `${n}.jpg`);
  if (!fs.existsSync(imgFile)) {
    const r = await fetchRetry(`${folder}/${n}.jpg`);
    if (!r.ok) throw new Error(`第 ${n} 页图片 HTTP ${r.status}`);
    fs.mkdirSync(path.dirname(imgFile), { recursive: true });
    fs.writeFileSync(imgFile, Buffer.from(await r.arrayBuffer()));
  }
  const { text } = await chatVision({ prompt: OCR_PROMPT, image: fs.readFileSync(imgFile), maxTokens: 6000 });
  fs.mkdirSync(path.dirname(mdFile), { recursive: true });
  fs.writeFileSync(mdFile, text, 'utf8');
  return text;
}

async function ocrBook(book) {
  const { title, folder } = await imageFolder(book);
  const total = await pageCount(folder);
  console.log(`[math] ${book.label}《${title}》共 ${total} 页`);
  const pages = new Array(total);
  let next = 1;
  let done = 0;
  const worker = async () => {
    while (next <= total) {
      const n = next++;
      pages[n - 1] = await ocrPage(book, folder, n);
      done++;
      if (done % 20 === 0 || done === total) console.log(`[math] ${book.label} 转写 ${done}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { title, total, pages };
}

// ───────────── 切分：册 → 章 → 节 ─────────────
// 以书前目录为准：正文里的节标题只有「编号在目录里紧随当前节、且标题和目录一致」才算换节。
// 转写会把页眉（每页顶上的章名、节名）也当标题输出，偶尔还会认错节号，靠这两条过滤掉。
const RE_CHAPTER = /^#{0,3}\s*第\s*(\d{1,2})\s*章\s*(.*)$/;
// 选学节在目录里带星号：「*10.4 三元一次方程组」
const RE_SECTION = /^#{0,3}\s*[*＊]?\s*(\d{1,2})\s*[.．]\s*(\d{1,2})\s+(.+)$/;
const RE_PAGE = /^\s*页码[:：]\s*(\d+|无)/;
const RE_END = /^#*\s*(后\s*记|版权页)/;

const cleanHeading = (s) => s
  .replace(/[#*]/g, '')
  .replace(/[\s.…·]{2,}\d{1,3}\s*$/, '')
  .replace(/\s+\d{1,3}\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim();
const norm = (s) => cleanHeading(s).replace(/[\s,，、。.．:：—\-$()（）？?！!“”"]/g, '');

function titleMatches(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  let k = 0;
  while (k < x.length && x[k] === y[k]) k++;
  return k >= 4;
}

function parsePages(pageTexts) {
  const pages = pageTexts.map((raw, idx) => {
    const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^-{3,}$/.test(l));
    const pm = lines[0]?.match(RE_PAGE);
    return {
      imageNo: idx + 1,
      printed: pm && pm[1] !== '无' ? Number(pm[1]) : null,
      body: pm ? lines.slice(1) : lines,
    };
  });
  // 页码按前后 4 页「图号 − 页码」偏移的中位数推算：章首页不印页码也能补上，个别误读被邻页压掉
  const offsets = pages.map((p) => (p.printed == null ? null : p.imageNo - p.printed));
  for (const [i, p] of pages.entries()) {
    const near = offsets.slice(Math.max(0, i - 4), i + 5).filter((o) => o != null).sort((a, b) => a - b);
    if (!near.length) continue;
    const median = near[Math.floor(near.length / 2)];
    if (p.imageNo - median >= 1) p.printed = p.imageNo - median;
  }
  return pages;
}

/** 书前目录：一页里出现 ≥3 个节标题的页（只看前 16 页，书末常有别册的目录广告） */
function parseToc(pages) {
  const chapters = new Map();
  const sections = new Map();
  let last = -1;
  pages.slice(0, 16).forEach((p, i) => {
    const secLines = p.body.filter((l) => RE_SECTION.test(l));
    if (new Set(secLines.map((l) => l.match(RE_SECTION).slice(1, 3).join('.'))).size < 3) return;
    last = i;
    for (const l of p.body) {
      const cm = l.match(RE_CHAPTER);
      if (cm && !chapters.has(Number(cm[1]))) chapters.set(Number(cm[1]), cleanHeading(cm[2]));
      const sm = l.match(RE_SECTION);
      if (sm) {
        const key = `${Number(sm[1])}.${Number(sm[2])}`;
        if (!sections.has(key)) sections.set(key, { chapter: Number(sm[1]), section: Number(sm[2]), title: cleanHeading(sm[3]) });
      }
    }
  });
  const toc = [...sections.values()]
    .filter((s) => chapters.has(s.chapter))
    .sort((a, b) => a.chapter - b.chapter || a.section - b.section)
    .map((s) => ({ ...s, chapterTitle: chapters.get(s.chapter) }));
  return { toc, bodyStart: last + 1 };
}

/** 一册的页面转写 → 节列表 [{chapter, chapterTitle, section, title, paragraphs, paraPages, pages}] */
export function splitBook(book, pageTexts) {
  const pages = parsePages(pageTexts);
  const { toc, bodyStart } = parseToc(pages);
  if (toc.length < 3) throw new Error(`${book.label} 没找到目录（只解析到 ${toc.length} 节），请检查 data/math/ocr/${book.key}`);
  const sections = toc.map((t) => ({ ...t, paragraphs: [], paraPages: [], pages: [] }));
  let cur = -1;
  // 章首页（章名 + 章引言）出现在该章第一节之前：先暂存，第一节出现时并进去
  let intro = null;
  let stop = false;

  const push = (sec, line, pageRef) => {
    if (sec.pages.at(-1)?.image !== pageRef.image) sec.pages.push(pageRef);
    sec.paragraphs.push(line.replace(/^#{1,4}\s*/, ''));
    sec.paraPages.push(pageRef.page);
  };

  for (const p of pages.slice(bodyStart)) {
    if (stop) break;
    const pageRef = { page: p.printed ?? p.imageNo, image: `/media/${GRAPH}/${book.key}/${p.imageNo}.jpg` };
    for (const line of p.body) {
      if (RE_END.test(line)) { stop = true; break; }
      const heading = /^#/.test(line);
      const sm = heading && line.match(RE_SECTION);
      if (sm) {
        const j = toc.findIndex((t) => t.chapter === Number(sm[1]) && t.section === Number(sm[2]));
        if (j > cur && j <= cur + 2 && titleMatches(toc[j].title, sm[3])) {
          cur = j;
          if (sections[cur].pages.at(-1)?.image !== pageRef.image) sections[cur].pages.push(pageRef);
          for (const [l, ref] of intro || []) push(sections[cur], l, ref);
          intro = null;
          continue;
        }
        // 页眉重复本节或之前的节名
        if (j >= 0 && j <= cur) continue;
      }
      const cm = heading && line.match(RE_CHAPTER);
      if (cm) {
        const next = toc[cur + 1];
        if (next && Number(cm[1]) === next.chapter && next.chapter !== toc[cur]?.chapter && !intro) intro = [];
        continue;
      }
      if (intro) intro.push([line, pageRef]);
      else if (cur >= 0) push(sections[cur], line, pageRef);
    }
  }
  const imageNo = (ref) => Number(ref.image.match(/(\d+)\.jpg$/)[1]);
  for (const s of sections) {
    const seen = new Map(s.pages.map((ref) => [ref.image, ref]));
    s.pages = [...seen.values()].sort((a, b) => imageNo(a) - imageNo(b));
  }
  return sections.filter((s) => s.paragraphs.join('').length >= 80);
}

async function writeCover(book) {
  const src = path.join(MEDIA_DIR, book.key, '1.jpg');
  const dst = path.resolve('data', 'covers', `${GRAPH}.jpg`);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

export async function fetchMath(keys = []) {
  paths.ensureDirs();
  const books = BOOKS.filter((b) => !keys.length || keys.includes(b.key));
  const results = [];
  for (const book of books) results.push({ book, ...(await ocrBook(book)) });
  await writeCover(BOOKS[0]);

  // 全部 6 册切完再统一编号（单元号就是全书课时顺序，七上 1.1 = 1）
  if (keys.length) return results.length;
  const all = [];
  for (const r of results) {
    const secs = splitBook(r.book, r.pages);
    console.log(`[math] ${r.book.label} 切出 ${secs.length} 节：${secs.map((s) => `${s.chapter}.${s.section}`).join(' ')}`);
    for (const s of secs) all.push({ book: r.book, ...s });
  }
  for (const f of fs.readdirSync(paths.CHAPTER_DIR)) fs.rmSync(path.join(paths.CHAPTER_DIR, f));
  all.forEach((s, i) => {
    const no = i + 1;
    const text = s.paragraphs.join('\n');
    writeJson(paths.chapterFile(no), {
      no,
      title: `${s.chapter}.${s.section} ${s.title}`.trim(),
      label: `${s.book.label}·${s.chapter}.${s.section}`,
      part: `${s.book.label} 第${s.chapter}章 ${s.chapterTitle}`.trim(),
      url: detailUrl(s.book.id),
      paragraphs: s.paragraphs,
      para_pages: s.paraPages,
      pages: s.pages,
      char_count: text.length,
    });
  });
  console.log(`[math] 共 ${all.length} 节写入 ${paths.CHAPTER_DIR}`);
  return all.length;
}

if (isMain(import.meta.url)) {
  fetchMath(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[math] 失败:', e);
      process.exit(1);
    });
}
