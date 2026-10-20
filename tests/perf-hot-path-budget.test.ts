// tests/perf-hot-path-budget.test.ts
// ★★★决策 #1099（2026-10-19）：**P0 基线的第一个真结论——诊断代码跑在生产热路径上**
//
// 【这一轮量到了什么（Android 真机，superapp 桌面入口 drive，26 次 JS 同步段）】
//   开采样前基线：单次切屏 `__proteusSuperappRender` = 101–114ms，其中 `mount()` 占 101ms。
//   把 mount 内部按相位拆开后：
//      像素自检 `sample()` = 63.4ms  ← **62%**（整屏画进 bitmap + 每 12px 网格取色）
//      内核建树 layout      = 1.5ms
//      emitAll（出绘制指令）= 8.2ms
//      JS 实例化（总 − 宿主）= 3ms
//   ⇒ **最大的"长任务"不是 JS、也不是布局，是诊断口径的像素采样**。
//     而 `painted_samples`/`painted_colors` 只被**探针判据**读（`check-app-screen-content` /
//     `js-render` 场景），真实应用路径没有任何消费者。
//
// 【判据（守两件事，缺一不可）】
//   ① **默认仍必须开**——存量探针（js-render / app-screen-content）的 `painted_samples > 0`
//     是它们的放行判据；把默认改 false 会让那批判据静默变假（这是"偷性能换假绿"）。
//   ② **应用壳必须显式关**——`SuperappActivity`（框架参考壳）与 CLI 模板 `AppActivity`（真·生成的 App）
//      都在切屏热路径上，必须调用 `setPaintSampling(false)`。
//      ★漏一处 = 那个壳每次切屏白烧 60ms（本判据就是防这条回潮）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const VAPOR_HOST = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java'
const SUPERAPP_ACTIVITY = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java'
const CLI_APP_ACTIVITY = 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'

describe('★#1099 像素自检是可开关的诊断口径', () => {
  it('默认开（存量探针读 painted_samples，不得静默失效）', () => {
    const v = read(VAPOR_HOST)
    expect(v).toMatch(/private boolean paintSampling = true/)
    expect(v).toMatch(/public void setPaintSampling\(boolean on\)/)
  })

  it('采样仍走 sample(0)/sample(1) 且写回同一对字段（语义未变）', () => {
    const v = read(VAPOR_HOST)
    expect(v).toMatch(/if \(paintSampling\) \{.*lastPaintedSamples = sample\(0\); lastPaintedColors = sample\(1\);/)
  })

  it('★应用壳必须关掉（否则每次切屏白烧 ~60ms）', () => {
    for (const f of [SUPERAPP_ACTIVITY, CLI_APP_ACTIVITY]) {
      expect(read(f), `${f} 未关闭诊断像素采样`).toMatch(/draw\.setPaintSampling\(false\)/)
    }
  })
})

describe('★#1099 mount 相位耗时是可比读数（P1/P2 切片的依据）', () => {
  it('宿主侧 mount 拆分出 measure / layout / wrap / emit / scroll 五项', () => {
    const v = read(VAPOR_HOST)
    for (const field of ['lastMeasureMs', 'lastLayoutMs', 'lastWrapMs', 'lastEmitMs', 'lastScrollMs']) {
      expect(v.includes(field), `缺相位字段 ${field}`).toBe(true)
    }
  })

  it('运行时宿主桥记录 mount / applyOps 的宿主侧总耗时', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/SuperappRuntimeHost.java')
    expect(s).toMatch(/public long lastMountMs/)
    expect(s).toMatch(/public long lastApplyOpsMs/)
  })

  it('报告带出这些字段（判据可读；缺一项就无法归因）', () => {
    const a = read(SUPERAPP_ACTIVITY)
    for (const k of ['mount_host_ms', 'mount_measure_ms', 'mount_layout_ms', 'mount_wrap_ms', 'mount_emit_ms', 'mount_scroll_ms']) {
      expect(a.includes(k), `报告缺 ${k}`).toBe(true)
    }
  })
})

