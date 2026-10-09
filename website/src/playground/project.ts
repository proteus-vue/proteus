// website/src/playground/project.ts —— Playground「多文件项目」模型（决策 #700）
//
// 【为什么（用户「Playground 是否有条件升级为大厂那种标准 Playground」的第二档）】
//   大厂 Playground 第二根支柱 = **多文件 + 依赖**。单文件 SFC 撑不起"像真实工程"。本模块把编辑对象
//   从"一个字符串"升为"一棵虚拟文件树"，预览走 `build-project.ts`（多文件 ESM 模块链接 + 外部 ESM 依赖）。
//
// 【诚实边界】依赖走 **esm.sh**（外部 ESM CDN，非浏览器内 npm 安装）；`vue` 由**宿主单例**提供
//   （所有文件共享同一 Vue 运行时——否则多份 Vue 实例会崩）。
import { encodeSource, decodeSource } from './share'

/** 一个虚拟文件 */
export interface PlaygroundFile {
  content: string
}
/** 多文件项目（`entry` = 根组件路径） */
export interface PlaygroundProject {
  entry: string
  files: Record<string, PlaygroundFile>
}

/** 单文件 → 项目（向后兼容：分享/初始源码仍是单文件） */
export function singleFileProject(source: string, name = 'App.vue'): PlaygroundProject {
  return { entry: name, files: { [name]: { content: source } } }
}

/** 默认多文件示例（中/英）：App.vue 引子组件 + 工具模块 + **一个 npm 依赖（nanoid）** */
export function demoProject(isEn: boolean): PlaygroundProject {
  return {
    entry: 'App.vue',
    files: {
      'App.vue': {
        content: `<script setup>
import { ref } from 'vue'
import Counter from './components/Counter.vue'
import { label } from './lib/format.js'
import { nanoid } from 'nanoid'

const count = ref(0)
const id = nanoid(6)
</script>

<template>
  <p-view class="app">
    <p-heading :level="1">${isEn ? 'Multi-file Playground' : '多文件 Playground'}</p-heading>
    <p-text>build id: {{ label(id) }}</p-text>
    <Counter ${isEn ? 'label="clicks"' : 'label="点击数"'} @bump="count = $event" />
    <p-text>total: {{ count }}</p-text>
  </p-view>
</template>

<style scoped>
.app { padding: 20px; }
</style>
`,
      },
      'components/Counter.vue': {
        content: `<script setup>
import { ref } from 'vue'

const props = defineProps({ label: { type: String, default: 'count' } })
const emit = defineEmits(['bump'])
const n = ref(0)
function bump() {
  n.value++
  emit('bump', n.value)
}
</script>

<template>
  <p-stack class="counter">
    <p-text>{{ props.label }}: {{ n }}</p-text>
    <p-button @tap="bump">+1</p-button>
  </p-stack>
</template>

<style scoped>
.counter { border: 1px dashed #8b8b99; border-radius: 8px; padding: 10px; margin: 8px 0; }
</style>
`,
      },
      'lib/format.js': {
        content: `// 工具模块（跨文件 import 演示——相对路径解析）
export function label(n) {
  return '#' + String(n)
}
`,
      },
    },
  }
}

/** 项目 → 分享串（JSON → base64；复用 share 的 UTF-8 安全编码） */
export function encodeProject(p: PlaygroundProject): string {
  return encodeSource(JSON.stringify(p))
}
/** 分享串 → 项目（非法 ⇒ null，调用方回退默认） */
export function decodeProject(s: string): PlaygroundProject | null {
  try {
    const o = JSON.parse(decodeSource(s)) as PlaygroundProject
    if (!o || typeof o.entry !== 'string' || !o.files || typeof o.files !== 'object') return null
    for (const [k, v] of Object.entries(o.files)) {
      if (typeof k !== 'string' || !v || typeof (v as PlaygroundFile).content !== 'string') return null
    }
    return o
  } catch {
    return null
  }
}
