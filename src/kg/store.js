// 学习层的落盘数据（解说、问答、核对决定）放在 data/<graph>/ 下：
// 重新入库会清空 Neo4j 里该图谱的所有节点，这些需要人或模型花成本产出的东西不能只存在库里。
import fs from 'node:fs';
import path from 'node:path';

export function graphFile(graphId, ...parts) {
  return path.resolve('data', graphId, ...parts);
}

export function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 先写临时文件再改名，进程中途退出也不会留下半截 JSON */
export function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
}

export function removeFile(file) {
  fs.rmSync(file, { force: true });
}
