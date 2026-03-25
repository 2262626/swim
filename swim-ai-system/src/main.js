import { createApp } from 'vue'
import App from './App.vue'

import './assets/styles.css'

// 注册 Service Worker (PWA 支持)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('SW registered: ', registration.scope)
      },
      (error) => {
        console.log('SW registration failed: ', error)
      }
    )
  })
}

// 阻止 iOS 橡皮筋效果
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
  document.body.addEventListener('touchmove', (e) => {
    if (e.target === document.body) {
      e.preventDefault()
    }
  }, { passive: false })
}

// 网络状态监听
window.addEventListener('online', () => {
  console.log('网络已连接')
})

window.addEventListener('offline', () => {
  console.log('网络已断开')
  // 可以在这里显示离线提示
})

createApp(App).mount('#app')
