// 网页上点「开始处理」后在服务进程里跑专题管线（转写 → 种子 → 抽取 → 入库 → 星图与线索）。
// 同一时间只跑一个专题，其余排队；每一步都可续跑，停止或服务重启后再点一次接着做。
// 管线各步的日志行都带「:<专题id>]」标签，这里截下来存到 data/topics/<id>/run.log 给专题页看。
// 命令行（npm run topic:import -- … --run）在另一个进程里跑时，status.json 里记着它的 pid，网页照样显示进度。
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { listGraphs } from '../kg/domains/index.js';
import { topicDir } from '../kg/domains/topics.js';
import { readStatus, runGraph, STEPS, status } from '../scripts/kg/run.js';

const active = new Map();
const logging = new Set();
let chain = Promise.resolve();

const logFile = (id) => path.join(topicDir(id), 'run.log');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** 别的进程（命令行）正在跑这个专题 */
export function externalRun(id) {
  const s = readStatus(id);
  return s.state === 'running' && s.pid && s.pid !== process.pid && alive(s.pid);
}

function capture(line) {
  for (const id of new Set([...active.keys(), ...logging])) {
    if (!line.includes(`:${id}]`)) continue;
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    try {
      fs.appendFileSync(logFile(id), `${stamp} ${line.trim()}\n`);
    } catch {
      // 专题刚被删掉
    }
  }
}

let patched = false;
function patchConsole() {
  if (patched) return;
  patched = true;
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      if (active.size || logging.size) capture(util.format(...args));
    };
  }
}

/** 命令行跑专题时也把日志写进 run.log */
export function attachLog(id) {
  patchConsole();
  fs.mkdirSync(topicDir(id), { recursive: true });
  fs.writeFileSync(logFile(id), '');
  logging.add(id);
}

export function tailLog(id, n = 120) {
  try {
    const lines = fs.readFileSync(logFile(id), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

/** queued | running | null */
export function runState(id) {
  const job = active.get(id);
  if (!job) return externalRun(id) ? 'running' : null;
  return job.started ? 'running' : 'queued';
}

export function startRun(id, steps = STEPS) {
  if (runState(id)) throw Object.assign(new Error('这个专题正在处理'), { status: 409, code: 'topic_busy' });
  patchConsole();
  const controller = new AbortController();
  const job = { controller, steps, started: false };
  active.set(id, job);
  fs.mkdirSync(topicDir(id), { recursive: true });
  fs.writeFileSync(logFile(id), '');
  status(id, { state: 'queued', step: null, error: null, error_code: null, queued_at: new Date().toISOString() });
  chain = chain.then(async () => {
    if (controller.signal.aborted) {
      status(id, { state: 'stopped' });
      active.delete(id);
      return;
    }
    job.started = true;
    try {
      await runGraph(id, steps, { signal: controller.signal });
    } catch (e) {
      if (e.code !== 'aborted') console.error(`[run:${id}] 失败:`, e.message || e);
      else console.log(`[run:${id}] 已停止，已完成的部分保留，再点「继续处理」接着做`);
    } finally {
      active.delete(id);
    }
  });
  return { state: 'queued' };
}

/** 停止：抽取中的那几份做完就停，不会丢已完成的部分 */
export function stopRun(id) {
  const job = active.get(id);
  if (!job) return false;
  job.controller.abort();
  if (!job.started) status(id, { state: 'stopped' });
  return true;
}

/** 服务重启时，上次没跑完的专题标成中断，提示可以继续 */
export function recoverStale() {
  for (const g of listGraphs()) {
    if (!g.topic || active.has(g.id) || externalRun(g.id)) continue;
    const s = readStatus(g.id);
    if (s.state === 'running' || s.state === 'queued') {
      status(g.id, { state: 'failed', error: '服务重启，处理中断了', error_code: 'interrupted' });
    }
  }
}
