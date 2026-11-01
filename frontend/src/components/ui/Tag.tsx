interface TagProps {
  children: string
  tone?: 'blue' | 'violet'
}

export function Tag({ children, tone = 'blue' }: TagProps) {
  const tones = {
    blue: 'bg-primary-soft text-primary',
    violet: 'bg-[#f0ecfe] text-[#7c5cf0]',
  }
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded px-2 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
