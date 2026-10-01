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

1. 打开 `http://localhost:3100`：知识图谱首页，按「文学名著 / 经史典籍 / 学科知识 / 人物关系」分类浏览，顶部可跨图谱搜索
2. 每个图谱有两个视图：语义星图 `/g/<图谱>/galaxy`、关系探索 `/g/<图谱>/explore`
3. 「人物关系」分类即原来的 3D 人物图谱（`/people/`），搜索框输入任意内容：
   - **已有**：直接跳转图谱探索
   - **没有**：选择「抓取人物资料」或「自动构建知识图谱」
   - 队列面板（右下角）管理任务，⚙ 配置面板（右上角）设置数据源库 / 构建规模 / LLM 模型

页面支持亮 / 暗主题和手机浏览（≤768px 时侧栏、详情卡、原文都改成底部抽屉）。

## 多图谱（语义星图 / 关系探索）

移植自 AIB 的知识图谱模块。库里每个节点带 `graph_id`，各图谱互不干扰；图谱配置（实体类型、谓词、单元名称、线索规则、分类）在 `src/kg/domains/index.js`。

| 图谱 | id | 来源 | 单元 |
|------|----|------|------|
| 水浒传 | `shuihu` | [5000yan](https://shuihu.5000yan.com/) | 120 回 |
| 西游记 / 红楼梦 / 三国演义 | `xiyouji` / `hongloumeng` / `sanguo` | 5000yan | 100 / 120 / 120 回 |
| 聊斋志异 | `liaozhai` | 5000yan | 494 篇 |
| 论语 / 史记 | `lunyu` / `shiji` | 5000yan | 20 / 130 篇 |
| 初中数学 | `math` | [国家中小学智慧教育平台](https://basic.smartedu.cn/) 苏科版 6 册 | 137 节 |

- **语义星图**：原文分段向量化（本地 bge-small-zh）→ PCA + UMAP → KMeans 聚成情节群 / 知识簇，DeepSeek 命名；子群、跨群关联、离群段、分期漂移、按实体检索，点任意一段看原文高亮。
- **关系探索**：实体关系 3D 图（Y 轴为章回 / 节）；浏览、路径探查、关联强度、社区、时序台账、流转、线索。
  线索规则按图谱类型选：小说 / 史传用 R1–R4（关系反转 / 死后再现 / 出场断档 / 籍贯冲突），
  教材用 M1–M4（前置倒挂 / 循环依赖 / 孤立知识点 / 跨册长跳）。
- **媒体**（水浒传）：维基共享资源的公有领域古画 + 百科配图（节点卡图集，注明出处和许可），
  央视 1998 版 43 集与回目的对应表（节点卡和原文抽屉里点集数，弹窗播放 B 站外链）。
- **教材原页**（初中数学）：原文抽屉按页显示教材页码，可切到页面原图。

### 数据生成

每个图谱一条管线：抓取 → 种子 → 抽取 → 入库 → 星图与关系分析，每步可续跑（已完成的部分跳过），进度写到 `data/<图谱>/status.json`，首页卡片据此显示构建进度。

```bash
npm run kg:run -- <图谱>                 # 全流程，如 npm run kg:run -- xiyouji
npm run kg:run -- <图谱> load build      # 只跑指定步骤
npm run classics:all                     # 后台批量跑 5000yan 的名著与典籍（失败的会串行重试一次）
npm run math:fetch                       # 数学：下载教材页图，deepseek-flash 识图转写，按目录切节
npm run math:all                         # 数学全流程（抓取步骤即 math:fetch，转写有缓存）
npm run shuihu:media                     # 水浒人物图片 + 央视版分集表，写入 Entity.media
npm run kg:covers                        # 首页封面（维基数据的公有领域书影）→ data/covers/
```

入库只清当前图谱的节点。抽取结果缓存在 `data/<图谱>/extract/`，重跑 load / build 不再调用模型抽取（星图命名仍会调用 DeepSeek）。
仓库里带了原文、抽取缓存和教材转写；向量文件、教材页图、水浒图片不入库，clone 后分别由 `kg:run -- <图谱> load build`、`math:fetch`、`shuihu:media` 重新生成。
页面上的「重新计算」按钮等价于 build 的对应阶段。

教材 PDF 需要登录，管线改用平台公开的逐页图片，由 `DEEPSEEK_VISION_MODEL`（默认 `deepseek-flash`）识图转写，
结果缓存在 `data/math/ocr/<册>/<页>.md`，页图在 `data/math/media/`。

### 前端

前端是独立的 Vite + React + antd 子工程（`web/`），构建产物输出到 `public/app/`（已 gitignore），由 Express 托管：

```bash
npm --prefix web install
npm run web:build        # 生成 public/app/
npm run web:dev          # 开发模式（http://localhost:5173，/api 和 /media 代理到 3100）
```

旧地址 `/kg/*` 会跳到 `/g/shuihu/*`。

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
├── kg/                     # 多图谱后端（/api/knowledge-graph/*，?graph=<id>）
│   ├── domains/index.js    # 图谱配置：分类、实体类型、谓词、单元名、线索规则
│   ├── galaxyBuild.js      # 向量化 + PCA/UMAP/KMeans + 命名 + 关联/子群/离群/漂移
│   ├── analysisBuild.js    # 关联强度 / Louvain 社区 / 枢纽 / 线索规则（R1–R4 / M1–M4）
│   └── *Query.js           # 星图 / 探索 / 分析查询
└── scripts/
    ├── seed.js             # 种子脚本
    ├── kg/                 # 通用管线（crawl / seeds / extract / load / build / run / all / covers / wikimedia）
    ├── math/fetch.js       # 教材页图下载 + 识图转写 + 按目录切节
    └── shuihu/             # 水浒专用：一百单八将词典、人物图片与分集表（media.js）
public/
├── app/                    # 知识图谱单页应用构建产物（来自 web/）
└── people/                 # 人物关系 3D 图谱（index.html + app-3d.js）
web/                        # 首页 + 语义星图 + 关系探索前端（Vite + React + antd）
data/<图谱>/                # 原文、抽取缓存、status.json、媒体（/media/<图谱>/…）
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
DEEPSEEK_VISION_MODEL=deepseek-flash  # 教材页图转写（需多模态）
MATH_OCR_PARALLEL=6                # 转写并发
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
