# Proteus 项目记忆（PROJECT_MEMORY.md）

> **项目本地记忆文件**：新会话入口 —— 当前进度 + 关键点 + 阅读指引（详细历史在 `docs/project-memory-archive/`）。
> 新会话的 LLM **必须先读顶部「当前状态速览」**，再按 §「会话恢复指引」顺序阅读。
> **维护规则见 §《收纳规范》**（门禁 `pnpm check:memory`）——新里程碑的详细叙事**直接写进当月归档**，主文件只加一行速览。

---

## 项目概览

- **名称**：Proteus（普罗透斯）—— Vue 跨端编译框架
- **核心理念（架构方向已定案，决策 #290）**：**一份标准 Vue 源码 → 语义 IR（C-IR/CompilerIR）→ 可插拔渲染后端**（Render anywhere, on any engine）；不再是「小程序编译器」——小程序降级为 Layer 1 兼容层
- **四层可插拔（原则 #10 终极形态）**：编译（G-29 CompilerBackend）/ 逻辑（JS 引擎）/ UI（G-27 RenderBackend）/ 能力（G-28 NativeBackend）
- **技术栈**：Vue 3.4+ / Vite 5 / TypeScript 5.4+ / 微信基础库 2.29.2+（Skyline + wx.router）
- **包规模**：**45 个 @proteus-vue/* npm 包**（+ `packages/layout-core-rust` = **cargo crate，非 npm 包**，故不计数）（★2026-09-29 layout-core = App 排版核心）（check:pkg 0 error · `pnpm check:stats` 校验 ✓；31→38 修正 → G-07 glass 39 → Skyline 收口 worklet 40 → ★2026-09-14 组件库拆包 `@proteus-vue/components` 41 → ★Vapor 线新增 `@proteus-vue/slot-runtime` 42 + `@proteus-vue/layout-core` 43 → ★2026-09-30 MA1 新增 `@proteus-vue/animation` 44；版本统一 0.3.0-beta.8，见「当前状态速览」）
- **文档**：`docs/proteus-architecture.md`（L0 规约·真理来源）→ `docs/board-inventory.md`（全景索引）→ `docs/roadmap.md`（版本线）→ `roadmap-2-plan`（里程碑线）→ 各 plan



## 当前状态速览（最近一次更新：**2026-10-26·（六六七）· ★★Studio 改动清单 ↔ Diff 联动（第一刀收口）+ 修红：两个越线文件拆回 1000 行内 · 判据 54 · 决策 #1253**——用户「好的继续」= 接着 #1246 留下的"下一步①"。★★**开单先撞红灯**：`check:file-size` 昨夜**是红的**——`CodePanel.vue` **1182 行**、`check-studio-panel.mjs` **1063 行**都越了 1000 行硬上限却没进基线（10-25 收尾那句"门禁 53/53 全绿"只覆盖 `check:studio-panel` **一条**门禁）⇒ 先修红再谈功能：CodePanel 拆出 `GitBar.vue`/`TabBar.vue`/`FileTree.vue` + 纯逻辑 `git.ts`/`fileTree.ts`（**1182→922**）；门禁脚本拆出 `studio-panel-icons/stale/device/serve.mjs`（**1077→987**）。★**联动**：点改动清单项 = **打开该文件 + 直接进 Diff 且来源 HEAD**（VS Code 的 SCM 语义）；反向：清单里当前文件亮左侧强调条。★**顺手修一个真缺陷**：`headText` 是**上一个文件**的 HEAD，原来读盘分支只 `refreshDiff()` ⇒「来源=HEAD 时切文件」会把 **A 的 HEAD 与 B 的缓冲**做 diff（行号连续、增减合理、内容全错且不报错）；现 `syncDiffAfterOpen()` 按文件重取。★★**判据 53→54（㉞）**，且**桩改成按 path 返回 HEAD**（原先不分路径 ⇒ 串文件缺陷永远测不出来，桩替被测物把 bug 藏了）。★**破坏性验证三条全红**（不进 Diff / 不重取 HEAD / 不高亮）；★**M2 第一次居然绿**——带 `{diff:'head'}` 走的是另一条分支，而"切文件后 HEAD 内容跟不跟"根本没断言 ⇒ **补内容断言后才红**（判据覆盖空洞）。★诚实边界：判据仍跑 Playwright 桩 + chromium，真实 Tauri 窗口未人眼验；`.app` 未重打包。★**下一步**：①提交/推送能力**需先定规则**（谁能提交、push 是否永远人工）②下一刀方向待定（终端 pty / 真实设备投屏 / 调试器）——**投屏是 Studio 相对 VS Code 的唯一存在理由**（画布现在还是录制流）。
## 当前状态速览（最近一次更新：**2026-10-25·（六六六）· ★★★Studio 应用图标重做：品牌立方体 + 四角选中框 · 判据 40 · 决策 #1224–#1246**——用户「logo 太凑合了，按大厂标准重做，基于官网 logo 衍生，适合 IDE 定位」。★**原状**：`icons/icon.png` 是"深底 + 浅方块 + 蓝竖线"的阶段 1 占位图，与品牌三色等距立方体（`docs/brand/avatar.svg`）**毫无关系**。★**做法**：母题不动（等距立方体 = 一套源码→三个渲染目标；三色渐变 / 白内缝 / 不描外轮廓全部沿用），加一层 **Studio 语义**——**四角选中框把立方体框住** = 被检视/被取证（引擎产出画面，Studio 拿来比对留证）；容器换**深石墨底**（IDE 日常底色，也把"白底=品牌 / 深底=开发工具"分开）。网格 1024 / squircle 824 / r186 / 立方体 a=300。★★**两份 artwork 不是一张缩到底**：16/32 用 `icon-small.svg`（a=370、**去掉框**）、≥64 完整版——实测 32px 下框糊成四团灰点，剪影才是唯一可辨的。★**三条制图纪律（当场量出来的）**：内缝必须 `clipPath` 剪在立方体轮廓内（round 线帽会在左右顶点戳白点，1024 可见）；框必须**完整包住**立方体（外扩 24/42）否则读成"在裁切它"；不写字。★**生成换代**：删 `make-icon.py`（手写像素循环），换 `make-icon.mjs`（**SVG 唯一真源 → Chromium 按目标尺寸矢量栅格化 → iconset 十档 → iconutil**）；`package-app.sh` 从"icns 缺了才生成"改成"**源 SVG 比 icns 新就重生成**"（否则改了图标会把旧图标打进包，与"包里是三天前的 UI"同一类假象）。★判据 39→**40**（㉗）：icns 比源 SVG 新 + 十档尺寸逐一对（读 PNG IHDR）；**破坏性验证** `touch icon.svg` ⇒ 红、重生成 ⇒ 绿。★**诚实边界**：Dock 实际观感只能人眼（TCC 拦截图），门禁只证"文件同步 + 尺寸正确"。★★**随后用户要求换方向**：字母变形（P 字标，参考 Xcode/Android Studio 的"一个强字形 + 品牌底"），当前图标**保留不动**，候选放在 `icons/options/`：A 三块平涂（竖笔绿+碗紫/蓝=立方体三面）/ B 白字紫蓝底 / C 白字三色底。几何共用（竖笔 104、碗半径 114、线宽 104、外接 376×552）；★两条制图约束：碗用 `butt` 帽（round 会鼓出"耳朵"）、竖笔最后画盖住碗端（免布尔运算）。★小尺寸实测：B/C 在 16px 仍可辨，A 糊成彩色团块 ⇒ **倾向 C**。未接入打包，等用户定。★★**再之后用户要求"基于 C 按大厂标准打磨"**（#1226）：判断是 **C 只有字形、没有材质与光**，主战场在容器而不是把字母画花。七项改动：径向补光（绿从**色带**变**补光**，32px 不再彩虹）/ rim 上亮下暗 / 竖笔**胶囊→方角** / 碗顶端与竖笔**齐平**（原 8px 台阶是 overshoot 用错地方）/ **-32px 视觉居中**（外接 386×556）/ 柔和投影 dy6-blur10-0.22 / **16/32 另出一份**（放大 12%、去投影）。★**试过并否掉**：三块平涂、30° 切分、五边形碗、菱形字怀、30° 斜切脚、硬边挤出、multiply 明暗——结论：字母图标的"设计感"来自**几何精度 + 光 + 材质**，不是给字加花纹。产物 `options/p-monogram-final{,-small}.svg` + `final-compare.png`，**未接入打包**（`icons/icon.svg` 仍是立方体版）。★★**再之后：双通道 + 双风格对照**（#1227）——通道靠**色相**（正式紫蓝 / 预览绿青，不写字角标）；生命感三件：**回光**（径向白 0.12，收过两次才对：0.22 会糊出奶白晕）· **45° 高光扫带** 0.09 · **预览版扫描光带**（横贯 + 4px 亮线 = "正在取景"）。★**32px 实测（放大 6 倍看真像素）**：P 的竖笔与碗仍干净；立方体三面可辨但**取景框糊成四团脏点** ⇒ **建议应用图标用 A（P 字标）**，立方体+取景框改当**产品标记**（应用内/文档，尺寸大才成立其"三面+检视"叙事）；若更看重家族连续性选 B 也成立，代价是 16/32 丢框。产物 `options/a1-p-release.svg` · `a2-p-preview.svg` · `b1-cube-release.svg` · `b2-cube-preview.svg` + `system-compare.png` + `size-check.png`，**未接入打包**。★★**最终定案（#1228）**：应用图标 = **P 字标**（`icon.svg`/`icon-small.svg` 紫蓝正式；`icon-preview*.svg` 绿青预览）；**立方体+取景框改当产品标记**（`docs/brand/studio-mark.svg` + 透明版 + `ui/src/icons/StudioMark.vue`，已接进空状态）。★分工按尺寸：取景框在 32px 会糊，故只用在尺寸够大处。★★**双通道**：`package-app.sh --channel preview` → 装成 Proteus Studio Preview（bundle id `.preview`），两通道可同装；根脚本 `build:studio-app:preview`；`make-icon.mjs` 循环出两套 icns；判据 ㉗ 扩到两套（同步 + 七档 + png 1024）。★**已知限制**：两通道共用同一个 state.json（数据目录未按 id 分），同机双开会互相覆盖。★★**用户报「正式版还是旧图标 / 预览版图标几秒后变回正式版」（#1229）**：取证发现**包内 icns 都是新的**，根因在包外两条——① 两个 .app 放了**同名可执行文件**（二进制与 ad-hoc 签名都一样）⇒ Dock 图标身份串台，修复：预览包用 `proteus-studio-shell-preview`（`CFBundleExecutable` 同步，打包前清残留）；② **ad-hoc 签名是确定性的**（`--timestamp=none`）⇒ 图标缓存不自动失效，修复：`lsregister -f` + `killall Dock`，打包脚本在**图标指纹变化**时打印提示。★用 `NSWorkspace.iconForFile` 导出**系统实际会用**的图标取证（紫 P / 绿 P）。★附带修 bash 坑：`$APP（…` 会把全角括号吞进变量名 ⇒ `set -u` 下 unbound variable（两处）。★★**Dock 图标同色（#1230）**：两通道同时跑时 Dock 两格都是紫 P ⇒ 读源码确认 `tauri-runtime-wry` 在 `RunEvent::Ready` 用**嵌进二进制的 `bundle.icon` PNG** 调 `setApplicationIconImage`，而两通道共用同一个二进制。修复：`embed_view.m` 加 `poc_use_bundle_icon()`（读当前 bundle 的 icon.icns），在 `App::run` 的 Ready 回调里调——**不能放 setup**（Tauri 的覆盖在 setup 之后）。取证用 `NSRunningApplication.icon` 导出**运行中**图标（比 iconForFile 更贴近 Dock）：紫 P / 绿 P。★★**标题栏拖不动/双击不缩放（#1231）**：两层根因——① `data-tauri-drag-region` 是 **bare** 值，只认"直接命中本体"，而标题条里全是子元素 ⇒ 改 `deep`；② **真凶是没有 `capabilities/`**：Tauri 2 的 IPC 对 `plugin:` 命令要求 ACL，`start_dragging` 被**静默拒绝**。新增 `capabilities/default.json`（start-dragging / internal-toggle-maximize / event listen+unlisten）。★连带发现 **`plugin:event|listen` 也被拒 ⇒ 菜单在真机从未生效**，旧判据 ㉕ 只测了 DOM 兜底路径（假绿）。判据升级：**㉔b** 注入 Tauri 真实 `drag.js` 断言发出 `start_dragging`/`toggle_maximize`；**㉔c** 能力源文件与**构建产物**（gen/schemas/capabilities.json）都含四项。★教训：`start_dragging` 不能当探针（会把主线程挂进拖拽循环）。★★**代码视图"边界功能"打磨（#1232–#1234）**：① 文件树**目录两态图标**（folder/folderOpen，形状区分不靠颜色）+ **文件类型图标**（`ui/src/fileIcons.ts`，9 类扩展名 → 单记号 + 类型色，色不借 `--ok/--warn/--bad`）；② **全局右键菜单**（`contextmenu.ts` + `ContextMenu.vue`，标签/文件树/编辑器三处，开关/互斥/贴边翻转/点外面-Esc 关闭都在一层；动作全落到既有函数，`close()` 拆出 `forget()`）；③ **复制路径走 Rust `copy_text`（NSPasteboard）**——WKWebView 的 `navigator.clipboard` 要手势+焦点，菜单点完会静默失败。判据 42→**45**（㉘ 目录两态 / ㉙ 五个语言五个图标+≥4 色 / ㉚ 三处菜单 + 关闭其他 + 复制路径 + Esc），破坏性验证全红。★**两个坑**：菜单点击没超时保护时，菜单没弹出会让整条门禁崩在 TimeoutError（改 `pickMenu()` 记 false 继续）；`build.rs` 缺 `rerun-if-changed` ⇒ **改了 `.m` 不重编**，链接期才报 `Undefined symbols: _poc_copy_text`（已补三条声明）。判据脚本 1222→937 行（采集段拆到 `studio-panel-probes.mjs`）。★★**去 AI 味 + 反馈组件（#1235/#1236）**：① 图标删掉回光/扫带/投影/三色带（**每层都想加戏 ⇒ 每处都发灰**），改**单色同族两档**渐变 + 精确字形（碗线宽 96，字怀更大）；② 文件树改 **JetBrains 式徽章**（类型色圆角底 + 白色单记号），真源收敛到 `fileIcons.ts`（含 glyph，StudioIcon 去重）；③ **toast 取代状态栏提示**：右下角可堆叠卡片、2.6s 自动消退、最多 4 条，**错误不自动消失**（保存冲突要等人处理）。判据 46（㉛ 复制出现 ok toast + 连点叠 2 条 + 3s 清空；⑱b 改读 toast）。★**icns 缓存第三层**：`initWithContentsOfFile:` 走 IconServices 的**文件**缓存 ⇒ 包里新、Dock 旧，改 `initWithData:` 按字节读绕过。★★**文件树图标 v3（#1237）**：v1 裸字母（太轻）/ v2 统一徽章（**抹平差异**）都被否 ⇒ 改「语言自己的记号 + 品牌色 + **填充**」：Vue 双 V · TS 蓝底 TS · JS 黄底 JS · Rust 齿轮 · CSS 盾牌 · JSON 大括号 · MD 徽章 · Python 双色 · C 紫底 C；尺寸 14→**16**（与 VS Code 一致）；目录也改**填充**两态（`FolderIcon.vue`，靠形状不靠颜色）。真源 `ui/src/fileIcons.ts` 一张表。★★**文件树去折叠箭头（#1238）**：删掉每行左侧 12px 的 `.caret`（连同 `StudioIcon` 的 chevron）⇒ 名字整体左移、**同级左边界才真正对齐**；层级改由缩进 `8 + depth×14`（原 12）表达；可折叠性交给 `FolderIcon` 的两套形状（点行即切，`aria-expanded` 仍在行上）。★代价：没有箭头，新人要靠"图标会变"发现可折叠；要补就 hover 时才淡入，不常驻。★★**右键菜单（#1239）**：① **定位改「先量后放」**——`openMenu` 只记锚点，组件隐藏渲染→`nextTick` 量真实尺寸→`placeMenu`（装不下才翻转、再夹边距），**删掉"估算高度×项数"**（它正是"点在下半屏、菜单弹到上半屏"的根因）；② **高亮改中性灰** `rgba(255,255,255,.08)`（危险项 14% 红），行高 24 / 圆角 8 / 边框 subtle，替掉"品牌蓝整块"；③ 补键盘 ↑↓/Enter/Home/End。判据 46→**47**（㉜ 按需翻转 + 右下角贴锚点 ±1px + 窗口内 + hover 三通道差 ≤14），变异"多偏 120px"立刻红。★判据自身的坑：`dispatchEvent('mouseenter')` 读不到 Vue 刚更新的 class（nextTick），改用真实 hover。★★**菜单光标（#1240）**：菜单项写的是 `cursor:default`，而本应用树/标签/脏标记全是 `pointer` ⇒ 菜单成了唯一例外；改 `pointer`（禁用项保持 `default`，给手指等于骗人点），㉜ 顺带断言光标形态（变异回 default 立刻红）。★★**语言模式 28 种 + 状态栏切换（#1241）**：`ui/src/langs.ts` 注册表（官方 Lezer：Vue/TS/TSX/JS/JSX/Rust/CSS；legacy 流式：JSON/MD/Python/Go/Java/Kotlin/C/C++/ObjC/Shell/YAML/TOML/SQL/XML/HTML/Ruby/Swift/Lua/Diff/Dockerfile；+ Plain Text），`languages.json` 扩展名映射同步扩容；Markdown 自带 40 行 StreamParser（这版 legacy-modes 没有 md）。**底部状态栏 `#langMode` chip** 显示当前语言、点开全量列表+自动，`editorLang.ts` 共享 store（覆盖按文件记、不落盘），热切换用 **Compartment.reconfigure** 保 undo。判据 47→**48**（㉝ 纯文本 0 个着色 span / Rust >0 / 回自动回 Vue；判"颜色≠正文色的 span"而不是 CM 内部类名——`ͼ*` 在纯文本下也有 36 个，是假绿）。★顺手修 `open()` 缓存分支漏 `trackEditorFile`（状态栏停在上一个文件类型上）。★★**⌘Z 失效（#1242）**：菜单建起来后"编辑→撤销"用了 `PredefinedMenuItem::undo` ⇒ AppKit 把 `undo:` 交给 **WKWebView 的 undoManager**，而撤销栈在 **CodeMirror** 里，且**菜单吃掉了 ⌘Z**、CM 的 keymap 也收不到 ⇒ 完全没反应。修复：`edit.undo/redo/selectAll` 改**自绘动作**落到 CM6 的 `undo/redo/selectAll`（焦点在输入框时退回 `execCommand`），剪切/拷贝/粘贴保持预定义项。判据 48→**49**（⑱d 派发 `edit.undo` 后标记必须消失；摘掉处理器立刻红）。★教训：编辑栈在自己手里时（CodeMirror/Monaco/xterm），撤销/全选必须自己接，**不能用系统预定义项**。★★**关闭未保存标签要拦（#1243）**：`confirm.ts` + `ConfirmDialog.vue`（Promise 化 `ask()`，默认焦点在**取消**）；×/关闭其他/关闭右侧三条路径都拦，多个脏文件先收集再问，选"全部保存并关闭"时逐个 `savePath()`，**存盘失败即中止关闭**；为此 `save()` 拆成 `savePath(path)` + 包装。判据 49→**50**（⑱e 取消后标签与改动都在、不保存后标签 -1；跳过拦截立刻红）。★门禁自身也被打中：㉓ 关 main.rs 时它是脏的，已补"有新确认框就选不保存"的适配。★**未做（如实记）**：**关窗口/退出应用**还没拦——要走 Rust `close-requested` 往返。★★**关窗口/退出也拦（#1244）**：脏计数 `set_dirty_count` 同步到 Rust 原子量；`CloseRequested` 里 `prevent_close()` + `emit("app:close-blocked")`；前端弹**同一套三选一**，选完 `close_now()` 放行。判据 50→**51**（⑱f：脏计数≥1 / 三选一齐全 / 取消后 `close_now` 0 次 / 保存并关闭后 1 次；去掉放行立刻红）。★**诚实边界**：判据走浏览器兜底事件，`prevent_close` 本身只能人眼验（改点东西点红点，应弹框而不是关掉）。★★**Diff 视图（#1245，第一刀第三件）**：`@codemirror/merge` 未装且沙箱装不了 ⇒ **自己写行级 LCS**（`ui/src/diff.ts`）+ `DiffView.vue`（unified 行、双列行号、`−/+`、**8% 淡底**、3 行上下文、长间隔 `···`；`MAX_CELLS=4e6` 以上退化整块替换防卡死）。入口是文件 bar 的 `Diff` 按钮，打开时编辑器 `v-show=false`（**不叠层**）。判据 51→**52**（⑱g：`+≥1/−≥1`、探针行在新增里、编辑区互斥；变异 `added=0` 立刻红）。★边界：只做行级，不做词级高亮/三栏合并。★★**Git 只读（#1246，第一刀最后一件）**：Rust 只跑 `status --porcelain=v2 --branch` 与 `show HEAD:path`（**不提供** stage/commit/push；非仓库/无 git 一律降级 `isRepo:false`，不拖垮读代码）。porcelain 字段数不固定 ⇒ 路径用 `rsplitn(2,' ')` 取末段。UI：文件树上方 24px **Git 带**（`⎇ 分支 · ↑a ↓b · N 处改动`，点开清单，M黄/A绿/D红/?灰，点文件直接开）；**Diff 头部常驻 `磁盘 / HEAD` 切换**（未跟踪显示"HEAD 里没有"）。★修 bug：来源切换原来塞在 `v-else`，导致"没本地改动时看不到 HEAD diff"——那正是最需要看的时候。判据 52→**53**（⑱h 分支/改动数/清单/点开/HEAD 标记；变异 `git_head=null` 立刻红）。★★**第一刀四件（多标签/搜索/Diff/Git 只读）全部完成**。★★**今天收尾（10-25 17:26）**：Studio 侧 54 提交 · 门禁 53/53 · 我的路径全部提交干净 · **6 个提交未 push（等用户批准）**。未提交的改动都是**别的并发会话**的（css-conformance/hosts），没碰。★**明天从这里接**：①（可选）改动清单 ↔ Diff 联动（点清单项直接看该文件 HEAD diff）；②提交/推送能力**需先定规则**（谁能提交、push 是否永远人工）；③第一刀四件已完成，下一刀方向待定。
## 当前状态速览（最近一次更新：**2026-10-25·（六六五）· ★★★Studio 搜索落地：rg 子进程 + 字节→字符列换算 · 判据 39 · 决策 #1222/#1223**——第一刀第二件。左栏顶部常驻搜索框（⌘F 聚焦，菜单 `edit.find` 接上），有查询时**结果列表替换目录树**（VS Code 同款，不叠浮层、不与原生画布抢 z 序）。★**为什么是 rg**：3000+ 文件自写遍历慢、还要重踩"忽略哪些目录"，rg 是事实标准（VS Code 搜索框底层也是它）；`--fixed-strings`（打 `a.b*` 找的就是这串字符，不当正则）、单文件 50/总量 300 超了 kill、**`async`+`spawn_blocking`**（rg 阻塞，写同步 command 会占住主线程连输入法都顿）。★★**唯一会错的地方是坐标**：rg 的 `start` 是**字节**偏移，CM 用 **UTF-16 code unit**，中文 1 字 = 3 字节/1 unit ⇒ Rust 里字节→字符列（单测钉 `中文abc` 的 `abc` = 字符 3），前端 `Array.from` → code unit，少一步就"差不多但偏几格"。★判据 38→**39**（㉖）：2 条命中与桩一致 + 树让位 + 点第一条 `data-caret=4:9`（**不是"文件打开了"就算过**）+ 当前行文本对得上 + 清除回树；`data-caret` 从 CM **实际 selection 反算**。★**破坏性验证两条全红**：忽略列 ⇒ `4:1`；结果不顶掉树 ⇒ 让位=false。★**诚实边界**：㉖ 跑桩数据（rg 解析/列换算由 Rust 单测覆盖）；**替换没做**（搜索只读）。★★**收尾时核真机环境发现 `rg` 根本没装**（brew 里也没有）⇒ 只有一条路等于没有功能，补 `builtin()` 兜底扫描（与 list_files 同一套忽略目录/扩展名/字面量/每行一条；`NotFound` 才回退，rg 存在但报错仍返回 Err），`Outcome.engine` **如实**返回 `rg`/`builtin`，UI 显示「内置扫描（装 ripgrep 更快）」不让兜底速度被当常态；㉖ 增一条"没 rg 时标注必须是内置扫描且命中数不变"（换引擎不改契约）。★**同时按职责拆两处过 1000 行的文件**：CodePanel 1036→862（搜索搬进 `SearchBox.vue`）、门禁脚本 1095→965（Tauri 桩 → `studio-panel-stub.mjs`、大文件性能测量 → `studio-panel-perf.mjs`）；拆完 39/39（㉑ 冷跳 78/17ms）。★**下一步**：Diff（@codemirror/merge）→ Git 只读。
## ★《收纳规范》（2026-10-03 立 · 门禁 `pnpm check:memory`）

**为什么立这条**：本文件曾达 **11,118 行 / 2.4 MB**（每轮里程碑的详细叙事都内联插 H3），
「新会话先读顶部」的成本被历史内容淹没。⇒ 改为「**主文件 = 当前态薄入口；历史与长表全文在 `docs/project-memory-archive/`**」。

**主文件只放六类内容**（其余一律归档）：
1. 项目概览（要点，不放过程）
2. 当前状态速览——**只保留最近 3 条**；插入新条时，第 4 条起移入当月归档
3. 关键决策与文档偏差——**全文在 `decisions.md`**；主文件只留指针 + 锚点（决策号只增不改号）
4. 待办 / 注意事项（已完成项移归档）
5. 会话恢复指引（阅读顺序；指向归档而非内联历史）
6. 归档索引（归档文件清单 + 检索方式）

**新里程碑的写法**（替代旧习惯——详细叙事不再内联）：
1. **详细叙事**（交付 / 缺陷 / 验证 / 诚实边界）追加到 `docs/project-memory-archive/<YYYY-MM>.md`（当月文件；新月份新建）；
2. 主文件顶部加**一行**状态速览（`## 当前状态速览（…）`，含「下一步」）；
3. 需长期记住的教训 → 决策条目（号 +1）追加到 `decisions.md`，架构级同时在主文件「锚点」登记一行；
4. 跑 `pnpm check:memory` 自检（主文件上限 / 结构齐备 / 速览条数 / H3 泄漏）。

## 归档索引（历史在归档——**勿整读，按关键词 grep**）

| 文件 | 内容 |
|---|---|
| `docs/project-memory-archive/2026-10.md` | 2026-10 里程碑详细叙事 + 状态速览历史栈（约 10.5k 行）|
| `docs/project-memory-archive/2026-09.md` | 09 月全部叙事 + 柔性系统重组历史 + 2026-08 进度快照 + 已落地文件 + 09-19 验证状态（约 6.5k 行） |
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#794——按号检索（`grep -n "^736\." …`）|

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#794 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

**★★（2026-10-17 收口 · 决策 #1036）点击切换回弹校准已完成** —— `FLOW_C 1.00→0.6508`（ζ=0.55），
真机 1 格过冲 14.5px(5.8%)/3 格 43.4px(5.7%)、起跳相位不回归（详见归档 2026-10-17 条目）。
**★唯一剩余 = 用户目视手感验收**（手感以用户为准）：若仍偏软/偏弹，按预标定表只调 `FLOW_C`
（ζ=0.50⇒25px · 0.55⇒14.5px · 0.60⇒5.8px · 0.65⇒1px；**必须按离散复算，连续公式高估约 2 倍**）。

**★★★（2026-10-12 收尾 · 明天续接）本轮（#861–#868）遗留清单** —— 玻璃性能三端已达标（安卓 121 / 鸿蒙 121 / iOS 59 满帧）+ 系统级 OOM/挂死三处已修 + 治理补层（engines/loop-guard/lint）已落。**按优先级**：
1. ✅ **（2026-10-13 已收口 · 决策 #869）既有 8 项全量失败全部修复**——Node 22 全量 **5764 通过 / 0 失败**（此前 5756/8）。含 **1 个真 bug**：`p-icon/index.vue` 的 `import.meta.env?.DEV`（#804 引入）被本仓自定义编译器残留进产物 ⇒ `new Function` 抛 `Cannot use 'import.meta' outside a module`（三处门禁同红），改无条件告警；其余为数字/快照/契约漂移（`check:stats` packages 47→48 / conformance 11→12 / plans 86→87 + `css-capability-alignment` 重生成 + `router-project-driven` 测试正则收窄 + `p-batch2-contract` 契约更新）。★**遗留评估**：`test:coupled` 触发面未含 `packages/components/**`（见 #869 教训）。
2. **端到端样例：真 `.vue` 用 `<pg-glass>` → 三端渲染玻璃**（把"编译折叠"与"原生玻璃"两半接起来验一次）——**含 `glass.radius` 单位校验**（★#864 遗留：iOS 宿主把 `radius` 按 pt×scale，而 `resolveGlass` 产出 `radiusPx` 物理 px ⇒ 真实 `<pg-glass>` 会踩"半径 ×3"）。
3. **`proteus audit glass` + 降级链核验**（`packages/cli/src/glass-audit.ts` 已存在，需接 CI + 校验三级降级）。
4. ✅ **（2026-10-13 已完成 · 决策 #870）`capability.ts`（8987 行）已拆为三层**——`capability-types.ts`（3849·契约）+ `capability-bridges.ts`（4040·平台桥）+ `capability.ts`（1096·工厂/Hook/响应式）。纯机械搬迁（行为零变化，全量 5764/0 与拆分前一致）。★遗留：`capability-bridges.ts` 4040 行仍偏大（按能力域再分需先解 `idleSeq` 共享可变态）。
5. **`noUncheckedIndexedAccess` 迁移**（tsconfig）——**迁移项目**（实测 2 包即 47 错，全仓数千条），须棘轮式分级上。
6. **lint 后续批次**：type-aware 规则（`no-floating-promises` 等，需配 `parserOptions.project`）+ warning 清理（1431 条）。

**★★★（2026-10-11 续 · 承接 2026-10-10 的四项新能力）新能力「跨端铺开 + 验收」清单** —— 10-10 四项（#791/#792/#793/#794）骨架在 Android；**10-11 两批已收口：#795（iOS+鸿蒙驱动）+ #796（能力归 runtime：驱动器全下沉、壳零接线、门禁 ④ 双向守）**。**剩余 = 鸿蒙签名 + 续建**：
1. **★鸿蒙真机取证（唯一剩余的环境动作）**——签名 p12 口令是**另一台机加密**的密文（本机解不开）⇒ 在 DevEco 里对 **框架参考宿主 `hosts/harmony/host-app`** 重新自动签名一次（Project Structure → Signing Configs → 勾 Automatically generate signature；本机 `build-profile.json5` 的 signingConfigs 已清空为干净态，DevEco 会自动重写），然后 `bash hosts/harmony/build-host-app.sh && bash hosts/harmony/run-superapp.sh --pump=l3,2500`（编译已过、判据脚本已就绪）。★**iOS 已收官**（真机 `calls=78 fire_ticks=78 anim_start_calls=5`）；**Android 已复验**（壳零接线版）。
2. **CSS 伪元素 `::before`/`::after` + `:active` 触发动画的 iOS/鸿蒙落点**（#791 同理只接 Android）。
3. **Web/MP 对齐**：`v-pump`（Web 走 `setInterval`/rAF、MP 走原生定时器）与 `v-animate`（Web 走 CSS 动画、MP 走 `wx.createAnimation`）——以 **Web 真值为基准**核 CSS 语义（见 AGENTS.md「CSS 基准 = Web」红线）。
4. **Dactyl 场景续建**：L3 色相沸腾 / L4 多指场 / L5 全叠加 + 总负载旋钮；D4（`dactyl-metrics.json` 生产者 · 天花板刻度尺 · 崩裂回放 · Playground 挂载 · 跨框架对照组）。★L1 涟漪的**判据**也要补：逐帧量伪元素区域（不是整帧 diff，见 #791⑧ 假阳性教训）。
5. **CSS 能力清单已回填**（本日随官网文档更新）：`docs/generated/css-capability-sources/app-profile-features.json` 新增 `selector-pseudo-element` / `selector-pseudo-state-active`，更正 `animation`（delay/iteration 已支持）。★**官网新文档**：`website/content/primitives/40-directives.md`（+en）=「指令原语」页（v-pump/v-animate/v-follow）——后续指令类能力都往这页加。


**★★（2026-10-10）Vapor 事件「方法引用 / 方法体」—— T1 + T2 均已交付** —— 计划 `docs/vapor-event-methods-plan.md`（决策 #740 立项 · **#741 T1 · #749 T2**）。
- **T1**：`@click="handleTap"` / `handleTap()` / 多语句方法体 ⇒ 编译期内联 `<script setup>` 方法体降级为动作表（ref `.value` 解包；`$emit`/`$nav`）。判据 `tests/vapor-events.test.ts` + 真实 App 管线 `tests/app-runtime-content.test.ts` ③。
- **T2**：**带实参调用** `add(2)`（⇒ `let` 形参绑定）· **方法形参** · **方法内局部变量** · **`if/else`**（⇒ `if` 条件动作）。**契约+执行器下沉** `@proteus-vue/slot-runtime`（`handler.ts` 的 `runHandlerActions`）——`screen-runtime` 与 `entry-vapor` 共用。判据 `tests/handler-actions.test.ts`（8）· `vapor-events`（+6）· `app-runtime-content` ④ · **三端真机判据 ㉓**（`t2x` 值/几何 `[0,6,12,0]`，三端全过 + 指纹一致）。
- **仍「明确不做」**（编译期诊断，不静默）：循环 / `async`·`await` / 任意函数（`console.log(...)`）。**T3**（方法调方法 / `console.*`→面板 / 模板串）待做。
- **★三端同步义务**：本轮**已三端重跑** `check:vapor-three-end`（dev 夹具 +T2 用例 ⇒ 三端都要重跑）——Android/鸿蒙/iOS 各 `run-vapor.sh`/`run-selfdraw.sh --vapor` 并提交 `results/vapor.json`（已做）。
- **现状缓解已回收**：#739 模板"必须内联"的过渡说明已改（模板仍用内联，但属风格选择，非强制）；guides/09（中英）已列出支持/仍不支持边界。

**★本轮（2026-10-08）留存 —— 新会话接手必读**
- **★★★App DevTools 面板（#672–#675）**：`proteus dev` 的 dev server 根路径 = 浏览器 DevTools（**设备环境** chips / 设备在线 / Bundle 版本·体积·重建耗时 / 当前屏 / 重建时间线 / **Elements 节点树（含内核 rect，点节点看盒模型）** / **Events 手势 trace** / **Network** / **Console** / **渲染耗时+mount**）。端点 `/`(面板) `/events`(SSE) `/ping`(心跳+env+perf) `/tree` `/inspect` `/trace` `/log`。宿主模板采集设备信息 + 推树(切屏自动刷) + JS console 垫片 + trace；**仅 dev**。
- **★★修（#694a · 2026-10-09 已修）**：App **导航挂载失败（点卡片不切屏）**——根因 = **env token 未解析**（编译产物 `"minHeight":"env:--pf-vh"` 字符串直进内核 ⇒ serde `expected f32` ⇒ `proteus_layout_create` 返 0）；Android 已由 #677 修、**iOS 漏了** ⇒ #694a 在 iOS `ScreenHost.mount` 补同一解析（`SelfDrawBridge.current` 单一实现）。★**仍欠**：**破坏性验证**（剥掉解析调用 ⇒ 应复现 create 返 0）未跑完——`packageIosHost` 会 `syncRuntimeUnits` 覆盖生成宿主，须剥**框架源码**重打包（那次被用户叫停）。★下次**别耗真机全流程**，用 **Node 层兜底**：直接对 `screen.mount` 载荷断言「无 `env:` 字符串残留」。**用户可见 ⇒ 优先**。
- **★★发版已完成（#664 → 已发布）**：用户已发布到 npm——公网各包 `latest = **0.3.0-beta.23**`（含 #663/#664 的 CLI 三修 + `templates-host`/App 能力；已验证 `resolveAppRoutes`/新主题在发布物内）。git 版本 bump 已提交追平（`8e42d962`）。
- **★★★彻底打通（#666 打包 + #667 dev 热刷，Android 纯 npm 免框架 checkout）**：外部工程（`npm create`+`npm install`，**不碰框架源码**）现可完整 `build --package` + `dev` 热刷。**打包**：桥源 `templates-host/shared/bridge/entry-superapp.ts` + AAR `templates-host/prebuilt/android/proteus-runtime.aar`（`build-runtime-aar.sh` 同步）随 CLI 包发布，无框架回退 + esbuild 按 node_modules 解析。**dev**：`resolveWatchRoots` 按**布局/配置**解析监听根（模板 `src/` 与根形态都覆盖）。**门禁**：`check:bridge-sync`（桥源真源⇄随包副本逐字节一致；改真源后跑 `node scripts/sync-host-bridge.mjs`）。真机验证：出包 3.4MB + 改源码 **59ms** 重建 → 宿主 `PROTEUS_DEV_RELOADED`。**★剩余**：iOS/harmony runtime（26/33MB 静态库）仍需独立托管（`host-runtime-package-plan.md`，已证伪其"尚未发生"前提）。
- **★★★"新工程 → 手机"已验证（#664 本地包 + #665 补更）**：`create-proteus` 新工程 → `build --target android --package` → 3.4MB APK → 装机 `PROTEUS_APP_READY`。修 **4** 缺陷：D1 `routesOutput` 硬编码（→ `app-routes.ts` 唯一实现）、D2 三端文本默认白→黑（Web 基准）、D3 CLI 宿主主题 `Theme.Material.NoActionBar`（状态栏透明）、D4 **App 页根块级满宽**（#665 · `buildLayoutTemplate` 单根补 `widthRatio:1`，修 `text-align:center`+根 padding 渲染成顶左）。**★已生成宿主需删 `dist/app/<端>/host` 重建**才拿 D3。**剩余**：App 端 `<button>` 的**原生外形**（圆角/阴影/按下态）属独立 UX 批次（语义已渲染，随 D2 可见）。
- **★★★CLI 启动期「陈旧 dist」守卫（#663）**：`npx proteus` 走 `packages/cli/dist/index.js`，**改了 `packages/*/src` 忘 `build-packages` ⇒ 跑的是旧代码**（实测：`proteus dev --target android` 仍启动 web），而 `tsx src` 手测正常=假绿。现 `main()` 顶部 `warnIfDistStale(cmd)` 从 dist 运行时会对陈旧包打 stderr 告警（不阻断）。**修法**：`node scripts/build-packages.mjs`。
- **★★★完整宿主 + CLI 出包 + dev 热刷（#662，Android 已端到端）**：`proteus build --target android --package`（`--host-dir` 可省）→ `dist/app/android/{host/, bundle-superapp.js, proteus-host.apk}`（**项目包名** = `proteus.config` native 段，如 `cn.proteus.superapp`）；`proteus dev --target android` → 改源码秒级热刷（真机验过 `PROTEUS_DEV_RELOADED`）。**剩余**：**iOS/鸿蒙 dev 热刷宿主通道待接**（iOS `#if DEBUG`+ATS / 鸿蒙 `buildMode`+NetworkKit）——本批**只端到端兑现 Android**；壳定位已收口（`hosts/*` 仅框架测试，CLI 生成宿主=项目自有）。
- **iOS 签名切换器（#657，两台电脑 office/home 分档）**：办公室机（kagsdeimac）已上档 `lyl@shxuxi.cn`；★**设备端需"信任新证书"**（设置→通用→VPN与设备管理——iOS 强制步骤；若 App 启动被拦先点这个）；**回家用机首次** `bash hosts/ios/signing.sh use <家里账号>` 上档一次即可；自查 `bash hosts/ios/signing.sh status`。
- **★超应用 CSS 能力扩展（主线，进行中）**：计划 `docs/proteus-superapp-css-expansion-plan.md`（5 个新族 **F1 定位 / F2 filter / F3 排版 / F4 交互态与伪元素 / F5 滚动**；裁定 A→E 顺序）。**★批 A（定位族）已收官**：fixed / sticky（全三端）· z-index 数值→语义层映射（#658）· 验收页 E 案例 + 四端验证（Android/iOS/鸿蒙红片在最上+Web 基准+MP 产物级）+ `css:verify z-index` 三段判据全过。**剩余**：
  · **iOS/鸿蒙的滚动锚定像素证据待补**（批 A⑤ 欠账；装置问题：iOS superapp 空跑起的是 `bundle-superapp.js` 而非 css-conformance ⇒ `--screen=` 无处可去；鸿蒙 `superapp-screen-*` 无滚动参数）。fixed/sticky 的 iOS/鸿蒙**实现已编译验证**（swiftc/HAP），仅缺滚动像素。
  · **批 B–E（F2 filter/backdrop-filter · F3 排版增强 · F4 状态伪类与伪元素 · F5 滚动增强）全部待做**。
  · **z-index v1 边界（#658 具名）**：负值 / stacking context 完整语义 / relative·sticky·flex·grid item 的 z 不生效——后续如需扩展从此处接。
