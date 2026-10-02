// 网站入口：Express 静态页面 + JSON API
//   /            学习材料首页与各图谱页面（web/ 构建到 public/app 的 SPA）
//   /people/     自由探索：任意人物 / 学习主题的 3D 时间图谱（旧首页，独立静态页）
//   /media/...   图片等本地缓存的媒体（data/ 下）
import path from 'node:path';
import express from 'express';
import config from './config.js';
import { verifyConnection, initSchema } from './db.js';
import router from './routes.js';
import kgRouter from './kg/routes.js';
import { hasGraph } from './kg/domains/index.js';

const app = express();
const SPA_DIR = 'public/app';

// 解析 JSON 请求体（POST /api/seed 用）
app.use(express.json());

// API 路由
app.use(router);
app.use('/api', kgRouter);

// 静态资源：构建产物带哈希，可长期缓存
app.use('/assets', express.static(`${SPA_DIR}/assets`, { immutable: true, maxAge: '1y' }));
app.use('/vendor', express.static('public/vendor', { maxAge: '7d' }));
app.use('/people', express.static('public/people'));

// 媒体：/media/covers/<图谱>.jpg 首页封面；/media/<图谱>/... 该图谱的人物图、教材页图
app.use('/media/covers', express.static('data/covers', { maxAge: '7d', fallthrough: false }));
app.use('/media/:graph', (req, res, next) => {
  if (!hasGraph(req.params.graph)) return res.status(404).end();
  express.static(path.join('data', req.params.graph, 'media'), { maxAge: '7d', fallthrough: false })(req, res, next);
});

// SPA 前端路由：刷新任意页面都回落到 index.html（入口页不缓存，保证拿到最新构建）
app.get(['/', '/g/{*splat}', '/kg', '/kg/{*splat}'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile('index.html', { root: SPA_DIR });
});

// 统一错误处理：不出堆栈，只回简明错误
app.use((err, req, res, next) => {
  if (err.status === 404) return res.status(404).end();
  console.error('[web]', err); // 完整打印错误对象，方便定位
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动：先验证数据库连通 + 建好约束/索引
await verifyConnection();
await initSchema();
app.listen(config.port, () => {
  console.log(`[web] 无限连接已启动: http://localhost:${config.port}`);
});
