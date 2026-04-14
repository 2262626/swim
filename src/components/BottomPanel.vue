<script setup>
import { computed } from 'vue'
import { ElSelect, ElOption } from 'element-plus'

const props = defineProps({
  strokeCount: Number,
  pauseBtnText: String,
  recordBtnText: String,
  selectedSwimStyle: String,
  swimStyleOptions: {
    type: Array,
    default: () => [],
  },
  analysisMode: {
    type: String,
    default: 'camera',
  },
  isRecording: {
    type: Boolean,
    default: false,
  },
  poolLength: {
    type: Number,
    default: 25,
  },
  trainingTarget: {
    type: String,
    default: '',
  },
  cameraType: {
    type: Array,
    default: () => [],
  },
  poolLengthOptions: {
    type: Array,
    default: () => [
      { label: '25米', value: 25 },
      { label: '50米', value: 50 },
    ],
  },
  trainingTargetOptions: {
    type: Array,
    default: () => ['中考游泳', '等级考试', '竞技比赛', '减脂健身', '初学入门'],
  },
  cameraTypeOptions: {
    type: Array,
    default: () => [
      { label: '正侧面固定机位', value: '正侧面固定机位' },
      { label: '泳道尽头正面机位', value: '泳道尽头正面机位' },
      { label: '水下侧机位', value: '水下侧机位' },
      { label: '顶部俯视机位', value: '顶部俯视机位' },
    ],
  },
  teams: {
    type: Array,
    default: () => [],
  },
  athletes: {
    type: Array,
    default: () => [],
  },
  selectedTeamId: {
    type: String,
    default: '',
  },
  selectedAthleteId: {
    type: String,
    default: '',
  },
  loadingTeams: {
    type: Boolean,
    default: false,
  },
  loadingAthletes: {
    type: Boolean,
    default: false,
  },
  collapsible: {
    type: Boolean,
    default: false,
  },
  collapsed: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'camera', 'pause', 'record', 'select-style', 'toggle-collapse',
  'update:poolLength', 'update:trainingTarget', 'update:cameraType',
  'update:teamId', 'update:athleteId', 'load-athletes',
])

const STROKE_OPTIONS = ['自由泳', '蛙泳', '仰泳', '蝶泳']

const showRecordParams = computed(() => props.analysisMode === 'camera' && !props.isRecording)
</script>

<template>
  <section class="bottom-panel" :class="{ collapsible, collapsed: collapsible && collapsed }">
    <div v-if="collapsible" class="bottom-panel-header">
      <div class="bottom-panel-header-copy">
        <strong>参数面板</strong>
        <span>实时控制与配置</span>
      </div>
      <button class="bottom-panel-toggle-btn" @click="emit('toggle-collapse')">
        {{ collapsed ? '展开' : '收起' }}
      </button>
    </div>

    <div v-if="!collapsed" class="bp-bar">
      <!-- 队伍/学员 -->
      <div class="bp-group">
        <span class="bp-tag">队伍</span>
        <ElSelect
          class="bp-select team-select"
          :model-value="selectedTeamId"
          :disabled="loadingTeams"
          :loading="loadingTeams"
          placeholder="请选择队伍"
          @update:model-value="emit('update:teamId', $event || '')"
        >
          <ElOption v-for="team in teams" :key="team._teamId" :value="team._teamId" :label="team._teamName" />
        </ElSelect>
      </div>
      <div class="bp-group">
        <span class="bp-tag">学员</span>
        <ElSelect
          class="bp-select athlete-select"
          :model-value="selectedAthleteId"
          :disabled="loadingAthletes || !selectedTeamId"
          :loading="loadingAthletes"
          placeholder="请选择学员"
          @update:model-value="emit('update:athleteId', $event || '')"
        >
          <ElOption v-for="a in athletes" :key="a._athleteId" :value="a._athleteId" :label="a._athleteName" />
        </ElSelect>
      </div>

      <div class="bp-divider" />

      <!-- 泳姿 -->
      <div class="bp-group">
        <span class="bp-tag">泳姿</span>
        <ElSelect
          class="bp-select stroke-select"
          :model-value="selectedSwimStyle"
          placeholder="选择泳姿"
          @update:model-value="emit('select-style', $event || '')"
        >
          <ElOption v-for="s in STROKE_OPTIONS" :key="s" :value="s" :label="s" />
        </ElSelect>
      </div>

      <!-- 录制参数（摄像头模式 + 未录制） -->
      <template v-if="showRecordParams">
        <div class="bp-divider" />
        <div class="bp-group">
          <span class="bp-tag">泳池</span>
          <ElSelect
            class="bp-select pool-select"
            :model-value="poolLength"
            @update:model-value="emit('update:poolLength', Number($event || 25))"
          >
            <ElOption v-for="p in poolLengthOptions" :key="p.value" :value="p.value" :label="p.label" />
          </ElSelect>
        </div>
        <div class="bp-group">
          <span class="bp-tag">机位</span>
          <ElSelect
            class="bp-select camera-select"
            :model-value="cameraType"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择机位"
            @update:model-value="emit('update:cameraType', $event || [])"
          >
            <ElOption v-for="c in cameraTypeOptions" :key="c.value" :value="c.value" :label="c.label" />
          </ElSelect>
        </div>
        <div class="bp-group">
          <span class="bp-tag">目标</span>
          <ElSelect
            class="bp-select target-select"
            :model-value="trainingTarget"
            placeholder="请选择目标"
            @update:model-value="emit('update:trainingTarget', $event || '')"
          >
            <ElOption v-for="t in trainingTargetOptions" :key="t" :value="t" :label="t" />
          </ElSelect>
        </div>
      </template>

    </div>

  </section>
</template>
