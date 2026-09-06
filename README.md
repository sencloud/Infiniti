# 无限连接 INFINITI

> 自动构建的知识图谱引擎 —— 输入任意主题或人物，系统自动规划、多源抓取、LLM 抽取，
> 在 3D 时间图谱上无限生长。

人物只是接入点之一。输入「小学数学3年级」，系统自动拆解课程单元、抓取知识点、
构建学科图谱；输入「苏轼」，则沿人际关系网络无限扩展。

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                      前端（Three.js 3D）                  │
│   时间地层图谱 · 聚焦模式 · 图例过滤 · 时间轴 · 配置面板   │
└──────────────────────────┬───────────────────────────────┘
                           │ REST API
┌──────────────────────────┴───────────────────────────────┐
│                   Express 服务层（src/）                   │
│  routes.js ─ queryService ─ graphService ─ settingsService │
└───────┬──────────────────────────────────┬───────────────┘
        │ 写入                              │ 读取
┌───────┴──────────────┐          ┌────────┴──────────────┐
│  Pipeline Worker     │          │       Neo4j           │
│  crawler（多源降级）  │─────────▶│  Person/Event/Topic/  │
│  analyzer（DeepSeek） │          │  Task/Source/Settings │
│  worker（双流程）     │          └───────────────────────┘
└──────────────────────┘
```

## 快速开始

### 1. 环境准备

- Node.js 20+
- Docker（运行 Neo4j）
- DeepSeek API Key

### 2. 启动

```bash
# 一键启动（Windows）：Neo4j + Web + Worker + 浏览器打开
start.bat
```

或手动：

```bash
# 数据库
docker compose up -d

# 依赖安装（含真浏览器抓取内核）
npm install
npx playwright-core install chromium

# 配置
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

# Web 服务（http://localhost:3100）
npm start

# 数据管道（另开终端）
npm run worker
```

### 3. 使用

1. 打开 `http://localhost:3100`
2. 搜索框输入任意内容：
   - **已有**：直接跳转图谱探索
   - **没有**：选择「抓取人物资料」或「自动构建知识图谱」
3. 队列面板（右下角）可管理任务：添加 / 重试 / 置顶 / 删除 / 清空
4. ⚙ 配置面板（右上角）：数据源库 / 构建规模 / LLM 模型

## 本体（Ontology）

| 实体 | 说明 | 3D 呈现 |
|------|------|--------|
| `Person` | 人物（生卒年/职业） | 球体，按家族姓氏着色 |
| `Event` | 事件（年份/类别） | 金色八面体 ◆ |
| `Topic` | 知识主题（学科/单元/概念） | 绿色立方体 |

关系（`RELATES.type` 受控词表，源码 `src/ontology.js`）：

- **人—人**：亲属 / 配偶 / 师生 / 同事 / 朋友 / 竞争对手 等 14 类
- **人—事件**：参与 / 主持 / 发起 / 组织 / 涉及 / 牵连
- **知识—知识**：包含 / 前置 / 属于 / 应用 / 相关

## 数据管道

任务带 `kind` 字段，两条流水线：

**人物流程**（`kind: person`）
```
取任务 → 抓取百科 → DeepSeek 抽取(属性+关系+事件) → 消歧 → 入库
     → 关系人入队（亲缘优先）→ 事件参与者入队
```

**知识流程**（`kind: knowledge`，三阶段）
```
plan     LLM 规划：主题 → 单元(8~15) → 概念(每单元3~6)
unit     单元展开：概念任务入队
concept  多源抓取 → 通用知识抽取 → Topic 节点 + 知识边 → 相关概念入队
```

### 数据源库

抓取不再固定百度百科。源注册表（`src/sources/registry.js`）内置：

| 源 | 优先级 | 说明 |
|----|--------|------|
| 百度百科 | 100 | 中文覆盖最全 |
| 中文维基百科 | 80 | 学术可信 |

按优先级依次尝试，失败自动降级。自定义源可在配置面板添加（存 Neo4j，热加载）。
所有源共用真浏览器抓取内核（Playwright），自带 JS 反爬能力。

## 3D 图谱交互

| 操作 | 效果 |
|------|------|
| 单击节点 | 聚焦：只显示该节点及其直接关系，其余隐藏 |
| 双击节点 | 展开邻域（无限生长） |
| 悬停 | 节点高亮 + 手型光标 |
| 拖动 | 旋转视角（左键）/ 平移（右键） |
| 滚轮 | 缩放 |
| 左侧时间轴 | 拖动手柄缩放年代范围 |
| 图例 | 点击关系类型行，隐藏/显示对应节点和边 |
| `Esc` | 退出聚焦 |

- **Y 轴 = 时间地层**：人物按出生年、事件按发生年分层，唐代在上、清代在下
- **X/Z 平面 = 力导向**：同代/同主题自然聚拢

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats` | 全库统计 |
| GET | `/api/search?q=` | 搜索（人物/事件/主题） |
| GET | `/api/graph/:key` | 实体邻域子图 |
| GET | `/api/person/:key` | 实体详情 |
| POST | `/api/seed` | 添加种子人物 |
| POST | `/api/topics` | 构建知识主题（plan 阶段入队） |
| GET/POST | `/api/tasks` | 任务列表 / 添加任务 |
| DELETE | `/api/tasks/:name` | 删除任务 |
| POST | `/api/tasks/:name/retry` | 重试任务 |
| PUT | `/api/tasks/:name/priority` | 调整优先级 |
| DELETE | `/api/tasks?status=` | 清空某状态任务 |
| POST | `/api/purge` | 清理孤立节点 |
| GET/POST | `/api/sources` | 数据源列表 / 添加 |
| DELETE | `/api/sources/:id` | 删除自定义源 |
| GET/POST | `/api/settings` | 系统配置读写 |

## 项目结构

```
src/
├── server.js               # Web 入口
├── routes.js               # API 路由
├── db.js                   # Neo4j 驱动 + Schema
├── config.js               # 环境变量配置
├── ontology.js             # 本体定义（实体/关系词表）
├── sources/
│   └── registry.js         # 数据源注册表
├── services/
│   ├── graphService.js     # 图写入（Person/Event/Topic/Task）
│   ├── queryService.js     # 图查询（邻域/详情/搜索/统计）
│   └── settingsService.js  # 系统配置持久化
├── pipeline/
│   ├── crawler.js          # 多源抓取（真浏览器）
│   ├── analyzer.js         # DeepSeek 抽取（人物/知识/消歧/规划）
│   └── worker.js           # 管道主循环（person/knowledge 双流程）
└── scripts/
    └── seed.js             # 种子脚本
public/
├── index.html              # 单页应用
└── app-3d.js               # Three.js 3D 图谱引擎
```

## 配置说明（.env）

```ini
PORT=3100                          # Web 端口
NEO4J_URI=bolt://localhost:7687    # 数据库
NEO4J_USER=neo4j
NEO4J_PASSWORD=infiniti123
DEEPSEEK_API_KEY=sk-xxx            # 必填
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
MAX_PERSONS=500                    # 构建规模上限
MAX_DEPTH=6                        # 探索深度上限
CRAWL_DELAY_MS=2000                # 抓取限速（对源友好）
```

面板保存的配置存 Neo4j，重启 worker 后覆盖 `.env` 默认值。

## 技术栈

- **后端**：Node.js 20 + Express 5
- **数据库**：Neo4j 5（Cypher）
- **抽取**：DeepSeek（OpenAI 兼容接口）
- **抓取**：Playwright 无头浏览器（多源降级）
- **前端**：Three.js r160（手写力导向，无图库依赖）
