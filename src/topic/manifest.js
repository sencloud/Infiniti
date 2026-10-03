// 专题的文件清单 data/topics/<id>/manifest.json：
//   {next_no, files: [{no, path, name, category, code, title, kind, size, sha1, added_at, converted, error}]}
// 原件放在 media/files/<path>（/media/<id>/files/... 可直接打开），path 的目录部分就是分类。
// 单元号一经分配就不再变：删文件不回收号码，增删文件不会打乱已有的抽取缓存。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocName, parseStandardCode, topicDir } from '../kg/domains/topics.js';

export const ACCEPT = /\.(pdf|docx?|txt|md)$/i;
export const MAX_FILE_BYTES = 400 * 1024 * 1024;

export function manifestFile(id) {
  return path.join(topicDir(id), 'manifest.json');
}

export function filesDir(id) {
  return path.join(topicDir(id), 'media', 'files');
}

export function readManifest(id) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile(id), 'utf8'));
    // 编号和标题每次按文件名重新解析：解析规则改进后，老清单也跟着用新写法
    const files = (Array.isArray(m.files) ? m.files : []).map((f) => ({ ...f, ...parseDocName(f.path) }));
    return { next_no: m.next_no || 1, files };
  } catch {
    return { next_no: 1, files: [] };
  }
}

function writeManifest(id, m) {
  const file = manifestFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(m, null, 1)}\n`);
  // Windows 上别的进程（网页服务）正好在读这个文件时替换会报 EPERM，稍等再试
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 20 || (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

/** 读改写一气呵成（同步），同一进程里上传和转写交替进行也不会互相覆盖 */
export function updateManifest(id, fn) {
  const m = readManifest(id);
  const out = fn(m);
  writeManifest(id, m);
  return out;
}

/** 规范化相对路径：统一斜杠，去掉 . 和 ..，不允许越出 files 目录 */
export function cleanRelPath(rel) {
  const parts = String(rel || '').replace(/\\/g, '/').split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');
  if (!parts.length) return '';
  return parts.join('/');
}

export function categoryOf(rel) {
  const dir = path.posix.dirname(rel);
  return dir === '.' ? '' : dir.split('/').join(' / ');
}

export function fileKind(name) {
  const ext = path.extname(name).toLowerCase().slice(1);
  return ext === 'docx' || ext === 'doc' ? ext : ext === 'md' || ext === 'txt' ? 'text' : ext;
}

export async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

/** 同目录排序：先分类，再按标准编号（前缀 + 数字），最后按标题 */
export function sortKey(rel) {
  const { code, title } = parseDocName(rel);
  const p = parseStandardCode(code);
  const m = p?.base.match(/^(\S+)\s+([\d.]+)/);
  const num = m ? m[2].split('.').map((n) => n.padStart(6, '0')).join('.') : '';
  return [categoryOf(rel), m ? `0${m[1]}` : '1', num, title].join('\u0001');
}

export function compareRel(a, b) {
  return sortKey(a).localeCompare(sortKey(b), 'zh-Hans-CN');
}

/**
 * 登记一个已放到 files/<rel> 的文件。同路径再传是替换（保留单元号、清掉旧的转写）；
 * 内容和清单里另一份完全相同的视为重复，删掉新放的这份。返回 {entry, status: added|replaced|duplicate|unchanged}
 */
export function registerFile(id, rel, { size, sha1 }) {
  return updateManifest(id, (m) => {
    const same = m.files.find((f) => f.path === rel);
    if (same) {
      if (same.sha1 === sha1) return { entry: same, status: 'unchanged' };
      Object.assign(same, { size, sha1, added_at: new Date().toISOString(), converted: null, error: null });
      return { entry: same, status: 'replaced' };
    }
    const dup = m.files.find((f) => f.sha1 === sha1);
    if (dup) {
      fs.rmSync(path.join(filesDir(id), rel), { force: true });
      return { entry: dup, status: 'duplicate' };
    }
    const { code, title } = parseDocName(rel);
    const entry = {
      no: m.next_no++,
      path: rel,
      name: path.posix.basename(rel),
      category: categoryOf(rel),
      code,
      title,
      kind: fileKind(rel),
      size,
      sha1,
      added_at: new Date().toISOString(),
      converted: null,
      error: null,
    };
    m.files.push(entry);
    return { entry, status: 'added' };
  });
}

/** 删一个文件：原件、转写、抽取缓存、页图一起删 */
export function removeFile(id, no) {
  const dir = topicDir(id);
  const pad = String(no).padStart(3, '0');
  const entry = updateManifest(id, (m) => {
    const i = m.files.findIndex((f) => f.no === Number(no));
    return i >= 0 ? m.files.splice(i, 1)[0] : null;
  });
  if (!entry) return null;
  fs.rmSync(path.join(filesDir(id), entry.path), { force: true });
  for (const p of [['chapters', `${pad}.json`], ['extract', `${pad}.json`]]) fs.rmSync(path.join(dir, ...p), { force: true });
  for (const p of [['ocr', pad], ['media', 'pages', pad]]) fs.rmSync(path.join(dir, ...p), { recursive: true, force: true });
  return entry;
}

/** 把服务器本机文件夹里的资料收进专题：同盘用硬链接（不占空间），跨盘复制 */
export async function importFolder(id, srcDir, { onFile } = {}) {
  const root = path.resolve(srcDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw Object.assign(new Error(`文件夹不存在：${srcDir}`), { status: 400, code: 'folder_missing', params: { dir: srcDir } });
  }
  const found = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ACCEPT.test(ent.name) && !ent.name.startsWith('~$')) found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  found.sort(compareRel);
  const tally = { added: 0, replaced: 0, duplicate: 0, unchanged: 0, skipped: 0 };
  for (const rel of found) {
    const src = path.join(root, rel);
    const stat = fs.statSync(src);
    if (stat.size > MAX_FILE_BYTES || !stat.size) {
      tally.skipped++;
      continue;
    }
    const dst = path.join(filesDir(id), cleanRelPath(rel));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const sha1 = await sha1File(src);
    const known = readManifest(id).files.find((f) => f.path === cleanRelPath(rel));
    if (known?.sha1 === sha1 && fs.existsSync(dst)) {
      tally.unchanged++;
      continue;
    }
    fs.rmSync(dst, { force: true });
    try {
      fs.linkSync(src, dst);
    } catch {
      await fs.promises.copyFile(src, dst);
    }
    const { status } = registerFile(id, cleanRelPath(rel), { size: stat.size, sha1 });
    if (status === 'duplicate') fs.rmSync(dst, { force: true });
    tally[status]++;
    onFile?.(rel, status);
  }
  return { found: found.length, ...tally };
}
