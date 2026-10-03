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
  pride: { count: 45, hint: '班纳特一家、宾利与达西两家、柯林斯与卢卡斯家、凯瑟琳夫人、韦翰、加德纳夫妇等' },
  janeeyre: { count: 50, hint: '里德一家、劳渥德师生、桑菲尔德的主仆与宾客、里弗斯兄妹、梅森兄妹' },
  sherlock: { count: 70, hint: '福尔摩斯与华生、哈德森太太、警探，以及 12 个故事里各自的委托人、嫌疑人与受害者' },
  gatsby: { count: 30, hint: '尼克、盖茨比、布坎南夫妇、乔丹、威尔逊夫妇、沃尔夫山姆、派对客人等' },
  romeo: { count: 30, hint: '蒙太古与凯普莱特两家、亲王与帕里斯、神父与奶妈、仆人与乐师' },
  alice: { count: 40, hint: '爱丽丝、白兔、毛毛虫、公爵夫人、柴郡猫、疯帽匠、三月兔、睡鼠、红心国王王后、假海龟、狮鹫等' },
};

const NAME_RULE = {
  zh: 'name(书中最通行的规范名)、nickname(字/号/绰号，没有留空)、aliases(书中其它称呼，最多 4 个)',
  en: 'name(英文原文里的规范名：书中给出名和姓的用「名 姓」如 Fitzwilliam Darcy，只有称谓加姓的保留如 Mrs. Bennet，动物和拟人角色去掉定冠词如 White Rabbit)、nickname(通行中文译名，如「达西」「白兔」)、aliases(原文里的其它称呼，如 Mr. Darcy、Lizzy，最多 4 个)',
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
每位：${NAME_RULE[graph.lang || 'zh']}、role(身份，中文 ≤12字)。
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
  const seeds = [...all.values()].slice(0, plan.count);
  // 别名正好是另一位的名字（老鼠的别名写成 Dormouse、爱丽丝的别名写成 Alice's Sister），会把两人并成一个
  const bare = (s) => s.replace(/^The\s+/i, '').toLowerCase();
  const names = new Set(seeds.map((s) => bare(s.name)));
  for (const s of seeds) s.aliases = s.aliases.filter((a) => !names.has(bare(a)) || bare(a) === bare(s.name));
  return seeds.map((s, i) => ({ rank: null, ...s, order: i + 1 }));
}

/** 专题：清单里的每份文件本身就是一个实体（标准用编号，法规制度用全称），不用调模型 */
async function topicSeeds(graph) {
  const { readManifest } = await import('../../topic/manifest.js');
  const { parseStandardCode } = await import('../../kg/domains/topics.js');
  const type = graph.ontology.ENTITY_TYPE_CODES.has('Standard') ? 'Standard' : 'Document';
  const seeds = [];
  for (const f of readManifest(graph.id).files) {
    if (!f.converted || f.error) continue;
    const title = f.title.replace(/[（(]\d{4}\s*版[）)]$/, '').trim();
    const name = f.code || title;
    const aliases = new Set();
    if (f.code) {
      aliases.add(title);
      const p = parseStandardCode(f.code);
      if (p?.year) aliases.add(p.base);
    } else if (title.startsWith('中华人民共和国')) {
      aliases.add(title.slice(7));
    }
    aliases.delete(name);
    seeds.push({
      name, type, nickname: '', aliases: [...aliases].filter((a) => a.length >= 2 && a.length <= 40),
      role: f.category, description: f.code ? title : '', unit_no: f.no,
    });
  }
  return seeds;
}

export async function loadSeeds(graphId, { refresh = false } = {}) {
  const graph = getGraph(graphId);
  const paths = graphPaths(graphId);
  paths.ensureDirs();
  if (!refresh) {
    const cached = readJson(paths.SEEDS_FILE);
    if (Array.isArray(cached)) return cached;
  }
  const seeds = graph.topic ? await topicSeeds(graph) : graphId === 'shuihu' ? await shuihuHeroes() : await bookSeeds(graph);
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
