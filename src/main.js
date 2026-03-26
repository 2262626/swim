import { createApp } from 'vue'
import App from './App.vue'
import 'element-plus/dist/index.css'
import './assets/styles.css'

const isProd = import.meta.env.PROD

if ('serviceWorker' in navigator) {
  if (isProd) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        (registration) => {
          registration.update()
          console.log('SW registered:', registration.scope)
        },
        (error) => {
          console.log('SW registration failed:', error)
        }
      )
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
  document.body.addEventListener('touchmove', (event) => {
    if (event.target === document.body) {
      event.preventDefault()
    }
  }, { passive: false })
}

window.addEventListener('online', () => {
  console.log('网络已连接')
})

window.addEventListener('offline', () => {
  console.log('网络已断开')
})

createApp(App).mount('#app')