/* ════════════════════════════════════════════════════════════════════════════
 * ★★★#1100（2026-10-20）：**iOS 同口径相位拆分**——#1099 只归因了 Android。
 *
 * 【为什么必须两端同字段名（#1098 已立过的纪律，这里再守一次）】
 *   iOS 侧此前只有总耗时（30 次 / long 3 / max 92ms），**答不了"那 92ms 花在哪"**；
 *   而两端若各起字段名，读一次就要人肉对照 —— 读数不可比，等于没有基线。
 *
 * 【语义差异必须如实标注，不能假装两端一模一样】
 *   · `emit`(Android 出绘制指令流) ↔ `emit`(iOS 建 CALayer 树)：对位关系，不是同一个实现；
 *   · `rects`：iOS 特有（全量路径每帧读全量几何 JSON），Android 只在开滚动范围时读；
 *   · `sample`：iOS **恒 -1**——像素自检在 mount 之外，mount 内没有采样。
 *     ★这条最容易被"顺手填 0"毁掉：0 会被读成"采样耗时为零"，而真实情况是"没采样"。
 * ════════════════════════════════════════════════════════════════════════════ */
const IOS_SELFDRAW = 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'
const IOS_RUNTIME_HOST = 'hosts/ios/ProteusHost/runtime/superapp-runtime-host.swift'
const IOS_SUPERAPP_SCENE = 'hosts/ios/ProteusHost/shell/superapp-scene.swift'

