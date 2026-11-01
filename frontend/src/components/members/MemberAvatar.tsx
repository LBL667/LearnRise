interface MemberAvatarProps {
  name: string
  hue: number
  size?: number
  className?: string
}

/** 渐变首字头像 */
export function MemberAvatar({ name, hue, size = 52, className = '' }: MemberAvatarProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 82% 68%), hsl(${(hue + 40) % 360} 74% 52%))`,
      }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  )
}