- **★★（2026-10-10 · 已解决 #745）判据 ㉑（元素/文本混排）iOS 真机红** —— 根因 = `slot-runtime/instantiate.ts` 的 `normalizeWhiteSpace` **逐叶 `.trim()`** 吞混排行内空格（共享路径 ⇒ 三端都中）；修法 = collapse-only（不 trim）；三端真机重跑 ㉑ 全绿 + `check:vapor-three-end` 真机新证据（详见决策 #745）。
- **★环境更正**：iOS 一直可用（Xcode **26.5** 在 `/Volumes/data1/work/office-applications/Xcode.app`，iPhone 12 在线）；用 `source hosts/ios/lib/xcode-env.sh`（自动选 26.5）。
- **（2026-10-10 · 已修 #748）CI `verify` job 缺两处测试前置**：`pnpm test` 里的非 e2e 测试硬依赖 **Chromium**（consistency-web-probe）+ **`examples/dist/app/android/screen-content.json`**（app-screen-content-gate），而 verify job 未装浏览器、App 产物构建排在 `pnpm test` 之后 ⇒ 干净克隆/CI 必红（本地被残留掩盖）。已补：`pnpm test` 前加 `npx playwright install --with-deps chromium` + `pnpm run build:android`。

**★★（2026-10-10 发现·pre-existing）两条待修（不在 #742 的 5 红内）**：① **鸿蒙 executor 腿**真机复跑得 `app-stack-executor.json` `exec_content_nodes:0`（提交版为 114——已**保留提交版已知好证据**，未覆盖）⇒ 待查该腿真机为何零节点。② `check:host-invoke-contract` 报 harmony 未知方法 `dev.console`（**干净树同样红**）⇒ 登记表与实现漂移，待收口。
- **多端逐页视觉验收（长欠账）**：css-conformance **31 页** × 4 端逐页截图 + 独立子代理终评（现只覆盖代表页）。
- **鸿蒙签名现状（环境态，非代码）**：本机 `~/.ohos/config/*.p7b` 已可签 `dev.proteus.host`（**2026-10-10 真机装起+跑通**）；另一绑定 `dev.proteus.cssconf`（`--css` 产品）。★hdc 陷阱：若先用旧版 hdc（如 OpenHarmony SDK 1.3.0a）启了 hdc server，再混用 3.2.0d client 会报 `sdk hdc.exe version is too low` ⇒ `pkill -f "hdc -m"` 后用 DevEco 自带 hdc 单跑。
- **官网域后续**：可继续通读其余指南页（13 布局 / 19 平台 API / 22 Skyline 等）是否仍含"双端"旧叙事。
- **（已完成，勿重做）** iOS `styleOf` 透传覆盖门禁已落地（`pnpm check:ios-style-keys`，决策 #650）——本会话抓出并修掉 `borderRadiusPct` / `animation` 两处静默降级。

