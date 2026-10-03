// 专题管线的第一步（对应固定图谱的「抓取」）：把清单里还没转写、或换了内容的文件转成单元原文。
// 已转写的跳过；清单里删掉的文件，其单元原文和抽取缓存一并清掉。
import fs from 'node:fs';
import { wellFormed } from '../kg/llm.js';
import { graphPaths } from '../scripts/kg/paths.js';
import { convertFile } from './convert.js';
import { readManifest, updateManifest } from './manifest.js';

export async function ingestTopic(id, { signal, onProgress } = {}) {
  const tag = `[ingest:${id}]`;
  const paths = graphPaths(id);
  paths.ensureDirs();
  const { files } = readManifest(id);
  const live = new Set(files.map((f) => f.no));
  for (const dir of [paths.CHAPTER_DIR, paths.EXTRACT_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      const no = Number.parseInt(f, 10);
      if (no && !live.has(no)) fs.rmSync(`${dir}/${f}`, { force: true });
    }
  }
  const todo = files.filter((f) => f.converted?.sha1 !== f.sha1 || !fs.existsSync(paths.chapterFile(f.no)));
  console.log(`${tag} 共 ${files.length} 份，待转写 ${todo.length}`);
  const progress = { files_total: todo.length, files_done: 0, failed: 0, current: '', ocr_done: 0, ocr_total: 0 };
  onProgress?.(progress);
  for (const entry of todo) {
    if (signal?.aborted) throw Object.assign(new Error('已停止'), { code: 'aborted' });
    Object.assign(progress, { current: entry.name, ocr_done: 0, ocr_total: 0 });
    onProgress?.(progress);
    const t0 = Date.now();
    try {
      const { chapter, stats } = await convertFile(id, entry, {
        signal,
        onOcr: (done, total) => {
          Object.assign(progress, { ocr_done: done, ocr_total: total });
          onProgress?.(progress);
        },
      });
      fs.rmSync(paths.extractFile(entry.no), { force: true });
      chapter.paragraphs = chapter.paragraphs.map(wellFormed);
      fs.writeFileSync(paths.chapterFile(entry.no), JSON.stringify(chapter, null, 1), 'utf8');
      updateManifest(id, (m) => {
        const f = m.files.find((x) => x.no === entry.no);
        if (f && f.sha1 === entry.sha1) Object.assign(f, { converted: { sha1: entry.sha1, ...stats, at: new Date().toISOString() }, error: null });
      });
      const ocr = stats.ocr_pages ? `，看图转写 ${stats.ocr_pages} 页` : '';
      console.log(`${tag} ${entry.name}：${stats.page_count ?? '-'} 页${ocr}，${stats.chars} 字 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      if (e.code === 'aborted') throw e;
      progress.failed++;
      updateManifest(id, (m) => {
        const f = m.files.find((x) => x.no === entry.no);
        if (f) f.error = String(e.message || e).slice(0, 200);
      });
      console.error(`${tag} ${entry.name} 转写失败: ${e.message}`);
      if (e.code === 'poppler_missing') throw e;
    }
    progress.files_done++;
    onProgress?.(progress);
  }
  const ready = readManifest(id).files.filter((f) => f.converted && !f.error).length;
  console.log(`${tag} 完成：可用 ${ready}/${files.length}${progress.failed ? `，失败 ${progress.failed}（重跑会再试）` : ''}`);
  if (!ready) throw Object.assign(new Error('没有可用的资料'), { code: 'topic_empty' });
  return { total: files.length, ready, failed: progress.failed };
}
