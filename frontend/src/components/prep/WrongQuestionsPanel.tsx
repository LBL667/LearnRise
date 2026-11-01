import { useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { api } from '@/api/client'
import type { WrongQuestion } from '@/api/types'
import { useToast } from '../ui/Toast'

type TypeFilter = 'all' | 'choice' | 'multiple' | 'judge' | 'blank'
type SeverityFilter = 'all' | 'repeat' | 'general'

const SEVERITY_LABEL: Record<WrongQuestion['severity'], string> = {
  repeat: '已多次错误',
  general: '一般错误',
}

const TYPE_LABEL: Record<WrongQuestion['type'], string> = {
  choice: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function answerText(q: WrongQuestion): string {
  const a = q.analysis.choiceAnswer
  if (q.type === 'judge' && a) return a === 'T' ? '正确' : '错误'
  return a ?? ''
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-[14px] font-bold text-ink">
      <span className="h-3.5 w-[3px] rounded-full bg-primary" />
      {children}
    </h3>
  )
}

/** 选择 / 多选 / 判断题的逐选项解析；填空题为步骤解析 */
function AnalysisView({ q }: { q: WrongQuestion }) {
  const a = q.analysis
  const hasChoice = q.type === 'choice' || q.type === 'multiple' || q.type === 'judge'
  return (
    <div className="rounded-xl bg-page p-4">
      {hasChoice && a.choiceAnswer && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">正确答案</span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-primary px-1.5 text-[13px] font-bold text-white">
            {answerText(q)}
          </span>
        </div>
      )}

      {a.optionNotes?.map((note) => (
        <div key={note.key} className="mb-2.5 flex gap-2 text-[13px] leading-5 last:mb-0">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              note.verdict === 'correct' ? 'bg-[#e5f6ec] text-[#188c5e]' : 'bg-[#fdecec] text-[#d24848]'
            }`}
          >
            {note.key}
          </span>
          <p className="text-ink-soft">
            <span className={note.verdict === 'correct' ? 'font-semibold text-[#188c5e]' : 'font-semibold text-[#d24848]'}>
              {note.verdict === 'correct' ? '应选。' : '不选。'}
            </span>
            {note.text}
          </p>
        </div>
      ))}

      {a.steps && (
        <ol className="mb-2.5 space-y-2">
          {a.steps.map((s, i) => (
            <li key={s} className="flex gap-2 text-[13px] leading-5 text-ink-soft">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 border-t border-line pt-2.5 text-[13px] font-semibold text-ink">{a.conclusion}</div>
    </div>
  )
}

export function WrongQuestionsPanel() {
  const [questions, setQuestions] = useState<WrongQuestion[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [searchText, setSearchText] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const { showToast } = useToast()

  useEffect(() => {
    void (async () => {
      const list = await api.listWrongQuestions()
      setQuestions(list)
      setSelectedId(list[0]?.id)
    })()
  }, [])

  const filtered = useMemo(() => {
    const kw = searchText.trim().toLowerCase()
    return questions.filter((q) => {
      if (typeFilter !== 'all' && q.type !== typeFilter) return false
      if (severityFilter !== 'all' && q.severity !== severityFilter) return false
      if (kw) {
        const haystack = [q.stem, ...q.tags].join(' ').toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })
  }, [questions, searchText, typeFilter, severityFilter])

  const selectedIndex = filtered.findIndex((q) => q.id === selectedId)
  const current = selectedIndex >= 0 ? filtered[selectedIndex] : filtered[0]
  const globalNo = current ? questions.findIndex((q) => q.id === current.id) + 1 : 0

  const step = (dir: 1 | -1) => {
    const next = filtered[selectedIndex + dir]
    if (next) setSelectedId(next.id)
  }

  /** 删除一道错题；若删除的是当前选中题，则选中相邻一道 */
  const removeQuestion = async (q: WrongQuestion) => {
    try {
      const next = await api.removeWrongQuestion(q.id)
      setQuestions(next)
      if (q.id === current?.id) {
        setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id)
      }
      showToast(`已删除一道${TYPE_LABEL[q.type]}错题`)
    } catch {
      showToast('删除失败，请重试', 'error')
    }
  }

  const activeFilterCount = (typeFilter !== 'all' ? 1 : 0) + (severityFilter !== 'all' ? 1 : 0)

  return (
    <div className="flex h-full min-h-0 gap-5">
      {/* 左：错题列表 */}
      <section className="card flex min-h-0 w-[400px] shrink-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line p-4">
          <span className="whitespace-nowrap text-[14px] font-bold text-ink">
            我的错题 ({filtered.length})
          </span>
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              className="field-input h-8 pl-8 text-[12.5px]"
              placeholder="搜索错题的题目或知识点…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div className="relative shrink-0">
            <button
              className={`flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] transition ${
                activeFilterCount > 0
                  ? 'border-primary/40 bg-primary-soft text-primary'
                  : 'border-line text-ink-soft hover:border-primary/40 hover:text-primary'
              }`}
              onClick={() => setFilterOpen((v) => !v)}
            >
              <SlidersHorizontal size={13} />
              筛选
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-10 z-20 w-56 rounded-xl border border-line bg-white p-3 shadow-lg">
                <div className="text-[12px] font-semibold text-ink">题型</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(
                    [
                      ['all', '全部'],
                      ['choice', '单选题'],
                      ['multiple', '多选题'],
                      ['judge', '判断题'],
                      ['blank', '填空题'],
                    ] as [TypeFilter, string][]
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setTypeFilter(v)}
                      className={`rounded-md px-2.5 py-1 text-[12px] transition ${
                        typeFilter === v ? 'bg-primary text-white' : 'bg-page text-ink-soft hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 text-[12px] font-semibold text-ink">错误程度</div>
                <div className="mt-1.5 flex gap-1.5">
                  {(
                    [
                      ['all', '全部'],
                      ['repeat', '已多次错误'],
                      ['general', '一般错误'],
                    ] as [SeverityFilter, string][]
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setSeverityFilter(v)}
                      className={`rounded-md px-2.5 py-1 text-[12px] transition ${
                        severityFilter === v ? 'bg-primary text-white' : 'bg-page text-ink-soft hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {filtered.map((q) => {
            const active = q.id === current?.id
            return (
              <div
                key={q.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(q.id)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedId(q.id)}
                className={`relative w-full cursor-pointer rounded-xl border p-3.5 transition ${
                  active ? 'border-primary bg-primary-soft/60' : 'border-line bg-white hover:border-primary/40'
                }`}
              >
                {/* 右上角删除 */}
                <button
                  aria-label="删除错题"
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeQuestion(q)
                  }}
                  className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full text-ink-mute transition-colors hover:bg-[#fdecec] hover:text-[#e25050]"
                >
                  <X size={13} />
                </button>

                <div className="flex items-center gap-2 pr-6">
                  <span className="text-[13px] font-bold text-ink">{pad(questions.indexOf(q) + 1)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      q.severity === 'repeat'
                        ? 'bg-[#fdecec] text-[#d24848]'
                        : 'bg-[#fdf3e3] text-[#c07b1d]'
                    }`}
                  >
                    {SEVERITY_LABEL[q.severity]}
                  </span>
                  <span className="ml-auto rounded bg-page px-1.5 py-0.5 text-[10.5px] text-ink-mute">
                    {TYPE_LABEL[q.type]}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-ink">{q.stem}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  {q.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="py-10 text-center text-[13px] text-ink-mute">
              {questions.length === 0 ? '错题本已清空' : '没有符合条件的错题'}
            </div>
          )}
        </div>
      </section>

      {/* 右：题目详情 */}
      <section className="card min-h-0 flex-1 overflow-y-auto p-5">
        {!current ? (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-mute">
            {questions.length === 0 ? '错题本已清空' : '选择左侧错题查看详情'}
          </div>
        ) : (
          <div>
            {/* 头部：序号 + 徽章 + 翻题 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[18px] font-bold text-ink">
                  {pad(globalNo)} <span className="text-ink-mute">/ {pad(questions.length)}</span>
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[12px] ${
                    current.severity === 'repeat'
                      ? 'bg-[#fdecec] text-[#d24848]'
                      : 'bg-[#fdf3e3] text-[#c07b1d]'
                  }`}
                >
                  {SEVERITY_LABEL[current.severity]}
                </span>
                <span className="rounded bg-page px-2 py-0.5 text-[11.5px] text-ink-mute">
                  {TYPE_LABEL[current.type]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost h-8 px-3"
                  disabled={selectedIndex <= 0}
                  onClick={() => step(-1)}
                >
                  <ChevronLeft size={14} />
                  上一题
                </button>
                <button
                  className="btn-ghost h-8 px-3"
                  disabled={selectedIndex >= filtered.length - 1}
                  onClick={() => step(1)}
                >
                  下一题
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* 题目 */}
            <div className="mt-5">
              <SectionTitle>题目</SectionTitle>
              <p className="mt-2.5 text-[14px] leading-6 text-ink">{current.stem}</p>
              {current.options && (
                <ul className="mt-3 space-y-2">
                  {current.options.map((o) => (
                    <li key={o.key} className="flex gap-2 text-[13.5px] leading-5 text-ink">
                      <span className="font-semibold">{o.key}.</span>
                      {o.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 我的错误 */}
            <div className="mt-5">
              <SectionTitle>我的错误</SectionTitle>
              <div className="mt-2.5 rounded-xl bg-[#fdecec] px-4 py-3 text-[13px] leading-5 text-[#c24545]">
                {current.myMistake}
              </div>
            </div>

            {/* 知识点标签 + 错误次数 */}
            <div className="mt-5 flex items-center justify-between">
              <div>
                <SectionTitle>知识点标签</SectionTitle>
                <div className="mt-2.5 flex gap-2">
                  {current.tags.map((t) => (
                    <span key={t} className="rounded-md bg-primary-soft px-2.5 py-1 text-[12px] text-primary">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="pr-2 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[13px] font-bold text-ink">
                  <BarChart3 size={15} className="text-[#e25050]" />
                  错误次数
                </div>
                <div className="mt-1 text-[18px] font-bold leading-none text-[#e25050]">
                  {current.wrongCount} <span className="text-[12px] font-normal text-ink-mute">次</span>
                </div>
              </div>
            </div>

            {/* 参考解析 */}
            <div className="mt-5">
              <SectionTitle>参考解析</SectionTitle>
              <div className="mt-2.5">
                <AnalysisView q={current} />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
