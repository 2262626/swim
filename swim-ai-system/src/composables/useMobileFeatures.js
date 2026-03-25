import { ref, onMounted, onUnmounted } from 'vue'

export function useMobileFeatures() {
  const isOnline = ref(navigator.onLine)
  const isPortrait = ref(window.matchMedia('(orientation: portrait)').matches)
  const batteryLevel = ref(null)
  const isCharging = ref(null)
  const deviceType = ref('unknown')

  // 检测设备类型
  const detectDeviceType = () => {
    const ua = navigator.userAgent
    if (/iPad|iPhone|iPod/.test(ua)) {
      deviceType.value = 'ios'
    } else if (/Android/.test(ua)) {
      deviceType.value = 'android'
    } else {
      deviceType.value = 'desktop'
    }
  }

  // 网络状态监听
  const handleOnline = () => { isOnline.value = true }
  const handleOffline = () => { isOnline.value = false }

  // 方向监听
  const handleOrientationChange = () => {
    isPortrait.value = window.matchMedia('(orientation: portrait)').matches
  }

  // 震动反馈 (仅移动端)
  const vibrate = (pattern = 50) => {
    if (navigator.vibrate && deviceType.value !== 'desktop') {
      navigator.vibrate(pattern)
    }
  }

  // 电池状态 (如果支持)
  const initBattery = async () => {
    if ('getBattery' in navigator) {
      try {
        const battery = await navigator.getBattery()
        batteryLevel.value = battery.level
        isCharging.value = battery.charging

        battery.addEventListener('levelchange', () => {
          batteryLevel.value = battery.level
        })
        battery.addEventListener('chargingchange', () => {
          isCharging.value = battery.charging
        })
      } catch (e) {
        console.log('Battery API not available')
      }
    }
  }

  // 阻止屏幕休眠 (仅支持的环境)
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        const wakeLock = await navigator.wakeLock.request('screen')
        console.log('Wake Lock active')
        return wakeLock
      } catch (err) {
        console.log('Wake Lock request failed:', err)
      }
    }
    return null
  }

  // 全屏模式 (移动端游戏化体验)
  const requestFullscreen = async () => {
    const element = document.documentElement
    if (element.requestFullscreen) {
      await element.requestFullscreen()
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen()
    }
  }

  // 退出全屏
  const exitFullscreen = async () => {
    if (document.exitFullscreen) {
      await document.exitFullscreen()
    } else if (document.webkitExitFullscreen) {
      await document.webkitExitFullscreen()
    }
  }

  // 检查是否为 PWA 模式运行
  const isStandalone = ref(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )

  // 显示 PWA 安装提示 (iOS 或 Android)
  const showInstallPrompt = ref(false)
  let deferredPrompt = null

  onMounted(() => {
    detectDeviceType()
    initBattery()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('orientationchange', handleOrientationChange)
    window.matchMedia('(orientation: portrait)').addEventListener('change', handleOrientationChange)

    // 监听 PWA 安装事件 (Android Chrome)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      deferredPrompt = e
      showInstallPrompt.value = true
    })

    // iOS 安装提示 (检测是否已添加到主屏幕)
    if (deviceType.value === 'ios' && !isStandalone.value) {
      // 可以在这里显示 iOS 安装引导
      console.log('iOS: 提示用户添加到主屏幕')
    }
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    window.removeEventListener('orientationchange', handleOrientationChange)
  })

  // 触发安装 (Android)
  const installPWA = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    showInstallPrompt.value = false
    return outcome === 'accepted'
  }

  return {
    // 状态
    isOnline,
    isPortrait,
    batteryLevel,
    isCharging,
    deviceType,
    isStandalone,
    showInstallPrompt,
    
    // 方法
    vibrate,
    requestWakeLock,
    requestFullscreen,
    exitFullscreen,
    installPWA,
  }
}
