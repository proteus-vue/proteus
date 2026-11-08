/**
 * fileOps.ts —— 文件树「新建 / 重命名 / 删除」的前端编排（决策 #1460）
 *
 * 【分工】Rust（`fs_ops.rs`）只管**磁盘**与**路径沙箱**；这里管**用户意图**：
 *   输入名字 → 校验 → 二次确认（写盘不可撤销）→ 保护已打开的标签 → 刷树 → 回执。
 *   `FileTree.vue` 只负责发一个 `{kind, path, dir, x, y}`，不碰 IPC。
 *
 * 【★为什么「已打开标签」一律拒绝，而不是自动改路径】重命名/删除之后，编辑器里还挂着
 *   旧路径的 EditorState、undo 历史、tsserver 文档与诊断缓存。自动改路径要同步四处状态，
 *   任何一处漏掉就是「编辑器显示的是 A，保存却写到 B」。第一版宁可**明确拒绝 + 提示关标签**
 *   （与 #1444 跨文件重命名的「整体拒绝」同一条纪律），也不做半套。
 *
 * 【ROOTS 单一真源】原来这个常量长在 `CodePanel.vue` 里；新建必须落在这些子树内，
 *   否则用户会在树上看不见刚建的文件 ⇒ 抽到这里，`CodePanel` 反向 import。
 */
import { readonly, ref } from 'vue'
import { ask } from './confirm'
import { pushToast as toast0 } from './toast'
import { createDir, createFile, deletePath, renamePath } from './bridge'

/** 统一收成 void：`runFileOp` 是 `Promise<void>`，`return pushToast(...)` 会把 number 带进返回类型。 */
const pushToast = (msg: string): void => { toast0(msg) }

/** 文件树扫描的子树（Studio 自己的源码）。★改这里 = 改文件树，别在别处复制一份。 */
export const ROOTS = ['packages/studio/ui/src', 'packages/studio/src', 'packages/studio/native'] as const

export type FileOpKind = 'createFile' | 'createDir' | 'rename' | 'delete'

export interface FileOp {
  kind: FileOpKind
  /** 右键命中的节点路径 */
  path: string
  /** 命中节点是不是目录 */
  dir: boolean
  /** 鼠标锚点（输入框浮层定位用） */
  x: number
  y: number
}

interface FileOpsDeps {
  /** 当前打开的标签路径（拒绝重命名/删除的依据） */
  openPaths: () => string[]
  /** 重新列文件树 */
  refresh: () => void
}

let deps: FileOpsDeps | null = null

export function installFileOps(d: FileOpsDeps): void {
  deps = d
}

/* ── 名字输入浮层（Promise 桥，与 chooser / rename 同形态）───────────────── */
export interface NameAsk {
  title: string
  initial: string
  x: number
  y: number
}

const askState = ref<NameAsk | null>(null)
export const nameAsk = readonly(askState)
let resolveName: ((v: string | null) => void) | null = null

function askFileName(a: NameAsk): Promise<string | null> {
  // 同一时刻只允许一个输入框：前一个当作取消（否则两个 Promise 都挂着）
  resolveName?.(null)
  return new Promise((resolve) => {
    resolveName = resolve
    askState.value = a
  })
}

export function settleName(v: string | null): void {
  askState.value = null
  const fn = resolveName
  resolveName = null
  fn?.(v)
}

/* ── 纯函数（可单测，不碰 DOM / IPC）────────────────────────────────────── */
export function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** `path` 是否就是 `dir` 或落在它下面（目录操作的影响面） */
export function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

/** 返回错误文案；空串 = 合法。★这里是提示层，真正的安全边界在 Rust 侧。 */
export function validName(name: string): string {
  const v = name.trim()
  if (!v) return '名字不能为空'
  if (v === '.' || v === '..') return '名字不能是 . 或 ..'
  if (/[\\/]/.test(v)) return '名字不能包含路径分隔符'
  if (/[\x00-\x1f]/.test(v)) return '名字不能包含控制字符'
  return ''
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */
export async function runFileOp(op: FileOp): Promise<void> {
  const d = deps
  if (!d) return
  try {
    if (op.kind === 'createFile' || op.kind === 'createDir') {
      const base = op.dir ? op.path : parentDir(op.path)
      const name = await askFileName({
        title: op.kind === 'createFile' ? `新建文件 · ${base || '根目录'}` : `新建文件夹 · ${base || '根目录'}`,
        initial: '',
        x: op.x,
        y: op.y,
      })
      if (name === null) return
      const bad = validName(name)
      if (bad) return pushToast(bad)
      // ★提示层也要挡扩展名：让用户当场知道原因，而不是等 Rust 报错
      if (op.kind === 'createFile' && !/\.[A-Za-z0-9]+$/.test(name)) {
        return pushToast('新建文件需要扩展名（如 new.vue）')
      }
      const target = joinPath(base, name.trim())
      if (op.kind === 'createFile') await createFile(target)
      else await createDir(target)
      d.refresh()
      pushToast(`已创建 ${target}`)
      return
    }

    /* ★受影响面 = 文件本身，或目录下的所有后代。有任一标签打开 ⇒ 整体拒绝。 */
    const affected = op.dir
      ? (p: string) => under(p, op.path)
      : (p: string) => p === op.path
    const blocked = d.openPaths().filter(affected)
    if (blocked.length) {
      pushToast(`请先关闭相关标签（${blocked.length} 个）再操作：${blocked[0]}`)
      return
    }

    if (op.kind === 'rename') {
      const oldName = op.path.slice(op.path.lastIndexOf('/') + 1)
      const next = await askFileName({
        title: `重命名 · ${oldName}`,
        initial: oldName,
        x: op.x,
        y: op.y,
      })
      if (next === null) return
      const bad = validName(next)
      if (bad) return pushToast(bad)
      const v = next.trim()
      if (v === oldName) return
      const target = joinPath(parentDir(op.path), v)
      const r = await ask({
        title: '重命名（写盘不可撤销）',
        body: `${op.path} → ${target}`,
        actions: [
          { id: 'cancel', label: '取消', kind: 'cancel' },
          { id: 'ok', label: '重命名', kind: 'danger' },
        ],
      })
      if (r !== 'ok') return
      await renamePath(op.path, target)
      d.refresh()
      pushToast(`已重命名为 ${target}`)
      return
    }

    const r = await ask({
      title: op.dir ? '删除空文件夹（不可撤销）' : '删除文件（不可撤销）',
      body: op.dir
        ? `${op.path}\n只允许删除空文件夹；非空会被拒绝。`
        : `${op.path}\n删除后无法恢复，请确认没有未提交的改动。`,
      actions: [
        { id: 'cancel', label: '取消', kind: 'cancel' },
        { id: 'ok', label: '删除', kind: 'danger' },
      ],
    })
    if (r !== 'ok') return
    await deletePath(op.path)
    d.refresh()
    pushToast(`已删除 ${op.path}`)
  } catch (e) {
    pushToast(`操作失败：${(e as Error)?.message ?? String(e)}`)
  }
}
