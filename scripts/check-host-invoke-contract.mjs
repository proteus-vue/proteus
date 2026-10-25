#!/usr/bin/env node
// scripts/check-host-invoke-contract.mjs —— ★★★B2（G4）：宿主 `proteusHost.invoke` **方法契约**门禁
//
// 【它防什么】`screen.*` + 能力族方法名此前**手抄**在各端宿主里⇒漂移（实测：iOS 漏 webassembly.*、
//   鸿蒙缺整个能力族）。本门禁据**代码事实**：① 各端声明的方法 ⊆ 契约（未知方法 ⇒ 红，防拼写/私增）；
//   ② `screen.*` 三端**完全一致**（M5 执行器协议）；③ 各端能力覆盖率**如实报告**（缺失列出，不静默）。
//
// 契约 SSOT：packages/render-backend/src/host-invoke-contract.ts（编译到 dist）。
// 用法：node scripts/check-host-invoke-contract.mjs
// 退出码：0 通过（含"如实报告缺失但不致命"）/ 1 违反（未知方法 / screen 不一致）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (p) => path.relative(ROOT, p)
const problems = []
const notes = []

// ① 契约（dist）
const dist = path.join(ROOT, 'packages/render-backend/dist/host-invoke-contract.js')
if (!fs.existsSync(dist)) {
  console.error(`✗ 缺 ${rel(dist)} —— 先跑 pnpm build-packages（本门禁读编译后契约）`)
  process.exit(1)
}
const { HOST_CAPABILITY_METHODS, HOST_SCREEN_METHODS, HOST_METHOD_OPTIONAL } = await import(pathToFileURL(dist).href)
const contract = new Set([...HOST_CAPABILITY_METHODS, ...HOST_SCREEN_METHODS])

/**
 * 从源码抽取方法分派用的方法名字面量（**四种真实形态**）。
 *
 * ★2026-10-19（决策 #1080）：初版**无条件收所有** `case "..."` ⇒ 设备实现里的业务 switch
 *   （`switch (kind) { case "gyroscope": … }`）被当成"宿主方法名"，门禁误报"未知方法 gyroscope"。
 *   ⇒ 按**方法名形态**过滤：必须是 `a.b`（含点）或是**已登记的契约方法**。业务枚举值一律排除。
 *
 * ★2026-10-19（决策 #1090）：补齐另外三种形态——此前只认 ①②，**实现了也报缺**：
 *   ③ `if f.method == "http.request"`（Swift 属性比较）——iOS 字节腿就是这个形态
 *      ⇒ 门禁一直报「ios 缺 http.request」，而 `http-capability.swift` 早已实现（数字低报）。
 *   ④ `method.equals("http.request")`（Java 反向调用）
 *   ★教训同 #1080/#1081：**门禁覆盖面必须跟着实际形态走**——换了写法就静默漏判，
 *     而它输出的"覆盖率"看起来仍然权威。
 */
function extractCases(file) {
  const out = []
  const contractNames = new Set([...HOST_CAPABILITY_METHODS, ...HOST_SCREEN_METHODS])
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8')
  const push = (name) => {
    if (name.includes('.') || contractNames.has(name)) out.push(name)
  }
  for (const m of text.matchAll(/case\s+"([^"]+)"/g)) push(m[1])                                  // ① switch 分支
  for (const m of text.matchAll(/"([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)"\.equals\(\s*method\s*\)/g)) push(m[1]) // ② Java 前缀判定
  for (const m of text.matchAll(/method\.equals\(\s*"([^"]+)"\s*\)/g)) push(m[1])                  // ③ Java 反向
  for (const m of text.matchAll(/\bmethod\s*==\s*"([^"]+)"/g)) push(m[1])                          // ④ Swift 属性比较
  return out
}
/** 扫目录：对每个匹配文件跑 extractCases 并合并（排除探针/工具/自测——它们不是运行期实现）。 */
function extractCasesInDir(dir, extRe) {
  const out = []
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const p = rel + '/' + e.name
      if (e.isDirectory()) {
        if (!/(^|\/)(tools?|probe|selftest)(\/|$)/i.test(p)) walk(p)
      } else if (extRe.test(p) && !/probe|selftest|tools?\//i.test(p)) {
        out.push(...extractCases(p))
      }
    }
  }
  walk(dir)
  return out
}

/** 从源码抽取 `method == "xxx"`（C++）。 */
/**
 * 从派发函数里抽 `method == "..."`（同 extractMethodEq，但显式声明用途：
 * 鸿蒙 `fs.*` 走 `dispatch()` 的前缀判定，字面量在 dispatch 内部）。
 * ★★#1226：不补这条扫描面 ⇒ 已实现的 fs 方法会被算成未覆盖（#1121 同族）。
 */
