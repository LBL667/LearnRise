import { useRef, useState } from 'react'
import { FileText, UploadCloud, X } from 'lucide-react'
import { api } from '@/api/client'
import type { StepProps } from '../wizardState'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 步骤 1：上传文档 + 知识点要求（最底层 prompt） */
export function UploadDocStep({ state, update }: StepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const STATE_LABEL: Record<string, string> = {
    uploading: '上传中…',
    parsing: '解析中…',
    ready: '解析完成',
    failed: '解析失败',
  }

  const pollJob = async (jobId: string): Promise<boolean> => {
    let consecutiveFailures = 0
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      try {
        const job = await api.getJob(jobId)
        consecutiveFailures = 0
        update({ uploadState: job.status === 'ready' || job.status === 'ready_empty' ? 'ready' : 'parsing' })
        if (job.status === 'ready' || job.status === 'ready_empty') return true
        if (job.status === 'failed') return false
      } catch {
        consecutiveFailures += 1
        if (consecutiveFailures >= 3) return false
      }
    }
    return false
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    update({ file, documentName: file.name, sourceId: null, uploadState: 'uploading' })
    try {
      const uploaded = await api.uploadDocument(file)
      update({ sourceId: uploaded.sourceId, uploadState: 'parsing' })
      const ready = await pollJob(uploaded.jobId)
      if (!ready) {
        update({ uploadState: 'failed' })
        setError('解析未完成，请重新上传')
      }
    } catch (caught) {
      update({ uploadState: 'failed' })
      setError(caught instanceof Error ? caught.message : '上传失败，请重试')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="mb-2 block text-[13px] font-semibold text-ink">
          学习竞赛名称 <span className="text-[#e25050]">*</span>
        </label>
        <input
          className="field-input"
          placeholder="给你的学习竞赛起个名字，例如 高等数学期中冲刺赛"
          value={state.name}
          onChange={(e) => update({ name: e.target.value })}
          maxLength={30}
        />
      </div>

      <div>
        <label className="mb-2 block text-[13px] font-semibold text-ink">
          上传文档 <span className="text-[#e25050]">*</span>
        </label>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void pickFile(e.dataTransfer.files?.[0])
          }}
          className={`flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors ${
            dragging ? 'border-primary bg-primary-soft' : 'border-[#d8e2f0] bg-[#fafcff] hover:border-primary/60'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.md,.txt,.ppt,.pptx"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          {state.file ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
              <FileText size={18} className="text-primary" />
              <span className="max-w-[320px] truncate text-[13px] font-medium text-ink">{state.documentName}</span>
              <span
                className={`text-[12px] ${state.uploadState === 'failed' ? 'text-[#e25050]' : 'text-ink-mute'}`}
              >
                {STATE_LABEL[state.uploadState] ?? formatSize(state.file.size)}
              </span>
              <button
                aria-label="移除文档"
                className="text-ink-mute hover:text-[#e25050]"
                onClick={(e) => {
                  e.stopPropagation()
                  update({ file: null, documentName: '', sourceId: null, uploadState: 'idle' })
                }}
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud size={34} className="text-primary/70" />
              <span className="text-[13px] font-medium text-ink">点击或拖拽文档到此处上传</span>
              <span className="text-[12px] text-ink-mute">支持 PDF / Word / Markdown / PPT 等格式</span>
            </>
          )}
        </div>
        {error && (
          <div className="mt-2 flex items-center gap-3 text-[12px] text-[#e25050]">
            <span>{error}</span>
            <button
              type="button"
              className="text-primary underline"
              onClick={() => void pickFile(state.file ?? undefined)}
            >
              重新上传
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="mb-2 block text-[13px] font-semibold text-ink">
          知识点与学习要求 <span className="text-[#e25050]">*</span>
          <span className="ml-1 font-normal text-ink-mute">（作为最底层的 prompt）</span>
        </label>
        <textarea
          className="field-input h-36 resize-none py-2.5 leading-6"
          placeholder={'请填写要掌握的知识点范围、掌握程度、要学哪些章节，例如：\n掌握集合与函数基础概念\n熟练求解一元二次方程与不等式\n重点学习数列与不等式综合应用'}
          value={state.knowledgePrompt}
          onChange={(e) => update({ knowledgePrompt: e.target.value })}
        />
      </div>
    </div>
  )
}
