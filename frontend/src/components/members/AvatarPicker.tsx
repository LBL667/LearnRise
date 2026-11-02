import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, GraduationCap, Upload, X } from 'lucide-react'
import boy from '../../../个人中心设置/开心男孩蓝色头像.png'
import girl from '../../../个人中心设置/image-gen-2(20261102-124431).png'
import glasses from '../../../个人中心设置/image-gen-3(20261102-124432).png'
import cap from '../../../个人中心设置/image-gen-4(9).png'
import cat from '../../../个人中心设置/image-gen-5(9).png'
import panda from '../../../个人中心设置/image-gen-6(7).png'

const presets = [boy, girl, glasses, cap, cat, panda]
const storageKey = 'learnrise-profile-avatar'
export function useProfileAvatar() {
  const [avatar, setAvatar] = useState(() => { try { return localStorage.getItem(storageKey) || '' } catch { return '' } })
  useEffect(() => {
    const update = () => { try { setAvatar(localStorage.getItem(storageKey) || '') } catch { setAvatar('') } }
    window.addEventListener('learnrise-avatar-change', update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener('learnrise-avatar-change', update); window.removeEventListener('storage', update) }
  }, [])
  return avatar
}

export function AvatarPicker({ current, onClose }: { current: string; onClose: () => void }) {
  const [selected, setSelected] = useState(current)
  const [custom, setCustom] = useState(current && !presets.includes(current) ? current : '')
  const [error, setError] = useState('')
  const modal = useRef<HTMLDivElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    modal.current?.focus()
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Tab' && modal.current) {
        const nodes = Array.from(modal.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="file"])'))
        if (!nodes.length) return
        if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === modal.current)) { e.preventDefault(); nodes[nodes.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [onClose])
  const chooseFile = (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setError('请选择 PNG、JPG、WebP 或 GIF 图片'); return }
    if (file.size > 2 * 1024 * 1024) { setError('图片请小于 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => { const result = String(reader.result); setCustom(result); setSelected(result); setError('') }
    reader.onerror = () => setError('图片读取失败，请重试')
    reader.readAsDataURL(file)
  }
  const save = () => {
    try { localStorage.setItem(storageKey, selected); window.dispatchEvent(new Event('learnrise-avatar-change')); onClose() }
    catch { setError('保存失败，浏览器存储空间可能不足') }
  }
  return createPortal(
    <div className="avatar-picker-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={modal} role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title" tabIndex={-1} className="avatar-picker">
        <div className="avatar-picker__header"><div><GraduationCap size={28} /><h2 id="avatar-picker-title">更换头像</h2></div><button type="button" aria-label="关闭" onClick={onClose}><X size={22} /></button></div>
        <p className="avatar-picker__intro">选择官方头像，或上传自己的图片</p>
        <div className="avatar-picker__grid" role="radiogroup" aria-label="选择头像">
          {presets.map((src, index) => <button key={src} type="button" role="radio" aria-checked={selected === src} aria-label={`预设头像 ${index + 1}`} className={`avatar-picker__choice ${selected === src ? 'is-selected' : ''}`} onClick={() => { setSelected(src); setError('') }}><img src={src} alt="" />{selected === src && <span className="avatar-picker__check"><Check size={15} strokeWidth={3} /></span>}</button>)}
          {custom && <button type="button" role="radio" aria-checked={selected === custom} aria-label="自定义头像" className={`avatar-picker__choice ${selected === custom ? 'is-selected' : ''}`} onClick={() => setSelected(custom)}><img src={custom} alt="" />{selected === custom && <span className="avatar-picker__check"><Check size={15} strokeWidth={3} /></span>}</button>}
          <button type="button" className="avatar-picker__upload" onClick={() => upload.current?.click()}><Upload size={23} /><span>上传图片</span></button>
          <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
        </div>
        {error && <p role="alert" className="avatar-picker__error">{error}</p>}
        <div className="avatar-picker__actions"><button type="button" onClick={onClose}>取消</button><button type="button" onClick={save} disabled={!selected}>保存</button></div>
      </div>
    </div>, document.body,
  )
}