describe('★#1100 iOS mount 相位与 Android 同口径', () => {
  it('iOS 也拆出 measure / layout / wrap / emit / scroll 五项（+ iOS 特有的 rects）', () => {
    const s = read(IOS_SELFDRAW)
    // ★只查"字段存在"会漏掉"有字段没埋点"（本判据首版踩过：删掉埋点仍绿）。
    //   ★也不能只数赋值次数——`render()` 开头有一条 `= -1` 复位，它会让"删掉埋点"照样凑够数。
    //   正确判据：**排除复位与声明后**，每个字段至少还有一处真实埋点（赋值为某个耗时变量）。
    for (const field of ['lastMountMeasureMs', 'lastMountLayoutMs', 'lastMountWrapMs',
                         'lastMountEmitMs', 'lastMountScrollMs', 'lastMountRectsMs',
                         // ★第二层：emit 内部三段（真机实测 emit = mount 的 92%）
                         'lastMountFlatMs', 'lastMountLayersMs', 'lastMountPostMs',
                         // ★第三层：post 内部四项（实测 post 占 emit 63%）
                         'lastMountPinMs', 'lastMountAnimMs', 'lastMountSvgMs', 'lastMountGlassMs']) {
      const all = s.match(new RegExp(`${field}\\s*=\\s*[^\\n]*`, 'g')) ?? []
      const real = all.filter((line) => !/=\s*-1(\.0)?\s*$/.test(line.trim()))
      expect(real.length, `${field} 只有声明/复位、没有真实埋点（删掉埋点这条必须红）`).toBeGreaterThanOrEqual(1)
    }
  })

  it('相位读数每次渲染先复位（否则上一屏旧读数冒充本屏——#710 恒定读数同族）', () => {
    const s = read(IOS_SELFDRAW)
    // render() 开头必须把本组字段清成 -1
    expect(s).toMatch(/private func render\(treeJson[\s\S]{0,400}lastMountMeasureMs = -1; lastMountLayoutMs = -1; lastMountRectsMs = -1/)
  })

  it('layout 只包内核建树/create（不含 rects 读取，与 Android lastLayoutMs 同义）', () => {
    const s = read(IOS_SELFDRAW)
    expect(s).toMatch(/let tCreate0 = CFAbsoluteTimeGetCurrent\(\)[\s\S]{0,200}proteus_layout_create/)
    expect(s).toMatch(/proteus_layout_create\(\$0\)[\s\S]{0,300}lastMountLayoutMs = /)
  })

  it('rects 读取单列计时（iOS 特有开销，不得混进 layout 掩盖归因）', () => {
    const s = read(IOS_SELFDRAW)
    expect(s).toMatch(/let tRects0 = CFAbsoluteTimeGetCurrent\(\)[\s\S]{0,200}proteus_layout_rects/)
    expect(s).toMatch(/proteus_layout_rects\(handle\)\)[\s\S]{0,200}lastMountRectsMs = /)
  })

  it('★sample 在 iOS 恒 -1（mount 内没有像素采样，不得伪造 0）', () => {
    const s = read(IOS_SELFDRAW)
    expect(s).toMatch(/private\(set\) var lastMountSampleMs = -1\.0/)
    const statFn = s.match(/func mountPhaseStats\(\)[\s\S]{0,600}?\n    \}/)
    expect(statFn, '未找到 mountPhaseStats').toBeTruthy()
    expect(statFn![0]).toMatch(/"sample_ms": lastMountSampleMs/)
    // ★全文件只允许**声明处**那一次赋值（= -1.0）。任何后续赋值都意味着"往里填了数"——
    //   0 会被读成"采样耗时为零"，而真实情况是"没采样"（诚实边界不得涂改）。
    const assigns = s.match(/lastMountSampleMs\s*=/g) ?? []
    expect(assigns.length, 'lastMountSampleMs 被额外赋值（应恒为 -1）').toBe(1)
    expect(s).toMatch(/lastMountSampleMs = -1\.0/)
  })

  it('运行期宿主桥记录 mount / applyOps 宿主侧总耗时（与 Android 同名）', () => {
    const s = read(IOS_RUNTIME_HOST)
    expect(s).toMatch(/private\(set\) var lastMountMs = -1\.0/)
    expect(s).toMatch(/private\(set\) var lastApplyOpsMs = -1\.0/)
    expect(s).toMatch(/let t0 = CFAbsoluteTimeGetCurrent\(\)[\s\S]{0,200}lastMountMs = /)
    expect(s).toMatch(/lastApplyOpsMs = \(CFAbsoluteTimeGetCurrent\(\) - t0\)/)
  })

  it('★iOS 报告带出与 Android 同名的相位字段（缺一项就无法跨端对照）', () => {
    const sc = read(IOS_SUPERAPP_SCENE)
    for (const k of ['mount_host_ms', 'apply_ops_host_ms', 'mount_measure_ms', 'mount_layout_ms',
                     'mount_wrap_ms', 'mount_emit_ms', 'mount_scroll_ms']) {
      expect(sc.includes(k), `iOS 报告缺 ${k}`).toBe(true)
    }
    // iOS 特有项如实另列
    for (const k of ['mount_rects_ms', 'mount_sample_ms']) {
      expect(sc.includes(k), `iOS 报告缺 ${k}`).toBe(true)
    }
    // ★第二层：emit 内部三段（缺一项就答不了"建层那 85ms 花在哪"）
    for (const k of ['mount_flat_ms', 'mount_layers_ms', 'mount_post_ms']) {
      expect(sc.includes(k), `iOS 报告缺 ${k}`).toBe(true)
    }
    // ★第三层：post 内部四项
    for (const k of ['mount_pin_ms', 'mount_anim_ms', 'mount_svg_ms', 'mount_glass_ms']) {
      expect(sc.includes(k), `iOS 报告缺 ${k}`).toBe(true)
    }
  })

  it('★每次 mount 进历史环（只报末次会把首屏 93ms 丢掉，切屏成本被低估 3 倍）', () => {
    const s = read(IOS_SELFDRAW)
    expect(s).toMatch(/private var mountHistoryMs: \[\[String: Double\]\] = \[\]/)
    expect(s).toMatch(/private static let mountHistoryCap = 8/)
    // 环必须有上限（无界增长 = 内存泄漏，本仓已踩过）
    expect(s).toMatch(/mountHistoryMs\.removeFirst\(mountHistoryMs\.count - SelfDrawBridge\.mountHistoryCap\)/)
    // mount() 里必须真的记录（不是只有字段）——先定位**实现**（协议声明行不带 `{`），再在同一函数体内找 append
    const mountDecl = /func mount\(_ treeJson: String\) -> String \{/g
    const decls = [...s.matchAll(mountDecl)]
    expect(decls.length, '找不到 mount() 实现（只有协议声明不算）').toBeGreaterThan(0)
    const mountStart = decls[decls.length - 1].index!
    const mountBody = s.slice(mountStart, s.indexOf('func update(_ treeJson: String) {', mountStart))
    expect(mountBody).toMatch(/mountHistoryMs\.append\(rec\)/)
    expect(read(IOS_SUPERAPP_SCENE)).toMatch(/o\["mount_history"\]/)
  })
})

/* ════════════════════════════════════════════════════════════════════════════
 * ★★★#1101：**玻璃遍子相位**——#1100 把 iOS 切屏拆到 glass=21.1ms（带玻璃屏的 59%），
 *   但"玻璃遍慢"本身不能动手：它内部有隐藏/栅格化/模糊/Metal/装面五段，成本完全不同源。
 *   本组判据守两件事：
 *     ① 五段**都在**且**都有真实埋点**（不是只加了字段）；
 *     ② 早退语义没被破坏——无玻璃时必须**零开销早退**（否则每个屏都白烧一次子相位）。
 * ════════════════════════════════════════════════════════════════════════════ */
