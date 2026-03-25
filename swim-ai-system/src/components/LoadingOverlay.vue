<script setup>
const props = defineProps({
  isLoading: Boolean,
  progress: Number,
  text: String,
})
</script>

<template>
  <div class="loading-overlay" :class="{ hidden: !isLoading }">
    <div class="loading-box">
      <div class="loading-spinner"></div>
      <p>{{ text }}</p>
      <div class="loading-bar-wrap">
        <div class="loading-bar-inner" :style="{ width: progress + '%' }"></div>
      </div>
    </div>
  </div>
</template>