**长期注意事项（仍在场）**
- ⚠ **CDP 视觉验收纪律**（2026-09-04 用户强反馈「你懂什么叫居中吗」）：官网改样式必须 CDP 截图 + **数值级核对**（居中/上下间距对称、偏差 <4px，禁目测）；布局壳禁用带默认布局语义的组件（`p-view` 默认 `flex-column` 会盖 `justify-content:center`——同源坑三次）。
- ⚠ **根 `vue-tsc` 零错误**须持续保持。
- **Skyline iOS 真机白屏**（微信平台已知问题，roadmap v0.5）：真机实测时记录复现路径（决策 #69）。

**历史已完工单（2026-08～09，全 ✅，勿重做）**：框架拆包 45 包 + npm 发布 · 组件库 P0 · i18n/devtools/types/security/app-plan B1 · 构建缓存 M8 · G-32 语义原语（capability 50/50、工程原语 28/28）等——详见 `docs/project-memory-archive/2026-09.md` 与 `decisions.md`（#1–#507）。

## 后续规划（更新于 2026-09-02，★以「当前状态速览」为准）

**主路线（G-32 完整语义落地，决策 #303-#311 链）**：
- **G-32 B3 续**：⑤ Capability **50/50 收官**（七/八期 12 能力：map(C4)/sms(C22)/background(C25)/socket-task(C28)/data-channel(C31)/cookie(C32)/face-id(C39)/in-app-purchase(C46)/mini-program(C47)/embedded(C48)/live(C49)/extension(C50)——web 真实 document.cookie·visibilitychange·WebSocket·WebAuthn + wx 原生 createMapContext·navigateToMiniProgram·startSoterAuthentication facial·onAppHide/Show·SocketTask·storage Cookie + 宿主桥 data-channel/embedded/live/extension 诚实降级，决策 #323）
- **G-32 B5**：⑥ 工程原语 28（**★★28/28 收官：首期 E1 useState/E2 useComputed/E3 useWatch/E6 useLifecycle/E7 useReady/E9 usePageParam（决策 #319）+ 续 E10-E17 路由语义化（决策 #320）+ 续二 E19-E23 动画（决策 #321）+ 续三 E24-E28 工程化（决策 #322）——`createEngineering`/`createRouterEngineering`/`createAnimationEngineering`/`createToolingEngineering` 注入式四工厂 + 组件形态 p-transition/p-animate（E19/E20 已 implemented）+ 纯声明工具 defineComponent/defineCapability**；B5 收官——唯一剩余 E18 router-link（声明式导航组件形态）待后续批次）；与 G-17 路由/G-34 HMR 协同
- **G-32 B6**：对照矩阵自动化（miniprogram-mapping 与 catalog 自动同步）+ codemod 完善（scroll-view/swiper AI 语义还原 + 路由名表）