function extractFsDispatch(file) {
  return extractMethodEq(file).filter((m) => m.startsWith("fs."))
}

function extractMethodEq(file) {
  const out = []
  for (const m of fs.readFileSync(path.join(ROOT, file), 'utf-8').matchAll(/method\s*==\s*"([^"]+)"/g)) out.push(m[1])
  return out
}

const ENDS = {
  android: {
    screen: extractCases('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ScreenHost.java'),
    // ★★2026-10-19（决策 #1067）：设备域 12 项在**独立文件**（HostCapabilities 用前缀判定转发，
    //   不写 12 个 case）⇒ 覆盖率必须同时扫该文件，否则数字低报（"实现了但门禁看不见"）。
    // ★★2026-10-19（决策 #1090）：改**扫整个 runtime 目录**——具体文件清单每加一个实现就漏一个
    //   （实测：HttpCapability.java 早已实现 http.request，清单里没有它 ⇒ 数字低报）。
    capability: extractCasesInDir('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime', /\.(java|kt)$/),
  },
  ios: {
    screen: extractCases('hosts/ios/ProteusHost/runtime/screen-host.swift'),
    // ★同上：iOS 设备域在 device-capability.swift（host-capabilities 走前缀转发）
    // ★★2026-10-19（决策 #1090）：同样改扫目录——host-runtime-bridge.swift 里的
    //   if f.method == "http.request" 此前压根没被扫到（清单外文件）。
    capability: extractCasesInDir('hosts/ios/ProteusHost/runtime', /\.swift$/),
  },
  harmony: {
    // ★决策 #725：鸿蒙 `screen.*`（一处 `method == "..."` 分发）已按**中性名下沉**到 runtime HAR
    //   （`host_app_runtime_impl.h`，由 proteus_host.cpp 导出 hostAppBoot/Drive/Render）——壳不再依赖 dev。
    //   能力族鸿蒙仍未接线（覆盖率如实为 0），故 capability 从同一头抽（当前为空，如实报告）。
    screen: extractMethodEq('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h').filter((m) => m.startsWith('screen.')),
    // ★★2026-10-19（决策 #1067）：设备域 12 项在 proteus_device.h（前缀判定转发）⇒ 一并抽取
    capability: [
      ...extractMethodEq('hosts/harmony/host-app/proteus_render/src/main/cpp/host_app_runtime_impl.h').filter((m) => !m.startsWith('screen.')),
      ...extractMethodEq('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_device.h'),
      // ★★★#1226：`fs.*` 在 proteus_fs.h 的 `dispatch()` 里（前缀判定转发，不写 4 个 case）
      //   ⇒ 不补扫就会把**已实现**的四个 fs 方法算成未覆盖（#1121 同族）。
      ...extractFsDispatch('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_fs.h'),
    ],
  },
}

for (const [end, sets] of Object.entries(ENDS)) {
  const all = [...sets.screen, ...sets.capability]
  // ① ⊆ 契约（未知 ⇒ 红）
  for (const meth of all) if (!contract.has(meth)) problems.push(`${end}: 未知方法「${meth}」（不在 host-invoke-contract）`)
  // ② screen.* 三端一致
  const screenSet = new Set(sets.screen)
  const missingScreen = HOST_SCREEN_METHODS.filter((m) => !screenSet.has(m))
  if (missingScreen.length) problems.push(`${end}: screen.* 缺 ${missingScreen.join(' / ')}（三端必须一致）`)
  // ③ 能力覆盖率（如实报告，缺失 = 非致命；已声明合法省略的端扣除）
  const optional = new Set(HOST_METHOD_OPTIONAL[end] ?? [])
  const capSet = new Set(sets.capability)
  const missingCap = HOST_CAPABILITY_METHODS.filter((m) => !capSet.has(m) && !optional.has(m))
  const covered = HOST_CAPABILITY_METHODS.filter((m) => capSet.has(m)).length
  if (missingCap.length) {
    notes.push(`${end}: 能力覆盖 ${covered}/${HOST_CAPABILITY_METHODS.length}（缺 ${missingCap.length}：${missingCap.slice(0, 6).join(', ')}${missingCap.length > 6 ? ', …' : ''}）`)
  }
}

console.log('宿主 invoke 方法契约门禁（screen.* 一致 + 能力 ⊆ 契约 + 覆盖率如实）')
for (const n of notes) console.log(`  ▸ ${n}`)
if (problems.length) {
  console.error(`\n❌ 违反（${problems.length}）：`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✅ 各端方法 ⊆ 契约 · screen.* 三端一致（能力覆盖缺项已如实列出，非静默）')
