<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { BrowserProfile } from '../env'

const props = defineProps<{
  visible: boolean
  editProfile?: BrowserProfile | null
}>()

const emit = defineEmits<{
  close: []
  saved: [profile: BrowserProfile]
}>()

// 模板值（来自 bot.sannysoft.com 检测数据）
const template = ref<BrowserProfile | null>(null)

// 表单输入项（为空时将回退使用模板值）
const formName = ref('')
const formUA = ref('')
const formPlatform = ref('')
const formLanguages = ref('')
const formCPU = ref<number | ''>('')
const formMemory = ref<number | ''>('')
const formScreenWidth = ref<number | ''>('')
const formScreenHeight = ref<number | ''>('')
const formScreenAvailWidth = ref<number | ''>('')
const formScreenAvailHeight = ref<number | ''>('')
const formColorDepth = ref<number | ''>('')
const formPixelRatio = ref<number | ''>('')
const formWebGLVendor = ref('')
const formWebGLRenderer = ref('')
const formSpeakers = ref<number | ''>('')
const formMicros = ref<number | ''>('')
const formWebcams = ref<number | ''>('')

const isSaving = ref(false)
const saveError = ref('')

onMounted(async () => {
  try {
    template.value = await window.watrApi.getProfileTemplate()
    initForm()
  } catch (e) {
    console.error('Failed to load profile template', e)
  }
})

