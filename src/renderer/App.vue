<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { StepData } from './env'
import ControlBar from './components/ControlBar.vue'
import StepTimeline from './components/StepTimeline.vue'
import StepInspector from './components/StepInspector.vue'
import ExportPanel from './components/ExportPanel.vue'

// ---- 状态管理 ----
const recordingState = ref<string>('idle')
const steps = ref<StepData[]>([])
const selectedStep = ref<StepData | null>(null)
const elapsedTime = ref(0)
let timerInterval: ReturnType<typeof setInterval> | null = null

// ---- 生命周期 ----
onMounted(() => {
  // 监听主进程推送的状态变更
  window.watrApi.onStateChanged((state: string) => {
    recordingState.value = state

    if (state === 'recording') {
      startTimer()
    } else {
      stopTimer()
    }
  })

  // 监听新步骤添加
  window.watrApi.onStepAdded((step: StepData) => {
    steps.value.push(step)
  })

  // 监听错误
  window.watrApi.onError((message: string) => {
    console.error('[Watr Error]', message)
  })

  // 初始化状态
  window.watrApi.getRecordingState().then((data) => {
    recordingState.value = data.state
    steps.value = data.steps
  })
})

// ---- 计时器 ----
function startTimer() {
  elapsedTime.value = 0
  timerInterval = setInterval(() => {
    elapsedTime.value++
  }, 1000)
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

// ---- 事件处理 ----
function handleStepSelect(step: StepData) {
  selectedStep.value = step
}

function handleStepDeselect() {
  selectedStep.value = null
}
</script>

<template>
  <div class="panel">
    <!-- 顶部：录制控制栏 -->
    <ControlBar
      :state="recordingState"
      :step-count="steps.length"
      :elapsed-time="elapsedTime"
    />

    <div class="divider" />

    <!-- 中部：步骤时间线 -->
    <div class="panel__body">
      <StepTimeline
        :steps="steps"
        :selected-index="selectedStep?.stepIndex ?? -1"
        @select="handleStepSelect"
      />
    </div>

    <!-- 中下部：步骤详情检查器 -->
    <StepInspector
      v-if="selectedStep"
      :step="selectedStep"
      @close="handleStepDeselect"
    />

    <div class="divider" />

    <!-- 底部：导出面板 -->
    <ExportPanel :state="recordingState" />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  overflow: hidden;
}

.panel__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-sm);
}
</style>
