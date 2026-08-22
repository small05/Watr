<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  state: string
}>()

const copyStatus = ref<string>('')

// ---- 一键复制为 AI 上下文 ----
async function handleCopyMarkdown() {
  try {
    const result = await window.watrApi.copyAsMarkdown()
    copyStatus.value = `已复制 ${result.length} 字符`
    setTimeout(() => { copyStatus.value = '' }, 3000)
  } catch {
    copyStatus.value = '复制失败'
  }
}

// ---- 打开输出目录 ----
async function handleOpenDir() {
  await window.watrApi.openOutputDirectory()
}
</script>

<template>
  <div class="export-panel">
    <div class="export-panel__row">
      <button
        class="btn"
        @click="handleCopyMarkdown"
        :disabled="state === 'idle'"
        title="将所有步骤格式化为 Markdown 并复制到剪贴板"
      >
        📋 一键复制为 AI 上下文
      </button>

      <button
        class="btn"
        @click="handleOpenDir"
        :disabled="state === 'idle'"
        title="在文件管理器中打开录制输出目录"
      >
        📁 打开输出目录
      </button>
    </div>

    <div v-if="copyStatus" class="export-panel__status">
      {{ copyStatus }}
    </div>
  </div>
</template>

<style scoped>
.export-panel {
  padding: var(--sp-sm) var(--sp-lg) var(--sp-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
}

.export-panel__row {
  display: flex;
  gap: var(--sp-sm);
  flex-wrap: wrap;
}

.export-panel__status {
  font-size: 11px;
  color: var(--success);
  padding: var(--sp-xs) 0;
  animation: fadeInUp 0.2s ease-out;
}
</style>
