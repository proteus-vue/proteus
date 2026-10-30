// ui/src/fileTree.ts —— 目录树的**纯逻辑**（决策 #1247 从 CodePanel.vue 拆出）
//
// 【为什么单独成文件】原来建树/展平/折叠/展开祖先都长在 CodePanel.vue 里，而它是
//   "编辑器 + 标签 + 目录树 + Git 条" 四个职责混在一起的一个 1182 行组件 ——
//   越过 `check:file-size` 的 1000 行硬上限（门禁当场红了，见决策 #1247）。
//   这几件事**与 Vue 无关**（不碰 DOM、不持有响应式），拆出来既能单独测，
//   也让组件只负责"渲染 + 转发事件"。
//
// 【折叠状态的归属】`collapsed` 是**会话状态**（`ws.codeCollapsed`，落盘、重启恢复），
//   所以这里的函数接收它作为参数并**原地增删**——不自己存一份，避免两份状态漂移。

export interface TreeNode {
  name: string
  path: string
  dir: boolean
  children: TreeNode[]
}

/** 扁平路径列表 → 树。目录在前、文件在后，同级按名字（不区分大小写）——IDE 的通用排序。 */
export function buildTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const isLeaf = i === parts.length - 1
      let next = node.children.find((c) => c.name === name)
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), dir: !isLeaf, children: [] }
        node.children.push(next)
      }
      node = next
    }
  }
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    ns.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

/** 树 → 可见行（一次 v-for + 缩进，比递归组件少一层抽象；折叠的目录不展开） */
export function flatten(nodes: TreeNode[], collapsed: readonly string[]): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = []
  const walk = (ns: TreeNode[], depth: number) => {
    for (const n of ns) {
      out.push({ node: n, depth })
      if (n.dir && !collapsed.includes(n.path)) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

/** 展开/折叠一个目录（原地改会话状态里的数组） */
export function toggleCollapsed(dir: string, collapsed: string[]): void {
  const i = collapsed.indexOf(dir)
  if (i >= 0) collapsed.splice(i, 1)
  else collapsed.push(dir)
}

/** 打开文件时把它所在的所有祖先目录展开（否则文件被折叠在看不见的地方） */
export function revealPath(path: string, collapsed: string[]): void {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const j = collapsed.indexOf(parts.slice(0, i).join('/'))
    if (j >= 0) collapsed.splice(j, 1)
  }
}
