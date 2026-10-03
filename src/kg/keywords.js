// 中文分词 + TF-IDF 关键词：jieba 默认词典 + 图谱实体名（人名/地名/势力名作为整词不被切碎）
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict.js';

// 章回小说高频虚词、套话，对主题没有区分度
const STOP_WORDS = new Set(`
了 的 道 是 我 你 他 她 这 那 来 去 不 也 都 只 便 又 却 说 与 和 在 把 得 着 个 一 人 将 见 有 里 上 下 回 时 自 要 听 看 叫 等
如何 怎地 那里 这里 甚么 什么 如此 一个 两个 三个 只见 便道 说道 众人 小人 洒家 俺们 兄弟 哥哥 不是 不曾 只得 却是 自己 知道
出来 起来 上来 过来 下来 进来 回来 不知 不得 一面 当下 次日 当时 原来 正是 只是 如今 今日 那个 这个 只顾 因此 便是 已自 我们
你们 他们 这般 那般 怎生 如何是好 一齐 一同 一处 一时 一声 一日 一夜 两人 二人 三人 自家 大哥 小弟 那厮 这厮 那人 这人 此人
不要 不敢 不能 不肯 不见 不来 不去 不好 不想 不妨 不必 也是 也不 都是 只有 只要 只管 便是 便把 便叫 便去 便来 就是 就把 若是
如果 虽然 但是 因为 所以 然后 于是 已经 还是 或是 可以 可是 须是 须要 却又 却才 方才 才得 正在 正要 正好 恰好 看时 看见 听得
听了 说了 问道 答道 叫道 喝道 笑道 叹道 骂道 应道 拜道 告道 禀道 言道 分解 下回 且听 话说 且说 却说 诗曰 有诗为证 正是 但见
怎么 怎的 什么样 那边 这边 前面 后面 里面 外面 中间 左右 上面 下面 一般 一样 一件 一条 一口 一匹 一碗 一杯 这些 那些 许多 多少
`.split(/\s+/).filter(Boolean));

let jieba;
const customWords = new Set();

function getJieba() {
  if (!jieba) jieba = Jieba.withDict(dict);
  return jieba;
}

/** 把实体名加入分词词典（重复调用只追加新词） */
export function addWords(words, tag = 'nz') {
  // 词典行格式是「词 词频 词性」，带空白的名字（数学公式如 y = kx + b）会让整份词典加载失败
  const fresh = words.filter((w) => w && w.length >= 2 && !/\s/.test(w) && !customWords.has(w));
  if (!fresh.length) return;
  for (const w of fresh) customWords.add(w);
  getJieba().loadDict(Buffer.from(fresh.map((w) => `${w} 100000 ${tag}`).join('\n')));
}

const EN_STOP = new Set(`
a about above after again against all almost alone along already also although always am among an and another any
anything are around as at away back be became because become been before being below beside besides best better
between both but by came can cannot could did do does doing done down during each either else enough even ever every
everything far few first for from further gave get give go going gone good got great had has have having he her here
hers herself him himself his how however i if in indeed into is it its itself just know known last least less let
like little long made make many may me might mine more most much must my myself never next no nobody none nor not
nothing now of off often oh on once one only or other others ought our ours ourselves out over own perhaps quite
rather really said same say saw see seemed seen shall she should since so some something soon still such sure take
than that the their theirs them themselves then there these they thing things think this those though thought three
through thus till to too took two under until up upon us very was way we well went were what whatever when where
whether which while who whom whose why will with within without would yes yet you your yours yourself
ever replied answered asked cried looked come came told tell seem upon whom shall don't can't i'm it's that's
`.split(/\s+/).filter(Boolean));

const enPhrases = new Set();

/** 英文：多词实体名（Elizabeth Bennet）当作一个词 */
export function addPhrases(words) {
  for (const w of words) if (w && /\s/.test(w) && /^[A-Za-z]/.test(w)) enPhrases.add(w);
}

function tokenizeEnglish(text) {
  let rest = text;
  const out = [];
  for (const p of [...enPhrases].sort((a, b) => b.length - a.length)) {
    if (!rest.includes(p)) continue;
    const parts = rest.split(p);
    for (let i = 1; i < parts.length; i++) out.push(p);
    rest = parts.join(' ');
  }
  for (const w of rest.match(/[A-Za-z][A-Za-z’'-]+/g) || []) {
    const lower = w.toLowerCase().replace(/[’']s$/, '');
    if (lower.length >= 3 && !EN_STOP.has(lower)) out.push(/^[A-Z]/.test(w) && w !== w.toUpperCase() ? w.replace(/[’']s$/, '') : lower);
  }
  return out;
}

export function tokenize(text, lang = 'zh') {
  if (lang === 'en') return tokenizeEnglish(text);
  return getJieba()
    .cut(text, false)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && /^[\u4e00-\u9fa5]+$/.test(w));
}

/**
 * 语料 TF-IDF：docs 为分好词的文档（每个元素是 token 数组）。
 * 返回 keywordsFor(indices, topK)：对一组文档求合并 TF × 全局 IDF 的关键词。
 */
export function buildTfIdf(docs, { minDf = 2, maxDfRatio = 0.35 } = {}) {
  const df = new Map();
  for (const tokens of docs) for (const w of new Set(tokens)) df.set(w, (df.get(w) || 0) + 1);
  const n = docs.length;
  const idf = new Map();
  for (const [w, c] of df) {
    if (c >= minDf && c / n <= maxDfRatio) idf.set(w, Math.log((n + 1) / (c + 1)) + 1);
  }
  return function keywordsFor(indices, topK = 12) {
    const tf = new Map();
    let total = 0;
    for (const i of indices) {
      for (const w of docs[i]) {
        if (!idf.has(w)) continue;
        tf.set(w, (tf.get(w) || 0) + 1);
        total++;
      }
    }
    return [...tf]
      .map(([word, c]) => ({ word, weight: (c / (total || 1)) * idf.get(word) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topK)
      .map((k) => ({ word: k.word, weight: Number(k.weight.toFixed(5)) }));
  };
}
