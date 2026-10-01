import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const api = process.env.KG_API_TARGET || 'http://localhost:3100'

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/media': { target: api, changeOrigin: true },
      '/people': { target: api, changeOrigin: true },
    },
  },
  // 产物落到 Express 的 public/app，由 server.js 对 / 、/g/* 、/kg/* 托管
  build: {
    outDir: path.resolve(__dirname, '../public/app'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
})
