<script setup>
const props = defineProps({
  stroke: String,
  strokeCount: Number,
  fps: Number,
  confidence: String,
  jointAngles: Object,
  angleBars: Object,
  pauseBtnText: String,
  recordBtnText: String,
  selectedSwimStyle: String,
  swimStyleOptions: {
    type: Array,
    default: () => [],
  },
  assessment: {
    type: Object,
    default: () => ({ score: null, items: [] }),
  },
  hideAssessment: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['reset', 'camera', 'pause', 'record', 'select-style'])

const formatAngle = (value) => (value ? `${value}°` : '—°')
</script>

<template>
  <div class="bottom-panel">
    <div class="panel-style-manual">
      <span class="style-label">当前泳姿：</span>
      <div class="style-buttons">
        <button
          v-for="style in swimStyleOptions"
          :key="style"
          class="style-btn"
          :class="{ active: selectedSwimStyle === style }"
          @click="$emit('select-style', style)"
        >
          {{ style }}
        </button>
      </div>
    </div>

    <div v-if="!hideAssessment && assessment?.items?.length" class="panel-technique">
      <div class="panel-technique-header">
        <span>{{ selectedSwimStyle }}动作标准</span>
        <strong>{{ assessment.score ?? 0 }}分</strong>
      </div>
      <div class="panel-technique-items">
        <div
          v-for="item in assessment.items"
          :key="item.key"
          class="panel-technique-item"
          :class="{ ok: item.ok, bad: !item.ok }"
        >
          <span class="name">{{ item.label }}</span>
          <span class="status">{{ item.ok ? '✓ 正确' : '✕ 错误' }}</span>
        </div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">泳姿</div>
        <div class="stat-value">{{ stroke || '—' }}</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-label">划臂次数</div>
        <div class="stat-value">{{ strokeCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">帧率</div>
        <div class="stat-value">{{ fps }} fps</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">置信度</div>
        <div class="stat-value">{{ confidence }}</div>
      </div>
    </div>

    <div class="angle-row">
      <div class="angle-item">
        <span class="angle-label">左肘</span>
        <div class="angle-bar">
          <div class="angle-fill" :style="{ width: angleBars.leftElbow + '%' }"></div>
        </div>
        <span class="angle-num">{{ formatAngle(jointAngles.leftElbow) }}</span>
      </div>
      <div class="angle-item">
        <span class="angle-label">右肘</span>
        <div class="angle-bar">
          <div class="angle-fill" :style="{ width: angleBars.rightElbow + '%' }"></div>
        </div>
        <span class="angle-num">{{ formatAngle(jointAngles.rightElbow) }}</span>
      </div>
      <div class="angle-item">
        <span class="angle-label">左肩</span>
        <div class="angle-bar">
          <div class="angle-fill" :style="{ width: angleBars.leftShoulder + '%' }"></div>
        </div>
        <span class="angle-num">{{ formatAngle(jointAngles.leftShoulder) }}</span>
      </div>
      <div class="angle-item">
        <span class="angle-label">右肩</span>
        <div class="angle-bar">
          <div class="angle-fill" :style="{ width: angleBars.rightShoulder + '%' }"></div>
        </div>
        <span class="angle-num">{{ formatAngle(jointAngles.rightShoulder) }}</span>
      </div>
    </div>

    <div class="btn-row">
      <button class="action-btn danger" @click="$emit('reset')">重置计数</button>
      <button class="action-btn record" @click="$emit('record')">{{ recordBtnText }}</button>
      <button class="action-btn primary" @click="$emit('camera')">切换摄像头</button>
      <button class="action-btn" @click="$emit('pause')">{{ pauseBtnText }}</button>
    </div>
  </div>
</template>
