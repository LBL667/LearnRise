import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bot,
  CalendarDays,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Lightbulb,
  RefreshCw,
  Send,
  Sparkles,
  ThumbsUp,
} from 'lucide-react'
import {
  createConversation,
  getConversation,
  listConversations,
  revealAnswer,
  sendMessage,
  streamMessage,
} from '@/api/assistant'
import type { AssistantMode } from '@/api/assistant'
import { ApiError } from '@/api/client'
import type { AssistantCitation, ChatItem, PlanCard } from '@/api/types'
import { useToast } from '../ui/Toast'

function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 计划卡片 */
function PlanCardView({ card }: { card: PlanCard }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-[14px] font-bold text-ink">
        <CalendarDays size={16} className="text-primary" />
        {card.title}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {card.months.map((m) => (
          <div key={m.no} className="rounded-lg bg-page p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                {m.no}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold leading-tight text-ink">
                  第 {m.no} 个月：{m.name}
                </div>
                <div className="text-[11px] text-ink-mute">{m.period}</div>
              </div>
            </div>
            <ul className="mt-2 space-y-1.5">
              {m.items.map((it) => (
                <li key={it} className="flex gap-1.5 text-[12px] leading-4 text-ink-soft">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-ink-soft">{card.tail}</p>
    </div>
  )
}

const MODE_OPTIONS: { value: AssistantMode; label: string }[] = [
  { value: 'concise', label: '简洁' },
  { value: 'detailed', label: '详细' },
  { value: 'example', label: '举例' },
  { value: 'socratic', label: '引导' },
]

const ASSISTANT_FEATURES = [  {
    icon: CalendarDays,
    title: '生成学习规划',
    desc: '根据你的目标和当前水平\n制定个性化的学习计划',
    question: '请根据我的目标和当前水平，制定一份个性化的学习规划。',
  },
  {
    icon: FileText,
    title: '归纳错题知识点',
    desc: '上传错题或拍照识别\n自动归纳知识点与易错点',
    question: '帮我归纳错题中的知识点和易错点。',
  },
  {
    icon: BarChart3,
    title: '薄弱章节分析',
    desc: '基于你的练习与错题数据\n分析薄弱章节，给出提升建议',
    question: '基于我的练习与错题数据，分析我的薄弱章节，给出提升建议。',
  },
  {
    icon: Lightbulb,
    title: '今日学习建议',
    desc: '结合学习进度与目标\n为你推荐今日的学习任务',
    question: '结合我的学习进度与目标，为我推荐今日的学习任务。',
  },
]

export function StudyAssistantPanel() {
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [fallback, setFallback] = useState<{
    assistantId: string
    conversationId: string
    content: string
  } | null>(null)
  const [fallbackPending, setFallbackPending] = useState(false)
  const [fallbackError, setFallbackError] = useState<string | null>(null)
  const [mode, setMode] = useState<AssistantMode>('concise')
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    ASSISTANT_FEATURES.map((feature) => feature.question),
  )
  const conversationRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [liked, setLiked] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()
  const navigate = useNavigate()
  const seq = useRef(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const conversations = await listConversations()
        const conversation =
          conversations.length > 0 ? conversations[0] : await createConversation({ title: '学习助手' })
        if (cancelled) return
        conversationRef.current = conversation.id
        const detail = await getConversation(conversation.id)
        if (cancelled) return
        setMessages(
          detail.messages.map((message) => ({
            id: message.id,
            role: message.role === 'assistant' ? 'ai' : 'user',
            text: message.content,
            time: formatClock(message.created_at),
            citations: message.citations,
          })),
        )
      } catch {
        if (!cancelled) showToast('学习助手暂时不可用', 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || thinking) return
      const conversationId = conversationRef.current
      if (conversationId === null) {
        showToast('学习助手尚未就绪，请稍后重试', 'error')
        return
      }

      const userMsg: ChatItem = { id: `u-${++seq.current}`, role: 'user', text: trimmed, time: nowTime() }
      const assistantId = `a-${++seq.current}`
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'ai', text: '', time: nowTime() },
      ])
      setInput('')
      setThinking(true)
      setFallback(null)
      setFallbackError(null)

      const controller = new AbortController()
      abortRef.current?.abort()
      abortRef.current = controller
      let citations: AssistantCitation[] = []

      try {
        await streamMessage(
          conversationId,
          trimmed,
          mode,
          {
            onCitations: (next) => {
              citations = next
            },
            onToken: (delta) => {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId ? { ...message, text: message.text + delta } : message,
                ),
              )
            },
            onDone: () => {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId ? { ...message, citations } : message,
                ),
              )
            },
          },
          controller.signal,
        )
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : '回答生成失败'
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantId ? { ...item, text: item.text || `（${message}）` } : item,
          ),
        )
        if (!controller.signal.aborted) {
          setFallback({ assistantId, conversationId, content: trimmed })
        }
      } finally {
        setThinking(false)
      }
    },
    [thinking, showToast, mode],
  )

  const runFallback = useCallback(async () => {
    if (!fallback || fallbackPending) return
    setFallbackPending(true)
    setFallbackError(null)
    try {
      const answer = await sendMessage(fallback.conversationId, fallback.content, mode)
      setMessages((prev) => [
        ...prev,
        {
          id: answer.message_id,
          role: 'ai',
          text: answer.content,
          time: formatClock(answer.created_at) || nowTime(),
          citations: answer.citations,
        },
      ])
      setFallback(null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'NO_CONTEXT') {
        setFallbackError('请先上传或选择资料')
      } else if (caught instanceof ApiError && caught.status === 404) {
        showToast('会话不存在，已返回助手列表', 'error')
        conversationRef.current = null
        setMessages([])
        setFallback(null)
      } else {
        const message =
          caught instanceof ApiError
            ? caught.detail
            : caught instanceof Error
              ? caught.message
              : '普通回复失败'
        setFallbackError(message)
      }
    } finally {
      setFallbackPending(false)
    }
  }, [fallback, fallbackPending, mode, showToast])

  const reveal = useCallback(async () => {
    const conversationId = conversationRef.current
    if (conversationId === null || thinking || revealing) return
    setRevealing(true)
    try {
      const result = await revealAnswer(conversationId)
      const body = result.explanation ? `${result.answer}\n\n解析：${result.explanation}` : result.answer
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${++seq.current}`,
          role: 'ai',
          text: `参考答案：${body}`,
          time: nowTime(),
        },
      ])
    } catch {
      showToast('暂无参考答案，请先生成讲解', 'error')
    } finally {
      setRevealing(false)
    }
  }, [thinking, revealing, showToast])

  const regenerate = async (msg: ChatItem) => {
    // 找到该 AI 消息对应的上一条用户消息，重新生成
    const idx = messages.findIndex((m) => m.id === msg.id)
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user')
    if (!prevUser) return
    setMessages((prev) => prev.filter((m) => m.id !== msg.id))
    await send(prevUser.text)
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制')
    } catch {
      showToast('复制失败，请手动选择文本', 'error')
    }
  }

  const toggleLike = (id: string) => {
    setLiked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        showToast('感谢反馈')
      }
      return next
    })
  }

  const refreshSuggestions = () => {
    setSuggestions((prev) => [...prev.slice(1), ...prev.slice(0, 1)])
  }

  return (
    <div className="flex h-full min-h-0 gap-5">
      {/* 左：对话区 */}
      <section className="card flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end gap-3">
                <div className="max-w-[70%]">
                  <div className="rounded-2xl rounded-tr-sm bg-primary-soft px-4 py-2.5 text-[13.5px] leading-6 text-ink">
                    {m.text}
                  </div>
                  <div className="mt-1 text-right text-[11px] text-ink-mute">{m.time}</div>
                </div>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, hsl(212 85% 68%), hsl(232 78% 55%))' }}
                >
                  林
                </span>
              </div>
            ) : (
              <div key={m.id} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4a90ff] to-primary text-white">
                  <Bot size={17} />
                </span>
                <div className="max-w-[82%]">
                  <div className="rounded-2xl rounded-tl-sm bg-page px-4 py-3 text-[13.5px] leading-6 text-ink">
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.planCard && <PlanCardView card={m.planCard} />}
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.citations.map((citation, index) =>
                          citation.knowledge_point_id ? (
                            <button
                              key={citation.chunk_id}
                              data-testid={`citation-${index}`}
                              onClick={() => navigate(`/kp/${citation.knowledge_point_id}`)}
                              className="rounded-md bg-primary-soft px-2 py-1 text-[11.5px] text-primary hover:underline"
                              title={citation.snippet}
                            >
                              [{index + 1}] 第 {citation.page ?? '-'} 页 · {citation.heading ?? '资料'}
                            </button>
                          ) : (
                            <span
                              key={citation.chunk_id}
                              data-testid={`citation-${index}`}
                              className="rounded-md bg-page px-2 py-1 text-[11.5px] text-ink-mute"
                              title={citation.snippet}
                            >
                              [{index + 1}] 第 {citation.page ?? '-'} 页 · {citation.heading ?? '资料'}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  {fallback?.assistantId === m.id && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                      <button
                        type="button"
                        data-testid="assistant-fallback"
                        className="rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={fallbackPending}
                        onClick={() => void runFallback()}
                      >
                        {fallbackPending ? '正在获取普通回复…' : '发送失败？改用普通回复'}
                      </button>
                      {fallbackError && <span className="text-[#e25050]">{fallbackError}</span>}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-4 text-[12px] text-ink-mute">
                    <span>{m.time}</span>
                    <button
                      className="flex items-center gap-1 transition-colors hover:text-primary"
                      onClick={() => void copyText(m.text)}
                    >
                      <Copy size={12} /> 复制
                    </button>
                    <button
                      className="flex items-center gap-1 transition-colors hover:text-primary"
                      onClick={() => void regenerate(m)}
                      disabled={thinking}
                    >
                      <RefreshCw size={12} /> 重新一次
                    </button>
                    <button
                      className={`flex items-center gap-1 transition-colors hover:text-primary ${
                        liked.has(m.id) ? 'text-primary' : ''
                      }`}
                      onClick={() => toggleLike(m.id)}
                    >
                      <ThumbsUp size={12} className={liked.has(m.id) ? 'fill-primary/20' : ''} /> 点赞
                    </button>
                  </div>
                </div>
              </div>
            ),
          )}

          {/* AI 思考中 */}
          {thinking && (
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4a90ff] to-primary text-white">
                <Bot size={17} />
              </span>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-page px-4 py-3.5">
                <span className="dot-bounce h-1.5 w-1.5 rounded-full bg-ink-mute" />
                <span className="dot-bounce h-1.5 w-1.5 rounded-full bg-ink-mute" style={{ animationDelay: '0.15s' }} />
                <span className="dot-bounce h-1.5 w-1.5 rounded-full bg-ink-mute" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          )}
        </div>

        {/* 输入区：发送按钮与输入框同行 */}
        <div className="border-t border-line p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-[12px] font-medium text-ink-mute">回答模式</span>
            <div
              role="group"
              aria-label="回答模式"
              className="inline-flex rounded-lg border border-line bg-page p-0.5"
            >
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => setMode(option.value)}
                  className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                    mode === option.value
                      ? 'bg-white text-primary shadow-[0_1px_3px_rgba(31,39,51,0.12)]'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-3">
            <textarea
              className="field-input h-11 max-w-[520px] flex-1 resize-none py-2.5 leading-5"
              placeholder="请输入你的问题，例如：制定下周的学习计划 / 分析一道错题…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
            />
            {mode === 'socratic' && (
              <button
                type="button"
                className="btn-ghost shrink-0 px-5"
                disabled={thinking || revealing}
                onClick={() => void reveal()}
              >
                <Eye size={14} />
                揭晓答案
              </button>
            )}
            <button className="btn-primary shrink-0 px-5" disabled={!input.trim() || thinking} onClick={() => void send(input)}>
              <Send size={14} />
              发送
            </button>
          </div>
        </div>
      </section>

      {/* 右：助手功能栏 */}
      <aside className="flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto pb-1">
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            <span className="text-[15px] font-bold text-ink">学习助手</span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-ink-mute">AI 助你更高效地备考，攻克每一个学习难题。</p>
        </div>

        {ASSISTANT_FEATURES.map((f) => (
          <button
            key={f.title}
            className="card group flex items-center gap-3 p-3.5 text-left transition-shadow hover:shadow-[0_4px_16px_rgba(46,124,246,0.1)]"
            onClick={() => void send(f.question)}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <f.icon size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink">{f.title}</span>
              <span className="mt-0.5 block whitespace-pre-line text-[11px] leading-4 text-ink-mute">{f.desc}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-mute transition group-hover:text-primary" />
          </button>
        ))}

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Sparkles size={14} className="text-primary" />
              你可以这样问
            </div>
            <button
              className="flex items-center gap-1 text-[12px] text-primary transition hover:text-primary-deep"
              onClick={() => void refreshSuggestions()}
            >
              <RefreshCw size={12} />
              换一批
            </button>
          </div>
          <div className="mt-2 flex flex-col">
            {suggestions.map((q) => (
              <button
                key={q}
                className="group flex items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left text-[12.5px] text-ink-soft transition hover:bg-primary-soft hover:text-primary"
                onClick={() => void send(q)}
              >
                <span className="min-w-0 flex-1 truncate">{q}</span>
                <ChevronRight size={13} className="shrink-0 text-ink-mute group-hover:text-primary" />
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