**并行候选（按顺序）**：
- **G-29 B2**：RustBackend（SWC 生态 → 同一 CompilerIR——conformance IR Golden Test 已就绪，接入即可验证）
- **G-27 B6**：混合渲染（Texture Sharing 抽象 + 页面级切后端 + DevTools 可视化）
- **G-31 收尾**：B7 续（useFetch/useStorage 已收口——剩 router 语义化对齐）

**★已整合（决策 #312-#314）**：`docs/proteus-website-v3-plus/` 与 `docs/proteus-website-v3-final/`（未跟踪）的新内容 G-33/G-34 已抽离入库为 **`docs/proteus-ai-agent-plan/`（G-36 AI Agent）** 与 **`docs/proteus-render-backend-spi-plan/`（G-37 RenderBackend SPI）**（编号避让：G-33=CLI、G-34=HMR 已实现占用）；**另发现同批 zip `proteus-compiler-backend-spi.zip`（pack.sh 产物）内含第三个新 plan——CompilerBackend SPI 原稿 G-35（与 app-config 冲突）→ 一并整合为 **`docs/proteus-compiler-backend-spi-plan/`（G-38，含 verify.sh/pack.sh/MANIFEST/conformance-runner.js 自检工具链）**；原稿引用 G-34（RenderBackend SPI）→ G-37、原则 #11（可插拔可验证）→ #13（含 #13.5-7 编译器专项子原则）同步重指向**；MCP Server（AI B1）、SPI 套件（G-37 B2）、编译器 SPI（G-38 B1）、宿主运行时 SPI（G-39 B1）可与既有 `@proteus-vue/render-backend`·`@proteus-vue/compiler-backend`·`@proteus-vue/renderer-app` 实现互为印证。**另发现第四 plan `proteus-host-runtime-plan`（未跟踪，原稿 G-36 与 AI Agent 冲突 + 兄弟引用旧编号）→ 按 #312 同法整合为 **`docs/proteus-host-runtime-plan/`（G-39，编号避让 G-36→G-39 / G-34→G-37 / G-35→G-38 / 原则 #11→#13，决策 #314）**。

