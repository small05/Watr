<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import type { BrowserProfile } from '../env'

const props = defineProps<{
  state: string
  stepCount: number
}>()

const emit = defineEmits<{
  openProfileEditor: [profile?: BrowserProfile | null]
}>()

const targetUrl = ref('')
const urlInputRef = ref<HTMLInputElement | null>(null)
const isPrivateMode = ref(false)
const clearStatus = ref('')

// 录制模式：'lite'（轻量，默认） | 'deep'（深度）
const recordingMode = ref<'lite' | 'deep'>('lite')
const snapshotStatus = ref('')

// Profile 列表与活动环境
const profiles = ref<BrowserProfile[]>([])
const activeProfileId = ref('native')

const stateLabels: Record<string, { text: string; class: string }> = {
  idle: { text: '待机中', class: 'status--idle' },
  recording: { text: '正在录制', class: 'status--recording' },
  paused: { text: '已暂停', class: 'status--paused' },
  saving: { text: '正在保存', class: 'status--saving' }
}

const currentLabel = computed(
  () => stateLabels[props.state] || stateLabels.idle
)

const isIdle = computed(() => props.state === 'idle')
const isRecording = computed(() => props.state === 'recording')
const isPaused = computed(() => props.state === 'paused')

const currentProfile = computed(() => {
  return profiles.value.find(p => p.id === activeProfileId.value)
})

onMounted(async () => {
  await loadProfiles()
  try {
    const mode = await window.watrApi.getRecordingMode()
    recordingMode.value = mode || 'lite'
  } catch {}
})

async function loadProfiles() {
  try {
    profiles.value = await window.watrApi.listProfiles()
    const active = await window.watrApi.getActiveProfile()
    activeProfileId.value = active.id
  } catch (e) {
    console.error('Failed to load profiles', e)
  }
}

// 切换环境 Profile（仅在 idle 状态可用）
async function handleProfileChange() {
  if (!isIdle.value) return
  await window.watrApi.setActiveProfile(activeProfileId.value)
  await loadProfiles()
}

// 删除自定义环境
async function handleDeleteProfile() {
  if (!currentProfile.value || currentProfile.value.isBuiltin) return
  if (confirm(`确定要删除环境 "${currentProfile.value.name}" 吗？`)) {
    await window.watrApi.deleteProfile(activeProfileId.value)
    await loadProfiles()
  }
}

// 切换录制模式
async function handleModeToggle(mode: 'lite' | 'deep') {
  if (!isIdle.value) return
  recordingMode.value = mode
  await window.watrApi.setRecordingMode(mode)
}

// 手动捕获深度快照
async function handleDeepSnapshot() {
  if (!isRecording.value) return
  snapshotStatus.value = '正在捕获...'
  await window.watrApi.captureDeepSnapshot()
  snapshotStatus.value = '快照已保存'
  setTimeout(() => { snapshotStatus.value = '' }, 2000)
}

// 当状态变为 idle 时自动聚焦 URL 输入框
watch(() => props.state, async (newState) => {
  if (newState === 'idle') {
    await nextTick()
    setTimeout(() => {
      urlInputRef.value?.focus()
    }, 150)
  }
})

// ---- 录制控制 ----
async function handleStart() {
  let url = targetUrl.value.trim()
  if (url && !url.startsWith('http')) {
    url = 'https://' + url
  }
  await window.watrApi.startRecording(url)
}

async function handlePause() {
  await window.watrApi.pauseRecording()
}

async function handleResume() {
  await window.watrApi.resumeRecording()
}

async function handleStop() {
  await window.watrApi.stopRecording()
  targetUrl.value = ''
}

async function handleReset() {
  if (confirm('确定要废弃当前录制吗？所有数据和文件将被永久删除。')) {
    await window.watrApi.resetRecording()
    targetUrl.value = ''
  }
}

// ---- 隐私模式 ----
async function togglePrivacy() {
  isPrivateMode.value = !isPrivateMode.value
  if (isPrivateMode.value) {
    await window.watrApi.enablePrivacy()
  } else {
    await window.watrApi.disablePrivacy()
  }
}

async function handleClearData() {
  await window.watrApi.clearSessionData()
  clearStatus.value = '已清除'
  setTimeout(() => { clearStatus.value = '' }, 2000)
}

defineExpose({
  loadProfiles
})
</script>

