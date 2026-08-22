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
  window.watrApi.onStateChanged((state: string) => {
    recordingState.value = state
    if (state === 'recording') {
      startTimer()
    } else {
      stopTimer()
    }
    // 【v1.1】录制停止/废弃时清空选中
    if (state === 'idle') {
      selectedStep.value = null
    }
  })

  window.watrApi.onStepAdded((step: StepData) => {
    steps.value.push(step)
  })

  // 【v1.1 新增】步骤列表整体更新（删除/排序后触发）
  window.watrApi.onStepsUpdated((updatedSteps: StepData[]) => {
    steps.value = updatedSteps
    // 如果当前选中的步骤被删除，清空选中
    if (selectedStep.value) {
      const exists = updatedSteps.find(s => s.stepIndex === selectedStep.value!.stepIndex)
      if (!exists) {
        selectedStep.value = null
      }
    }
  })

  window.watrApi.onError((message: string) => {
    console.error('[Watr Error]', message)
  })

  window.watrApi.getRecordingState().then((data) => {
    recordingState.value = data.state
    steps.value = data.steps
  })
})

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
        :recording-state="recordingState"
        @select="handleStepSelect"
      />
    </div>

    <!-- 中下部：步骤详情检查器 -->
    <StepInspector
      v-if="selectedStep"
      :step="selectedStep"
      :recording-state="recordingState"
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
