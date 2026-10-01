// 知识图谱查询辅助：把 Neo4j 记录转成普通 JS 对象（Integer → number，Node → properties），
// 并提供「当前图谱」上下文：所有 KG 节点都带 graph_id，Cypher 里统一用 $g 过滤。
import { AsyncLocalStorage } from 'node:async_hooks';
import neo4j from 'neo4j-driver';
import { run } from '../db.js';
import { getGraph, hasUnitLabels, setUnitLabels } from './domains/index.js';

const graphContext = new AsyncLocalStorage();

/** 在指定图谱的上下文里执行 fn（异步链路里的查询都会自动带上 $g） */
export function withGraph(graphId, fn) {
  getGraph(graphId);
  return graphContext.run(graphId, fn);
}

export function currentGraphId() {
  const id = graphContext.getStore();
  if (!id) throw new Error('未指定图谱上下文（withGraph）');
  return id;
}

/** 当前图谱的完整配置（本体、术语、规则…） */
export function currentGraph() {
  return getGraph(currentGraphId());
}

/** 当前图谱的语义检索向量索引名（每个图谱一套，靠专属标签隔离） */
export function vectorIndexName(graphId = currentGraphId()) {
  return `segment_embedding_${graphId}`;
}

export function vectorLabel(graphId = currentGraphId()) {
  return `Vec_${graphId}`;
}

export function toNative(v) {
  if (v === null || v === undefined) return v;
  if (neo4j.isInt(v)) return v.toNumber();
  if (Array.isArray(v)) return v.map(toNative);
  if (v instanceof neo4j.types.Node || v instanceof neo4j.types.Relationship) return toNative(v.properties);
  if (typeof v === 'object' && v.constructor === Object) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toNative(val);
    return out;
  }
  return v;
}

/** 执行 Cypher（自动注入 $g），返回原始记录 */
export function exec(cypher, params = {}) {
  return run(cypher, { g: currentGraphId(), ...params });
}

/** 执行 Cypher，返回 [{列名: 值}] */
export async function rows(cypher, params = {}) {
  const records = await exec(cypher, params);
  return records.map((r) => {
    const o = {};
    for (const key of r.keys) o[key] = toNative(r.get(key));
    return o;
  });
}

export async function one(cypher, params = {}) {
  return (await rows(cypher, params))[0] || null;
}

/**
 * 有名称的单元（Chapter.label）缓存进 domains，单元标签函数同步可用。
 * 查不到时只记 30 秒：图谱可能还在入库，之后再取一次。
 */
const emptyLabelsAt = new Map();
export async function ensureUnitLabels() {
  const graph = currentGraph();
  if (hasUnitLabels(graph.id)) return;
  if (Date.now() - (emptyLabelsAt.get(graph.id) || 0) < 30_000) return;
  const list = await rows('MATCH (c:Chapter {graph_id: $g}) WHERE c.label IS NOT NULL RETURN c.no AS no, c.label AS label');
  if (list.length) setUnitLabels(graph.id, new Map(list.map((r) => [r.no, r.label])));
  else emptyLabelsAt.set(graph.id, Date.now());
}

/** Cypher 的 LIMIT / SKIP 需要整数类型 */
export const int = (n) => neo4j.int(Math.max(0, Math.floor(Number(n) || 0)));

export function parseJsonField(v, fallback) {
  if (typeof v !== 'string') return v ?? fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
