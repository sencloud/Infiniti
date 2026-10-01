// 后台任务登记：进度在内存里实时更新，结束时落一份到 Neo4j（KgJob），重启后仍能查到最近一次结果。
// 任务按图谱区分：同一图谱同一类任务同时只跑一个。
import crypto from 'node:crypto';
import { exec, currentGraphId } from './neo.js';

const active = new Map();

export function createJob(kind, extra = {}) {
  const job = {
    job_id: crypto.randomUUID(),
    graph_id: currentGraphId(),
    kind,
    status: 'running',
    stage: '',
    progress: 0,
    error: null,
    cancelled: false,
    created_at: new Date().toISOString(),
    finished_at: null,
    ...extra,
  };
  active.set(job.job_id, job);
  return job;
}

export function isRunning(kind) {
  const g = currentGraphId();
  return [...active.values()].some((j) => j.graph_id === g && j.kind === kind && j.status === 'running');
}

export function getJob(jobId) {
  return active.get(jobId) || null;
}

export async function finishJob(job, status, error = null) {
  job.status = status;
  job.error = error ? String(error.message || error) : null;
  job.finished_at = new Date().toISOString();
  if (status === 'completed') {
    job.progress = 100;
    job.stage = 'done';
  }
  const { cancelled, ...props } = job;
  await exec(
    `MERGE (j:KgJob {job_id: $job_id})
     SET j.payload = $payload, j.kind = $kind, j.finished_at = $finished_at, j.graph_id = $gid`,
    { job_id: job.job_id, kind: job.kind, gid: job.graph_id, finished_at: job.finished_at, payload: JSON.stringify(props) },
  ).catch(() => {});
}

export async function latestJob(kind) {
  const g = currentGraphId();
  const running = [...active.values()]
    .filter((j) => j.graph_id === g && j.kind === kind)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (running) return running;
  const rows = await exec(
    'MATCH (j:KgJob {graph_id: $g, kind: $kind}) RETURN j.payload AS p ORDER BY j.finished_at DESC LIMIT 1',
    { kind },
  );
  return rows.length ? JSON.parse(rows[0].get('p')) : null;
}

export async function findJob(jobId) {
  if (active.has(jobId)) return active.get(jobId);
  const rows = await exec('MATCH (j:KgJob {job_id: $jobId}) RETURN j.payload AS p', { jobId });
  return rows.length ? JSON.parse(rows[0].get('p')) : null;
}