<template>
  <div class="control-bar">
    <!-- 品牌与状态 -->
    <div class="control-bar__header">
      <div class="brand">
        <span class="brand__icon">◉</span>
        <span class="brand__name">Watr</span>
        <span class="brand__version">v1.2</span>
      </div>
      <div class="status" :class="currentLabel.class">
        <span
          class="recording-dot"
          :class="{ 'recording-dot--active': isRecording }"
          v-if="isRecording || isPaused"
        />
        <span class="status__text">{{ currentLabel.text }}</span>
      </div>
    </div>

    <!-- 录制模式切换 (轻量/深度) -->
    <div class="mode-selector">
      <span class="mode-selector__label">录制模式:</span>
      <div class="mode-selector__tabs">
        <button
          class="mode-btn"
          :class="{ 'mode-btn--active': recordingMode === 'lite' }"
          :disabled="!isIdle"
          title="轻量模式：完全不挂载 CDP 调试器，使用原生截图+DOM清洗，彻底规避 403 风控"
          @click="handleModeToggle('lite')"
        >
          🟢 轻量模式 (推荐)
        </button>
        <button
          class="mode-btn"
          :class="{ 'mode-btn--active': recordingMode === 'deep' }"
          :disabled="!isIdle"
          title="深度模式：生成完整 MHTML 离线快照，适合普通无强防爬网站"
          @click="handleModeToggle('deep')"
        >
          🔵 深度快照模式
        </button>
      </div>
    </div>

    <!-- 用户环境 Profile 选择器 -->
    <div class="profile-bar">
      <div class="profile-bar__header">
        <span class="profile-bar__label">🌐 用户环境:</span>
        <div class="profile-bar__actions">
          <button
            class="profile-action-btn"
            :disabled="!isIdle"
            title="添加新环境（自定义硬件与指纹）"
            @click="emit('openProfileEditor', null)"
          >
            ⊕ 新建
          </button>
          <button
            v-if="currentProfile && !currentProfile.isBuiltin"
            class="profile-action-btn profile-action-btn--danger"
            :disabled="!isIdle"
            title="删除当前自定义环境"
            @click="handleDeleteProfile"
          >
            🗑
          </button>
        </div>
      </div>

      <select
        v-model="activeProfileId"
        class="profile-select"
        :disabled="!isIdle"
        @change="handleProfileChange"
        title="选择浏览器硬件画像（仅空闲时可切换）"
      >
        <option
          v-for="p in profiles"
          :key="p.id"
          :value="p.id"
        >
          {{ p.name }} {{ p.isBuiltin ? '(内置)' : '' }}
        </option>
      </select>
    </div>

    <!-- 隐私模式 & 清除数据 -->
    <div class="privacy-bar">
      <button
        class="privacy-btn"
        :class="{ 'privacy-btn--active': isPrivateMode }"
        @click="togglePrivacy"
        title="开启后使用独立临时 Session，关闭后数据不留存"
      >
        <span class="privacy-btn__icon">{{ isPrivateMode ? '🔒' : '🔓' }}</span>
        <span>{{ isPrivateMode ? '隐私模式：开启' : '隐私模式：关闭' }}</span>
      </button>

      <button
        class="privacy-btn privacy-btn--clear"
        @click="handleClearData"
        title="清除当前浏览器视图的 Cookies、Storage 和网络缓存"
      >
        <span>{{ clearStatus || '🗑 清除数据' }}</span>
      </button>
    </div>

    <!-- URL 输入（v-show 保证焦点恢复） -->
    <div class="control-bar__url" v-show="isIdle">
      <input
        ref="urlInputRef"
        v-model="targetUrl"
        class="input"
        placeholder="输入目标网址，如 https://example.com"
        @keydown.enter="handleStart"
      />
    </div>

    <!-- 统计仪表（已移除耗时计时器，纯步骤计数） -->
    <div class="control-bar__metrics card">
      <div class="metric">
        <span class="metric__value">{{ stepCount }}</span>
        <span class="metric__label">已记录步骤</span>
      </div>
      <div class="metric">
        <span class="metric__value" style="font-size: 13px;">{{ recordingMode === 'lite' ? '轻量模式' : '深度模式' }}</span>
        <span class="metric__label">当前模式</span>
      </div>
    </div>

    <!-- 录制控制按钮组 -->
    <div class="control-bar__actions">
      <!-- 待机中：开始录制 -->
      <button
        v-if="isIdle"
        class="btn btn--primary btn--full"
        @click="handleStart"
      >
        <span class="btn__icon">⏺</span>
        <span>开始录制</span>
      </button>

      <!-- 录制中：暂停 / 停止 / 废弃 / 手动深度快照 -->
      <template v-if="isRecording">
        <div class="btn-group">
          <button class="btn btn--warning" @click="handlePause">
            <span class="btn__icon">⏸</span>
            <span>暂停</span>
          </button>
          <button class="btn btn--success" @click="handleStop">
            <span class="btn__icon">⏹</span>
            <span>完成保存</span>
          </button>
          <button class="btn btn--danger" @click="handleReset" title="废弃本次录制并删除文件">
            <span class="btn__icon">✕</span>
            <span>废弃</span>
          </button>
        </div>

        <!-- 轻量模式下的按需深度快照按钮 -->
        <button
          v-if="recordingMode === 'lite'"
          class="btn btn--sm btn--full"
          style="margin-top: 4px; font-size: 11px;"
          @click="handleDeepSnapshot"
          title="对当前页面临时执行一次 CDP 完整 MHTML 快照"
        >
          📸 {{ snapshotStatus || '按需单步深度快照' }}
        </button>
      </template>

      <!-- 已暂停：继续 / 停止 / 废弃 -->
      <template v-if="isPaused">
        <div class="btn-group">
          <button class="btn btn--primary" @click="handleResume">
            <span class="btn__icon">▶</span>
            <span>继续录制</span>
          </button>
          <button class="btn btn--success" @click="handleStop">
            <span class="btn__icon">⏹</span>
            <span>完成保存</span>
          </button>
          <button class="btn btn--danger" @click="handleReset" title="废弃本次录制并删除文件">
            <span class="btn__icon">✕</span>
            <span>废弃</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.control-bar {
  padding: var(--sp-md) var(--sp-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
}

.control-bar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
}

