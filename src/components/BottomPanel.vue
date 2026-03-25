<script setup>
const props = defineProps({
  stroke: String,
  strokeCount: Number,
  fps: Number,
  confidence: String,
  jointAngles: Object,
  angleBars: Object,
  pauseBtnText: String,
})

const emit = defineEmits(['reset', 'camera', 'pause'])

const formatAngle = (val) => val ? val + '°' : '—°'
</script>

<template>
  <div class="bottom-panel">
    <!-- 数据卡片行 -->
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

    <!-- 关节角度条 -->
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

    <!-- 底部按钮 -->
    <div class="btn-row">
      <button class="action-btn danger" @click="$emit('reset')">重置计数</button>
      <button class="action-btn primary" @click="$emit('camera')">切换摄像头</button>
      <button class="action-btn" @click="$emit('pause')">{{ pauseBtnText }}</button>
    </div>
  </div>
</template>
