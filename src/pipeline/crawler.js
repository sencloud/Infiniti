// 爬虫模块：抓取百度百科词条页面并清洗出正文
// 只做两件事：fetchPage(抓取) + extractBaikeContent(清洗)，保持简单
//
// 【2026-09-06 重构】axios(纯 HTTP) → Crawlee + Playwright(真浏览器)
// 原因：百度百科词条页启用了 JS 挑战反爬（返回"百度安全验证"页），
// 纯 HTTP 客户端无法执行 JS，必然 403。改用无头 Chromium 真实渲染页面绕过。
// Crawlee 是 GitHub 上 star 数最高的 Node.js 爬虫框架（Apify 官方维护）。
// 对外接口保持不变：crawlBaike(name) / politeDelay()，worker.js 无需改动。
import * as cheerio from 'cheerio';
import { chromium } from 'playwright-core';
import config from '../config.js';

// 复用一个全局浏览器实例：每个 worker 进程只启动一次 Chromium，避免反复冷启动
// launchPersistentContext 带 userDataDir，跨请求保留 Cookie/缓存，
// 更像真实用户，进一步降低触发反爬的概率
let browserCtx = null;

// 浏览器窗口尺寸（影响一些站点的响应式布局，用桌面尺寸）
const VIEWPORT = { width: 1366, height: 900 };

// 启动（或复用）持久化浏览器上下文
async function getBrowser() {
  if (!browserCtx) {
    browserCtx = await chromium.launchPersistentContext('./.crawlee-browser-profile', {
      headless: true, // 无头模式：服务器环境无显示，也更快
      viewport: VIEWPORT,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      locale: 'zh-CN',
      timeout: 60_000, // 单次导航超时 60s（首次冷启动较慢）
    });
  }
  return browserCtx;
}

// 抓取 URL，返回 HTML 文本
// 注意：不用 networkidle——百科页面有常驻长连接（统计上报），网络永远不空闲，
// networkidle 会一直等到超时。改用 domcontentloaded + 固定 2s 等待 JS 渲染完成
export async function fetchPage(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // 给 JS 挑战/渲染留时间（词条是 SSR，够用）
    // 若被重定向到安全验证页（URL 含 wappass 或标题含"安全验证"），明确报错
    const title = await page.title();
    if (title.includes('安全验证')) {
      throw new Error(`触发百度安全验证: ${url}`);
    }
    if (resp && resp.status() >= 400) {
      throw new Error(`HTTP ${resp.status()}: ${url}`);
    }
    return await page.content(); // 渲染后的完整 HTML
  } finally {
    // 无论成败都关闭页面（上下文保留，供下次复用）
    await page.close();
  }
}

// 从 HTML 提取纯文本（去掉 script/style 等），供 LLM 分析
function htmlToText(html) {
  const $ = cheerio.load(html);
  $('script, style, .reference, sup').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

/**
 * 抓取并解析一个百度百科词条
 * 返回 { url, title, content }；词条不存在或重定向到非人物页时返回 null
 */
export async function crawlBaike(name) {
  // 中文直接拼 URL，浏览器会自动编码
  const url = `https://baike.baidu.com/item/${encodeURIComponent(name)}`;
  const html = await fetchPage(url);

  const $ = cheerio.load(html);
  // 消歧页特征：存在"多义词"标记，或正文里出现词条列表
  const isDisambiguation = $('div.polysense, div.view-tip').length > 0;
  const content = htmlToText(html);

  if (isDisambiguation || content.length < 100) {
    return null; // 消歧页 / 空页 / 反爬页，视为抓取失败
  }

  return { url, title: $('title').text().replace(/_百度百科$/, ''), content };
}

/* ============ 【v4】多源泛化抓取 ============ */

// 维基百科词条解析：mw-parser-output 是正文容器
export async function crawlWikiZh(name) {
  const url = `https://zh.wikipedia.org/wiki/${encodeURIComponent(name)}`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  // 维基不存在词条时返回"找不到页面"特征
  const notFound = $('title').text().includes('找不到') || $('#noarticletext').length > 0;
  const content = htmlToText(html);
  if (notFound || content.length < 100) return null;
  return { url, title: $('#firstHeading').text().trim() || name, content };
}

/**
 * 多源抓取一个词条：按源优先级依次尝试，失败降级。
 * kind: 'person' | 'knowledge'（筛选适用源）
 * 返回 { url, title, content, source: 'baike' | 'wiki-zh' | ... }；全部失败返回 null
 */
export async function crawlMultiSource(name, kind = 'knowledge') {
  const { sourcesFor } = await import('../sources/registry.js');
  const fetchers = { baike: crawlBaike, 'wiki-zh': crawlWikiZh };
  for (const src of sourcesFor(kind)) {
    try {
      const page = await fetchers[src.id]?.(name);
      if (page) return { ...page, source: src.id };
    } catch (e) {
      console.warn(`[crawler] 源 ${src.id} 抓取失败，尝试下一个: ${e.message}`);
    }
  }
  return null;
}

// 简单限速：保证两次请求之间有 config.crawl.requestDelayMs 的间隔
// （保持原有的礼貌限速，真浏览器渲染 + 限速双保险，对百科友好）
let lastRequestAt = 0;
export async function politeDelay() {
  const now = Date.now();
  const wait = lastRequestAt + config.crawl.requestDelayMs - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// worker 进程退出时清理浏览器，避免残留 Chromium 进程占内存
process.on('exit', () => {
  if (browserCtx) browserCtx.close().catch(() => {});
});
