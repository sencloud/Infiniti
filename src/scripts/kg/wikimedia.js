// 维基数据 / 维基共享资源的小工具：按中文名找条目、取条目配图（P18）与共享资源分类（P373）里的图片，
// 并把缩略图下载到本地。只用公开 API，按维基礼仪带 User-Agent、顺序请求。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const UA = 'InfinitiKG/1.0 (local knowledge-graph demo; https://github.com/)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1500 * i);
    }
  }
}

const WD = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const qs = (o) => new URLSearchParams({ format: 'json', ...o }).toString();

export async function searchItems(name, limit = 8) {
  const j = await getJson(`${WD}?${qs({ action: 'wbsearchentities', search: name, language: 'zh', uselang: 'zh', type: 'item', limit })}`);
  return (j.search || []).map((s) => s.id);
}

export async function getItems(ids) {
  if (!ids.length) return [];
  const j = await getJson(`${WD}?${qs({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|descriptions|labels', languages: 'zh|zh-hans|zh-cn|en' })}`);
  return ids.map((id) => j.entities?.[id]).filter(Boolean);
}

const claimValues = (item, prop) => (item.claims?.[prop] || [])
  .map((c) => c.mainsnak?.datavalue?.value)
  .filter((v) => v != null);

export const itemImages = (item) => claimValues(item, 'P18').map(String);
export const itemCommonsCategory = (item) => claimValues(item, 'P373').map(String)[0] || null;
export const itemWorks = (item) => claimValues(item, 'P1441').map((v) => v.id);
export const itemText = (item) => [
  ...Object.values(item.descriptions || {}).map((d) => d.value),
  ...Object.values(item.labels || {}).map((d) => d.value),
].join(' ');

/** 按名字找条目，并用 accept(item) 过滤（例如描述里提到《水浒传》，或 P1441 出现于该作品） */
export async function findItem(name, accept) {
  const items = await getItems(await searchItems(name));
  return items.find(accept) || null;
}

/** 共享资源分类里的文件名（只取文件，不下钻子分类） */
export async function categoryFiles(category, limit = 12) {
  const j = await getJson(`${COMMONS}?${qs({ action: 'query', list: 'categorymembers', cmtitle: `Category:${category}`, cmtype: 'file', cmlimit: limit })}`);
  return (j.query?.categorymembers || []).map((m) => m.title.replace(/^File:/, ''));
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** 文件信息：缩略图地址、作者、许可、描述 */
export async function fileInfos(files, width = 640) {
  const out = [];
  for (let i = 0; i < files.length; i += 20) {
    const titles = files.slice(i, i + 20).map((f) => `File:${f}`).join('|');
    const j = await getJson(`${COMMONS}?${qs({ action: 'query', titles, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: width })}`);
    for (const p of Object.values(j.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|tiff|webp)/.test(ii.mime)) continue;
      const meta = ii.extmetadata || {};
      out.push({
        file: p.title.replace(/^File:/, ''),
        thumb: ii.thumburl || ii.url,
        page_url: ii.descriptionurl,
        width: ii.thumbwidth || ii.width,
        height: ii.thumbheight || ii.height,
        title: stripHtml(meta.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
        description: stripHtml(meta.ImageDescription?.value).slice(0, 200),
        credit: stripHtml(meta.Artist?.value).slice(0, 80),
        license: stripHtml(meta.LicenseShortName?.value),
      });
    }
  }
  return out;
}

/** 下载到 dir，文件名默认用 URL 摘要；已存在就跳过（force 时覆盖）。返回本地文件名 */
export async function download(url, dir, { referer, ext, name: fixedName, force = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  const suffix = ext || (/^\.(jpe?g|png|webp)$/.test(urlExt) ? urlExt : '.jpg');
  const name = fixedName || crypto.createHash('md5').update(url).digest('hex').slice(0, 16) + suffix;
  const file = path.join(dir, name);
  if (!force && fs.existsSync(file) && fs.statSync(file).size > 0) return name;
  const headers = { 'user-agent': referer ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' : UA };
  if (referer) headers.referer = referer;
  for (let i = 1; ; i++) {
    let r;
    try {
      r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      // 连接重置 / 超时（upload.wikimedia.org 偶发）按网络错误重试
      if (i >= 4) throw new Error(`下载失败 ${e.cause?.code || e.message}：${url}`);
      await sleep(2500 * i);
      continue;
    }
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 512) throw new Error(`图片过小：${url}`);
      fs.writeFileSync(file, buf);
      return name;
    }
    if (i >= 4 || (r.status !== 429 && r.status < 500)) throw new Error(`下载失败 HTTP ${r.status}：${url}`);
    await sleep(2500 * i);
  }
}

export { sleep };
