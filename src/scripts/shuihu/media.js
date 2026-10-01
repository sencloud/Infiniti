// 水浒传人物图片与央视版（1998）视频对照：
//   古画：维基数据人物条目 → 配图（P18）与共享资源分类（P373）里的公有领域画作（歌川国芳、陈洪绶等）
//   百科配图：百度百科词条首图，只作头像，标注来源
//   视频：B 站 43 集合集，按维基百科「各集剧名」的原著回数对照到 120 回本
// 产出 data/shuihu/media.json（applyMedia 写到实体与单元）和 data/shuihu/videos.json（/knowledge-graph/videos）
//   node src/scripts/shuihu/media.js                    全量（已下载的跳过）
//   node src/scripts/shuihu/media.js --only commons      只跑某一路（commons / baike / videos）
//   node src/scripts/shuihu/media.js --limit 5           调试：只处理前 N 个人物
import path from 'node:path';
import * as cheerio from 'cheerio';
import { close } from '../../db.js';
import { rows, withGraph } from '../../kg/neo.js';
import { applyMedia } from '../kg/load.js';
import { graphPaths, isMain, readJson, writeJson } from '../kg/paths.js';
import {
  categoryFiles, download, fileInfos, findItem, getItems, itemCommonsCategory, itemImages, itemText, itemWorks,
  searchItems, sleep,
} from '../kg/wikimedia.js';

const GRAPH = 'shuihu';
const paths = graphPaths(GRAPH);
const MEDIA_DIR = path.join(paths.DATA_DIR, 'media');
const CACHE_FILE = path.join(MEDIA_DIR, 'cache.json');
const MEDIA_URL = `/media/${GRAPH}`;

// ───────────── 视频：央视 1998 版 43 集 ─────────────
// 原著回数取自维基百科「水浒传 (1998年电视剧)」各集剧名表（100 回本口径）；
// 100 回本第 91 回起对应 120 回本第 111 回起（120 回本多出征田虎、王庆二十回）
const BILI = { bvid: 'BV1J5411h7FV', title: '央视版《水浒传》（1998）导演剪辑版', owner: 'niceus' };
const EPISODES = [
  ['高俅发迹', '2'], ['拳打镇关西', '3'], ['大闹五台山', '4'], ['倒拔垂杨柳', '6-7'], ['白虎节堂', '7-8'],
  ['野猪林', '8-9'], ['风雪山神庙', '9-10'], ['林冲落草', '11-12'], ['杨志卖刀', '12-13'], ['七星聚义', '14-15'],
  ['智取生辰纲', '16-17'], ['私放晁天王', '18'], ['火并王伦', '19-20'], ['宋江杀惜', '20-22'], ['景阳冈', '22-23'],
  ['兄弟重逢', '23-24'], ['王婆弄风情', '24'], ['武大郎捉奸', '25'], ['狮子楼', '26'], ['醉打蒋门神', '27-29'],
  ['血溅鸳鸯楼', '30-31'], ['清风寨', '32-35'], ['发配江州', '36-38'], ['浔阳楼题反诗', '39-40'], ['闹江州', '40-41'],
  ['李逵背母', '43-45'], ['祝家庄（上）', '45-48'], ['祝家庄（下）', '50,52,54'], ['大破连环马', '55-57'], ['曾头市', '59-60'],
  ['卢俊义上山', '61,66'], ['英雄排座次', '67-68,71'], ['元夜闹东京', '71-72'], ['燕青打擂', '74'], ['李逵坐堂', '73-74'],
  ['偷酒扯诏', '75'], ['大败高太尉', '78-80'], ['招安', '81-82'], ['血洒陈桥驿', '82-83'], ['征方腊', '90,93'],
  ['魂系涌金门', '94-96'], ['血染乌龙岭', '96,98-99'], ['宋江之死', '99-100'],
];

const to120 = (n) => (n > 90 ? n + 20 : n);

