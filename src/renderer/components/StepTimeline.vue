<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { StepData } from '../env'

const props = defineProps<{
  steps: StepData[]
  selectedIndex: number
  recordingState: string
}>()

const emit = defineEmits<{
  select: [step: StepData]
}>()

const timelineRef = ref<HTMLElement | null>(null)
/** 各分组的展开/折叠状态，key 为 hostname */
const collapsedGroups = ref<Record<string, boolean>>({})

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

// ---- 按 hostname 分组 ----
interface StepGroup {
  hostname: string
  displayName: string
  steps: StepData[]
}

const groupedSteps = computed((): StepGroup[] => {
  const groups: StepGroup[] = []
  let currentGroup: StepGroup | null = null

  for (const step of props.steps) {
    let hostname = ''
    try {
      hostname = new URL(step.pageUrl).hostname
    } catch {
      hostname = step.pageUrl || '空白页'
    }

    // 连续的相同 hostname 归入同一组
    if (!currentGroup || currentGroup.hostname !== hostname) {
      currentGroup = {
        hostname,
        displayName: hostname || '空白页',
        steps: []
      }
      groups.push(currentGroup)
    }

    currentGroup.steps.push(step)
  }

  return groups
})

// ---- 折叠/展开 ----
function toggleGroup(hostname: string) {
  collapsedGroups.value[hostname] = !collapsedGroups.value[hostname]
}

function isCollapsed(hostname: string): boolean {
  return !!collapsedGroups.value[hostname]
}

// ---- 动作类型标签 ----
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
    click: '点击', input: '输入', change: '选择', submit: '提交',
    keydown_enter: '回车', navigate: '导航', init_navigate: '访问',
    challenge_detected: '验证盾', challenge_resolved: '已放行'
  }
  return map[actionType] || actionType
}

// ---- 步骤管理 ----
async function handleDeleteStep(e: Event, stepIndex: number) {
  e.stopPropagation()
  if (confirm(`确定删除步骤 ${String(stepIndex).padStart(3, '0')} 吗？`)) {
    await window.watrApi.deleteStep(stepIndex)
  }
}

async function handleMoveUp(e: Event, step: StepData) {
  e.stopPropagation()
  if (step.stepIndex > 0) {
    await window.watrApi.swapSteps(step.stepIndex, step.stepIndex - 1)
  }
}

async function handleMoveDown(e: Event, step: StepData) {
  e.stopPropagation()
  if (step.stepIndex < props.steps.length - 1) {
    await window.watrApi.swapSteps(step.stepIndex, step.stepIndex + 1)
  }
}
</script>

<template>
  <div class="timeline" ref="timelineRef">
    <div v-if="steps.length === 0" class="timeline__empty">
      <span class="timeline__empty-icon">📋</span>
      <span>开始录制后，操作步骤将在此实时显示</span>
    </div>

    <!-- 按 hostname 分组渲染 -->
    <div
      v-for="(group, gi) in groupedSteps"
      :key="gi"
      class="step-group fade-in-up"
    >
      <!-- 分组头（点击折叠/展开） -->
      <div
        class="group-header"
        @click="toggleGroup(group.hostname)"
      >
        <span class="group-header__arrow" :class="{ 'group-header__arrow--collapsed': isCollapsed(group.hostname) }">
          ▾
        </span>
        <span class="group-header__icon">🌐</span>
        <span class="group-header__name">{{ group.displayName }}</span>
        <span class="group-header__count">{{ group.steps.length }} 步</span>
      </div>

      <!-- 分组内的步骤列表 -->
      <div v-show="!isCollapsed(group.hostname)" class="group-body">
        <div
          v-for="step in group.steps"
          :key="step.stepIndex"
          class="step-card"
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
            <span v-if="step.userNotes" class="badge badge--noted" title="已添加人工补充说明">
              已注记
            </span>

            <!-- 步骤管理按钮 -->
            <div class="step-card__actions">
              <button
                class="step-action-btn"
                title="上移"
                :disabled="step.stepIndex === 0"
                @click="handleMoveUp($event, step)"
              >↑</button>
              <button
                class="step-action-btn"
                title="下移"
                :disabled="step.stepIndex === steps.length - 1"
                @click="handleMoveDown($event, step)"
              >↓</button>
              <button
                class="step-action-btn step-action-btn--danger"
                title="删除此步骤"
                @click="handleDeleteStep($event, step.stepIndex)"
              >✕</button>
            </div>
          </div>
          <p class="step-card__desc">{{ step.description }}</p>
          <span class="step-card__time">
            {{ new Date(step.timestamp).toLocaleTimeString() }}
          </span>
        </div>
      </div>
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

/* ---- 分组 ---- */
.step-group {
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: var(--sp-sm) var(--sp-md);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.group-header:hover {
  background: rgba(255, 255, 255, 0.06);
}

.group-header__arrow {
  font-size: 10px;
  color: var(--text-muted);
  transition: transform var(--transition-fast);
}

.group-header__arrow--collapsed {
  transform: rotate(-90deg);
}

.group-header__icon {
  font-size: 13px;
}

.group-header__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-header__count {
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 8px;
  background: var(--bg-glass);
  border-radius: 100px;
}

.group-body {
  display: flex;
  flex-direction: column;
}

/* ---- 步骤卡片 ---- */
.step-card {
  padding: var(--sp-md);
  border-top: 1px solid var(--border);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.step-card:hover {
  background: var(--bg-card-hover);
}

.step-card--selected {
  background: rgba(124, 58, 237, 0.08);
  border-left: 3px solid var(--accent-primary);
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

.step-card__actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.step-card:hover .step-card__actions {
  opacity: 1;
}

.step-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.step-action-btn:hover {
  background: var(--bg-glass);
  color: var(--text-primary);
  border-color: var(--border-active);
}

.step-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.step-action-btn--danger:hover {
  background: var(--danger-glow);
  color: var(--danger);
  border-color: var(--danger);
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
