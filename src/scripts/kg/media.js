// 外国名著的图像与影视对照：生成 data/<graph>/media.json 与 videos.json，并写回 Neo4j。
//   插图：Project Gutenberg 插图本（公有领域）里的插图，按说明与图旁段落定位到章节，
//         再由 LLM 判断画的是哪些人物，进人物图集；章节里列出本章插图
//   人物像：维基数据人物条目的配图（P18，维基共享资源）
//   影视：B 站上的改编剧集 / 电影，按剧情对照到章节
//   node src/scripts/kg/media.js <graph>        需先跑完 load（要用图谱里的人物与出场章节）
import fs from 'node:fs';
import path from 'node:path';
import { close } from '../../db.js';
import { getGraph } from '../../kg/domains/index.js';
import { chatJson } from '../../kg/llm.js';
import { rows, withGraph } from '../../kg/neo.js';
import { ebookImageUrl, fetchEbook, illustrations, locateIllustration } from './gutenberg.js';
import { applyMedia } from './load.js';
import { graphArg, graphPaths, isMain, writeJson } from './paths.js';
import {
  download, fileInfos, getItems, itemImages, itemWorks, searchItems,
} from './wikimedia.js';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * illustrated：插图本（ebook 号；file 是缓存位置，默认就是原文 source.html）
 * wikidata：人物条目描述里应出现的作者 / 作品名
 * video：source 是 B 站视频，episodes 的 chapters 是该集对应的单元
 */
const PLANS = {
  pride: {
    illustrated: { ebook: 1342, credit: 'Hugh Thomson（George Allen 1894 年版）' },
    wikidata: /Austen|Pride and Prejudice/i,
    video: {
      source: { bvid: 'BV1sgVwzhESD', title: '【全6集】傲慢与偏见 (1995)', owner: '书殇客', note: 'BBC 1995 年版六集剧，按剧情大致对照章节' },
      episodes: [
        [1, '内瑟菲尔德舞会之前', range(1, 12)], [2, '柯林斯求婚', range(13, 23)], [3, '汉斯福德的求婚', range(24, 34)],
        [4, '达西的信', range(35, 44)], [5, '彭伯里与私奔', range(45, 50)], [6, '两对婚事', range(51, 61)],
      ].map(([ep, title, chapters]) => ({ ep, title, page: ep, chapters, label: `1995 版第${ep}集 ${title}`, label_en: `1995 ep. ${ep}` })),
    },
  },
  janeeyre: {
    illustrated: { ebook: 1260, credit: 'F. H. Townsend（1897 年版）' },
    wikidata: /Bront|Jane Eyre/i,
    video: {
      source: { bvid: 'BV1KfMD65EhM', title: '简·爱（BBC 2006 版，全 4 集）', owner: '月兔拾光', note: 'BBC 2006 年版四集剧，按剧情大致对照章节' },
      episodes: [
        [1, '盖茨黑德与劳渥德', range(1, 15)], [2, '桑菲尔德', range(16, 20)], [3, '婚礼', range(21, 27)], [4, '沼泽居与归来', range(28, 38)],
      ].map(([ep, title, chapters]) => ({ ep, title, page: ep, chapters, label: `2006 版第${ep}集 ${title}`, label_en: `2006 ep. ${ep}` })),
    },
  },
  sherlock: {
    illustrated: { ebook: 48320, file: 'media/illustrated.html', credit: 'Sidney Paget（《海滨杂志》原刊插图）' },
    wikidata: /Sherlock|Conan Doyle/i,
    video: {
      source: { bvid: 'BV1LUECz5E4A', title: '【全集】福尔摩斯探案集 (1984)', owner: '书殇客', note: '格拉纳达电视台 1984–1994 年版，只列本书收录的 8 个故事' },
      episodes: [
        [1, 1, '波希米亚丑闻'], [12, 2, '红发会'], [30, 4, '博斯科姆比溪谷秘案'], [18, 6, '歪唇男人'],
        [7, 7, '蓝宝石案'], [6, 8, '斑点带子案'], [35, 10, '单身贵族'], [8, 12, '铜山毛榉案'],
      ].map(([page, no, title]) => ({ ep: page, title, page, chapters: [no], label: `格拉纳达版《${title}》`, label_en: `Granada: ${title}` })),
    },
  },
  alice: {
    illustrated: { ebook: 28885, file: 'media/illustrated.html', credit: 'Arthur Rackham（1907 年版）' },
    wikidata: /Carroll|Alice|Wonderland/i,
    video: {
      source: { bvid: 'BV1EZ421i7u6', title: '爱丽丝梦游仙境 (1951)', owner: '゙珈乐', note: '迪士尼 1951 年动画电影' },
      episodes: [{ ep: 1, title: '迪士尼动画电影', page: 1, chapters: range(1, 12), label: '1951 迪士尼动画', label_en: 'Disney 1951' }],
    },
  },
  romeo: {
    wikidata: /Shakespeare|Romeo and Juliet/i,
    video: {
      source: { bvid: 'BV19KGszBEPv', title: '罗密欧与朱丽叶 (1968)', owner: '纯爱视界', note: '泽菲雷利 1968 年电影，英语中英双字' },
      episodes: [{ ep: 1, title: '泽菲雷利电影', page: 1, chapters: range(1, 24), label: '1968 泽菲雷利电影', label_en: 'Zeffirelli 1968' }],
    },
  },
  gatsby: {
    wikidata: /Fitzgerald|Great Gatsby/i,
    video: {
      source: { bvid: 'BV1iPu46ZEB5', title: '了不起的盖茨比 (1974) 普通话', owner: '怀旧配音歌舞音乐', note: '1974 年电影的普通话配音版，分 35 段上传；按全片进度大致对照章节' },
      // 全片 35 段，第 n 章从全片的 (n-1)/9 处开始
      episodes: range(1, 9).map((no) => {
        const page = Math.round(((no - 1) / 9) * 35) + 1;
        return { ep: no, title: `约第 ${page} 段起`, page, chapters: [no], label: `1974 电影 · 第${no}章（第 ${page} 段起）`, label_en: `1974 film · part ${page}` };
      }),
    },
  },
};