function parseChapters(spec) {
  const out = [];
  for (const part of spec.split(',')) {
    const [a, b = a] = part.split('-').map(Number);
    for (let n = a; n <= b; n++) out.push(to120(n));
  }
  return [...new Set(out)];
}

export function buildVideos() {
  return {
    source: { ...BILI, url: `https://www.bilibili.com/video/${BILI.bvid}`, note: '原著回数据维基百科「各集剧名」表换算到 120 回本' },
    episodes: EPISODES.map(([title, spec], i) => ({ ep: i + 1, title, page: i + 1, chapters: parseChapters(spec) })),
  };
}

// ───────────── 人物名单 ─────────────
async function personList() {
  const heroes = readJson(paths.SEEDS_FILE, []);
  const names = heroes.map((h) => ({ name: h.name, nickname: h.nickname, hero: true }));
  const known = new Set(names.map((n) => n.name));
  // 书中戏份重的非好汉人物（高俅、潘金莲、西门庆…）也配图
  const extra = await withGraph(GRAPH, () => rows(
    `MATCH (e:Entity {graph_id: $g, entity_type: 'Person'})
     RETURN e.canonical_name AS name, coalesce(e.claim_count, 0) AS n ORDER BY n DESC LIMIT 160`,
  ));
  for (const r of extra) {
    if (!known.has(r.name) && names.length < 170) {
      names.push({ name: r.name, hero: false });
      known.add(r.name);
    }
  }
  return names;
}

// ───────────── 古画：维基数据 + 共享资源 ─────────────
const ABOUT_SHUIHU = /水浒|水滸|Water Margin|Suikoden|Outlaws of the Marsh/i;
const PUBLIC_DOMAIN = /public domain|^PD|CC0/i;
let shuihuQid = null;

async function commonsFor(person) {
  if (!shuihuQid) {
    const work = await findItem('水浒传', (it) => /小说|novel/i.test(itemText(it)));
    shuihuQid = work?.id || 'none';
  }
  // 同名条目可能有好几个（人物本身、历史原型、戏曲角色），优先有共享资源分类的
  const matched = (await getItems(await searchItems(person.name)))
    .filter((it) => itemWorks(it).includes(shuihuQid) || ABOUT_SHUIHU.test(itemText(it)));
  const item = matched.find((it) => itemCommonsCategory(it)) || matched.find((it) => itemImages(it).length) || matched[0];
  if (!item) return { item: null, images: [] };
  const files = [...itemImages(item)];
  const cat = itemCommonsCategory(item);
  if (cat) for (const f of await categoryFiles(cat, 24)) if (!files.includes(f)) files.push(f);
  // 只要公有领域的古画；分类里混着的现代景区照片（CC BY）不要。
  // 缩略图宽度只能取维基的标准档（120/250/330/500/960…），非标准宽度会被 upload.wikimedia.org 拒绝
  const infos = (await fileInfos(files.slice(0, 16), 500)).filter((i) => PUBLIC_DOMAIN.test(i.license)).slice(0, 6);
  const images = [];
  for (const info of infos) {
    try {
      const local = await download(info.thumb, path.join(MEDIA_DIR, 'commons'));
      images.push({
        src: `${MEDIA_URL}/commons/${local}`,
        title: info.title,
        description: info.description,
        credit: info.credit,
        license: info.license,
        source: 'commons',
        page_url: info.page_url,
        width: info.width,
        height: info.height,
      });
    } catch (e) {
      console.warn(`[media] ${person.name} 下载失败：${e.message}`);
    }
    await sleep(200);
  }
  return { item: item.id, category: cat, images };
}

