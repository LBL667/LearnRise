import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Pencil, Plus, Star, Trash2, Zap } from 'lucide-react'
import {
  createAgent,
  getAgent,
  listAgents,
  removeAgent,
  setDefaultAgent,
  testAgent,
  updateAgent,
} from '@/api/agents'
import { TIMEOUTS, parseApiDetail } from '@/api/client'
import type { AgentOut, AgentTestResult, AgentUpdate } from '@/api/types/agents'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DataTable } from '@/components/ui/DataTable'
import type { Column } from '@/components/ui/DataTable'
import { EmptyView, ErrorView, LoadingView } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'

interface FormState {
  name: string
  base_url: string
  model: string
  api_key: string
  temperature: string
  system_prompt: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

const EMPTY_FORM: FormState = {
  name: '',
  base_url: '',
  model: '',
  api_key: '',
  temperature: '0.7',
  system_prompt: '',
}

const ACTION_BUTTON =
  'btn-base h-8 gap-1 rounded-md border border-line px-2 text-[12px] text-ink-soft hover:bg-page hover:text-ink disabled:opacity-50'

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail?: unknown }).detail
    const parsed = parseApiDetail(detail)
    if (parsed.message) return parsed.message
  }
  if (error instanceof Error && error.message) return error.message
  return '请求失败，请稍后重试'
}

function validateForm(form: FormState, editing: boolean): FormErrors {
  const errors: FormErrors = {}

  if (form.name.trim() === '') {
    errors.name = '请填写 Agent 名称'
  } else if (form.name.trim().length > 80) {
    errors.name = '名称不能超过 80 个字符'
  }
  if (form.base_url.trim() === '') {
    errors.base_url = '请填写 base_url'
  }
  if (form.model.trim() === '') {
    errors.model = '请填写模型名称'
  }
  if (!editing && form.api_key.trim() === '') {
    errors.api_key = '新建 Agent 时必须填写 API Key'
  }

  const temperature = Number(form.temperature)
  if (
    form.temperature.trim() === '' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    errors.temperature = 'temperature 必须在 0 到 2 之间'
  }

  return errors
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-soft">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[11.5px] leading-5 text-[#d24848]" data-testid={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11.5px] leading-5 text-ink-mute">{hint}</p>
      ) : null}
    </div>
  )
}

