/**
 * 专题管理 API（/api/knowledge-graph/topics/*）：新建专题、上传资料、开始/停止处理、看进度。
 * 上传是一个文件一个 PUT，请求体就是文件本身，?path= 带上它在专题里的相对路径（目录即分类）。
 */
import request from './request'

export type TopicState = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | null

export interface TopicStatus {
  state: TopicState
  step: string | null
  external: boolean
  steps: string[] | null
  ingest: {
    files_total: number
    files_done: number
    failed: number
    current: string | null
    ocr_done: number
    ocr_total: number
  } | null
  extracted: number | null
  units: number | null
  error: string | null
  error_code: string | null
  started_at: string | null
  finished_at: string | null
  updated_at: string | null
}

export interface TopicSummary {
  id: string
  name: string
  description: string
  preset: string
  created_at: string
  file_count: number
  converted: number
  failed: number
  bytes: number
  categories: number
  stats: { units: number; entities: number; claims: number }
  status: TopicStatus
}

export interface TopicFile {
  no: number
  path: string
  name: string
  category: string
  code: string
  title: string
  kind: string
  size: number
  added_at: string
  converted: { chars: number; pages: number | null; ocr_pages: number } | null
  extracted: boolean
  error: string | null
  status: 'pending' | 'converted' | 'extracted' | 'failed'
}

export interface TopicPreset {
  id: string
  name: string
  description: string
}

export interface TopicAccess {
  can_manage: boolean
  local: boolean
}

export interface TopicDetail extends TopicSummary, TopicAccess {
  files: TopicFile[]
  log: string[]
  steps: string[]
}

export interface ImportTally {
  found: number
  added: number
  replaced: number
  duplicate: number
  unchanged: number
  skipped: number
}

const BASE = '/knowledge-graph/topics'

async function unwrap<T>(promise: Promise<any>): Promise<T> {
  const res = await promise
  return (res?.data ?? res) as T
}

export function listTopics() {
  return unwrap<{ items: TopicSummary[]; presets: TopicPreset[] } & TopicAccess>(request.get(BASE))
}

export function getTopic(id: string) {
  return unwrap<TopicDetail>(request.get(`${BASE}/${id}`))
}

export function createTopic(body: { name: string; description?: string; preset?: string }) {
  return unwrap<TopicSummary>(request.post(BASE, body))
}

export function updateTopic(id: string, body: { name?: string; description?: string }) {
  return unwrap<TopicSummary>(request.patch(`${BASE}/${id}`, body))
}

export function deleteTopic(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(request.delete(`${BASE}/${id}`))
}

export function uploadTopicFile(id: string, path: string, file: File, onProgress?: (loaded: number) => void) {
  return unwrap<{ status: 'added' | 'replaced' | 'duplicate' | 'unchanged'; no: number; path: string }>(
    request.put(`${BASE}/${id}/files`, file, {
      params: { path },
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 0,
      onUploadProgress: (e) => onProgress?.(e.loaded),
    }),
  )
}

export function removeTopicFile(id: string, no: number) {
  return unwrap<{ no: number; removed: boolean }>(request.delete(`${BASE}/${id}/files/${no}`))
}

export function importLocalFolder(id: string, dir: string) {
  return unwrap<ImportTally>(request.post(`${BASE}/${id}/import-local`, { dir }, { timeout: 0 }))
}

export function runTopic(id: string, steps?: string[]) {
  return unwrap<{ state: TopicState }>(request.post(`${BASE}/${id}/run`, steps ? { steps } : {}))
}

export function stopTopic(id: string) {
  return unwrap<{ stopping: boolean }>(request.post(`${BASE}/${id}/stop`))
}