**遗留已知限制**（★2026-09-19 复核）：~~tabBar 100vh 遮挡~~ **已实测关闭**（Skyline 的 100vh **按页面类型解析**——tabBar 页得 `windowHeight`=762（底边恰在 tabBar 顶边）、非 tabBar 页得 `screenHeight`=844 满屏 ⇒ 不存在遮挡；已加几何回归锁）。**仍存**：半屏页 / 长列表 list-view 摊平 / 下拉刷新 Web 端未桥接；其余 roadmap 大项（v0.5 多端 / v0.6 App+Vapor / v1.0 生产可用）见 docs/roadmap.md。

## 会话恢复指引（新 LLM 按此顺序阅读）

0. **★★★先挂载效率规范 Skill（每会话强制）**：执行 `Skill(ai-efficiency-rules)`
   （文件 `.agents/skills/ai-efficiency-rules/SKILL.md`），再开始任何工具调用——
   约束固定 `sleep` 盲等 / 重复拉取远程资源 / 重复读文件 / 无归因重试 / 该并行却串行 / 输出爆炸。
   同规则见根目录 `AGENTS.md` §0。
1. `PROJECT_MEMORY.md`（本文件）—— **★先读顶部「当前状态速览」**（只保留最近 3 条）：架构方向 / 最近里程碑 / 当前数量 / 路线图位置 / 待决项；**详细历史与决策链全文在 `docs/project-memory-archive/`（按月归档 + decisions.md，勿整读、按号/关键词 grep）**。
2. `docs/proteus-architecture.md` —— **L0 规约（真理来源）**：原则 #0-#12 + 铁律 + 十系规则总表（G-31.1-4/CMP005-8/RND001-005 等）
3. `docs/board-inventory.md` —— **架构规划全景（v2）**：六层 plan 分层索引 + 双路线对照 + 资产对照（改新增 plan/包后同步此表）
4. `docs/proteus-positioning-v3.md` —— 对外门面（slogan One semantic model. Any render engine.）
5. `docs/roadmap.md` + `docs/roadmap-2-plan/` —— 版本线 + 里程碑线（M1 双 SPI 原型 → M2 能力 → M3 生态）
6. `LLM_IMPLEMENTATION_GUIDE.md` —— §0 痛点对照 + 阶段任务指令
7. `packages/compiler/src/transforms/registry.ts` + `README.md` —— 编译规则注册表（AI 说明书，改动编译器前先查）
8. `proteus.config.ts` —— 当前配置；`examples/pages/` 是 Playground 演示
9. **多 AI 协作开发规范（决策 #871/#872/#874）**——**可执行形态 = `Skill(ai-development)`**（`.agents/skills/ai-development/SKILL.md`；规范正文 `docs/ai-development-spec.md`）：生命周期 7 关 × 三链路 A/B/C × 协作原语（任务单元 / 所有权边界 / 认领 / 交接 / 追溯）+ **反巨型化（源文件 < 1000 行）**；**认领任务 = 往 `docs/ai-tasks.json` 写一行**，门禁 `pnpm check:ai-tasks` / `pnpm check:file-size`。（A 链=开发框架 · B=G-36 用框架 · C=`Skill(ai-cobuild)` 外部缺陷）
10. **万神殿命名规范（决策 #879）**——`docs/Proteus_万神殿命名规范.md`：本仓模块/方案**代号命名 SSOT**（命名轴「**神职即模块职责**」+ 三纪律 N-1 只收神话神名 / N-2 体系内不得撞名 / N-3 定名前须商标检索 + **万神殿总览** + 排除名单 + 新命名七步）。**新增/改名模块代号 → 先过该规范再登记。**