// ───────────── 百科配图：真浏览器打开词条取首图 ─────────────
async function baikeFor(person, fetchPage) {
  const url = `https://baike.baidu.com/item/${encodeURIComponent(person.name)}`;
  const html = await fetchPage(url);
  if (!ABOUT_SHUIHU.test(html)) return null;
  const $ = cheerio.load(html);
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="image"]').attr('content'),
    $('[class*="abstractAlbum"] img').first().attr('src'),
    $('.summary-pic img').first().attr('src'),
  ].filter(Boolean);
  let img = candidates.find((u) => /bkimg|bcebos|baidu/.test(u));
  if (!img) return null;
  if (img.startsWith('//')) img = `https:${img}`;
  // 百科缩略参数统一换成 360 宽，避免拿到原图大文件
  img = img.replace(/\?x-bce-process=[^"]*$/, '') + '?x-bce-process=image/resize,m_lfit,w_360,limit_1/format,f_jpg';
  const local = await download(img, path.join(MEDIA_DIR, 'baike'), { referer: 'https://baike.baidu.com/', ext: '.jpg' });
  return { src: `${MEDIA_URL}/baike/${local}`, title: `${person.name}（百度百科配图）`, source: 'baike', page_url: url, license: '版权归原作者，仅作示意' };
}

// ───────────── 汇总 ─────────────
function buildMediaJson(cache, videos) {
  const entities = {};
  for (const [name, c] of Object.entries(cache)) {
    const gallery = [...(c.commons?.images || [])];
    if (c.baike) gallery.unshift(c.baike);
    if (!gallery.length) continue;
    // 头像优先用百科配图（人物单幅、构图干净），没有再用古画
    entities[name] = { avatar: (c.baike || gallery[0]).src, gallery };
  }
  const chapters = {};
  for (const ep of videos.episodes) {
    for (const no of ep.chapters) {
      (chapters[no] ||= { episodes: [] }).episodes.push({ ep: ep.ep, title: ep.title, bvid: videos.source.bvid, page: ep.page });
    }
  }
  return { entities, chapters };
}

export async function fetchShuihuMedia({ only = null, limit = 0 } = {}) {
  const videos = buildVideos();
  writeJson(path.join(paths.DATA_DIR, 'videos.json'), videos);
  const cache = readJson(CACHE_FILE, {});
  if (only !== 'videos') {
    let people = await personList();
    if (limit) people = people.slice(0, limit);
    const save = () => writeJson(CACHE_FILE, cache);

    const commonsTrack = async () => {
      if (only && only !== 'commons') return;
      let i = 0;
      for (const p of people) {
        i++;
        const c = (cache[p.name] ||= {});
        if (c.commons) continue;
        try {
          c.commons = await commonsFor(p);
          console.log(`[media:commons] ${i}/${people.length} ${p.name} ${c.commons.item || '无条目'} ${c.commons.images.length} 张`);
        } catch (e) {
          console.warn(`[media:commons] ${p.name} 失败：${e.message}`);
        }
        save();
      }
    };

    const baikeTrack = async () => {
      if (only && only !== 'baike') return;
      const { fetchPage, politeDelay } = await import('../../pipeline/crawler.js');
      let i = 0;
      for (const p of people) {
        i++;
        const c = (cache[p.name] ||= {});
        if ('baike' in c) continue;
        try {
          await politeDelay();
          c.baike = await baikeFor(p, fetchPage);
          console.log(`[media:baike] ${i}/${people.length} ${p.name} ${c.baike ? '有图' : '无图'}`);
        } catch (e) {
          console.warn(`[media:baike] ${p.name} 失败：${e.message}`);
          if (/安全验证/.test(e.message)) break;
        }
        save();
      }
    };

    await Promise.all([commonsTrack(), baikeTrack()]);
  }
  const media = buildMediaJson(cache, videos);
  writeJson(path.join(paths.DATA_DIR, 'media.json'), media);
  const applied = await withGraph(GRAPH, () => applyMedia(GRAPH));
  console.log(`[media] 人物 ${Object.keys(media.entities).length} 位有图，写入实体 ${applied.entities}，单元 ${applied.chapters}`);
  return media;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
  fetchShuihuMedia({ only: opt('only'), limit: Number(opt('limit')) || 0 })
    .catch((e) => {
      console.error('[media] 失败:', e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await close();
      process.exit();
    });
}