// ───────────────────────── 图片尺寸 ─────────────────────────

function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return {};
}

// ───────────────────────── 图谱里的人物 ─────────────────────────

async function chapterPeople() {
  const list = await rows(
    `MATCH (e:Entity {graph_id: $g, entity_type: 'Person'})-[a:APPEARS_IN]->(c:Chapter {graph_id: $g})
     RETURN c.no AS no, e.canonical_name AS name, e.nickname AS zh, a.count AS n, e.claim_count AS claims ORDER BY no, n DESC`,
  );
  const byChapter = new Map();
  const people = new Map();
  for (const r of list) {
    if (!byChapter.has(r.no)) byChapter.set(r.no, []);
    byChapter.get(r.no).push(r);
    const p = people.get(r.name) || { name: r.name, zh: r.zh || '', claims: Number(r.claims) || 0 };
    people.set(r.name, p);
  }
  return { byChapter, people };
}

// ───────────────────────── 插图 ─────────────────────────

async function illustratedImages(graph, plan, chapters) {
  const { DATA_DIR } = graphPaths(graph.id);
  const { ebook, file = 'source.html' } = plan.illustrated;
  const html = await fetchEbook(ebook, path.join(DATA_DIR, file));
  const dir = path.join(DATA_DIR, 'media', 'illustrations');
  const seen = new Set();
  const out = [];
  for (const ill of illustrations(html)) {
    if (seen.has(ill.src)) continue;
    seen.add(ill.src);
    const at = locateIllustration(chapters, ill);
    if (!at) continue;
    let name = await download(ebookImageUrl(ebook, ill.src), dir, { name: path.basename(ill.src) });
    let size = imageSize(path.join(dir, name));
    // 插图本正文里放的是小图、链到大图的，小于 400px 就换大图
    if (ill.full && (size.width || 0) < 400) {
      name = await download(ebookImageUrl(ebook, ill.full), dir, { name: `full-${path.basename(ill.full)}` });
      size = imageSize(path.join(dir, name));
    }
    out.push({ ...ill, ...at, file: name, ...size });
  }
  return out;
}

