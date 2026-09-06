// 网站入口：Express 静态页面 + JSON API
import express from 'express';
import config from './config.js';
import { verifyConnection, initSchema } from './db.js';
import router from './routes.js';

const app = express();

// 解析 JSON 请求体（POST /api/seed 用）
app.use(express.json());

// API 路由
app.use(router);

// 静态前端页面
app.use(express.static('public'));

// 统一错误处理：不出堆栈，只回简明错误
app.use((err, req, res, next) => {
  console.error('[web]', err); // 完整打印错误对象，方便定位
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动：先验证数据库连通 + 建好约束/索引
await verifyConnection();
await initSchema();
app.listen(config.port, () => {
  console.log(`[web] 无限连接已启动: http://localhost:${config.port}`);
});
