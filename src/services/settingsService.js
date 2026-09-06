// 设置服务：系统配置的持久化（Neo4j Settings 节点，单例）
// 【v4】配置面板保存的构建规模 / LLM 模型存在这里，worker 启动时读取合并。
// 环境变量优先级更高（.env 里的显式配置不被面板覆盖，重启后仍以 .env 为准）。
import { run } from '../db.js';

const SETTINGS_KEY = 'global'; // 单例键

// 读取全部设置（无则返回空对象）
export async function getSettings() {
  const records = await run(
    `MATCH (s:Settings {id: $id}) RETURN s.props AS props`,
    { id: SETTINGS_KEY }
  );
  if (!records.length) return {};
  const props = records[0].get('props');
  // Neo4j 属性不支持对象嵌套，props 存 JSON 字符串
  try { return JSON.parse(props || '{}'); } catch { return {}; }
}

// 合并保存设置（浅合并：只覆盖传入的键）
export async function saveSettings(patch = {}) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await run(
    `
    MERGE (s:Settings {id: $id})
    SET s.props = $props, s.updatedAt = datetime()
    `,
    { id: SETTINGS_KEY, props: JSON.stringify(next) }
  );
  return next;
}