/** LLM 看说明与所在段落，判断每张图画了哪些人物（只能从本章出场人物里选），并给中文图题 */
async function tagIllustrations(graph, images, chapters, byChapter) {
  const BATCH = 12;
  const tasks = [];
  for (let i = 0; i < images.length; i += BATCH) tasks.push(images.slice(i, i + BATCH));
  const run = async (batch) => {
    const items = batch.map((img, k) => {
      const ch = chapters.find((c) => c.no === img.no);
      const cast = (byChapter.get(img.no) || []).slice(0, 18).map((p) => (p.zh ? `${p.name}（${p.zh}）` : p.name));
      const context = (ch?.paragraphs.slice(img.para, img.para + 2) || []).join(' ').slice(0, 600);
      return `#${k + 1} 第${img.no}${graph.unit} · 说明：${img.caption}\n上下文：${context}\n本${graph.unit}人物：${cast.join('、') || '（无）'}`;
    });
    const res = await chatJson({
      system: `你在为《${graph.book}》（${graph.title}）的插图编目。说明多是原文里的一句话，是判断画面的主要依据；上下文只是插图附近的段落，可能与画面无关。
每张图给：title（中文图题，≤18 字，概括画面，人物用通行中文译名）；people（画面里出现的人物，只能从该条给出的人物名单里原样抄英文名，看不出是谁就留空）。`,
      user: `${items.join('\n\n')}\n\n输出 JSON：{"items":[{"id":1,"title":"","people":[]}]}`,
      maxTokens: 3000,
    });
    for (const it of res.items || []) {
      const img = batch[Number(it.id) - 1];
      if (!img) continue;
      const allowed = new Set((byChapter.get(img.no) || []).map((p) => p.name));
      img.title = String(it.title || '').trim();
      img.people = (it.people || []).map(String).filter((n) => allowed.has(n));
    }
  };
  for (let i = 0; i < tasks.length; i += 4) await Promise.all(tasks.slice(i, i + 4).map(run));
}

// ───────────────────────── 维基数据人物像 ─────────────────────────

async function workItem(graph) {
  const title = graph.title.replace(/[’‘]/g, "'");
  const items = await getItems(await searchItems(title, 8, 'en'));
  return items.find((it) => /novel|play|tragedy|book|stor|literary work|collection/i.test(it.descriptions?.en?.value || '')) || null;
}

async function portraits(graph, plan, people) {
  const work = await workItem(graph);
  const out = new Map();
  const top = [...people.values()].sort((a, b) => b.claims - a.claims).slice(0, 30);
  for (const p of top) {
    let item = null;
    try {
      const items = await getItems(await searchItems(p.name, 6, 'en'));
      // 同名的画作、电影条目也有配图：要么标了出现于本作，要么英文描述就是「某书中的人物」
      const desc = (it) => it.descriptions?.en?.value || '';
      item = items.find((it) => itemImages(it).length && ((work && itemWorks(it).includes(work.id)) || (/character/i.test(desc(it)) && plan.wikidata.test(desc(it)))));
    } catch (e) {
      console.warn(`  [wikidata] ${p.name}: ${e.message}`);
    }
    if (!item) continue;
    const [info] = await fileInfos(itemImages(item).slice(0, 1), 480);
    if (!info || !/public domain|pd|cc/i.test(info.license || '')) continue;
    const dir = path.join(graphPaths(graph.id).DATA_DIR, 'media', 'commons');
    const name = await download(info.thumb, dir);
    out.set(p.name, {
      src: `/media/${graph.id}/commons/${name}`, title: info.title, description: info.description, credit: info.credit,
      license: info.license, source: 'commons', page_url: info.page_url, width: info.width, height: info.height,
    });
    console.log(`  [wikidata] ${p.name} ← ${info.file}`);
  }
  return out;
}

