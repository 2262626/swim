<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isOpen: Boolean,
  settings: Object,
})

const emit = defineEmits(['close', 'apply', 'update-skeleton'])

const localSettings = ref({ ...props.settings })

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    localSettings.value = { ...props.settings }
  }
})

const colors = ['#00FFFC', '#FF006E', '#FFD600', '#76FF03']

const apply = () => {
  emit('apply', localSettings.value)
}

const selectComplexity = (val) => {
  localSettings.value.complexity = parseInt(val)
}

const selectColor = (color) => {
  localSettings.value.lineColor = color
  emit('update-skeleton', { lineColor: color })
}
</script>

<template>
  <div class="settings-drawer" :class="{ open: isOpen }">
    <div class="drawer-header">
      <h3>识别设置</h3>
      <button class="icon-btn" @click="$emit('close')">✕</button>
    </div>

    <div class="setting-group">
      <label>模型精度</label>
      <div class="seg-control">
        <button 
          class="seg-btn" 
          :class="{ active: localSettings.complexity === 0 }"
          @click="selectComplexity(0)"
        >快速</button>
        <button 
          class="seg-btn" 
          :class="{ active: localSettings.complexity === 1 }"
          @click="selectComplexity(1)"
        >标准</button>
        <button 
          class="seg-btn" 
          :class="{ active: localSettings.complexity === 2 }"
          @click="selectComplexity(2)"
        >精准</button>
      </div>
    </div>

    <div class="setting-group">
      <label>检测置信阈值 <span>{{ localSettings.detectConf }}</span></label>
      <input 
        type="range" 
        v-model.number="localSettings.detectConf" 
        min="0.1" 
        max="0.9" 
        step="0.05"
      >
    </div>

    <div class="setting-group">
      <label>跟踪置信阈值 <span>{{ localSettings.trackConf }}</span></label>
      <input 
        type="range" 
        v-model.number="localSettings.trackConf" 
        min="0.1" 
        max="0.9" 
        step="0.05"
      >
    </div>

    <div class="setting-group">
      <label>骨骼线宽 <span>{{ localSettings.lineWidth }}px</span></label>
      <input 
        type="range" 
        v-model.number="localSettings.lineWidth" 
        min="1" 
        max="8" 
        step="1"
        @input="$emit('update-skeleton', { lineWidth: localSettings.lineWidth })"
      >
    </div>

    <div class="setting-group">
      <label>骨骼颜色</label>
      <div class="color-picker-row">
        <button 
          v-for="color in colors" 
          :key="color"
          class="color-swatch" 
          :class="{ active: localSettings.lineColor === color }"
          :style="{ background: color }"
          @click="selectColor(color)"
        ></button>
      </div>
    </div>

    <div class="setting-group">
      <label>显示置信度标签</label>
      <label class="toggle">
        <input type="checkbox" v-model="localSettings.showLabels" @change="$emit('update-skeleton', { showLabels: localSettings.showLabels })">
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="setting-group">
      <label>只显示上半身</label>
      <label class="toggle">
        <input type="checkbox" v-model="localSettings.upperOnly" @change="$emit('update-skeleton', { upperOnly: localSettings.upperOnly })">
        <span class="toggle-slider"></span>
      </label>
    </div>

    <button class="action-btn primary full-width" @click="apply">应用设置</button>
  </div>
</template>
