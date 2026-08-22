<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps<{
  state: string
  stepCount: number
  elapsedTime: number
}>()

const targetUrl = ref('')
const urlInputRef = ref<HTMLInputElement | null>(null)
const isPrivateMode = ref(false)
const clearStatus = ref('')

const formattedTime = computed(() => {
  const h = Math.floor(props.elapsedTime / 3600)
  const m = Math.floor((props.elapsedTime % 3600) / 60)
  const s = props.elapsedTime % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
})

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

/**
 * 【v1.1 修复】当状态变为 idle 时，自动聚焦 URL 输入框
 * 使用 v-show 替代 v-if，配合 watch + nextTick 确保焦点恢复
 */
watch(() => props.state, async (newState) => {
  if (newState === 'idle') {
    await nextTick()
    setTimeout(() => {
      urlInputRef.value?.focus()
    }, 150)
  }
})

// ---- 录制动作 ----
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
</script>

<template>
  <div class="control-bar">
    <!-- 品牌与状态 -->
    <div class="control-bar__header">
      <div class="brand">
        <span class="brand__icon">◉</span>
        <span class="brand__name">Watr</span>
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

    <!-- URL 输入（使用 v-show 代替 v-if，避免 DOM 重建导致焦点丢失） -->
    <div class="control-bar__url" v-show="isIdle">
      <input
        ref="urlInputRef"
        v-model="targetUrl"
        class="input"
        placeholder="输入目标网址，如 https://example.com"
        @keydown.enter="handleStart"
      />
    </div>

    <!-- 统计仪表 -->
    <div class="control-bar__stats" v-show="!isIdle">
      <div class="stat">
        <span class="stat__label">步骤</span>
        <span class="stat__value">{{ String(stepCount).padStart(2, '0') }}</span>
      </div>
      <div class="stat">
        <span class="stat__label">耗时</span>
        <span class="stat__value stat__value--mono">{{ formattedTime }}</span>
      </div>
    </div>

    <!-- 控制按钮 -->
    <div class="control-bar__actions">
      <button v-if="isIdle" class="btn btn--primary" @click="handleStart">
        ▶ 开始录制
      </button>

      <button v-if="isRecording" class="btn" @click="handlePause">
        ⏸ 暂停
      </button>

      <button v-if="isPaused" class="btn btn--primary" @click="handleResume">
        ▶ 继续
      </button>

      <button v-if="isRecording || isPaused" class="btn btn--success" @click="handleStop">
        ✓ 结束保存
      </button>

      <button v-if="isRecording || isPaused" class="btn btn--danger" @click="handleReset">
        ✕ 废弃
      </button>
    </div>

    <!-- 隐私与清除功能 -->
    <div class="control-bar__privacy">
      <button
        class="btn btn--sm"
        :class="{ 'btn--active': isPrivateMode }"
        @click="togglePrivacy"
        :title="isPrivateMode ? '退出隐私模式' : '开启隐私模式（不保存 Cookies）'"
      >
        {{ isPrivateMode ? '🔒 隐私模式' : '🔓 普通模式' }}
      </button>

      <button class="btn btn--sm" @click="handleClearData" title="清除 Cookies 和网站数据">
        🗑 清除数据
      </button>

      <span v-if="clearStatus" class="clear-status">{{ clearStatus }}</span>
    </div>
  </div>
</template>

<style scoped>
.control-bar {
  padding: var(--sp-md) var(--sp-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
}

.control-bar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
}

.brand__icon {
  font-size: 18px;
  color: var(--accent-primary);
  filter: drop-shadow(0 0 6px var(--accent-glow));
}

.brand__name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.status {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
}

.status--idle { background: var(--bg-glass); color: var(--text-muted); }
.status--recording { background: var(--danger-glow); color: var(--danger); }
.status--paused { background: var(--warning-glow); color: var(--warning); }
.status--saving { background: var(--success-glow); color: var(--success); }

.control-bar__url {
  margin-top: var(--sp-xs);
}

.control-bar__stats {
  display: flex;
  gap: var(--sp-xl);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat__label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat__value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat__value--mono {
  font-family: var(--font-mono);
  font-size: 18px;
}

.control-bar__actions {
  display: flex;
  gap: var(--sp-sm);
  flex-wrap: wrap;
}

.control-bar__privacy {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding-top: var(--sp-xs);
  border-top: 1px solid var(--border);
}

.btn--sm {
  padding: 4px 10px;
  font-size: 11px;
}

.btn--active {
  background: rgba(124, 58, 237, 0.2);
  border-color: var(--accent-primary);
  color: var(--text-accent);
}

.clear-status {
  font-size: 11px;
  color: var(--success);
  animation: fadeInUp 0.2s ease-out;
}
</style>
