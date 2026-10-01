// 星图 / 分析用到的小工具：向量运算、可复现随机数、稳健统计、轮廓系数

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a) {
  return Math.sqrt(dot(a, a));
}

export function normalize(a) {
  const n = norm(a) || 1;
  return a.map((x) => x / n);
}

export function cosine(a, b) {
  const d = norm(a) * norm(b);
  return d ? dot(a, b) / d : 0;
}

export function meanVector(rows) {
  const dim = rows[0]?.length || 0;
  const out = new Array(dim).fill(0);
  for (const r of rows) for (let i = 0; i < dim; i++) out[i] += r[i];
  return out.map((x) => x / (rows.length || 1));
}

/** mulberry32：UMAP / KMeans 需要可复现的随机源 */
export function seededRandom(seed = 42) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 稳健 z 分数：(x - 中位数) / (1.4826 · MAD) */
export function robustZ(values) {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med))) * 1.4826 || 1e-6;
  return values.map((v) => (v - med) / mad);
}

/** 余弦距离矩阵（输入需已归一化），Float32Array 行主序 */
export function cosineDistanceMatrix(rows) {
  const n = rows.length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - dot(rows[i], rows[j]);
      m[i * n + j] = d;
      m[j * n + i] = d;
    }
  }
  return m;
}

/** 平均轮廓系数，dist 为 n×n 距离矩阵 */
export function silhouette(dist, n, labels) {
  const k = Math.max(...labels) + 1;
  const sizes = new Array(k).fill(0);
  for (const l of labels) sizes[l]++;
  let total = 0;
  const sums = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    sums.fill(0);
    for (let j = 0; j < n; j++) if (j !== i) sums[labels[j]] += dist[i * n + j];
    const own = labels[i];
    if (sizes[own] <= 1) continue;
    const a = sums[own] / (sizes[own] - 1);
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== own && sizes[c]) b = Math.min(b, sums[c] / sizes[c]);
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}

export function percentileRank(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (v) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return sorted.length ? lo / sorted.length : 0;
  };
}
