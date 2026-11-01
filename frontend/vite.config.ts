import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// 走 nginx 时由 compose 注入 http://backend:8000；本机裸跑默认本地后端。
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: true,
    port: 5174,
    // 端口被占用时直接失败，避免 vite 悄悄换端口导致 nginx 反代打到空处。
    strictPort: true,
    proxy: {
      // 预留：关闭 mock（VITE_USE_MOCK=false）后，前端 API 走 FastAPI 后端
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
