<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { StepData, BrowserProfile } from './env'
import ControlBar from './components/ControlBar.vue'
import StepTimeline from './components/StepTimeline.vue'
import StepInspector from './components/StepInspector.vue'
import ExportPanel from './components/ExportPanel.vue'
import ProfileEditor from './components/ProfileEditor.vue'

// ---- 状态管理 ----
const recordingState = ref<string>('idle')
const steps = ref<StepData[]>([])
const selectedStep = ref<StepData | null>(null)
const controlBarRef = ref<any>(null)

// ---- Profile 编辑器状态 ----
const showProfileEditor = ref(false)
const editingProfile = ref<BrowserProfile | null>(null)

// ---- 生命周期 ----
onMounted(() => {
  window.watrApi.onStateChanged((state: string) => {
    recordingState.value = state
    if (state === 'idle') {
      selectedStep.value = null
    }
  })

  window.watrApi.onStepAdded((step: StepData) => {
    steps.value.push(step)
  })

  window.watrApi.onStepsUpdated((updatedSteps: StepData[]) => {
    steps.value = updatedSteps
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

function handleStepSelect(step: StepData) {
  selectedStep.value = step
}

function handleStepDeselect() {
  selectedStep.value = null
}

function handleOpenProfileEditor(profile?: BrowserProfile | null) {
  editingProfile.value = profile || null
  showProfileEditor.value = true
}

function handleProfileSaved(_profile: BrowserProfile) {
  controlBarRef.value?.loadProfiles()
}
</script>

<template>
  <div class="panel">
    <!-- 顶部：录制控制栏 -->
    <ControlBar
      ref="controlBarRef"
      :state="recordingState"
      :step-count="steps.length"
      @open-profile-editor="handleOpenProfileEditor"
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

    <!-- Profile 全屏配置模态框 -->
    <ProfileEditor
      :visible="showProfileEditor"
      :edit-profile="editingProfile"
      @close="showProfileEditor = false"
      @saved="handleProfileSaved"
    />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  overflow: hidden;
  position: relative;
}

.panel__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-sm);
}
</style>
