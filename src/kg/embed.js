// 本地中文句向量：BGE-small-zh（512 维，CLS 池化 + L2 归一化），首次运行自动下载到 data/models
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';

export const EMBED_MODEL = process.env.KG_EMBED_MODEL || 'Xenova/bge-small-zh-v1.5';
export const EMBED_DIM = 512;

env.cacheDir = path.resolve('data/models');

let extractorPromise;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBED_MODEL, { dtype: 'fp32' });
  }
  return extractorPromise;
}

/** 批量向量化，返回 number[][]；onProgress(done, total) 可选 */
export async function embedTexts(texts, { batchSize = 16, onProgress } = {}) {
  const extractor = await getExtractor();
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const tensor = await extractor(batch, { pooling: 'cls', normalize: true });
    const [n, dim] = tensor.dims;
    const data = tensor.data;
    for (let r = 0; r < n; r++) out.push(Array.from(data.subarray(r * dim, (r + 1) * dim)));
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}

export async function embedQuery(text) {
  const [vec] = await embedTexts([text]);
  return vec;
}
