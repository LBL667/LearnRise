import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, GraduationCap, Upload, X } from 'lucide-react'
import boy from '@/assets/avatars/boy.png'
import girl from '@/assets/avatars/girl.png'
import glasses from '@/assets/avatars/glasses.png'
import cap from '@/assets/avatars/cap.png'
import cat from '@/assets/avatars/cat.png'
import panda from '@/assets/avatars/panda.png'

const presets = [boy, girl, glasses, cap, cat, panda]
type Selection = { kind: 'preset'; url: string } | { kind: 'file'; file: File; url: string }

export function AvatarPicker({ onClose, onSave, saving }: { onClose: () => void; onSave: (file: File) => Promise<boolean>; saving: boolean }) {
  const [selected, setSelected] = useState<Selection | null>(null)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); onClose() }
      if (event.key === 'Tab' && dialog.current) {
        const nodes = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
        if (!nodes.length) return
        if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === dialog.current)) { event.preventDefault(); nodes[nodes.length - 1].focus() }
        else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose, saving])
  useEffect(() => () => { if (selected?.kind === 'file') URL.revokeObjectURL(selected.url) }, [selected])
  const chooseFile = (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('请选择 PNG、JPG 或 WebP 图片'); return }
    if (!file.size) { setError('图片为空，请重新选择'); return }
    setError(''); setSelected({ kind: 'file', file, url: URL.createObjectURL(file) })
  }
  const save = async () => {
    if (!selected || saving) return
    try {
      let file: File
      if (selected.kind === 'preset') {
        const response = await fetch(selected.url)
        if (!response.ok) throw new Error('预设头像加载失败，请重试')
        file = new File([await response.blob()], 'avatar.png', { type: 'image/png' })
      } else file = selected.file
      if (await onSave(file)) onClose()
      else setError('保存失败，请检查图片大小或网络后重试')
    } catch { setError('头像加载失败，请重试') }
  }
  return createPortal(<div className="avatar-picker-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title" tabIndex={-1} className="avatar-picker">
      <div className="avatar-picker__header"><div><GraduationCap size={28} /><h2 id="avatar-picker-title">更换头像</h2></div><button type="button" aria-label="关闭" onClick={onClose} disabled={saving}><X size={22} /></button></div>
      <p className="avatar-picker__intro">选择官方头像，或上传自己的图片</p>
      <div className="avatar-picker__grid" role="group" aria-label="选择头像">
        {presets.map((url, index) => <button key={url} type="button" aria-pressed={selected?.kind === 'preset' && selected.url === url} aria-label={`预设头像 ${index + 1}`} className={`avatar-picker__choice ${selected?.kind === 'preset' && selected.url === url ? 'is-selected' : ''}`} onClick={() => { setSelected({ kind: 'preset', url }); setError('') }} disabled={saving}><img src={url} alt="" />{selected?.kind === 'preset' && selected.url === url && <span className="avatar-picker__check"><Check size={15} strokeWidth={3} /></span>}</button>)}
        {selected?.kind === 'file' && <button type="button" aria-label="已选择自定义头像" aria-pressed="true" className="avatar-picker__choice is-selected"><img src={selected.url} alt="" /><span className="avatar-picker__check"><Check size={15} strokeWidth={3} /></span></button>}
        <button type="button" className="avatar-picker__upload" onClick={() => input.current?.click()} disabled={saving}><Upload size={23} /><span>上传图片</span></button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} data-testid="profile-avatar-input" onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
      </div>
      {error && <p role="alert" className="avatar-picker__error">{error}</p>}
      <div className="avatar-picker__actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="button" onClick={() => void save()} disabled={!selected || saving}>{saving ? '保存中…' : '保存'}</button></div>
    </div>
  </div>, document.body)
}
