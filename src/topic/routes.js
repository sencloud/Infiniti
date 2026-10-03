// 专题管理 API（/api/knowledge-graph/topics/*；/api/topics 是旧版人物网的主题任务，别混）：新建专题、上传或从本机文件夹导入资料、开始/停止处理、看进度。
// 改动类操作要管理权限（见 kg/access.js）；读服务器本地文件夹只认本机直连。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { canManage, isLocalRequest, requireManage } from '../kg/access.js';
import {
  clearUnitLabels, getGraph, hasGraph, listGraphs, registerTopic, syncTopics, unregisterGraph,
} from '../kg/domains/index.js';
import { presetList, PRESETS, TOPIC_ID_RE, topicDir, writeTopicMeta } from '../kg/domains/topics.js';
import { exec, one, vectorIndexName, withGraph } from '../kg/neo.js';
import { graphPaths } from '../scripts/kg/paths.js';
import { readStatus, STEPS } from '../scripts/kg/run.js';
import { wipeGraph } from '../scripts/kg/load.js';
import {
  ACCEPT, MAX_FILE_BYTES, cleanRelPath, filesDir, importFolder, readManifest, registerFile, removeFile,
} from './manifest.js';
import { externalRun, recoverStale, runState, startRun, stopRun, tailLog } from './runner.js';

const router = Router();
const T = '/knowledge-graph/topics';

const fail = (status, code, message, params) => Object.assign(new Error(message), { status, code, params });

const wrap = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req, res) });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[topics]', req.method, req.originalUrl, e);
    res.status(e.status || 500).json({ success: false, message: e.message || '服务器错误', code: e.code || 'server_error', params: e.params });
  }
};

function topicOf(id) {
  if (!hasGraph(id) || !getGraph(id).topic) throw fail(404, 'topic_missing', `没有这个专题：${id}`, { id });
  return getGraph(id);
}

function readMeta(id) {
  return JSON.parse(fs.readFileSync(path.join(topicDir(id), 'topic.json'), 'utf8'));
}

function busy(id) {
  if (runState(id)) throw fail(409, 'topic_busy', '这个专题正在处理，请先停止');
}

async function counts(id) {
  try {
    return await withGraph(id, () => one(
      `CALL { MATCH (c:Chapter {graph_id: $g}) RETURN count(c) AS units }
       CALL { MATCH (e:Entity {graph_id: $g}) RETURN count(e) AS entities }
       CALL { MATCH (c:Claim {graph_id: $g}) RETURN count(c) AS claims }
       RETURN units, entities, claims`,
    ));
  } catch {
    return { units: 0, entities: 0, claims: 0 };
  }
}

function fileRows(id) {
  const paths = graphPaths(id);
  return readManifest(id).files.map((f) => {
    const converted = f.converted && f.converted.sha1 === f.sha1
      ? { chars: f.converted.chars, pages: f.converted.page_count, ocr_pages: f.converted.ocr_pages }
      : null;
    const extracted = fs.existsSync(paths.extractFile(f.no));
    return {
      no: f.no,
      path: f.path,
      name: f.name,
      category: f.category,
      code: f.code,
      title: f.title,
      kind: f.kind,
      size: f.size,
      added_at: f.added_at,
      converted,
      extracted,
      error: f.error || null,
      status: f.error ? 'failed' : extracted && converted ? 'extracted' : converted ? 'converted' : 'pending',
    };
  });
}

const seenFinish = new Map();

function statusOf(id) {
  const s = readStatus(id);
  const live = runState(id);
  // 命令行进程入库后，本进程缓存的单元名不会自己失效
  if (s.finished_at && seenFinish.get(id) !== s.finished_at) {
    seenFinish.set(id, s.finished_at);
    clearUnitLabels(id);
  }
  return {
    state: live || (s.state === 'running' || s.state === 'queued' ? 'failed' : s.state || null),
    step: live ? s.step || null : null,
    external: live === 'running' && externalRun(id),
    steps: s.steps || null,
    ingest: s.ingest || null,
    extracted: s.extracted ?? null,
    units: s.units ?? null,
    error: s.error || null,
    error_code: s.error_code || null,
    started_at: s.started_at || null,
    finished_at: s.finished_at || null,
    updated_at: s.updated_at || null,
  };
}

async function summary(graph) {
  const files = readManifest(graph.id).files;
  return {
    id: graph.id,
    name: graph.name,
    description: graph.description,
    preset: graph.preset,
    created_at: graph.created_at,
    file_count: files.length,
    converted: files.filter((f) => f.converted && f.converted.sha1 === f.sha1).length,
    failed: files.filter((f) => f.error).length,
    bytes: files.reduce((s, f) => s + (f.size || 0), 0),
    categories: [...new Set(files.map((f) => f.category).filter(Boolean))].length,
    stats: await counts(graph.id),
    status: statusOf(graph.id),
  };
}

const access = (req) => ({ can_manage: canManage(req), local: isLocalRequest(req) });

router.get(T, wrap(async (req) => {
  syncTopics();
  const graphs = listGraphs().filter((g) => g.topic);
  return { items: await Promise.all(graphs.map(summary)), presets: presetList(), ...access(req) };
}));

