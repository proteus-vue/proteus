#!/usr/bin/env node
// scripts/check-gradient-contract.mjs —— ★★渐变填充的**跨语言键名契约**门禁（渐变 v1，2026-10-01）
//
// 【为什么需要（与 check-svg-path-shape 同源的教训）】渐变是**宿主绘制属性**
//   （不参与内核计算——见 `packages/animation/src/gradient.ts` 文件头的边界说明），
//   由三端宿主各自实现（iOS `CAGradientLayer` / Android `Shader` / 鸿蒙 `OH_Drawing`）。
//   ⇒ "两端各写一份实现" 又会回到 C2 踩过的形态：**漏读一个键名 = 该维度静默降级**
//     （例：Android 忘了读 `alpha` ⇒ 渐变不透明明暗全变、而判据若只查"渐变建出来了"仍绿）。
//
// 【判据】键名清单的唯一事实源 = TS 的 `GRADIENT_CONTRACT_KEYS`（用 tsx 从源码读出）；
//   要求两端宿主源码**都出现**这些键名（任一侧漏 = 红）。
//   ★加字段时只改 `gradient.ts`（本门禁与两端检查一起跟进——与 hook 清单同一纪律：
//     "清单唯一事实来源"）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── ① 键名清单（唯一事实源：TS 模块）──
let keys
try {
  const raw = execFileSync(
    'npx',
    ['tsx', '-e', `import { GRADIENT_CONTRACT_KEYS as K } from ${JSON.stringify(path.join(ROOT, 'packages/animation/src/gradient.ts'))}; console.log(JSON.stringify(K))`],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 },
  )
  keys = JSON.parse(raw.trim().split('\n').pop())
} catch (e) {
  console.error(`✗ 渐变契约门禁：读 GRADIENT_CONTRACT_KEYS 失败——${(e && e.message) || e}`)
  process.exit(1)
}

// 两端消费端（各自实现渐变——必须引用全部键名）
// ★消费端可跨**多个文件**（解析面按职责分文件：Android 的 `fillGradient` 键在
//   LightsHost 读（写进 Cmd），子键在 ProteusHostView.GradSpec.parse 读）——
//   合并源码后检查，避免"文件选错 ⇒ 假红/假绿"。
const CONSUMERS = [
  { label: 'iOS 宿主（applyGradient）', files: ['hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'] },
  {
    label: 'Android 宿主（LightsHost 取键 + GradSpec 解析）',
    files: [
      'hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/LightsHost.java',
      'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java',
    ],
  },
  // ★★★鸿蒙宿主（2026-10-08 补）：此前**未纳入**本门禁 ⇒ 漏读键名不会被抓（实际已漏 `alpha`——
  //   发给渲染层的 stop 只带 color ⇒ `transparent` 变不透明黑，用户实测「案例 C 完全不对」）。
  //   解析面同样跨两文件：emit（proteus_host.cpp，把 fillGradient 折叠进 cmd + 并入 alpha）
  //   + render（proteus_render.cpp，解析 grad 的 kind/angle/stops/offset/color）。
  {
    label: '鸿蒙宿主（appScreenCommands 折叠 + proteus_render 解析）',
    files: [
      'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp',
      'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_render.cpp',
    ],
    // ★★具名边界（2026-10-08 · 补鸿蒙进本门禁时如实登记）：鸿蒙当前**只实现线性渐变**——
    //   · 已实现：fillGradient / kind / linear / radial(仅识别字符串) / angle / stops / offset / color / alpha
    //   · **未实现**（下列键在本端不出现，属真缺口、已登记，非静默）：
    //       cx / cy            —— 径向渐变的圆心/半径（本端不画 RadialGradient）
    //       fillGradientTo     —— 渐变**形变**（morph）
    //       mask / softness / progress —— 软边遮罩（mask v1）
    //   ⇒ `only` = 本端**实际消费**的键；未实现项在此**具名**（不是沉默跳过）——待补鸿蒙径向/遮罩时
    //     把键移入 `only` 即可（门禁随之收紧）。
    only: ['fillGradient', 'kind', 'linear', 'radial', 'angle', 'stops', 'offset', 'color', 'alpha'],
  },
  // ★适配器只需透传**顶层键**（子键由宿主解析）——否则请求树不带声明（与 clipPath 漏键同款静默）
  { label: '自绘适配器（LAYOUT_KEYS 透传）', files: ['packages/renderer-app/src/adapters/selfdraw.ts'], only: ['fillGradient'] },
]

let bad = 0
console.log(` 契约键名（唯一事实源 = animation/src/gradient.ts）：${keys.join(' / ')}`)
for (const c of CONSUMERS) {
  const missingFiles = c.files.filter((f) => !fs.existsSync(path.join(ROOT, f)))
  if (missingFiles.length > 0) {
    console.error(`  ❌ ${c.label}：文件不存在（${missingFiles.join(', ')}）`)
    bad++
    continue
  }
  // ★引号两种都算（Swift 用双引号、TS 用单引号）——查的是"真实字符串字面量"，
  //   注释里的同名词不算（避免"注释提一下键名就假绿"）。
  const src = c.files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  const need = c.only ?? keys
  const missing = need.filter((k) => !src.includes(`"${k}"`) && !src.includes(`'${k}'`))
  if (missing.length > 0) {
    console.error(
      `  ❌ ${c.label}：缺键名 ${missing.join(', ')}——该维度在本端静默降级（渐变读不全）`,
    )
    bad++
  } else {
    console.log(`  ✅ ${c.label}：覆盖全部契约键名`)
  }
}

if (bad > 0) {
  console.error('\n✗ 渐变跨语言契约不一致（三端 + 适配器必须读同一份键名）')
  process.exit(1)
}
console.log('\n✅ 渐变跨语言契约一致（TS 声明 ⇄ 三端宿主 ⇄ 适配器透传）')
