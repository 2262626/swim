import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    open: true,
    host: true,  // 允许局域网访问
    cors: true   // 允许跨域
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