**关键包地图（决策 #314 后）**：`@proteus-vue/render-backend`（G-27 五后端 + conformance）· `@proteus-vue/component-ir`（G-31 C-IR + G-32 128 原语 SSOT + audit）· `@proteus-vue/compiler-backend`（G-29 编译器 SPI + NodeBackend）· `packages/compiler-backend-rust`（G-29 B2 RustBackend cargo crate——同一 CompilerIR）· `@proteus-vue/gesture`（G-32 ④）· `@proteus-vue/api/capability.ts`（G-32 ⑤ useXxx 50/50——传感器/WebAuthn/useAuth/近场媒体/收官 12 能力）· `@proteus-vue/api/router-engineering.ts`（G-32 B5 续 E10-E17 路由语义化）· `@proteus-vue/api/animation-engineering.ts`（G-32 B5 续二 E21-E23 动画 Hook）+ `src/components/p-transition`·`p-animate`（E19/E20 组件形态，IR engineering.transition/animate implemented）· `@proteus-vue/api/tooling-engineering.ts`（G-32 B5 续三 E24-E28 工程化 Hook + define 工具）· `@proteus-vue/api/request-engineering.ts`（请求数据层 R1-R4：策略请求/useQuery SWR/enqueue/去重）· `@proteus-vue/compat-miniprogram`（G-31 B6 迁移）· `@proteus-vue/desktop`（G-24 B1 桌面交互原语——v-p-hover/-shortcut/-focus-trap/-context-menu）· `src/components/p-*`（57 组件聚合导出）；规划 SPI（同批四 plan：G-36 AI Agent / G-37 RenderBackend SPI / G-38 CompilerBackend SPI / G-39 Host Runtime SPI，均有规约 + conformance 套件 + 参考实现，与既有包互为印证）

