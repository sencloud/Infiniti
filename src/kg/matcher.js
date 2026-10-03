// 实体名称匹配器：按首字建索引，单遍扫描文本做最长匹配，统计每个实体被提及的次数。
// 用于「出场章回 / 提及次数」和语义星图片段的人物、地点标注。

const WORD = /[A-Za-z0-9]/;

/** 英文名要整词匹配：「Ann」不能命中「Anne」，「Jane」不能命中「Janet」 */
function atBoundary(text, i, name) {
  if (WORD.test(name[0]) && i > 0 && WORD.test(text[i - 1])) return false;
  const end = i + name.length;
  return !(WORD.test(name[name.length - 1]) && end < text.length && WORD.test(text[end]));
}

export class NameMatcher {
  /** @param {{id:string, names:string[]}[]} items */
  constructor(items) {
    this.byFirst = new Map();
    for (const { id, names } of items) {
      for (const name of new Set(names)) {
        if (!name || name.length < 2) continue;
        const list = this.byFirst.get(name[0]) || [];
        list.push({ name, id });
        this.byFirst.set(name[0], list);
      }
    }
    for (const list of this.byFirst.values()) list.sort((a, b) => b.name.length - a.name.length);
  }

  /** @returns {Map<string, number>} id → 次数 */
  count(text) {
    const counts = new Map();
    let i = 0;
    while (i < text.length) {
      const list = this.byFirst.get(text[i]);
      let hit = null;
      if (list) {
        for (const cand of list) {
          if (text.startsWith(cand.name, i) && atBoundary(text, i, cand.name)) {
            hit = cand;
            break;
          }
        }
      }
      if (hit) {
        counts.set(hit.id, (counts.get(hit.id) || 0) + 1);
        i += hit.name.length;
      } else {
        i++;
      }
    }
    return counts;
  }
}
