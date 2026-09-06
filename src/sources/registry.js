// ============================================================
// 数据源注册表（Source Registry）
// ============================================================
// 【v4】采集数据不再固定百度百科：数据源变成可配置的"库"。
// 每个数据源是一个适配器，实现三个能力：
//   search(query)     搜索：返回候选词条 [{ title, url, snippet }]
//   fetch(url)        抓取：返回 { url, title, content }
//   suitability(kind) 适用性：'person' | 'knowledge' | 'both'
//
// 调度策略：按 priority 降序依次尝试，抓取失败自动降级到下一个源（fallback）。
// 内置源（百度/维基）代码硬编码；自定义源存 Neo4j，启动时合并加载。
// ============================================================
import { run } from '../db.js';

// ---------- 内置数据源适配器 ----------
// 注意：适配器只声明元信息（名字/优先级/适用域），抓取逻辑复用 crawler.js 的
// 真浏览器管线（fetchPage），因此所有源都自带 JS 反爬能力。

// 百度百科：中文知识覆盖最全，人物/知识都强
const baikeSource = {
  id: 'baike',
  name: '百度百科',
  priority: 100,
  for: ['person', 'knowledge'],
  // 词条 URL 规则：baike.baidu.com/item/{name}
  itemUrl: (name) => `https://baike.baidu.com/item/${encodeURIComponent(name)}`,
};

// 中文维基百科：中立可信，学术知识强；英文世界补充
const wikiSource = {
  id: 'wiki-zh',
  name: '维基百科(中文)',
  priority: 80,
  for: ['person', 'knowledge'],
  itemUrl: (name) => `https://zh.wikipedia.org/wiki/${encodeURIComponent(name)}`,
};

// 内置源清单（启动即注册）
const builtins = [baikeSource, wikiSource];

// ---------- 运行时注册表 ----------
// id -> 源对象（内置 + 自定义合并视图）
const registry = new Map();

// 从 Neo4j 加载自定义源并合并进注册表（server/worker 启动时调用）
export async function loadSources() {
  registry.clear();
  for (const s of builtins) registry.set(s.id, s);
  try {
    const records = await run(
      `MATCH (s:Source) RETURN s.id AS id, s.name AS name, s.priority AS priority, s.for AS forKinds`
    );
    for (const r of records) {
      registry.set(r.get('id'), {
        id: r.get('id'),
        name: r.get('name'),
        priority: Number(r.get('priority')) || 50,
        for: (r.get('forKinds') || ['knowledge']),
        itemUrl: (name) => null, // 自定义源无 URL 模板时不直接猜 URL，走 search
      });
    }
  } catch (e) {
    console.warn('[sources] 自定义源加载失败（忽略，仅用内置源）:', e.message);
  }
  return listSources();
}

// 列出全部源（按优先级降序）
export function listSources() {
  return [...registry.values()].sort((a, b) => b.priority - a.priority);
}

// 按任务类型筛选适用源（person / knowledge）
export function sourcesFor(kind) {
  return listSources().filter(s => s.for.includes(kind));
}

// 增删自定义源（配置面板用）
export async function addSource({ id, name, priority = 50, forKinds = ['knowledge'] }) {
  if (!id || !name) throw new Error('id 和 name 必填');
  await run(
    `
    MERGE (s:Source {id: $id})
    SET s.name = $name, s.priority = $priority, s.for = $forKinds
    `,
    { id, name, priority: Number(priority), forKinds }
  );
  await loadSources(); // 热重载
  return listSources();
}

export async function removeSource(id) {
  await run(`MATCH (s:Source {id: $id}) DELETE s`, { id });
  await loadSources();
  return listSources();
}

// 启动即加载内置源（import 副作用最小化：这里只填内置，DB 调用留给显式 loadSources）
for (const s of builtins) registry.set(s.id, s);
