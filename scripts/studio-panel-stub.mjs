// scripts/studio-panel-stub.mjs —— check:studio-panel 的 Tauri 桩（决策 #1223 拆分）
//
// 【为什么单独成文件】判据脚本本身也要过 file-size 门禁；而"值怎么送到页面"这一层
//   与"断言什么"是两件事：前者是**替身**，后者是**判据**。混在一个 1000+ 行的文件里，
//   改桩和改判据的人会互相踩。
//
// 【它是什么 / 不是什么】
//   · 是：Tauri `invoke` 的替身，把**真实跑机的读数**（fixture）喂给面板；
//   · 不是：对 Tauri 行为的模拟。`__TAURI__.event` **刻意不桩**——菜单走的是 DOM 兜底
//     （`studio:menu`），在这里假装有 event 只会让人以为原生事件通路被测过了。
//
// 【契约】`addInitScript` 会把这个函数的**源码**注入页面 ⇒ 不能引用任何外部变量，
//   需要的数据只能通过 `payload` 传进去（写成闭包会在页面里变成 undefined）。
export function stubTauri(payload) {
  const calls = []
  window.__STUB_CALLS__ = calls
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd === 'stats') return payload
        if (cmd === 'set_canvas_rect') return null
        // ★read_text 现在返回 {text, mtime_ms}：mtime 是"保存时冲突检测"的输入
        // ★桩内容**按文件类型**给：语法着色判据要真解析（Vue 的 <template> / Rust 的 fn / CSS 的
        //   `color:` / ObjC 的 `static`），把一段 JavaScript 塞给 .vue 解析器只会得到"整篇一个颜色"，
        //   那样 ⑲ 系列永远测不到东西（假绿）。VUE/RUST/TS 三份都含 `stubLine`，⑪/⑱ 的断言不变。
        if (cmd === 'read_text') {
          const p = String(args?.path ?? '')
          // ★大文件性能判据（㉑）用：置 localStorage.__BIG__=1 后只给一份 8000 行的 TS
          if (payload.big && window.localStorage.getItem('__BIG__') === '1')
            return { text: payload.big, mtime_us: 1700000000000000 }
          const VUE =
            '<template>\n  <div class="card">{{ total }}</div>\n</template>\n\n' +
            '<script setup lang="ts">\nconst stubLine = 1\nconst label = \'ok\'\n' +
            'export { stubLine, label }\n</script>\n'
          const RUST =
            'use std::fs;\n\nfn main() {\n    let stubLine = 1;\n    let second = 2;\n' +
            '    println!("{} {}", stubLine, second);\n}\n'
          const TS =
            'export const stubLine = 1\n\nconst label = \'ok\'\n\n' +
            'export function stubFn(): number {\n  return stubLine + 2\n}\n'
          const CSS = '.stub {\n  color: red;\n  width: 32px;\n}\n\n/* note */\n'
          const OBJC =
            '#import <Foundation/Foundation.h>\n\n// note\nstatic int stubLine = 1;\n\n' +
            'int main(void) {\n    return stubLine;\n}\n'
          const byExt = { '.vue': VUE, '.rs': RUST, '.ts': TS, '.css': CSS, '.m': OBJC }
          const ext = p.slice(p.lastIndexOf('.'))
          return { text: byExt[ext] ?? VUE, mtime_us: 1700000000000000 }
        }
        if (cmd === 'write_text') {
          // 模拟"磁盘上已被别人改过"：让前端把冲突如实显示出来（不谎称已保存）
          if (window.__FAIL_WRITE__) throw new Error('文件已被外部修改（磁盘 2 ≠ 打开时 1，可能是并发会话）⇒ 已拒绝覆盖')
          window.__LAST_WRITE__ = args
          return 1700000000000001
        }
        // ★文件列表也要桩：代码视图启动时先 list_files 再 default open
        // 搜索（决策 #1222）：只给两条固定命中。★行/列要能在 RUST 桩里对上号：
        //   RUST 桩第 4 行是 `    let stubLine = 1;`，`stubLine` 从第 9 个字符开始。
        if (cmd === 'search_text') {
          const q = String(args?.query ?? '')
          if (q.trim().length < 2) throw new Error('至少输入 2 个字符')
          // __NORG__=1 ⇒ 模拟"本机没装 ripgrep"，UI 必须如实显示引擎（内置扫描慢一个量级）
          const engine = window.localStorage.getItem('__NORG__') === '1' ? 'builtin' : 'rg'
          return {
            engine,
            truncated: false,
            hits: [
              { path: 'packages/studio/src/main.rs', line: 4, col: 9, text: '    let stubLine = 1;' },
              { path: 'packages/studio/ui/src/App.vue', line: 6, col: 7, text: "const stubLine = 1" },
            ],
          }
        }
        // 关闭拦截（决策 #1244）：前端同步脏数量 / 放行关闭
        if (cmd === 'set_dirty_count') return null
        if (cmd === 'close_now') return null
        // 剪贴板（决策 #1234）：右键菜单「复制相对路径」
        if (cmd === 'copy_text') return null
        if (cmd === 'list_files')
          return window.localStorage.getItem('__BIG__') === '1'
            ? ['packages/studio/big.ts']
            : [
                'packages/studio/ui/src/App.vue',
                'packages/studio/ui/src/bridge.ts',
                'packages/studio/ui/src/styles.css',
                'packages/studio/src/main.rs',
                'packages/studio/native/embed_view.m',
              ]
        // ★G5 会话状态：用 localStorage 模拟磁盘——这样 reload 后还能验「恢复上次视图」
        if (cmd === 'load_state') return localStorage.getItem('__stub_state__') ?? '{}'
        if (cmd === 'save_state') {
          localStorage.setItem('__saved_state__', String(args?.json ?? ''))
          return null
        }
        throw new Error('未实现：' + cmd)
      },
    },
  }
  // ★这里刻意**不再**桩 `__TAURI__.event.listen`：指针输入已经不在 Tauri 事件里走了
  //   （B1 那条原生 mouseDown 通路是死路，见 README「输入通路」）。留个桩只会让人以为它还在用。
}
