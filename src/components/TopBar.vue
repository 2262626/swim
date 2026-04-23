<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const props = defineProps({
  title: {
    type: String,
    default: 'AI游泳训练辅助系统',
  },
  showImport: {
    type: Boolean,
    default: true,
  },
  showSettings: {
    type: Boolean,
    default: true,
  },
  showExport: {
    type: Boolean,
    default: true,
  },
  showLogout: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['settings', 'export', 'import-video', 'logout', 'quick-add'])
const router = useRouter()
const route = useRoute()
const pageSubtitle = computed(() => {
  if (route.path.startsWith('/fitness')) return '力量动作训练分析'
  if (route.path.startsWith('/analysis')) return 'AI 视频深度分析'
  return ''
})

const isAnalysisRoute = computed(() => route.path.startsWith('/analysis'))

const triggerVideoImport = () => {
  emit('import-video')
}

const goToAnalysis = () => router.push('/analysis')
</script>

<template>
  <header class="top-bar">
    <div class="logo">
      <div class="logo-copy">
        <span>{{ props.title }}</span>
        <small>{{ pageSubtitle }}</small>
      </div>
    </div>

    <div class="top-bar-center-logo">
      <img src="../assets/logo.png" alt="logo" class="logo-img" />
    </div>

    <div class="top-actions">
      <button
        v-if="!isAnalysisRoute"
        class="icon-btn"
        title="新增队伍/学员"
        @click="$emit('quick-add')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <button
        v-if="!isAnalysisRoute"
        class="module-switch-btn ai-analysis-btn"
        title="AI视频分析"
        @click="goToAnalysis"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </button>

      <!-- <button v-if="props.showImport" class="icon-btn" title="导入视频分析" @click="triggerVideoImport">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </button>

      <button v-if="props.showSettings" class="icon-btn" title="设置" @click="$emit('settings')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button> -->
      


      <button v-if="props.showLogout" class="icon-btn" title="退出登录" @click="$emit('logout')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  </header>
</template>
