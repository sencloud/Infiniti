// 抓取 5000言 (5000yan.com) 上的古典名著原文，每个单元（回 / 篇）一份 JSON。已抓过的单元直接跳过，可反复执行。
//   node src/scripts/kg/crawl.js <graph>
// 各站点目录页都用 a.category-link 列出单元链接，正文结构不同：
//   章回小说：article.reading-content 下的 <p>
//   聊斋：p.para-yuanwen 原文，p.para-fanyi 白话（作参考）
//   论语：目录里篇名链接后跟各章链接（/1-1.html），每章一页
//   史记：目录链接到篇目页，篇目页再链接「原文及注释」页，正文里的【注释】要去掉
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import { graphArg, graphPaths, isMain, writeJson } from './paths.js';

const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 600);

const http = axios.create({
  timeout: 30_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  },
  responseType: 'text',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, retries = 4) {
  for (let i = 1; ; i++) {
    try {
      return (await http.get(url)).data;
    } catch (e) {
      if (i >= retries) throw e;
      await sleep(2000 * i);
    }
  }
}

const squash = (s) => s.replace(/\s+/g, '').trim();
// 拼音注音「（sì）」与站点注释「【子：后代。】」不属于原文
const PINYIN = /（[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňḿ\s,，;；]+）/g;
const NOTE = /【[^】]*】/g;
const cleanText = (s) => squash(s).replace(PINYIN, '').replace(NOTE, '');

async function indexLinks(indexUrl, filter) {
  const $ = cheerio.load(await fetchHtml(indexUrl));
  const seen = new Set();
  const links = [];
  $('a.category-link').each((_, a) => {
    const href = $(a).attr('href') || '';
    const url = new URL(href, indexUrl).href;
    if (seen.has(url) || !filter(new URL(url).pathname)) return;
    seen.add(url);
    links.push({ url, title: $(a).text().replace(/\s+/g, ' ').trim() });
  });
  return links;
}

function novelBody(html) {
  const $ = cheerio.load(html);
  const paragraphs = [];
  $('article.reading-content p').each((_, p) => {
    if ($(p).closest('section').length) return;
    const text = cleanText($(p).text());
    if (text) paragraphs.push(text);
  });
  return { title: $('h1').first().text().replace(/\s+/g, ' ').trim(), paragraphs };
}

function bilingualBody(html) {
  const $ = cheerio.load(html);
  const paragraphs = [];
  const references = [];
  $('article.reading-content p.para-yuanwen').each((_, p) => {
    const text = cleanText($(p).text());
    if (!text) return;
    paragraphs.push(text);
    const next = $(p).nextAll('p.para-fanyi').first();
    references.push(next.length ? squash(next.text()) : '');
  });
  return { title: $('h1').first().text().replace(/\s+/g, ' ').trim(), paragraphs, references };
}

