import { useState } from 'react'
import { CheckCircle2, Copy, FileText, X } from 'lucide-react'
import { api } from '@/api/client'
import type { CreateResult } from '@/api/types'
import { StepBar, WIZARD_STEPS } from './StepBar'
import { initialWizardState, type WizardState } from './wizardState'
import { UploadDocStep } from './steps/UploadDocStep'
import { QuestionTypeStep } from './steps/QuestionTypeStep'
import { RewardsStep } from './steps/RewardsStep'
import { TimeStep } from './steps/TimeStep'
import { useToast } from '../ui/Toast'

const TYPE_LABEL: Record<string, string> = {
  choice: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
  both: '混合题型',
}
const DIFF_LABEL: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

interface CreateCompetitionModalProps {
  onClose: () => void
  onCreated: () => void
}

export function CreateCompetitionModal({ onClose, onCreated }: CreateCompetitionModalProps) {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>(initialWizardState)
  const [publishing, setPublishing] = useState(false)
  const [created, setCreated] = useState<CreateResult | null>(null)
  const { showToast } = useToast()

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }))

  /** 每步校验，返回错误提示（null 表示通过） */
  const validate = (target: number): string | null => {
    if (target > 0 && !state.name.trim()) return '请先填写学习竞赛名称'
    if (target > 0 && !state.file) return '请先上传文档'
    if (target > 0 && !state.knowledgePrompt.trim()) return '请先填写知识点与学习要求'
    if (target > 1 && state.questionTypes.length === 0) return '请至少选择一种题型'
    if (target > 3) {
      if (!state.startTime || !state.endTime) return '请选择竞赛开始与结束时间'
      if (state.endTime <= state.startTime) return '结束时间必须晚于开始时间'
    }
    return null
  }

  const goNext = async () => {
    const err = validate(step + 1)
    if (err) {
      showToast(err, 'error')
      return
    }
    if (step === 3) {
      // 离开时间步骤即选定并锁定
      update({ timeLocked: true })
      setStep(4)
      return
    }
    if (step === 4) {
      await publish()
      return
    }
    setStep(step + 1)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const result = await api.createCompetition({
        name: state.name.trim(),
        documentName: state.documentName || undefined,
        knowledgePrompt: state.knowledgePrompt.trim(),
        questionTypes: state.questionTypes,
        difficulty: state.difficulty,
        winnerCount: state.winnerCount,
        rewards: state.rewards,
        startTime: state.startTime.replace('T', ' '),
        endTime: state.endTime.replace('T', ' '),
      })
      setCreated(result)
      onCreated()
    } catch {
      showToast('发布失败，请重试', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const copyInvite = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.inviteCode)
    } catch {
      /* 仅提示 */
    }
    showToast('邀请码已复制', 'success')
  }

  const stepBody = () => {
    if (created) {
      return (
        <div className="flex flex-col items-center py-6">
          <CheckCircle2 size={46} className="text-primary" />
          <h3 className="mt-3 text-[17px] font-bold text-ink">发布成功!</h3>
          <p className="mt-1.5 text-[13px] text-ink-mute">成员可使用邀请码加入竞赛</p>
          <div className="mt-5 flex items-center gap-3 rounded-xl bg-primary-soft px-7 py-4">
            <span className="text-[30px] font-bold leading-none tracking-[0.25em] text-primary">
              {created.inviteCode}
            </span>
            <button className="btn-primary" onClick={() => void copyInvite()}>
              <Copy size={14} />
              复制邀请码
            </button>
          </div>
        </div>
      )
    }
    const props = { state, update }
    switch (step) {
      case 0:
        return <UploadDocStep {...props} />
      case 1:
        return <QuestionTypeStep {...props} />
      case 2:
        return <RewardsStep {...props} />
      case 3:
        return <TimeStep {...props} />
      default:
        return (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex items-center gap-2 rounded-lg bg-page px-4 py-3">
              <FileText size={15} className="text-primary" />
              <span className="font-bold text-ink">{state.name || '未命名学习竞赛'}</span>
              <span className="text-ink-mute">（{state.documentName || '未上传文档'}）</span>
            </div>
            <Summary label="知识点要求" value={state.knowledgePrompt || '未填写'} />
            <Summary
              label="题型难度"
              value={`${state.questionTypes.map((t) => TYPE_LABEL[t] ?? t).join('、')} · ${DIFF_LABEL[state.difficulty]}`}
            />
            <Summary
              label="奖励名额"
              value={`${state.winnerCount} 名：${state.rewards.map((r) => `第${r.rank}名 ${r.name || '待定'}`).join('，')}`}
            />
            <Summary
              label="竞赛时间"
              value={`${state.startTime.replace('T', ' ')} 至 ${state.endTime.replace('T', ' ')}（已锁定）`}
            />
            <p className="mt-1 text-[12px] text-ink-mute">点击右下角发布后生成邀请码，发布后不可修改。</p>
          </div>
        )
    }
  }

  const isLast = step === WIZARD_STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(23,32,48,0.45)] p-6"
      onClick={created ? undefined : onClose}
    >
      <div
        className="modal-panel flex max-h-[86vh] w-[720px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line px-7 py-4">
          <h2 className="text-[16px] font-bold text-ink">{created ? '学习竞赛已发布' : '创建学习竞赛'}</h2>
          <button
            aria-label="关闭"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute hover:bg-page hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        {/* 步骤条 */}
        {!created && (
          <div className="pb-4 pt-5">
            <StepBar current={step} />
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-7 py-5">{stepBody()}</div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 border-t border-line px-7 py-4">
          {created ? (
            <button className="btn-primary px-8" onClick={onClose}>
              完成
            </button>
          ) : (
            <>
              {step > 0 && (
                <button
                  className="btn-ghost"
                  onClick={() => setStep(step - 1)}
                  disabled={publishing}
                >
                  上一步
                </button>
              )}
              <button className="btn-primary px-7" onClick={() => void goNext()} disabled={publishing}>
                {publishing ? '发布中…' : isLast ? '发布' : '下一步'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-line px-4 py-2.5">
      <span className="w-20 shrink-0 text-ink-mute">{label}</span>
      <span className="min-w-0 flex-1 text-ink">{value}</span>
    </div>
  )
}
