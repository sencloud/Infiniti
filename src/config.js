// 全局配置：从环境变量（.env 文件）读取，未配置时使用默认值
// 所有模块统一从这里拿配置，避免散落各处的魔法数字
import 'dotenv/config';

const config = {
  // 网站监听端口
  port: Number(process.env.PORT || 3000),

  // Neo4j 图数据库连接信息（与 docker-compose.yml 保持一致）
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'infiniti123',
  },

  // DeepSeek API（OpenAI 兼容格式，用 openai 客户端直连）
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },

  // 数据管道的规模上限与节奏控制（防止 BFS 无限扩散）
  crawl: {
    maxPersons: Number(process.env.MAX_PERSONS || 500), // 图谱收录人数上限
    maxDepth: Number(process.env.MAX_DEPTH || 6), // 从种子出发的最大关系跳数
    requestDelayMs: Number(process.env.CRAWL_DELAY_MS || 2000), // 每次抓取后的间隔（对百科友好）
    maxRetries: 3, // 单个任务最多尝试次数，超过则标记失败
  },
};

export default config;