describe('★#1101 iOS 玻璃遍子相位', () => {
  it('拆出 hide / raster / blur / metal / install 五段（+ 总量 / 捕获像素 / 玻璃块数）', () => {
    const s = read(IOS_SELFDRAW)
    for (const f of ['lastGlassHideMs', 'lastGlassRasterMs', 'lastGlassBlurMs',
                     'lastGlassMetalMs', 'lastGlassInstallMs', 'lastGlassTotalMs']) {
      expect(s.includes(f), `缺玻璃子相位字段 ${f}`).toBe(true)
    }
    // 捕获像素数必须可读——否则"栅格慢"无法归因到面积（裁剪撑大是最常见原因）
    expect(s).toMatch(/lastGlassCropPx/)
    expect(s).toMatch(/lastGlassCount/)
  })

  it('★每段都有真实计时（不是只声明字段——删掉计时表达式必须红）', () => {
    const s = read(IOS_SELFDRAW)
    // ★关键：真实埋点是局部 `xxxMs = (CFAbsoluteTimeGetCurrent() - tXxx0) * 1000`，
    //   而不是末尾那次 `lastGlassXxxMs = xxxMs`。只查后者会被"删掉计时仍绿"骗过（本轮实测）。
    const SEGS: Array<[string, string]> = [
      ['hide', 'capHideMs'],
      ['raster', 'rasterMs'],
      ['blur', 'blurMs'],
      ['metal', 'metalMs'],
      ['install', 'installMs'],
    ]
    for (const [phase, local] of SEGS) {
      const re = new RegExp(`${local}\\s*=\\s*\\(CFAbsoluteTimeGetCurrent\\(\\)\\s*-\\s*t\\w+0\\)\\s*\\*\\s*1000`)
      expect(re.test(s), `玻璃 ${phase} 段没有计时表达式（只有字段声明不算埋点）`).toBe(true)
    }
    // 五段必须被写回读数（否则界面上取不到）
    for (const f of ['lastGlassHideMs', 'lastGlassRasterMs', 'lastGlassBlurMs',
                     'lastGlassMetalMs', 'lastGlassInstallMs']) {
      expect(s).toMatch(new RegExp(`${f} = `))
    }
  })

  it('★无玻璃时仍零开销早退（子相位不得给每个屏都加一次全流程）', () => {
    const s = read(IOS_SELFDRAW)
    const fn = s.slice(s.indexOf('func applyGlassPass()'))
    const head = fn.slice(0, fn.indexOf('let size = bounds.size'))
    expect(head, 'applyGlassPass 首行必须是"无玻璃直接 return"').toMatch(/guard !glassSpecByNodeId\.isEmpty else \{ return \}/)
    // 早退必须在计时开始**之前**（否则"无玻璃"也会记一堆 0，读数无法区分"没玻璃"与"玻璃零成本"）
    expect(head.indexOf('guard !glassSpecByNodeId.isEmpty')).toBeLessThan(head.length)
    expect(head).not.toMatch(/CFAbsoluteTimeGetCurrent/)
  })

  it('报告带出玻璃子相位（mount_history 逐次 + glass_phase 末次）', () => {
    const s = read(IOS_SELFDRAW)
    expect(s).toMatch(/for \(k, val\) in v\.glassPhaseStats\(\) \{ rec\["glass_" \+ k\] = val \}/)
    expect(read(IOS_SUPERAPP_SCENE)).toMatch(/o\["glass_phase"\]/)
  })

  it('★CIContext 必须复用（每帧新建 = 每帧付一次上下文初始化；真机模糊段 10.6ms）', () => {
    const s = read(IOS_SELFDRAW)
    // 只允许**声明处**一次构造；`applyGlassPass` 内不得再 `CIContext(options:)` 新建
    //   ★排除注释行（注释里会提到 `CIContext(options: nil)` 这个写法——按代码行判才准）
    const codeLines = s.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    const ctor = codeLines.join('\n').match(/CIContext\(options:/g) ?? []
    expect(ctor.length, 'CIContext 被多次构造（应复用一份 sharedCIContext）').toBe(1)
    expect(s).toMatch(/private static let sharedCIContext = CIContext\(options: nil\)/)
    expect(s).toMatch(/let ctx = SelfDrawView\.sharedCIContext/)
  })
})