function initForm() {
  if (props.editProfile && !props.editProfile.isBuiltin) {
    const p = props.editProfile
    formName.value = p.name
    formUA.value = p.userAgent
    formPlatform.value = p.platform
    formLanguages.value = p.languages.join(',')
    formCPU.value = p.hardwareConcurrency || ''
    formMemory.value = p.deviceMemory || ''
    formScreenWidth.value = p.screen.width || ''
    formScreenHeight.value = p.screen.height || ''
    formScreenAvailWidth.value = p.screen.availWidth || ''
    formScreenAvailHeight.value = p.screen.availHeight || ''
    formColorDepth.value = p.screen.colorDepth || ''
    formPixelRatio.value = p.screen.devicePixelRatio || ''
    formWebGLVendor.value = p.webgl.vendor || ''
    formWebGLRenderer.value = p.webgl.renderer || ''
    formSpeakers.value = p.mediaDevices.speakers || ''
    formMicros.value = p.mediaDevices.micros || ''
    formWebcams.value = p.mediaDevices.webcams || ''
  } else {
    formName.value = '自定义环境_' + new Date().toLocaleDateString().replace(/\//g, '')
    // 留空以展示灰色底层的模板值
    formUA.value = ''
    formPlatform.value = ''
    formLanguages.value = ''
    formCPU.value = ''
    formMemory.value = ''
    formScreenWidth.value = ''
    formScreenHeight.value = ''
    formScreenAvailWidth.value = ''
    formScreenAvailHeight.value = ''
    formColorDepth.value = ''
    formPixelRatio.value = ''
    formWebGLVendor.value = ''
    formWebGLRenderer.value = ''
    formSpeakers.value = ''
    formMicros.value = ''
    formWebcams.value = ''
  }
}

// 保存 Profile：如果输入为空，自动使用模板值保存
async function handleSave() {
  if (!template.value) return
  isSaving.value = true
  saveError.value = ''

  try {
    const t = template.value
    const profilePayload = {
      name: formName.value.trim() || '未命名环境',
      userAgent: formUA.value.trim() || t.userAgent,
      platform: formPlatform.value.trim() || t.platform,
      languages: formLanguages.value.trim()
        ? formLanguages.value.split(',').map(s => s.trim()).filter(Boolean)
        : [...t.languages],
      hardwareConcurrency: formCPU.value !== '' ? Number(formCPU.value) : t.hardwareConcurrency,
      deviceMemory: formMemory.value !== '' ? Number(formMemory.value) : t.deviceMemory,
      screen: {
        width: formScreenWidth.value !== '' ? Number(formScreenWidth.value) : t.screen.width,
        height: formScreenHeight.value !== '' ? Number(formScreenHeight.value) : t.screen.height,
        availWidth: formScreenAvailWidth.value !== '' ? Number(formScreenAvailWidth.value) : t.screen.availWidth,
        availHeight: formScreenAvailHeight.value !== '' ? Number(formScreenAvailHeight.value) : t.screen.availHeight,
        colorDepth: formColorDepth.value !== '' ? Number(formColorDepth.value) : t.screen.colorDepth,
        pixelDepth: formColorDepth.value !== '' ? Number(formColorDepth.value) : t.screen.pixelDepth,
        devicePixelRatio: formPixelRatio.value !== '' ? Number(formPixelRatio.value) : t.screen.devicePixelRatio
      },
      webgl: {
        vendor: formWebGLVendor.value.trim() || t.webgl.vendor,
        renderer: formWebGLRenderer.value.trim() || t.webgl.renderer
      },
      mediaDevices: {
        speakers: formSpeakers.value !== '' ? Number(formSpeakers.value) : t.mediaDevices.speakers,
        micros: formMicros.value !== '' ? Number(formMicros.value) : t.mediaDevices.micros,
        webcams: formWebcams.value !== '' ? Number(formWebcams.value) : t.mediaDevices.webcams
      }
    }

    let savedProfile: BrowserProfile
    if (props.editProfile && !props.editProfile.isBuiltin) {
      const res = await window.watrApi.updateProfile(props.editProfile.id, profilePayload)
      if (res.success && res.profile) {
        savedProfile = res.profile
      } else {
        throw new Error('更新失败')
      }
    } else {
      const res = await window.watrApi.createProfile(profilePayload)
      if (res.success && res.profile) {
        savedProfile = res.profile
      } else {
        throw new Error('创建失败')
      }
    }

    emit('saved', savedProfile)
    emit('close')
  } catch (err: any) {
    saveError.value = err.message || '保存失败'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="profile-modal-backdrop" @click.self="emit('close')">
    <div class="profile-modal card fade-in-up">
      <!-- 模态框头部 -->
      <div class="profile-modal__header">
        <div class="profile-modal__title-box">
          <span class="profile-modal__icon">🌐</span>
          <div>
            <h2 class="profile-modal__title">
              {{ editProfile ? '编辑浏览器环境配置' : '添加新的浏览器环境配置' }}
            </h2>
            <p class="profile-modal__subtitle">
              定制硬件层与指纹参数。文本框留空将自动采用灰色底层的 Win10 标准真机模板值。
            </p>
          </div>
        </div>
        <button class="btn btn--icon" @click="emit('close')">✕</button>
      </div>

      <!-- 模态框主体内容 -->
      <div class="profile-modal__body" v-if="template">
        <!-- 基础配置 -->
        <div class="section-title">
          <span>📌 基础环境标识</span>
        </div>
        <div class="form-grid">
          <div class="form-item">
            <label class="form-label">环境名称 <span class="required">*</span></label>
            <input
              v-model="formName"
              type="text"
              class="input"
              placeholder="例如：Win10 独立营销环境"
            />
          </div>

          <div class="form-item">
            <label class="form-label">操作系统平台 (navigator.platform)</label>
            <input
              v-model="formPlatform"
              type="text"
              class="input"
              :placeholder="template.platform"
            />
          </div>

          <div class="form-item form-item--full">
            <label class="form-label">浏览器标识 (User-Agent)</label>
            <input
              v-model="formUA"
              type="text"
              class="input"
              :placeholder="template.userAgent"
            />
          </div>

          <div class="form-item form-item--full">
            <label class="form-label">语言偏好 (navigator.languages，逗号分隔)</label>
            <input
              v-model="formLanguages"
              type="text"
              class="input"
              :placeholder="template.languages.join(', ')"
            />
          </div>
        </div>

        <!-- 硬件与计算规格 -->
        <div class="section-title">
          <span>💻 硬件计算与屏幕规格</span>
        </div>
        <div class="form-grid">
          <div class="form-item">
            <label class="form-label">CPU 核心数 (hardwareConcurrency)</label>
            <input
              v-model.number="formCPU"
              type="number"
              class="input"
              :placeholder="String(template.hardwareConcurrency)"
            />
          </div>

          <div class="form-item">
            <label class="form-label">运行内存 (deviceMemory, GB)</label>
            <input
              v-model.number="formMemory"
              type="number"
              class="input"
              :placeholder="String(template.deviceMemory)"
            />
          </div>

          <div class="form-item">
            <label class="form-label">屏幕分辨率 (宽 × 高)</label>
            <div class="input-row">
              <input
                v-model.number="formScreenWidth"
                type="number"
                class="input"
                :placeholder="String(template.screen.width)"
              />
              <span class="sep">×</span>
              <input
                v-model.number="formScreenHeight"
                type="number"
                class="input"
                :placeholder="String(template.screen.height)"
              />
            </div>
          </div>

          <div class="form-item">
            <label class="form-label">可用工作区 (宽 × 高)</label>
            <div class="input-row">
              <input
                v-model.number="formScreenAvailWidth"
                type="number"
                class="input"
                :placeholder="String(template.screen.availWidth)"
              />
              <span class="sep">×</span>
              <input
                v-model.number="formScreenAvailHeight"
                type="number"
                class="input"
                :placeholder="String(template.screen.availHeight)"
              />
            </div>
          </div>

          <div class="form-item">
            <label class="form-label">色彩深度 (screen.colorDepth)</label>
            <input
              v-model.number="formColorDepth"
              type="number"
              class="input"
              :placeholder="String(template.screen.colorDepth)"
            />
          </div>

          <div class="form-item">
            <label class="form-label">像素比率 (devicePixelRatio)</label>
            <input
              v-model.number="formPixelRatio"
              type="number"
              class="input"
              :placeholder="String(template.screen.devicePixelRatio)"
            />
          </div>
        </div>

        <!-- 显卡与渲染 (WebGL) -->
        <div class="section-title">
          <span>🎮 显卡渲染器 (WebGL 硬件层)</span>
        </div>
        <div class="form-grid">
          <div class="form-item">
            <label class="form-label">WebGL 供应商 (Vendor)</label>
            <input
              v-model="formWebGLVendor"
              type="text"
              class="input"
              :placeholder="template.webgl.vendor"
            />
          </div>

          <div class="form-item">
            <label class="form-label">音频设备 / 麦克风 / 摄像头数量</label>
            <div class="input-row">
              <input
                v-model.number="formSpeakers"
                type="number"
                class="input"
                :placeholder="'扬声器:' + template.mediaDevices.speakers"
                title="扬声器数量"
              />
              <input
                v-model.number="formMicros"
                type="number"
                class="input"
                :placeholder="'麦克风:' + template.mediaDevices.micros"
                title="麦克风数量"
              />
              <input
                v-model.number="formWebcams"
                type="number"
                class="input"
                :placeholder="'摄像头:' + template.mediaDevices.webcams"
                title="摄像头数量"
              />
            </div>
          </div>

          <div class="form-item form-item--full">
            <label class="form-label">WebGL 渲染器型号 (Renderer)</label>
            <input
              v-model="formWebGLRenderer"
              type="text"
              class="input"
              :placeholder="template.webgl.renderer"
            />
          </div>
        </div>

        <!-- 自动变更与微噪注入（只读保护类目） -->
        <div class="section-title section-title--locked">
          <span>🔒 自动随机变更项（每次启动/切换自动生成，禁止手动篡改）</span>
        </div>
        <div class="locked-card">
          <div class="locked-item">
            <div class="locked-item__header">
              <span class="locked-badge">⚡ 动态生成</span>
              <span class="locked-name">Canvas 绘制指纹 (2D 像素微噪注入)</span>
            </div>
            <p class="locked-desc">
              在像素导出时注入人眼不可见的 ±1 bit 数学抖动。每次启动生成全网独一无二的全新 Canvas 绘制哈希，100% 不破坏验证码与图表渲染。
            </p>
          </div>

          <div class="locked-item">
            <div class="locked-item__header">
              <span class="locked-badge">⚡ 动态生成</span>
              <span class="locked-name">AudioContext 音频采样指纹 (频域振幅偏移)</span>
            </div>
            <p class="locked-desc">
              拦截音频上下文频域分析器，注入微小振幅扰动因子，彻底改变浏览器音频特征值。
            </p>
          </div>

          <div class="locked-item">
            <div class="locked-item__header">
              <span class="locked-badge">⚡ 动态生成</span>
              <span class="locked-name">字体测量度量 (Font Metrics Jitter)</span>
            </div>
            <p class="locked-desc">
              对字符测量结果注入随机微量抖动，防止通过探测字符渲染宽高枚举本地字体库。
            </p>
          </div>
        </div>
      </div>

      <!-- 模态框底部操作栏 -->
      <div class="profile-modal__footer">
        <span v-if="saveError" class="error-msg">{{ saveError }}</span>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn--primary" :disabled="isSaving" @click="handleSave">
          {{ isSaving ? '正在保存...' : '💾 保存环境配置' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(10, 10, 20, 0.75);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-lg);
}

.profile-modal {
  width: 820px;
  max-width: 95vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-active);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px var(--accent-glow);
  overflow: hidden;
}

.profile-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-lg);
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
}

.profile-modal__title-box {
  display: flex;
  align-items: center;
  gap: var(--sp-md);
}

.profile-modal__icon {
  font-size: 28px;
}

.profile-modal__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.profile-modal__subtitle {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.profile-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-lg);
  display: flex;
  flex-direction: column;
  gap: var(--sp-lg);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-accent);
  padding-bottom: var(--sp-xs);
  border-bottom: 1px dashed var(--border);
}

.section-title--locked {
  color: #f59e0b;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-md);
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
}

.form-item--full {
  grid-column: 1 / -1;
}

.form-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

.required {
  color: var(--danger);
}

.input-row {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
}

.sep {
  color: var(--text-muted);
  font-size: 12px;
}

/* 锁定/自动变更区域 */
.locked-card {
  background: rgba(245, 158, 11, 0.05);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-md);
  padding: var(--sp-md);
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
}

.locked-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.locked-item__header {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
}

.locked-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border-radius: 4px;
  font-weight: 600;
}

.locked-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.locked-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* 模态框底部 */
.profile-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-md);
  padding: var(--sp-md) var(--sp-lg);
  border-top: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
}

.error-msg {
  font-size: 11px;
  color: var(--danger);
  margin-right: auto;
}
</style>
