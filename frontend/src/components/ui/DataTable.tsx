import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T, index: number) => ReactNode
  className?: string
  headerClassName?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  empty?: ReactNode
  testIdPrefix?: string
  className?: string
  onRowClick?: (row: T) => void
  density?: 'normal' | 'compact'
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** 通用数据表：真实 table 语义，支持空态、行点击与紧凑密度。 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  testIdPrefix,
  className,
  onRowClick,
  density = 'normal',
}: DataTableProps<T>) {
  const cellPadding = density === 'compact' ? 'px-3 py-2' : 'px-4 py-3'
  const headerPadding = density === 'compact' ? 'px-3 py-2' : 'px-4 py-2.5'

  return (
    <div className={cx('card overflow-hidden', className)}>
      <table className="w-full border-collapse text-left text-[13px] text-ink">
        <thead>
          <tr className="border-b border-line bg-[#f7f9fd]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'whitespace-nowrap text-[12px] font-semibold text-ink-soft',
                  headerPadding,
                  column.headerClassName,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-[13px] text-ink-mute">
                {empty ?? '暂无数据'}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                data-testid={testIdPrefix ? `${testIdPrefix}-row` : undefined}
                data-row-index={index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  'border-b border-line/70 last:border-b-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-primary-soft-2',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(cellPadding, 'align-middle text-ink', column.className)}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
