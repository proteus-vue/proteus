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
        if (cmd === 'stats') {
          // ★设备物理尺寸可覆盖（判据 ㊳）：localStorage.__DEV_SIZE__ = "1200x2608"
          const dv = window.localStorage.getItem('__DEV_SIZE__')
          // ★"没有画面"可覆盖（判据 ㊻）：iOS 引导卡只在 frames==0 时出现，
          //   而 fixture 是**有画面**的真实读数 ⇒ 必须能临时把 frames 归零。
          const noFrames = window.localStorage.getItem('__NO_FRAMES__') === '1'
          /* ★采集源可覆盖（判据 ㊽b）：localStorage.__SOURCE__ = "ios"
             —— 触控分派就是看这个字段，判据必须能把它切过去（决策 #1298）。 */
          const src = window.localStorage.getItem('__SOURCE__') || 'android'
          const base = { ...payload, source: src, ...(noFrames ? { frames: 0 } : {}) }
          if (dv) {
            const [w, h] = dv.split('x').map(Number)
            return { ...base, dev_w: w, dev_h: h }
          }
          return base
        }
        if (cmd === 'set_canvas_rect') return null
        // 开发环境设置（决策 #1266）：路径来自"用户填写"，桩只负责回显与验证
        if (cmd === 'open_settings') return null
        // 窗口级命令（决策 #1271）：拖拽 / 最大化。只记录，不需要真行为
        if (cmd === 'plugin:window|start_dragging' || cmd === 'plugin:window|internal_toggle_maximize') return null
        // 自动检测（决策 #1268）：两台 Xcode + 一个 adb，正好用来测"点选"与"取消不改"
        if (cmd === 'detect_tools')
          return {
            by_key: {
              'web.node': [{ path: '/opt/homebrew/bin/node', version: 'v22.22.2' }],
              'web.browser': [
                { path: '/Applications/Google Chrome.app', version: null },
                { path: '/Applications/Microsoft Edge.app', version: null },
              ],
              'android.studio': [{ path: '/Applications/Android Studio.app', version: null }],
              'android.adb': [
                { path: '/opt/homebrew/bin/adb', version: 'Android Debug Bridge version 1.0.41' },
              ],
              'ios.xcode': [
                { path: '/Volumes/data1/work/office-applications/Xcode.app', version: 'Xcode 26.5' },
                { path: '/Volumes/data1/applications/Xcode.app', version: 'Xcode 14.2' },
              ],
              'harmony.deveco': [],
              'mp.devtools': [],
            },
          }
        if (cmd === 'pick_tool') {
          // __PICK_CANCEL__=1 模拟"用户点了取消"
          if (window.localStorage.getItem('__PICK_CANCEL__') === '1') return null
          return args?.key === 'ios.xcode' ? '/Applications/Xcode-browse.app' : '/usr/local/bin/tool'
        }
        if (cmd === 'get_settings') return { paths: {}, ios_port: 9001 }
        if (cmd === 'save_settings') {
          window.__STUB_SETTINGS__ = args?.s
          return null
        }
        if (cmd === 'probe_tool') {
          if (window.localStorage.getItem('__PROBE_FAIL__') === '1')
            return {
              ok: false,
              detail: `${String(args?.path ?? '')}/Contents/Developer/usr/bin/xcodebuild 不存在 —— 请选 Xcode.app 本体的路径`,
            }
          return {
            ok: true,
            detail: args?.kind === 'xcode' ? 'Xcode 14.2' : 'Android Debug Bridge version 1.0.41',
          }
        }
        // 采集档位（决策 #1263）：桩返回"切成了什么"，判据据此断言 IPC 与界面同步
        // 设备管理（决策 #1265）：两台设备，第二台可切；__DEV_FAIL__ 模拟切换失败
        if (cmd === 'list_devices') {
          // 两台 Android（1 台未授权）+ 两台 iOS（1 台在线、1 台离线）——按平台分组的关键样本
          const cur = window.__STUB_DEV_CUR__ || 'd1aaaaaaaa'
          return [
            { platform: 'android', note: '', serial: 'd1aaaaaaaa', state: 'device', model: 'M098FE', size: '1200x2608', current: cur === 'd1aaaaaaaa' },
            { platform: 'android', note: '', serial: 'd2bbbbbbbb', state: 'device', model: 'Pixel 9', size: '1080x2424', current: cur === 'd2bbbbbbbb' },
            { platform: 'android', note: '', serial: 'd3cccccccc', state: 'unauthorized', model: '—', size: null, current: false },
            { platform: 'ios', note: '在手机上运行 ProteusHost 并开始直播后出画面（触控回传暂不支持）', serial: 'IOS-00008101', state: 'device', model: 'yunlai的iPhone · iOS 26.7.2', size: null, current: cur === 'IOS-00008101' },
            { platform: 'ios', note: '离线：用 USB 连接并在手机上点「信任此电脑」', serial: 'IOS-OFFLINE-02', state: 'offline', model: '旧 iPhone · iOS 17.0', size: null, current: false },
            /* ★模拟器行（决策 #1315）：之前桩里**没有 simulator**，于是"切换后选中态丢失"
               这个 bug 完全没有判据能抓到（它只在模拟器/真机上暴露）。 */
            { platform: 'simulator', note: '', serial: 'SIM-0000AAAA', state: 'device', model: 'iPhone 17 Pro · iOS 26.5', size: null, current: cur === 'SIM-0000AAAA' },
          ]
        }
        if (cmd === 'select_device') {
          /* ★可延迟（决策 #1315）：观察"切换中…"必须有足够长的窗口，
             否则桩瞬时返回，UI 的 busy 态一帧都看不到。 */
          if (window.localStorage.getItem('__SLOW_SELECT__') === '1') {
            await new Promise((r) => setTimeout(r, 700))
          }
          if (window.localStorage.getItem('__DEV_FAIL__') === '1')
            throw new Error('设备 d2bbbbbbbb 当前状态是 unauthorized，不能投屏（要先授权/唤醒）')
          window.__STUB_DEV_CUR__ = args?.serial
          // iOS 此刻没有尺寸（要等第一帧 SPS）⇒ 返回 0，界面显示「等待推流」
          if (String(args?.serial || '').startsWith('IOS-'))
            return { preset: 'ios', width: 0, height: 0, mbps: 0 }
          return { preset: 'standard', width: 1080, height: 2424, mbps: 13 }
        }
        if (cmd === 'capture_preset') {
          if (window.localStorage.getItem('__CAP_FAIL__') === '1')
            throw new Error('当前画面源不支持切换分辨率（只有 Android / adb 实时投屏可以）')
          const mbps = args?.preset === 'low' ? 4 : 13
          // 分辨率**不变**：这正是 #1264 的重点（改的是码率，不是几何）
          return { preset: args?.preset, width: 884, height: 1920, mbps }
        }
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
        /* 决策 #1462：格式化回包**不是手写 fixture** —— `checksFormat` 用
           `page.exposeFunction` 在 Node 侧真跑同一个 prettier CLI（参数从 Rust 的
           FORMAT_ARGS 常量读取），桩只做转发。真 CLI 报错也原样 reject 给前端。 */
        if (cmd === 'format_text')
          return await window.__formatWithPrettier(String(args?.path ?? ''), String(args?.text ?? ''))
        /* ★决策 #1474：文件树悬停预览的数据源。
           ★桩数据**按文件名区分**（App.vue/main.rs 行数不同）——判据要能证明
             "卡片显示的是当前悬停那一项"，而不是"卡片上恰好有个数字"。
             全都返回 42 的话，悬停哪个文件都看不出差别，那种判据等于没测。 */
        /* 结构大纲（决策 #1481）：桥接文件给 5 条（含 interface/type/function/const 四类，
           其中 2 条非导出 ⇒ 分组与"内部实现淡一档"都能判）。其他文件只给 1 条，
           ★按路径区分是为了能验"面板列的是当前文件"而不是固定数据。 */
        if (cmd === 'file_symbols') {
          const p = String(args?.path ?? '')
          if (p.endsWith('/bridge.ts')) {
            /* ★决策 #1483：造 **80 条**（真实 bridge.ts 有 100 个符号）。
              只给 5 条时面板很矮，"会不会被底边/状态栏切掉"这条根本测不出来。
              每 4 条里 1 条非导出 ⇒ 20 条淡色。 */
            /* ★决策 #1499：末位补 `useAutoSave` —— #1491 handoff 点名的验收样本
               （搜 `uas` 必须靠词首缩写命中）。它替换的是原本的 `sym5`，
               所以总数仍 80 / 20 条非导出 / interface-type-function 三组不变，
               且不影响 ㊿t 搜 `sym1` 的结果（该项不含 sym1）。 */
            const named = ['Stats', 'BridgeState', 'hasBridge', 'invoke', 'MAX_BYTES', 'useAutoSave']
            return Array.from({ length: 80 }, (_, i) => ({
              name: i < named.length ? named[i] : `sym${i}`,
              kind: i === 0 ? 'interface' : i === 1 ? 'type' : 'function',
              line: 3 + i * 7,
              exported: i % 4 !== 0,
            }))
          }
          return [{ name: 'onlyOne', kind: 'const', line: 1, exported: true }]
        }
        if (cmd === 'file_stat') {
          const p = String(args?.path ?? '')
          const name = p.slice(p.lastIndexOf('/') + 1)
          const dir = !name.includes('.')
          if (dir) {
            /* ★决策 #1475：项目卡桩。**按路径区分**（与 LINE_STUB 同一个道理）——
               若所有目录回同一份 project/owner，"卡片沿用了上一项数据"这类串数据缺陷抓不到。
               `packages/studio` 是项目根，`packages` 自己不是项目、只报"所属"。 */
            const PROJ_STUB = {
              'packages/studio': {
                kind: 'tauri',
                label: 'Tauri 桌面应用',
                name: 'Proteus Studio',
                version: '0.1.0',
                markers: ['tauri.conf.json', 'Cargo.toml'],
                deps: null,
                scripts: null,
              },
            }
            const OWNER_STUB = {
              packages: { path: '', name: 'proteus-vue', label: 'pnpm 工作区根', distance: 1 },
            }
            return {
              path: p,
              kind: 'dir',
              size: 0,
              mtime_us: 1762666666000000,
              sensitive: false,
              ext: '',
              lines: null,
              children: [9, 2],
              project: PROJ_STUB[p] ?? null,
              owner: OWNER_STUB[p] ?? null,
            }
          }
          const LINE_STUB = { 'App.vue': 371, 'main.rs': 997, 'bridge.ts': 551 }
          /* ★决策 #1476/#1479：`.m` 桩成"未统计"（lines: null）；角色/摘要按文件区分。
             ★`bridge.ts` 故意给「无角色 + 有结构」——这正是普通源码的形态，
               判据要能证明"角色行不出现、结构行仍出现"。 */
          const BRIEF_STUB = {
            'App.vue': {
              role: 'entry',
              label: '入口',
              chips: ['script setup', 'props', 'scoped'],
              names: [],
              names_total: 0,
              facts: [],
            },
            'main.rs': { role: 'entry', label: '入口', chips: [], names: [], names_total: 0, facts: [] },
            /* ★决策 #1486：`.rs` 现在也有结构摘要（批次 3）——没有角色，但有 pub 计数 */
            'format.rs': {
              role: '',
              label: '',
              chips: ['6 pub', '1 struct', '含测试'],
              names: ['run_format', 'FmtResult', 'MAX_OUT'],
              names_total: 6,
              facts: [],
            },
            'bridge.ts': {
              role: '',
              label: '',
              chips: ['95 导出', '6 interface', '9 type'],
              names: ['a', 'b', 'c'],
              names_total: 42,
              facts: [],
            },
          }
          return {
            path: p,
            kind: 'file',
            size: name === 'embed_view.m' ? 12 * 1024 * 1024 : 8421,
            mtime_us: 1762666666000000,
            sensitive: /^\.env/.test(name) || /^id_rsa$/.test(name) || /\.pem$/.test(name),
            ext: name.split('.').pop()?.toLowerCase() ?? '',
            lines: name === 'embed_view.m' ? null : (LINE_STUB[name] ?? 42),
            children: null,
            project: null,
            owner: null,
            brief: BRIEF_STUB[name] ?? null,
          }
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
        // Git 只读（决策 #1246）
        /* ★决策 #1492：诊断 watch 的起停。真实后端会拉起常驻 `vue-tsc --watch`，
           桩只需回成功 —— 判据验的是"事件到了以后界面怎么画"。 */
        if (cmd === 'diag_watch_start' || cmd === 'diag_watch_stop') return null
        if (cmd === 'git_status')
          return {
            isRepo: true,
            branch: 'main',
            /* ★决策 #1477：HEAD 与提交标题由 Rust 侧给（oid 来自 `status --branch`，
               标题来自额外一次 `git log -1`）。桩里给固定的假值，判据据此刻意核对文案。 */
            head: 'abc1234',
            subject: '演示提交标题',
            ahead: 1,
            behind: 0,
            files: [
              { path: 'packages/studio/ui/src/App.vue', status: 'M' },
              { path: 'packages/studio/src/main.rs', status: 'M' },
            ],
          }
        // ★按 path 返回（决策 #1247）：原来不管哪个文件都回同一段文本 ⇒
        //   "把 A 的 HEAD 内容拿去和 B 的缓冲做 diff"这类**串文件**缺陷在判据里永远看不出来
        //   （桩自己把两个文件变成同一份内容，等于替被测物把 bug 掩盖了）。
        //   真实现是 `git show HEAD:<path>`，当然一个文件一份。
        if (cmd === 'git_head') {
          const p = String(args?.path ?? '')
          return `// HEAD-VERSION-MARKER ${p}\nconst baseline = 1\n`
        }
        // 触摸回传（决策 #1254）：只**记录**，不真去调 adb（判据验的是"前端算的设备像素对不对"）。
        // ★`__TAP_UNSUPPORTED__=1` 模拟"当前源不支持"（iOS 推流 / 录制流），
        //   用来钉住"提示一次并自动关开关"这条行为——那是用户最常撞到的情形。
        if (cmd === 'device_tap') {
          window.__LAST_TAP__ = args
          if (window.localStorage.getItem('__TAP_UNSUPPORTED__') === '1')
            throw new Error('当前画面源不支持触控回传（只有 Android / adb 实时投屏能注入）')
          // 熄屏：真机实测 input tap 返回 0 但**不生效**（2026-10-26）⇒ Rust 侧提前报错
          if (window.localStorage.getItem('__TAP_SLEEPING__') === '1')
            throw new Error('设备屏幕没亮（Dozing）：这次点击大概率没效果 —— 先把设备屏幕点亮')
          return `${args?.x},${args?.y}`
        }
        // 滑动 / 长按（决策 #1255）：与 tap 同一套闸门（源不支持 / 熄屏）
        if (cmd === 'device_swipe') {
          if (window.localStorage.getItem('__TAP_UNSUPPORTED__') === '1')
            throw new Error('当前画面源不支持触控回传（只有 Android / adb 实时投屏能注入）')
          // ★照 Rust 的类型规则校验（决策 #1262）：真实命令的参数是 u32，
          //   负数/非整数会被 Tauri 挡在门外并弹红条。桩不照做的话，
          //   "拖出画布算出负坐标"这类缺陷在判据里永远是绿的。
          for (const k of ['x1', 'y1', 'x2', 'y2']) {
            const v = args?.[k]
            if (!Number.isInteger(v) || v < 0)
              throw new Error(`invalid args \`${k}\` for command \`device_swipe\`: invalid value: integer \`${v}\`, expected u32`)
          }
          return `${args?.x1},${args?.y1}→${args?.x2},${args?.y2} @${args?.ms}ms`
        }
        // 关闭拦截（决策 #1244）：前端同步脏数量 / 放行关闭
        if (cmd === 'set_dirty_count') return null
        if (cmd === 'close_now') return null
        // 剪贴板（决策 #1234）：右键菜单「复制相对路径」
        if (cmd === 'copy_text') return null
        /* 内置终端（决策 #1279）：桩只记录调用与参数——真实 pty 由 Rust 单测
           `pty_runs_echo_and_reads_back` 覆盖；这里测的是"界面到 IPC 这一层"有没有接对。 */
        if (cmd === 'term_open' || cmd === 'term_resize' || cmd === 'term_write' || cmd === 'term_close') return null
        if (cmd === 'term_info') return { open: true, pid: 4242 }
        /* 一键投屏（决策 #1288）：桩只记录调用与参数；真流水线由 Rust/真机那条路覆盖。
           ★`ios_uninstall` 要回 bundle id（前端会拿它显示"已卸载 X"）。 */
        if (cmd === 'ios_stream_start') return null
        /* 快路径（决策 #1297）：先试"直接启动已装宿主" */
        if (cmd === 'ios_start_host') return null
        if (cmd === 'ios_uninstall') return String(args?.bundle ?? 'cn.shxuxi.proteus.experiments')
        if (cmd === 'ios_run_state') return { running: false, bundle: 'cn.shxuxi.proteus.experiments' }
        /* iOS 接法提示（决策 #1277）：真实实现要 `route`+`ifconfig`+`lsof`，桩里给一组定值。
           ★`active` 由 `__IOS_ACTIVE__` 控制——判据要能分别验"该显示"和"不该显示"两态。 */
        if (cmd === 'ios_stream_hint')
          return {
            ip: '192.168.1.24',
            port: 9001,
            cmd: 'bash hosts/ios/run-selfdraw.sh --stream=192.168.1.24:9001',
            listening: window.localStorage.getItem('__IOS_LISTEN__') !== '0',
            active: window.localStorage.getItem('__IOS_ACTIVE__') === '1',
          }
        if (cmd === 'list_files') {
          if (window.localStorage.getItem('__BIG__') === '1') return ['packages/studio/big.ts']
          /* 决策 #1460：新建成功后文件树要**真的出现**新文件（刷树也是判据的一部分）。
             桩把 create_file/create_dir 收到的路径记下来，下一次 list_files 一并返回。 */
          const made = JSON.parse(window.localStorage.getItem('__STUB_MADE__') || '[]')
          return [
            'packages/studio/ui/src/App.vue',
            'packages/studio/ui/src/bridge.ts',
            'packages/studio/ui/src/styles.css',
            'packages/studio/src/main.rs',
            /* ★决策 #1486：给 `.rs` 结构摘要留一个**普通 Rust 源文件**（main.rs 是入口，
               会走"角色"分支，测不到"无角色但有结构"这条）。 */
            'packages/studio/src/format.rs',
            'packages/studio/native/embed_view.m',
            ...made,
          ].sort()
        }
        /* 文件树写操作（决策 #1460）：桩只记录 + 回成功，不碰真实磁盘。
           ★调用记录由 `calls.push` 统一完成 ⇒ 判据能核对命令名与 args.path。 */
        if (cmd === 'create_file' || cmd === 'create_dir') {
          const made = JSON.parse(window.localStorage.getItem('__STUB_MADE__') || '[]')
          made.push(String(args?.path ?? ''))
          window.localStorage.setItem('__STUB_MADE__', JSON.stringify(made))
          return null
        }
        if (cmd === 'rename_path' || cmd === 'delete_path') return null
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