/** 每个图谱的单元列表：[{no, title, fetch: async () => ({paragraphs, references?, url})}] */
const SOURCES = {
  async novel(indexUrl) {
    const links = await indexLinks(indexUrl, (p) => /\.html$/.test(p));
    return links.map((l, i) => ({
      no: i + 1,
      title: l.title,
      url: l.url,
      fetch: async () => novelBody(await fetchHtml(l.url)),
    }));
  },
  async liaozhai(indexUrl) {
    const links = await indexLinks(indexUrl, (p) => /\.html$/.test(p));
    return links.map((l, i) => ({
      no: i + 1,
      title: l.title,
      url: l.url,
      fetch: async () => bilingualBody(await fetchHtml(l.url)),
    }));
  },
  async lunyu(indexUrl) {
    const links = await indexLinks(indexUrl, () => true);
    const units = [];
    for (const l of links) {
      const path = new URL(l.url).pathname;
      if (/^\/[a-z]+\/$/.test(path)) {
        units.push({ no: units.length + 1, title: l.title, url: l.url, chapters: [] });
      } else if (/^\/\d+-\d+\.html$/.test(path) && units.length) {
        units[units.length - 1].chapters.push(l.url);
      }
    }
    return units.map((u) => ({
      no: u.no,
      title: u.title,
      url: u.url,
      fetch: async () => {
        const paragraphs = [];
        const references = [];
        for (const url of u.chapters) {
          const body = bilingualBody(await fetchHtml(url));
          // 「1.1子曰…」去掉章号
          if (body.paragraphs[0]) {
            paragraphs.push(body.paragraphs[0].replace(/^\d+\.\d+/, ''));
            references.push(body.references[0] || '');
          }
          await sleep(DELAY_MS / 2);
        }
        return { paragraphs, references };
      },
    }));
  },
  async shiji(indexUrl) {
    const links = await indexLinks(indexUrl, (p) => /^\/[a-z0-9]+\/$/.test(p));
    return links.map((l, i) => ({
      no: i + 1,
      title: l.title,
      url: l.url,
      fetch: async () => {
        const html = await fetchHtml(l.url);
        const $ = cheerio.load(html);
        let original = '';
        $('a').each((_, a) => {
          if (!original && /原文/.test($(a).text())) original = new URL($(a).attr('href'), l.url).href;
        });
        // 少数篇目原书即缺文（如《汉兴以来将相名臣年表》「此表无序」），只有简介页
        if (!original) {
          const paragraphs = [];
          $('.category-block p').each((_, p) => {
            const text = cleanText($(p).text());
            if (text) paragraphs.push(text);
          });
          return { paragraphs, url: l.url };
        }
        await sleep(DELAY_MS / 2);
        const body = novelBody(await fetchHtml(original));
        return { paragraphs: body.paragraphs, url: original };
      },
    }));
  },
};

const BOOKS = {
  shuihu: { source: 'novel', index: 'https://shuihu.5000yan.com/', expect: 120 },
  xiyouji: { source: 'novel', index: 'https://xiyouji.5000yan.com/', expect: 100 },
  hongloumeng: { source: 'novel', index: 'https://hongloumeng.5000yan.com/', expect: 120 },
  sanguo: { source: 'novel', index: 'https://sanguo.5000yan.com/', expect: 120 },
  liaozhai: { source: 'liaozhai', index: 'https://liaozhai.5000yan.com/', expect: 494 },
  lunyu: { source: 'lunyu', index: 'https://lunyu.5000yan.com/', expect: 20 },
  shiji: { source: 'shiji', index: 'https://shiji.5000yan.com/', expect: 130 },
};

export function canCrawl(graphId) {
  return Boolean(BOOKS[graphId]);
}

/** 章回小说标题里的「第七回」由单元标签统一给出，这里只留回目 */
const stripUnitNo = (title) => title.replace(/^第[一二三四五六七八九十百零〇]+回\s*/, '').trim();

export async function crawlBook(graphId) {
  const book = BOOKS[graphId];
  if (!book) throw new Error(`${graphId} 没有 5000言 抓取配置`);
  const paths = graphPaths(graphId);
  paths.ensureDirs();
  const units = await SOURCES[book.source](book.index);
  if (units.length < book.expect * 0.9) throw new Error(`目录页只解析到 ${units.length} 个单元（预期 ${book.expect}），页面结构可能变了`);
  const todo = units.filter((u) => !fs.existsSync(paths.chapterFile(u.no)));
  console.log(`[crawl:${graphId}] 目录共 ${units.length} 个单元，待抓 ${todo.length}`);
  for (const u of todo) {
    const body = await u.fetch();
    if (!body.paragraphs?.length) throw new Error(`第 ${u.no} 单元正文为空: ${u.url}`);
    const text = body.paragraphs.join('\n');
    const title = stripUnitNo(body.title && book.source === 'novel' ? body.title : u.title);
    writeJson(paths.chapterFile(u.no), {
      no: u.no,
      title,
      url: body.url || u.url,
      paragraphs: body.paragraphs,
      ...(body.references?.some(Boolean) ? { references: body.references } : {}),
      char_count: text.length,
    });
    console.log(`[crawl:${graphId}] ${u.no}/${units.length} ${title} · ${text.length} 字`);
    await sleep(DELAY_MS);
  }
  console.log(`[crawl:${graphId}] 完成`);
  return units.length;
}

if (isMain(import.meta.url)) {
  const { id } = graphArg();
  crawlBook(id).catch((e) => {
    console.error(`[crawl:${id}] 失败:`, e.message);
    process.exit(1);
  });
}
