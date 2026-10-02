/**
 * 关系详情抽屉（关系探索页「点边下钻」）
 *
 * 语义图上的一条边 = 同一对实体间多条 Claim（关系体实例）的聚合投影。
 * 本体建模视角（gUFO）：
 *   - 聚合边 ≈ 派生的物质关系（material relation，如 hasStudent）
 *   - 每条 Claim ≈ 关系体（relator，如 Enrollment），是让关系为真的一手事实
 *   - Claim 的证据区间 + 来源档案 ≈ mediation（关系体拴住实体与档案）
 *
 * 点边打开本抽屉：还原这条聚合边背后的全部 Claim 实例，
 * 每条可看证据原文、置信度、状态，并可跳到原文高亮（EvidenceHighlightDrawer）。
 */
import { useEffect, useState } from 'react'
import { Drawer, Empty, Spin, Tag, message } from 'antd'
import { RightOutlined } from '@ant-design/icons'

import { getClaimsByIds, type Claim, type Ontology } from '@/api/knowledge-graph'
import type { EvidenceStop } from '@/components/EvidenceHighlightDrawer'
import { useIsMobile } from '@/hooks/useIsMobile'
import { claimStatusLabel, relationLabel } from '@/utils/graphStyle'
import { displayText } from '@/utils/mathText'

interface Props {
  /** 聚合边的标识，形如 "subjectId::PREDICATE::objectId"；null 时关闭 */
  edgeId: string | null
  /** 边上的谓词码（大写），用于标题显示 */
  predicate: string | null
  /** 边两端实体名，用于标题显示 */
  subjectName: string
  objectName: string
  /** 边聚合的 Claim 实例 id 列表 */
  claimIds: string[]
  ontology: Ontology | null
  /** 点某条 Claim 的来源档案时回调（打开原文高亮抽屉）；trail 是本关系全部依据，按原文顺序 */
  onOpenEvidence: (recordId: string, claimId: string, trail: EvidenceStop[]) => void
  onClose: () => void
}

/** 谓词中文名：本体优先，RELATION_LABELS 兜底，尽量不露英文码 */
function predicateName(code: string, ontology: Ontology | null): string {
  return ontology?.predicates.find((item) => item.code === code)?.name
    || relationLabel(code)
}

/** Claim 状态 -> Tag 颜色（与治理工作台 Claim 审核面板的配色一致） */
const STATUS_COLORS: Record<string, string> = {
  proposed: 'default',
  auto_verified: 'blue',
  human_verified: 'green',
  rejected: 'red',
  superseded: 'orange',
}

export default function RelationDetailDrawer({
  edgeId,
  predicate,
  subjectName,
  objectName,
  claimIds,
  ontology,
  onOpenEvidence,
  onClose,
}: Props) {
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(false)
  const mobile = useIsMobile()

  const open = Boolean(edgeId)

  // 打开（或换了边）时按 claim_ids 拉取关系体实例详情
  useEffect(() => {
    if (!open) {
      // 已是空数组时不换引用，避免父组件每次渲染都连带重渲染本抽屉
      setClaims((prev) => (prev.length ? [] : prev))
      return
    }
    let cancelled = false
    setLoading(true)
    getClaimsByIds(claimIds)
      .then((res) => {
        if (cancelled) return
        const items = [...(res.data?.items || [])].sort((a, b) => (
          a.record_id.localeCompare(b.record_id, undefined, { numeric: true })
          || (a.evidence_start ?? 0) - (b.evidence_start ?? 0)
        ))
        setClaims(items)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        message.error(error instanceof Error ? error.message : '加载关系详情失败')
        setClaims([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edgeId])

  const title = predicate
    ? `${subjectName} —${predicateName(predicate, ontology)}→ ${objectName}`
    : '关系详情'

  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      width={mobile ? '100%' : 460}
      placement={mobile ? 'bottom' : 'right'}
      height={mobile ? '78%' : undefined}
      rootClassName="rel-drawer"
      styles={{ body: { padding: '12px 16px' } }}
    >
      {/* 说明：聚合边与关系体实例的关系（对齐本体建模语义） */}
      <div className="rel-drawer-note">
        这段关系有 <b>{claims.length || claimIds.length}</b> 条原文依据，点出处可翻到原文里的高亮位置。
      </div>

      {loading && <div className="rel-drawer-loading"><Spin /></div>}

      {!loading && claims.length === 0 && (
        <Empty description="暂无支撑该关系的事实" />
      )}

      {!loading && claims.map((claim) => (
        <div key={claim.claim_id} className="rel-claim-card">
          <div className="rel-claim-head">
            {mobile ? (
              <span className="rel-claim-conf">
                {claimStatusLabel(claim.status)} · 置信度 {(claim.confidence * 100).toFixed(0)}%
              </span>
            ) : (
              <>
                <Tag color={STATUS_COLORS[claim.status] || 'default'}>
                  {claimStatusLabel(claim.status)}
                </Tag>
                <span className="rel-claim-conf">
                  置信度 {(claim.confidence * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
          {/* 证据原文：这条 Claim 的成立依据 */}
          <div className="rel-claim-evidence">{displayText(claim.evidence_text)}</div>
          {/* 来源档案：mediation 结构里的 Archive，点击跳原文高亮 */}
          <button
            type="button"
            className="rel-claim-source"
            onClick={() => onOpenEvidence(
              claim.record_id,
              claim.claim_id,
              claims.map((item) => ({ recordId: item.record_id, claimId: item.claim_id })),
            )}
            title={claim.archive_title || claim.record_id}
          >
            <span>{claim.archive_title || claim.record_id}</span>
            {mobile && <span className="rel-claim-go">读原文<RightOutlined /></span>}
          </button>
        </div>
      ))}
    </Drawer>
  )
}