export default function AgentsPage() {
  const { showToast } = useToast()
  const [agents, setAgents] = useState<AgentOut[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, AgentTestResult>>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AgentOut | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AgentOut | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) setLoading(true)
      try {
        const rows = await listAgents()
        setAgents(rows)
        setLoadError(null)
      } catch (error) {
        const message = describeError(error)
        if (options.silent) {
          showToast(message, 'error')
        } else {
          setLoadError(message)
        }
      } finally {
        if (!options.silent) setLoading(false)
      }
    },
    [showToast],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!formOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        setFormOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [formOpen, saving])

  const markBusy = useCallback((key: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [key]: value }))
  }, [])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setSubmitError(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((agent: AgentOut) => {
    setEditing(agent)
    setForm({
      name: agent.name,
      base_url: agent.base_url,
      model: agent.model,
      api_key: '',
      temperature: String(agent.temperature),
      system_prompt: agent.system_prompt ?? '',
    })
    setErrors({})
    setSubmitError(null)
    setFormOpen(true)
  }, [])

  const openEditFromServer = useCallback(
    async (agent: AgentOut) => {
      if (editingId !== null) return
      setEditingId(agent.id)
      try {
        const fresh = await getAgent(agent.id)
        openEdit(fresh)
      } catch (error) {
        showToast(describeError(error), 'error')
      } finally {
        setEditingId(null)
      }
    },
    [editingId, openEdit, showToast],
  )

  const closeForm = useCallback(() => {
    if (saving) return
    setFormOpen(false)
  }, [saving])

  const updateField = useCallback((key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const found = validateForm(form, editing !== null)
    setErrors(found)
    setSubmitError(null)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      const temperature = Number(form.temperature)
      const systemPrompt = form.system_prompt.trim()
      if (editing) {
        const payload: AgentUpdate = {
          name: form.name.trim(),
          base_url: form.base_url.trim(),
          model: form.model.trim(),
          temperature,
          system_prompt: systemPrompt === '' ? null : systemPrompt,
        }
        const apiKey = form.api_key.trim()
        if (apiKey !== '') payload.api_key = apiKey
        await updateAgent(editing.id, payload)
        showToast('Agent 已更新', 'success')
      } else {
        await createAgent({
          name: form.name.trim(),
          base_url: form.base_url.trim(),
          model: form.model.trim(),
          provider_type: 'openai_compatible',
          api_key: form.api_key.trim(),
          temperature,
          system_prompt: systemPrompt === '' ? null : systemPrompt,
        })
        showToast('Agent 已创建', 'success')
      }
      setFormOpen(false)
      await load({ silent: true })
    } catch (error) {
      const message = describeError(error)
      setSubmitError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (agent: AgentOut) => {
    const key = `test:${agent.id}`
    if (busy[key]) return
    markBusy(key, true)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[agent.id]
      return next
    })
    try {
      const result = await testAgent(agent.id, { timeoutMs: TIMEOUTS.agentTest })
      setTestResults((prev) => ({ ...prev, [agent.id]: result }))
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      const message = describeError(error)
      setTestResults((prev) => ({ ...prev, [agent.id]: { ok: false, message } }))
      showToast(message, 'error')
    } finally {
      markBusy(key, false)
    }
  }

  const handleSetDefault = async (agent: AgentOut) => {
    const key = `default:${agent.id}`
    if (busy[key]) return
    markBusy(key, true)
    try {
      await setDefaultAgent(agent.id)
      showToast('已设为默认 Agent', 'success')
      await load({ silent: true })
    } catch (error) {
      showToast(describeError(error), 'error')
    } finally {
      markBusy(key, false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await removeAgent(deleteTarget.id)
      showToast('Agent 已删除', 'success')
      setDeleteTarget(null)
      await load({ silent: true })
    } catch (error) {
      showToast(describeError(error), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const columns = useMemo<Column<AgentOut>[]>(
    () => [
      {
        key: 'name',
        header: '名称',
        render: (row) => <span className="font-medium text-ink">{row.name}</span>,
      },
      {
        key: 'provider_type',
        header: 'provider_type',
        render: (row) => (
          <span className="font-mono text-[12px] text-ink-soft">{row.provider_type}</span>
        ),
      },
      {
        key: 'model',
        header: '模型',
        render: (row) => <span className="font-mono text-[12px] text-ink-soft">{row.model}</span>,
      },
      {
        key: 'api_key',
        header: 'API Key（掩码）',
        render: (row) => (
          <span
            className="font-mono text-[12px] text-ink-mute"
            data-testid="agent-key-masked"
            title="密钥已脱敏，仅展示掩码"
          >
            {row.api_key_masked}
          </span>
        ),
      },
      {
        key: 'is_default',
        header: '默认',
        render: (row) =>
          row.is_default ? (
            <span
              data-testid="default-badge"
              className="inline-flex h-5 items-center rounded bg-[#e5f6ec] px-2 text-[11px] font-medium leading-none text-[#188c5e]"
            >
              默认
            </span>
          ) : (
            <span className="text-[12px] text-ink-mute">—</span>
          ),
      },
      {
        key: 'updated_at',
        header: '更新时间',
        render: (row) => (
          <span className="whitespace-nowrap text-[12px] text-ink-mute">
            {formatTime(row.updated_at)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '操作',
        className: 'w-[230px]',
        render: (row) => {
          const testing = busy[`test:${row.id}`] === true
          const settingDefault = busy[`default:${row.id}`] === true
          const result = testResults[row.id]
          return (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={ACTION_BUTTON}
                  data-testid="agent-edit"
                  onClick={() => void openEditFromServer(row)}
                  disabled={deleting || editingId === row.id}
                >
                  <Pencil size={13} />
                  {editingId === row.id ? '加载中…' : '编辑'}
                </button>
                <button
                  type="button"
                  className={ACTION_BUTTON}
                  data-testid="agent-test"
                  onClick={() => void handleTest(row)}
                  disabled={testing}
                >
                  <Zap size={13} />
                  {testing ? '测试中…' : '测试连接'}
                </button>
                {row.is_default ? (
                  <span className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-ink-mute">
                    <Star size={13} />
                    已是默认
                  </span>
                ) : (
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    data-testid="agent-default"
                    onClick={() => void handleSetDefault(row)}
                    disabled={settingDefault}
                  >
                    <Star size={13} />
                    {settingDefault ? '设置中…' : '设为默认'}
                  </button>
                )}
                <button
                  type="button"
                  className={`${ACTION_BUTTON} text-[#d24848] hover:bg-[#fdecec] hover:text-[#b73636]`}
                  data-testid="agent-delete"
                  onClick={() => setDeleteTarget(row)}
                  disabled={deleting}
                >
                  <Trash2 size={13} />
                  删除
                </button>
              </div>
              {result && (
                <span
                  data-testid="agent-test-result"
                  className={`text-[11.5px] leading-5 ${
                    result.ok ? 'text-[#188c5e]' : 'text-[#d24848]'
                  }`}
                >
                  {result.ok ? '成功' : '失败'} · {result.message}
                </span>
              )}
            </div>
          )
        },
      },
    ],
    [busy, deleting, editingId, openEditFromServer, testResults],
  )

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6" data-testid="page-agents">
      <div className="flex flex-wrap items-start justify-end gap-3">
        <button type="button" className="btn-primary" onClick={openCreate} data-testid="agent-create">
          <Plus size={16} />
          新建 Agent
        </button>
      </div>

      <div
        className="mt-4 rounded-xl border border-[#ffe4bf] bg-[#fff8ed] px-4 py-3 text-[12.5px] leading-6 text-[#96621c]"
        data-testid="agents-hint"
      >
        <p>测试连接失败不影响保存；把占位 Key 的 Agent 设为默认会导致 AI 功能失败</p>
        <p className="mt-0.5 text-[#b07a2e]">
          base_url 仅支持 https 公网地址；密钥只会以掩码形式展示，编辑时留空表示不修改。
        </p>
      </div>

      {loading ? (
        <div className="card mt-5" data-testid="agents-state">
          <LoadingView />
        </div>
      ) : loadError ? (
        <div className="card mt-5" data-testid="agents-state">
          <ErrorView message={loadError} onRetry={() => void load()} />
        </div>
      ) : agents.length === 0 ? (
        <div className="card mt-5" data-testid="agents-state">
          <EmptyView
            title="还没有 Agent"
            description="创建第一个 Agent 后，就能在知识点讲解里选择它。"
            action={
              <button type="button" className="btn-primary" onClick={openCreate} data-testid="agent-create-empty">
                新建 Agent
              </button>
            }
          />
        </div>
      ) : (
        <DataTable
          className="mt-5"
          columns={columns}
          rows={agents}
          rowKey={(row) => row.id}
          testIdPrefix="agent"
          density="compact"
        />
      )}

      {formOpen && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-[rgba(31,39,51,0.42)] p-4 py-10">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={editing ? '编辑 Agent' : '新建 Agent'}
            data-testid="agent-form"
            className="modal-panel w-full max-w-[520px] rounded-[14px] border border-line bg-white p-5 shadow-xl"
            onSubmit={handleSubmit}
            noValidate
          >
            <h2 className="text-[15px] font-bold text-ink">{editing ? '编辑 Agent' : '新建 Agent'}</h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-mute">
              {editing
                ? 'API Key 留空表示不修改；其余字段保存后立即生效。'
                : '填写 OpenAI 兼容端点的地址、模型与密钥。'}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <Field id="agent-field-name" label="名称" error={errors.name}>
                <input
                  id="agent-field-name"
                  data-testid="agent-field-name"
                  className="field-input"
                  value={form.name}
                  maxLength={80}
                  placeholder="例如：DeepSeek 官方"
                  onChange={(event) => updateField('name', event.target.value)}
                  disabled={saving}
                />
              </Field>

              <Field
                id="agent-field-base-url"
                label="base_url"
                hint="必须是可公网访问的 https 地址，例如 https://api.deepseek.com/v1"
                error={errors.base_url}
              >
                <input
                  id="agent-field-base-url"
                  data-testid="agent-field-base-url"
                  className="field-input font-mono"
                  value={form.base_url}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => updateField('base_url', event.target.value)}
                  disabled={saving}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="agent-field-model" label="模型" error={errors.model}>
                  <input
                    id="agent-field-model"
                    data-testid="agent-field-model"
                    className="field-input font-mono"
                    value={form.model}
                    placeholder="例如：deepseek-chat"
                    onChange={(event) => updateField('model', event.target.value)}
                    disabled={saving}
                  />
                </Field>

                <Field
                  id="agent-field-temperature"
                  label="temperature（0–2）"
                  error={errors.temperature}
                >
                  <input
                    id="agent-field-temperature"
                    data-testid="agent-field-temperature"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    className="field-input"
                    value={form.temperature}
                    onChange={(event) => updateField('temperature', event.target.value)}
                    disabled={saving}
                  />
                </Field>
              </div>

              <Field
                id="agent-field-api-key"
                label="API Key"
                hint={editing ? '留空表示不修改' : '仅保存在后端，界面只展示掩码'}
                error={errors.api_key}
              >
                <input
                  id="agent-field-api-key"
                  data-testid="agent-field-api-key"
                  type="password"
                  autoComplete="off"
                  className="field-input font-mono"
                  value={form.api_key}
                  placeholder={editing ? '留空表示不修改' : '填写模型服务的 API Key'}
                  onChange={(event) => updateField('api_key', event.target.value)}
                  disabled={saving}
                />
              </Field>

              <Field id="agent-field-system-prompt" label="系统提示词（可选）">
                <textarea
                  id="agent-field-system-prompt"
                  data-testid="agent-field-system-prompt"
                  className="field-input h-auto min-h-[84px] resize-y py-2"
                  value={form.system_prompt}
                  placeholder="告诉 Agent 它应该如何讲解知识点"
                  onChange={(event) => updateField('system_prompt', event.target.value)}
                  disabled={saving}
                />
              </Field>

              <div className="rounded-lg bg-page px-3 py-2 text-[12px] leading-5 text-ink-mute">
                provider_type 固定为 <span className="font-mono">openai_compatible</span>
              </div>
            </div>

            {submitError && (
              <p
                className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-[12px] leading-5 text-[#b73636]"
                data-testid="agent-form-submit-error"
              >
                {submitError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-gray"
                data-testid="agent-form-cancel"
                onClick={closeForm}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn-primary"
                data-testid="agent-form-submit"
                disabled={saving}
              >
                {saving ? '保存中…' : editing ? '保存' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除 Agent"
        description={
          deleteTarget ? `确定要删除「${deleteTarget.name}」吗？删除后无法恢复。` : undefined
        }
        confirmLabel="删除"
        danger
        pending={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null)
        }}
      />
    </div>
  )
}
