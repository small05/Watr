<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { StepData } from '../env'

const props = defineProps<{
  steps: StepData[]
  selectedIndex: number
}>()

const emit = defineEmits<{
  select: [step: StepData]
}>()

const timelineRef = ref<HTMLElement | null>(null)

// 新步骤添加时自动滚动到底部
watch(
  () => props.steps.length,
  async () => {
    await nextTick()
    if (timelineRef.value) {
      timelineRef.value.scrollTop = timelineRef.value.scrollHeight
    }
  }
)

// 动作类型 → Badge 样式映射
function getBadgeClass(actionType: string): string {
  if (actionType.includes('challenge')) return 'badge--challenge'
  if (actionType.includes('click')) return 'badge--click'
  if (actionType.includes('input') || actionType.includes('change')) return 'badge--input'
  if (actionType.includes('navigate') || actionType.includes('init')) return 'badge--navigate'
  if (actionType.includes('submit') || actionType.includes('enter')) return 'badge--submit'
  return 'badge--click'
}

function getBadgeText(actionType: string): string {
  const map: Record<string, string> = {
    click: '点击',
    input: '输入',
    change: '选择',
    submit: '提交',
    keydown_enter: '回车',
    navigate: '导航',
    init_navigate: '访问',
    challenge_detected: '验证盾',
    challenge_resolved: '已放行'
  }
  return map[actionType] || actionType
}
</script>

<template>
  <div class="timeline" ref="timelineRef">
    <div v-if="steps.length === 0" class="timeline__empty">
      <span class="timeline__empty-icon">📋</span>
      <span>开始录制后，操作步骤将在此实时显示</span>
    </div>

    <div
      v-for="step in steps"
      :key="step.stepIndex"
      class="step-card fade-in-up"
      :class="{ 'step-card--selected': step.stepIndex === selectedIndex }"
      @click="emit('select', step)"
    >
      <div class="step-card__header">
        <span class="step-card__index">
          {{ String(step.stepIndex).padStart(3, '0') }}
        </span>
        <span class="badge" :class="getBadgeClass(step.actionType)">
          {{ getBadgeText(step.actionType) }}
        </span>
        <span
          v-if="step.userNotes"
          class="badge badge--noted"
          title="已添加人工补充说明"
        >
          已注记
        </span>
      </div>
      <p class="step-card__desc">{{ step.description }}</p>
      <span class="step-card__time">
        {{ new Date(step.timestamp).toLocaleTimeString() }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
}

.timeline__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-sm);
  padding: var(--sp-2xl) var(--sp-lg);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.timeline__empty-icon {
  font-size: 28px;
  opacity: 0.5;
}

.step-card {
  padding: var(--sp-md);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.step-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-active);
}

.step-card--selected {
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-glow);
}

.step-card__header {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  margin-bottom: var(--sp-xs);
}

.step-card__index {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.step-card__desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.step-card__time {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: var(--sp-xs);
  display: block;
}
</style>
