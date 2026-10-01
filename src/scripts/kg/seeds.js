// 主要人物种子表：作为抽取时的规范名表（把「宋公明」「及时雨」统一到「宋江」），入库时补全人物属性，
// 并标记为主要人物（is_hero，用于「出场断档」线索）。
//   水浒传：石碣排座次一百单八将（rank / star / nickname / name / aliases / role）
//   其它书：LLM 按书列出主要人物（name / nickname / aliases / role）
//   教材：不需要种子
//   node src/scripts/kg/seeds.js <graph>    重新生成
import fs from 'node:fs';
import { chatJson } from '../../kg/llm.js';
import { getGraph } from '../../kg/domains/index.js';
import { graphArg, graphPaths, isMain, readJson, writeJson } from './paths.js';

const clean = (h) => ({
  name: String(h.name || '').trim(),
  nickname: String(h.nickname || '').trim(),
  aliases: (h.aliases || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 6),
  role: String(h.role || '').trim(),
});

async function shuihuHeroes() {
  const all = [];
  for (const [from, to] of [[1, 36], [37, 72], [73, 108]]) {
    const res = await chatJson({
      system: '你是《水浒传》研究专家，只输出 JSON。',
      user: `按《水浒传》第七十一回石碣排座次，列出第 ${from} 到第 ${to} 位好汉。
每位给出：rank(座次数字)、star(星号，如「天魁星」)、nickname(绰号)、name(本名)、
aliases(书中常见的其它称呼，如表字、官称、尊称，不含绰号本身，最多 4 个)、
role(梁山职司，简短)。
输出 JSON：{"heroes":[{"rank":1,"star":"","nickname":"","name":"","aliases":[],"role":""}]}`,
      maxTokens: 8000,
    });
    all.push(...(res.heroes || []));
  }
  const byRank = new Map();
  for (const h of all) {
    const rank = Number(h.rank);
    if (rank >= 1 && rank <= 108 && h.name && !byRank.has(rank)) byRank.set(rank, { rank, star: String(h.star || '').trim(), ...clean(h) });
  }
  const heroes = [...byRank.values()].sort((a, b) => a.rank - b.rank);
  if (heroes.length !== 108) throw new Error(`座次表只拿到 ${heroes.length} 位，请重试`);
  return heroes;
}

const SEED_PLAN = {
  xiyouji: { count: 120, hint: '取经团队、天庭与灵山诸神、各路妖王、沿途国王' },
  hongloumeng: { count: 150, hint: '四大家族主子、金陵十二钗、主要丫鬟小厮、府外亲友' },
  sanguo: { count: 160, hint: '魏蜀吴君主与文臣武将、汉末群雄、后期人物' },
  liaozhai: { count: 120, hint: '著名篇目的主角（狐、鬼、书生），name 用篇中称呼，role 写所在篇名' },
  lunyu: { count: 50, hint: '孔子、孔门弟子（含字）、书中出现的国君大夫与隐者' },
  shiji: { count: 200, hint: '五帝三代、春秋战国君主名臣、秦汉之际人物、汉初功臣与汉武帝时人物' },
};

async function bookSeeds(graph) {
  const plan = SEED_PLAN[graph.id];
  if (!plan) return [];
  const all = new Map();
  // 一批太多会顶到 max_tokens（三国人名表尤其容易），截断时把这一批减半重来
  let size = 30;
  let stale = 0;
  while (all.size < plan.count && stale < 3) {
    const exclude = [...all.keys()].slice(-160).join('、');
    let res;
    try {
      res = await chatJson({
        system: `你是${graph.prompts.role}，只输出 JSON。`,
        user: `列出《${graph.book}》中最重要的${graph.extract.seedNoun}，范围：${plan.hint}。
这一批给出 ${size} 位${exclude ? `，不要重复以下已列出的：${exclude}` : ''}。
每位：name(书中最通行的规范名)、nickname(字/号/绰号，没有留空)、aliases(书中其它称呼，最多 4 个)、role(身份，≤12字)。
输出 JSON：{"people":[{"name":"","nickname":"","aliases":[],"role":""}]}`,
        maxTokens: 8000,
      });
    } catch (e) {
      if (e.code === 'LENGTH' && size > 10) {
        size = Math.ceil(size / 2);
        continue;
      }
      throw e;
    }
    const before = all.size;
    for (const h of res.people || []) {
      const c = clean(h);
      if (c.name && !all.has(c.name)) all.set(c.name, c);
    }
    stale = all.size === before ? stale + 1 : 0;
  }
  return [...all.values()].slice(0, plan.count).map((s, i) => ({ rank: null, ...s, order: i + 1 }));
}

export async function loadSeeds(graphId, { refresh = false } = {}) {
  const graph = getGraph(graphId);
  const paths = graphPaths(graphId);
  paths.ensureDirs();
  if (!refresh) {
    const cached = readJson(paths.SEEDS_FILE);
    if (Array.isArray(cached)) return cached;
  }
  const seeds = graphId === 'shuihu' ? await shuihuHeroes() : await bookSeeds(graph);
  writeJson(paths.SEEDS_FILE, seeds);
  return seeds;
}

if (isMain(import.meta.url)) {
  const { id } = graphArg();
  const file = graphPaths(id).SEEDS_FILE;
  if (fs.existsSync(file)) fs.rmSync(file);
  loadSeeds(id, { refresh: true })
    .then((s) => console.log(`[seeds:${id}] ${s.length} 位：`, s.slice(0, 8).map((x) => x.name).join('、'), '…'))
    .catch((e) => {
      console.error(`[seeds:${id}] 失败:`, e.message);
      process.exit(1);
    });
}