.brand__icon {
  font-size: 14px;
  color: var(--accent-primary);
}

.brand__name {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: -0.5px;
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand__version {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-glass);
  padding: 1px 5px;
  border-radius: 4px;
}

/* 录制模式选择器 */
.mode-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-xs);
  background: var(--bg-glass);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.mode-selector__label {
  font-size: 11px;
  color: var(--text-muted);
}

.mode-selector__tabs {
  display: flex;
  gap: 4px;
}

.mode-btn {
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.mode-btn--active {
  background: rgba(124, 58, 237, 0.15) !important;
  border-color: var(--accent-primary) !important;
  color: var(--text-primary) !important;
  font-weight: 600;
}

.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Profile 环境选择器 */
.profile-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-glass);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.profile-bar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-bar__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.profile-bar__actions {
  display: flex;
  gap: 4px;
}

.profile-action-btn {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-accent);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.profile-action-btn:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.1);
  border-color: var(--accent-primary);
}

.profile-action-btn--danger:hover:not(:disabled) {
  background: var(--danger-glow);
  color: var(--danger);
  border-color: var(--danger);
}

.profile-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.profile-select {
  width: 100%;
  padding: 4px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
  cursor: pointer;
}

.profile-select:focus {
  border-color: var(--border-active);
}

.profile-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 隐私模式条 */
.privacy-bar {
  display: flex;
  gap: var(--sp-xs);
}

.privacy-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-glass);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.privacy-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.privacy-btn--active {
  background: rgba(124, 58, 237, 0.15);
  border-color: var(--accent-primary);
  color: var(--text-accent);
  font-weight: 600;
}

.privacy-btn--clear {
  flex: 0 0 auto;
  font-size: 10px;
}

.privacy-btn--clear:hover {
  background: var(--danger-glow);
  color: var(--danger);
}

.privacy-btn__icon {
  font-size: 11px;
}

.control-bar__url {
  display: flex;
  gap: var(--sp-xs);
}

.control-bar__metrics {
  display: flex;
  padding: var(--sp-sm) var(--sp-md);
  justify-content: space-around;
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.metric__value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.metric__label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.control-bar__actions {
  display: flex;
  flex-direction: column;
}

.btn-group {
  display: flex;
  gap: var(--sp-xs);
}

.btn-group .btn {
  flex: 1;
}

.btn--full {
  width: 100%;
}
</style>
