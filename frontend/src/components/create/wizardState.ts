/** 弹窗向导的共享状态 */
import type { Difficulty, QuestionType, RewardItem } from '@/api/types'

export interface WizardState {
  /** 学习竞赛名称 */
  name: string
  file: File | null
  documentName: string
  knowledgePrompt: string
  /** 已选题型（可多选） */
  questionTypes: QuestionType[]
  difficulty: Difficulty
  winnerCount: number
  rewards: RewardItem[]
  /** datetime-local 原始值 'YYYY-MM-DDTHH:mm' */
  startTime: string
  endTime: string
  /** 时间选定后固定不可更改 */
  timeLocked: boolean
  /** 后端返回的资料 id，建赛时作为 source_ids 提交 */
  sourceId: string | null
  /** 入库 job 轮询状态 */
  uploadState: 'idle' | 'uploading' | 'parsing' | 'ready' | 'failed'
}

export const initialWizardState: WizardState = {
  name: '',
  file: null,
  documentName: '',
  knowledgePrompt: '',
  questionTypes: ['choice', 'blank'],
  difficulty: 'medium',
  winnerCount: 3,
  rewards: [
    { rank: 1, name: '' },
    { rank: 2, name: '' },
    { rank: 3, name: '' },
  ],
  startTime: '',
  endTime: '',
  timeLocked: false,
  sourceId: null,
  uploadState: 'idle',
}

export type StepProps = {
  state: WizardState
  update: (patch: Partial<WizardState>) => void
}
