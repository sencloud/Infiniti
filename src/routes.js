// API 路由：网站所有后端接口
import { Router } from 'express';
import * as query from './services/queryService.js';
import * as graph from './services/graphService.js';
import * as settings from './services/settingsService.js';
import defaultConfig from './config.js';

const router = Router();

// 全库统计（首页看板）
router.get('/api/stats', async (req, res, next) => {
  try {
    res.json(await query.getStats());
  } catch (e) {
    next(e);
  }
});

// 任务队列统计（首页看板：管道是否还在跑）
router.get('/api/tasks', async (req, res, next) => {
  try {
    res.json(await graph.taskStats());
  } catch (e) {
    next(e);
  }
});

// 任务队列明细（队列状态面板：最近任务 + 当前处理项 + 失败原因）
router.get('/api/tasks/list', async (req, res, next) => {
  try {
    res.json(await graph.taskList(40));
  } catch (e) {
    next(e);
  }
});

/* ===== 【队列管理 v2】任务增删改 ===== */

// 添加任务（队列面板内直接添加，高优先级）
router.post('/api/tasks', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 30) return res.status(400).json({ error: '人名不合法' });
    const priority = Number(req.body?.priority) || 1000;
    const depth = Number(req.body?.depth) || 0;
    await graph.enqueueTask(name, { priority, depth, reason: '手动添加' });
    res.json({ ok: true, name });
  } catch (e) {
    next(e);
  }
});

// 删除任务（取消排队）
router.delete('/api/tasks/:name', async (req, res, next) => {
  try {
    await graph.deleteTask(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// 重试任务（failed -> pending，优先级提升）
router.post('/api/tasks/:name/retry', async (req, res, next) => {
  try {
    await graph.retryTask(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// 清空某状态的全部任务（pending 清空队列 / failed 清理失败 / done 清历史）
router.delete('/api/tasks', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    if (!['pending', 'processing', 'failed', 'done'].includes(status)) {
      return res.status(400).json({ error: 'status 不合法' });
    }
    const n = await graph.deleteTasksByStatus(status);
    res.json({ ok: true, deleted: n });
  } catch (e) {
    next(e);
  }
});

// 调整优先级
router.put('/api/tasks/:name/priority', async (req, res, next) => {
  try {
    await graph.setTaskPriority(req.params.name, req.body?.priority);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// 清理无效节点（孤立 mentioned 人物）
router.post('/api/purge', async (req, res, next) => {
  try {
    const n = await graph.purgeOrphanMentioned();
    res.json({ ok: true, purged: n });
  } catch (e) {
    next(e);
  }
});

/* ===== 【v4】知识主题构建 ===== */

// 构建知识主题：入队 plan 阶段任务（如"小学数学3年级"）
router.post('/api/topics', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 40) return res.status(400).json({ error: '主题名不合法' });
    await graph.enqueueTask(name, {
      priority: 1500, // 比普通种子更高：用户明确要构建的主题
      depth: 0,
      reason: '用户知识构建',
      kind: 'knowledge',
      phase: 'plan',
    });
    res.json({ ok: true, name });
  } catch (e) {
    next(e);
  }
});

/* ===== 【v4】系统设置（配置面板读写） ===== */

// 读取设置（含当前生效值：.env 默认 + 面板覆盖）
router.get('/api/settings', async (req, res, next) => {
  try {
    const saved = await settings.getSettings();
    res.json({
      maxNodes: saved.maxNodes ?? defaultConfig.crawl.maxPersons,
      maxDepth: saved.maxDepth ?? defaultConfig.crawl.maxDepth,
      requestDelayMs: saved.requestDelayMs ?? defaultConfig.crawl.requestDelayMs,
      model: saved.model ?? defaultConfig.deepseek.model,
    });
  } catch (e) {
    next(e);
  }
});

// 保存设置（浅合并）
router.post('/api/settings', async (req, res, next) => {
  try {
    await settings.saveSettings(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ===== 【v4】数据源库配置 ===== */

import * as sources from './sources/registry.js';

// 列出全部数据源（内置 + 自定义，按优先级降序）
router.get('/api/sources', async (req, res, next) => {
  try {
    await sources.loadSources();
    res.json(sources.listSources());
  } catch (e) {
    next(e);
  }
});

// 添加自定义数据源
router.post('/api/sources', async (req, res, next) => {
  try {
    const { id, name, priority, forKinds } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id 和 name 必填' });
    await sources.addSource({ id, name, priority, forKinds });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// 删除自定义数据源（内置源不允许删）
router.delete('/api/sources/:id', async (req, res, next) => {
  try {
    if (['baike', 'wiki-zh'].includes(req.params.id)) {
      return res.status(400).json({ error: '内置数据源不可删除' });
    }
    await sources.removeSource(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// 搜索
router.get('/api/search', async (tmpReq, res, next) => {
  try {
    const q = String(tmpReq.query.q || '').trim();
    if (!q) return res.json([]);
    res.json(await query.searchPersons(q));
  } catch (e) {
    next(e);
  }
});

// 人物邻域子图（图谱页主接口）
router.get('/api/graph/:key', async (req, res, next) => {
  try {
    const data = await query.getNeighborhood(req.params.key);
    if (!data) return res.status(404).json({ error: '人物不存在' });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// 人物详情
router.get('/api/person/:key', async (req, res, next) => {
  try {
    const data = await query.getPersonDetail(req.params.key);
    if (!data) return res.status(404).json({ error: '人物不存在' });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// 追加种子人物（公开接口：简单限流 + 上限保护）
const seedWindow = new Map(); // ip -> 最近请求时间戳
router.post('/api/seed', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 30) return res.status(400).json({ error: '人名不合法' });

    // 简单限流：同一 IP 每 60 秒只能提交 1 次
    const ip = req.ip;
    const last = seedWindow.get(ip) || 0;
    if (Date.now() - last < 60_000) {
      return res.status(429).json({ error: '请求太频繁，请 1 分钟后再试' });
    }
    seedWindow.set(ip, Date.now());

    await graph.enqueueTask(name, { priority: 1000, depth: 0, reason: '用户种子' });
    res.json({ ok: true, name });
  } catch (e) {
    next(e);
  }
});

export default router;