router.post(T, wrap(async (req) => {
  requireManage(req);
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const preset = PRESETS[req.body?.preset] ? req.body.preset : 'standards';
  if (!name || name.length > 40) throw fail(400, 'topic_name', '专题名称 1–40 个字');
  let id = String(req.body?.id || '').trim().toLowerCase();
  if (id && (!TOPIC_ID_RE.test(id) || hasGraph(id))) throw fail(400, 'topic_id', '专题标识已被占用或格式不对', { id });
  if (!id) id = `t${Date.now().toString(36)}`;
  const meta = { id, name, description: description.slice(0, 300), preset, created_at: new Date().toISOString() };
  writeTopicMeta(meta);
  return summary(registerTopic(meta));
}));

router.get(`${T}/:id`, wrap(async (req) => {
  const graph = topicOf(req.params.id);
  return { ...(await summary(graph)), files: fileRows(graph.id), log: tailLog(graph.id), steps: STEPS, ...access(req) };
}));

router.patch(`${T}/:id`, wrap(async (req) => {
  requireManage(req);
  const graph = topicOf(req.params.id);
  const meta = readMeta(graph.id);
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 40) throw fail(400, 'topic_name', '专题名称 1–40 个字');
    meta.name = name;
  }
  if (req.body?.description !== undefined) meta.description = String(req.body.description).trim().slice(0, 300);
  writeTopicMeta(meta);
  return summary(registerTopic(meta));
}));

router.delete(`${T}/:id`, wrap(async (req) => {
  requireManage(req);
  const graph = topicOf(req.params.id);
  busy(graph.id);
  await withGraph(graph.id, async () => {
    await wipeGraph();
    await exec(`DROP INDEX ${vectorIndexName(graph.id)} IF EXISTS`);
  });
  unregisterGraph(graph.id);
  fs.rmSync(topicDir(graph.id), { recursive: true, force: true });
  return { id: graph.id, deleted: true };
}));

/** 上传一个文件：请求体就是文件本身，?path= 是它在专题里的相对路径（目录即分类） */
router.put(`${T}/:id/files`, async (req, res) => {
  const tmpName = `.upload-${crypto.randomUUID()}`;
  let tmp = '';
  try {
    requireManage(req);
    const graph = topicOf(req.params.id);
    const rel = cleanRelPath(req.query.path);
    if (!rel || !ACCEPT.test(rel)) throw fail(400, 'topic_file_type', '只收 PDF、Word（doc/docx）和 txt/md 文件');
    const declared = Number(req.get('content-length') || 0);
    if (declared > MAX_FILE_BYTES) throw fail(413, 'topic_file_large', '单个文件不能超过 400MB');
    tmp = path.join(topicDir(graph.id), tmpName);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const hash = crypto.createHash('sha1');
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) {
          req.destroy();
          reject(fail(413, 'topic_file_large', '单个文件不能超过 400MB'));
          return;
        }
        hash.update(chunk);
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
    if (!size) throw fail(400, 'topic_file_empty', '文件是空的');
    const sha1 = hash.digest('hex');
    const known = readManifest(graph.id).files.find((f) => f.path === rel);
    let result;
    if (known?.sha1 === sha1) {
      fs.rmSync(tmp, { force: true });
      result = { entry: known, status: 'unchanged' };
    } else {
      const dst = path.join(filesDir(graph.id), rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.rmSync(dst, { force: true });
      fs.renameSync(tmp, dst);
      result = registerFile(graph.id, rel, { size, sha1 });
      if (result.status === 'duplicate') fs.rmSync(dst, { force: true });
    }
    res.json({ success: true, data: { status: result.status, no: result.entry.no, path: result.entry.path } });
  } catch (e) {
    if (tmp) fs.rmSync(tmp, { force: true });
    if (!e.status) console.error('[topics] upload', e);
    if (!res.headersSent) {
      res.status(e.status || 500).json({ success: false, message: e.message || '上传失败', code: e.code || 'server_error', params: e.params });
    }
  }
});

router.delete(`${T}/:id/files/:no`, wrap(async (req) => {
  requireManage(req);
  const graph = topicOf(req.params.id);
  busy(graph.id);
  const entry = removeFile(graph.id, Number(req.params.no));
  if (!entry) throw fail(404, 'topic_file_missing', '没有这个文件');
  return { no: entry.no, removed: true };
}));

router.post(`${T}/:id/import-local`, wrap(async (req) => {
  requireManage(req);
  if (!isLocalRequest(req)) throw fail(403, 'topic_local_only', '只有在服务器本机上打开页面，才能从本机文件夹导入');
  const graph = topicOf(req.params.id);
  busy(graph.id);
  const dir = String(req.body?.dir || '').trim().replace(/^"|"$/g, '');
  if (!dir) throw fail(400, 'folder_missing', '请填写文件夹路径', { dir });
  return importFolder(graph.id, dir);
}));

router.post(`${T}/:id/run`, wrap(async (req) => {
  requireManage(req);
  const graph = topicOf(req.params.id);
  if (!readManifest(graph.id).files.length) throw fail(400, 'topic_empty', '还没有资料，请先上传');
  const steps = Array.isArray(req.body?.steps) ? req.body.steps.filter((s) => STEPS.includes(s)) : STEPS;
  return startRun(graph.id, steps.length ? steps : STEPS);
}));

router.post(`${T}/:id/stop`, wrap(async (req) => {
  requireManage(req);
  const graph = topicOf(req.params.id);
  if (externalRun(graph.id)) throw fail(409, 'topic_external', '这个专题是在命令行里处理的，请在那个命令行窗口里按 Ctrl+C 停止');
  return { stopping: stopRun(graph.id) };
}));

export { recoverStale };
export default router;