// ───────────────────────── 汇总 ─────────────────────────

export async function buildMedia(graphId) {
  const graph = getGraph(graphId);
  const plan = PLANS[graphId];
  if (!plan) throw new Error(`${graphId} 没有媒体计划`);
  const tag = `[media:${graphId}]`;
  const { DATA_DIR, listChapters } = graphPaths(graphId);
  const chapters = listChapters();
  const { byChapter, people } = await withGraph(graphId, chapterPeople);
  if (!people.size) throw new Error('图谱里还没有人物，先跑 load');

  let images = [];
  if (plan.illustrated) {
    images = await illustratedImages(graph, plan, chapters);
    console.log(`${tag} 插图 ${images.length} 张已定位`);
    await tagIllustrations(graph, images, chapters, byChapter);
  }
  const wiki = await portraits(graph, plan, people);
  console.log(`${tag} 维基数据人物像 ${wiki.size}`);

  const entities = {};
  const add = (name, img) => {
    entities[name] ||= { gallery: [] };
    entities[name].gallery.push(img);
  };
  for (const [name, img] of wiki) add(name, img);
  const credit = plan.illustrated?.credit;
  for (const img of images) {
    const shown = {
      src: `/media/${graphId}/illustrations/${img.file}`,
      title: img.title || img.caption,
      description: img.caption,
      credit,
      license: 'Public domain',
      source: 'gutenberg',
      page_url: `https://www.gutenberg.org/ebooks/${plan.illustrated.ebook}`,
      width: img.width,
      height: img.height,
    };
    img.shown = shown;
    for (const name of img.people || []) add(name, { ...shown, solo: img.people.length === 1 });
  }
  // 头像：插图本里的单人插图（与本书同一画风），其次维基数据人物像（可能是后世剧照），再次是第一张插图
  for (const m of Object.values(entities)) {
    m.gallery = m.gallery.slice(0, 12);
    const pick = m.gallery.find((g) => g.solo) || m.gallery.find((g) => g.source === 'commons') || m.gallery[0];
    m.avatar = pick.src;
    for (const g of m.gallery) delete g.solo;
  }

  const chaptersMedia = {};
  const ensure = (no) => (chaptersMedia[no] ||= {});
  for (const ep of plan.video?.episodes || []) {
    for (const no of ep.chapters) {
      const m = ensure(no);
      (m.episodes ||= []).push({ ep: ep.ep, title: ep.title, bvid: plan.video.source.bvid, page: ep.page, label: ep.label, label_en: ep.label_en });
    }
  }
  for (const img of images) {
    (ensure(img.no).images ||= []).push({ ...img.shown, para: img.para, people: img.people || [] });
  }

  writeJson(path.join(DATA_DIR, 'media.json'), { entities, chapters: chaptersMedia });
  if (plan.video) {
    writeJson(path.join(DATA_DIR, 'videos.json'), {
      source: { ...plan.video.source, url: `https://www.bilibili.com/video/${plan.video.source.bvid}` },
      episodes: plan.video.episodes,
    });
  }
  const applied = await withGraph(graphId, () => applyMedia(graphId));
  console.log(`${tag} 完成：人物图集 ${Object.keys(entities).length}，单元 ${applied.chapters}，写回实体 ${applied.entities}`);
  return applied;
}

if (isMain(import.meta.url)) {
  const { id } = graphArg();
  buildMedia(id)
    .catch((e) => {
      console.error('[media] 失败:', e.message);
      process.exitCode = 1;
    })
    .finally(close);
}
