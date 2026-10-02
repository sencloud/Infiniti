/**
 * 学习层 API：条目解说、还可以看谁、沿图问答、待核对队列。
 * 解说与回答里的 [n] 对应 citations[n-1]，claim_id 为空时 record_id 是原文片段编号。
 */
import request from './request'

export interface Citation {
  n: number
  claim_id: string
  record_id: string
  chapter_no: number
  unit: string
  relation: string
  evidence_text: string
}

export interface EntityNote {
  entity_id: string
  name: string
  summary: string
  sections: { title: string; text: string }[]
  citations: Citation[]
  basis_size: number
  generated_at: string
}

export interface NoteState {
  note: EntityNote | null
  /** 解说写成之后，这个条目的事实有增减 */
  stale: boolean
}

const K = '/data-governance/knowledge-graph'
const L = '/knowledge-graph/learn'

export async function getEntityNote(entityId: string): Promise<NoteState> {
  return (await request.get(`${K}/entities/${encodeURIComponent(entityId)}/note`)).data
}

export async function writeEntityNote(entityId: string): Promise<NoteState> {
  return (await request.post(`${K}/entities/${encodeURIComponent(entityId)}/note`)).data
}

export interface RelatedEntity {
  id: string
  name: string
  label: string
  score: number
  shared: number
  via: string[]
}

export async function getRelatedEntities(entityId: string, limit = 6): Promise<RelatedEntity[]> {
  return (await request.get(`${K}/entities/${encodeURIComponent(entityId)}/related`, { params: { limit } })).data.items
}

export interface Answer {
  id: string
  question: string
  answer: string
  citations: Citation[]
  followups: string[]
  entities: { id: string; name: string }[]
  saved: boolean
  generated_at: string
  saved_at?: string
}

export interface SavedAnswerItem {
  id: string
  question: string
  preview: string
  saved_at: string
  citation_count: number
}

export async function askGraph(question: string, fresh = false): Promise<Answer> {
  return (await request.post(`${L}/ask`, { question, fresh })).data
}

export async function saveAnswer(id: string): Promise<Answer> {
  return (await request.post(`${L}/answers/${id}`)).data
}

export async function getAnswer(id: string): Promise<Answer> {
  return (await request.get(`${L}/answers/${id}`)).data
}

export async function listSavedAnswers(): Promise<SavedAnswerItem[]> {
  return (await request.get(`${L}/answers`)).data.items
}

export type ReviewReason = 'unmatched' | 'conflict' | 'low'
export type ReviewAction = 'confirm' | 'reject' | 'skip' | 'reset'

export interface ReviewItem {
  claim_id: string
  reasons: ReviewReason[]
  predicate: string
  predicate_name: string
  confidence: number
  evidence_text: string
  record_id: string
  chapter_no: number
  unit: string
  archive_title: string
  subject: { entity_id: string; name: string; type: string }
  object: { entity_id: string; name: string; type: string }
}

export interface ReviewQueue {
  items: ReviewItem[]
  total: number
  counts: Record<ReviewReason, number>
  decided: { confirm: number; reject: number; skip: number }
  can_decide: boolean
}

export async function getReviewQueue(params: { reason?: ReviewReason | ''; limit?: number; offset?: number }): Promise<ReviewQueue> {
  return (await request.get(`${L}/review`, { params })).data
}

export async function decideReview(claimId: string, action: ReviewAction): Promise<{ claim_id: string; action: ReviewAction | null }> {
  return (await request.post(`${L}/review/${claimId}`, { action })).data
}
