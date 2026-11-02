import { DataTable } from '@/components/ui/DataTable'
import type { Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyView, ErrorView, LoadingView, NotFoundView } from '@/components/ui/StateViews'

interface DemoSource {
  id: string
  name: string
  status: string
}

const DEMO_SOURCES: DemoSource[] = [
  { id: 'src-1', name: '线性代数讲义.pdf', status: 'ready' },
  { id: 'src-2', name: '概率论笔记.docx', status: 'parsing' },
]

const DEMO_COLUMNS: Column<DemoSource>[] = [
  { key: 'name', header: '资料', render: (row) => <span className="font-medium text-ink">{row.name}</span> },
  { key: 'status', header: '状态', render: (row) => <StatusBadge status={row.status} /> },
]

const DEMO_STATUSES = ['pending', 'parsing', 'embedding', 'ready', 'ready_empty', 'failed']

export default function LibraryPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6" data-testid="page-library">
      <h1 className="text-[20px] font-bold text-ink">资料库</h1>
      <p className="mt-1 text-[13px] text-ink-soft">上传的资料、解析状态与知识点树将在这里管理。</p>

      <section className="card mt-5 p-5" data-testid="ui-atoms-demo">
        <h2 className="text-[14px] font-bold text-ink">共享 UI 组件预览</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
          <StatusBadge status="custom-status" />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-line bg-white">
            <LoadingView />
          </div>
          <div className="rounded-xl border border-line bg-white">
            <EmptyView title="暂无资料" description="上传第一份资料后这里会显示内容。" />
          </div>
          <div className="rounded-xl border border-line bg-white">
            <ErrorView message="资料加载失败，请稍后重试。" onRetry={() => {}} />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-white">
          <NotFoundView />
        </div>

        <div className="mt-4">
          <DataTable
            columns={DEMO_COLUMNS}
            rows={DEMO_SOURCES}
            rowKey={(row) => row.id}
            testIdPrefix="demo-source"
            density="compact"
          />
        </div>
      </section>
    </div>
  )
}
