// 首页卡片封面：名著与典籍取维基数据该书条目的配图（P18，多为古本书影或插图），存到 data/covers/<graph>.jpg，
// 由 /media/covers/<graph>.jpg 提供。教材封面由 src/scripts/math/fetch.js 从课本 PDF 首页渲染。
//   node src/scripts/kg/covers.js            全部
//   node src/scripts/kg/covers.js shuihu     只取一本（--force 覆盖已有封面）
import fs from 'node:fs';
import path from 'node:path';
import { listGraphs } from '../../kg/domains/index.js';
import { isMain, readJson, writeJson } from './paths.js';
import { download, fileInfos, findItem, itemImages, itemText } from './wikimedia.js';

const COVER_DIR = path.resolve('data', 'covers');
const CREDITS_FILE = path.join(COVER_DIR, 'credits.json');
const BOOKISH = /小说|长篇|章回|典籍|语录|史书|纪传|文言|著作|novel|book|classic|history|chronicle|analects|collection/i;

export async function fetchCover(graph, { force = false } = {}) {
  const file = path.join(COVER_DIR, `${graph.id}.jpg`);
  if (!force && fs.existsSync(file)) return { id: graph.id, skipped: true };
  const item = await findItem(graph.book, (it) => itemImages(it).length > 0 && BOOKISH.test(itemText(it)));
  if (!item) return { id: graph.id, error: '维基数据里没有带配图的条目' };
  const [info] = await fileInfos(itemImages(item).slice(0, 1), 500);
  if (!info) return { id: graph.id, error: '配图不是可用的图片格式' };
  await download(info.thumb, COVER_DIR, { name: `${graph.id}.jpg`, force: true });
  const credits = readJson(CREDITS_FILE, {});
  credits[graph.id] = { item: item.id, file: info.file, page_url: info.page_url, credit: info.credit, license: info.license };
  writeJson(CREDITS_FILE, credits);
  return { id: graph.id, file: info.file, license: info.license };
}

export async function fetchCovers(ids, opts) {
  const graphs = listGraphs().filter((g) => g.kind !== 'textbook' && (!ids?.length || ids.includes(g.id)));
  const results = [];
  for (const g of graphs) {
    try {
      results.push(await fetchCover(g, opts));
    } catch (e) {
      results.push({ id: g.id, error: e.message });
    }
  }
  return results;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  fetchCovers(args.filter((a) => !a.startsWith('--')), { force })
    .then((r) => console.table(r))
    .catch((e) => {
      console.error('[covers] 失败:', e.message);
      process.exitCode = 1;
    });
}
