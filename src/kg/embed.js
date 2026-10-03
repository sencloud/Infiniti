// 本地句向量：中文图谱用 BGE-small-zh（512 维，CLS 池化）；英文原著用 multilingual-e5-small（384 维，均值池化，
// 中文提问也能检索英文原文），补零到 512 维与同一个向量索引共用（补零不改变余弦相似度）。首次运行自动下载到 data/models
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';

export const EMBED_MODEL = process.env.KG_EMBED_MODEL || 'Xenova/bge-small-zh-v1.5';
export const EMBED_DIM = 512;

const MODELS = {
  zh: { id: EMBED_MODEL, pooling: 'cls', dtype: 'fp32', doc: '', query: '' },
  en: { id: process.env.KG_EMBED_MODEL_EN || 'Xenova/multilingual-e5-small', pooling: 'mean', dtype: 'q8', doc: 'passage: ', query: 'query: ' },
};

env.cacheDir = path.resolve('data/models');

const extractors = new Map();

function getExtractor(lang) {
  const m = MODELS[lang] || MODELS.zh;
  if (!extractors.has(m.id)) extractors.set(m.id, pipeline('feature-extraction', m.id, { dtype: m.dtype }));
  return extractors.get(m.id);
}

const pad = (vec) => (vec.length >= EMBED_DIM ? vec : [...vec, ...new Array(EMBED_DIM - vec.length).fill(0)]);

/** 批量求向量，返回 number[][]；lang 取图谱语言，onProgress(done, total) 可选 */
export async function embedTexts(texts, { batchSize = 16, onProgress, lang = 'zh', query = false } = {}) {
  const m = MODELS[lang] || MODELS.zh;
  const extractor = await getExtractor(lang);
  const prefix = query ? m.query : m.doc;
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => prefix + t);
    const tensor = await extractor(batch, { pooling: m.pooling, normalize: true });
    const [n, dim] = tensor.dims;
    const data = tensor.data;
    for (let r = 0; r < n; r++) out.push(pad(Array.from(data.subarray(r * dim, (r + 1) * dim))));
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}

export async function embedQuery(text, lang = 'zh') {
  const [vec] = await embedTexts([text], { lang, query: true });
  return vec;
}
