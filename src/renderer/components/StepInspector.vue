<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StepData } from '../env'

const props = defineProps<{
  step: StepData
  recordingState: string
}>()

const emit = defineEmits<{
  close: []
}>()

// ---- 用户注记编辑 ----
const userNotes = ref(props.step.userNotes || '')
let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.step.stepIndex,
  () => {
    userNotes.value = props.step.userNotes || ''
  }
)

function handleNotesInput() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveNotes()
  }, 1000)
}

function handleNotesBlur() {
  if (saveTimer) clearTimeout(saveTimer)
  saveNotes()
}

async function saveNotes() {
  await window.watrApi.updateStepNotes(props.step.stepIndex, userNotes.value)
}

// 选择器复制
async function copySelector(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch { /* fallback */ }
}

// ---- v1.1 新增：从此步骤后插入录制 ----
async function handleInsertAfter() {
  await window.watrApi.insertAfterStep(props.step.stepIndex)
}
</script>

<template>
  <div class="inspector card">
    <div class="inspector__header">
      <h3 class="inspector__title">
        步骤 {{ String(step.stepIndex).padStart(3, '0') }} 详情
      </h3>
      <div class="inspector__header-actions">
        <!-- 从此步骤后插入录制 -->
        <button
          v-if="recordingState === 'paused' || recordingState === 'idle'"
          class="btn btn--sm"
          @click="handleInsertAfter"
          title="从此步骤后恢复录制，新步骤将插入到此位置之后"
        >
          ⊕ 从此处插入
        </button>
        <button class="btn" @click="emit('close')" style="padding: 4px 8px;">✕</button>
      </div>
    </div>

    <!-- 选择器信息 -->
    <div class="inspector__section" v-if="step.targetElement">
      <div class="inspector__label">选择器（点击复制）</div>
      <div class="selector-list">
        <div class="selector-item" @click="copySelector(step.targetElement!.playwrightSelector)">
          <span class="selector-item__key">Playwright</span>
          <code class="selector-item__value">{{ step.targetElement.playwrightSelector }}</code>
        </div>
        <div class="selector-item" @click="copySelector(step.targetElement!.cssSelector)">
          <span class="selector-item__key">CSS</span>
          <code class="selector-item__value">{{ step.targetElement.cssSelector }}</code>
        </div>
        <div class="selector-item" @click="copySelector(step.targetElement!.xpath)">
          <span class="selector-item__key">XPath</span>
          <code class="selector-item__value">{{ step.targetElement.xpath }}</code>
        </div>
      </div>
    </div>

    <!-- 元素信息 -->
    <div class="inspector__section" v-if="step.targetElement">
      <div class="inspector__label">元素</div>
      <div class="inspector__meta">
        <span>{{ step.targetElement.tagName }}</span>
        <span v-if="step.targetElement.id">#{{ step.targetElement.id }}</span>
        <span v-if="step.targetElement.boundingBox" class="inspector__coords">
          {{ step.targetElement.boundingBox.x }}, {{ step.targetElement.boundingBox.y }}
          ({{ step.targetElement.boundingBox.width }}×{{ step.targetElement.boundingBox.height }})
        </span>
      </div>
    </div>

    <!-- 人工补充说明编辑区 -->
    <div class="inspector__section">
      <div class="inspector__label">✏️ 人工特殊补充说明</div>
      <textarea
        v-model="userNotes"
        class="textarea"
        placeholder="如果自动识别有遗漏，请在此补充业务说明，如：'点击了 Canvas 图表中的第三个柱子，需等待数据表格加载完成'"
        @input="handleNotesInput"
        @blur="handleNotesBlur"
      />
    </div>
  </div>
</template>

<style scoped>
.inspector {
  margin: 0 var(--sp-sm);
  padding: var(--sp-md);
  max-height: 280px;
  overflow-y: auto;
  animation: fadeInUp 0.2s ease-out;
}

.inspector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-md);
}

.inspector__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.inspector__header-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
}

.inspector__section {
  margin-bottom: var(--sp-md);
}

.inspector__label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--sp-xs);
}

.selector-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selector-item {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: 4px var(--sp-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.selector-item:hover {
  background: var(--bg-glass);
}

.selector-item__key {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-accent);
  min-width: 60px;
}

.selector-item__value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector__meta {
  display: flex;
  gap: var(--sp-sm);
  font-size: 11px;
  color: var(--text-secondary);
}

.inspector__coords {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.btn--sm {
  padding: 4px 10px;
  font-size: 11px;
}
</style>
