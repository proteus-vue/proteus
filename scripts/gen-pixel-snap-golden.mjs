#!/usr/bin/env node
// scripts/gen-pixel-snap-golden.mjs —— ★卡 I2 跨语言坐标吸附 golden（生成 + 分类 + 校验）
//
// 【为什么需要（本仓纪律：跨端契约必须有机器判据）】
//   坐标吸附在**两处**实现：TS `packages/layout-core/src/pixel-snap.ts` 与
//   Rust `packages/layout-core-rust/src/snap.rs`。两侧各写一份后，"各自往返"等于自己跟自己对
//   ——若一端改了 half 口径（如把 `floor(v+0.5)` 换回原生 round），另一端不会红，
//   **真机上才炸**（三端差 1px，且只在半值/负数上出现，极难复现）。
//   ⇒ 把两侧对同一组输入的求值结果冻结成 golden，两侧测试各自比对。
//
// 【★本脚本自己分类（首版实测逼出来的设计）】
//   TS 侧是 f64、Rust 侧是 f32 —— 对"距 .5 边界 < f32 ulp/2"的输入，**同一十进制字面量**
//   在两侧解析成不同的浮点值 ⇒ 吸附结果差 1（首次生成 golden 时当场打红两例）。
//   那是**表示精度差异，不是算法差异**（两语言同式 `floor(v+0.5)`）。
//   ⇒ 生成器对每个用例**同时**求 f64 与 f32 两条路径：
//     · 两者一致 → 进 `scalars` / `boxes`（**严格相等**契约，两端测试都断言）
//     · 两者不一致 → 进 `precisionDivergence`（**已知差异台账**：两侧读数都被锁定，
//       谁改动其中任一环都会红——不允许"悄悄扫到地毯下"）
//   这样新增用例无需人工判断该放哪一段——分类由机器完成。
//
// 用法：
//   node scripts/gen-pixel-snap-golden.mjs          # 生成（改策略/加用例后）
//   node scripts/gen-pixel-snap-golden.mjs --check  # 校验（漂移即红；已接 CI）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapRect, snapCoord } from '../packages/layout-core/src/pixel-snap.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(ROOT, 'packages/layout-core-rust/tests/golden/pixel-snap.json')
const CHECK = process.argv.includes('--check')

// ── f32 求值路径（模拟 Rust：每个中间结果都经 Math.fround 落回 f32）──────────────
//   ★安全性：Math.fround(双精度中间值) 对「两个 f32 做 +/−」与直接 f32 运算等价
//     （f64 的 53 位 ≫ 2×24+2 ⇒ 不产生双舍入偏差）
const f32 = Math.fround
const snapCoordF32 = (v) => Math.floor(f32(f32(v) + 0.5))
const snapBoxF32 = (x, y, width, height) => {
  const [X, Y, W, H] = [f32(x), f32(y), f32(width), f32(height)]
  const L = snapCoordF32(X)
  const T = snapCoordF32(Y)
  const R = snapCoordF32(f32(X + W))
  const B = snapCoordF32(f32(Y + H))
  return { x: L, y: T, width: Math.max(0, f32(R - L)), height: Math.max(0, f32(B - T)) }
}

/** 用例：盒（x, y, w, h）——刻意包含 half 值、负数、跨零、亚像素、零尺寸、三列均分 */
const BOXES = [
  [0, 0, 100, 50],
  [0.5, 1.5, 2.5, 3.5],
  [-0.5, -1.5, 10.5, 4.5],
  [-2.5, 3.25, 7.75, 0.4],
  [0, 0, 100 / 3, 20], // 鸿蒙三列场景的边值
  [100 / 3, 0, 100 / 3, 20],
  [(100 / 3) * 2, 0, 100 / 3, 20],
  [10.5, 0, 33.5, 7.75],
  [0.3, 0, 10.4, 10],
  [5.25, 0, 5.45, 10],
  [12, 200, 600, 40],
  [-1e-4, -1e-4, 1e-4, 1e-4],
  [1.4999999, 2.5000001, 3.9999999, 4.0000001], // ★距 .5 边界 1e-7 —— 首版即在此打红
  [0.25, 0.75, 0.5, 0.5],
]

/** 半值/边界标量（直接测 snapCoord——盒子通过边缘间接覆盖，这里是显式锚点） */
const SCALARS = [0, 0.5, 1.5, 2.5, 3.5, 3.4999999, -0.5, -1.5, -2.5, -3.5, 10.5, -1e-4]

// ── 分类 ────────────────────────────────────────────────────────────────────
const scalarsStrict = []
const scalarsDivergent = []
for (const v of SCALARS) {
  const tsOut = snapCoord(v)
  const f32Out = snapCoordF32(v)
  if (tsOut === f32Out) scalarsStrict.push({ in: v, out: tsOut })
  else scalarsDivergent.push({ in: v, tsOut, f32Out, f32Value: f32(v) })
}
const boxesStrict = []
const boxesDivergent = []
for (const [x, y, width, height] of BOXES) {
  const tsOut = snapRect(x, y, width, height)
  const f32Out = snapBoxF32(x, y, width, height)
  const same = tsOut.x === f32Out.x && tsOut.y === f32Out.y
    && tsOut.width === f32Out.width && tsOut.height === f32Out.height
  if (same) boxesStrict.push({ in: { x, y, width, height }, out: tsOut })
  else boxesDivergent.push({ in: { x, y, width, height }, tsOut, f32Out })
}

const payload = {
  generatedBy: 'scripts/gen-pixel-snap-golden.mjs（★勿手改；改策略请重新生成）',
  note: '★卡 I2 跨语言 golden：TS `pixel-snap.ts`（f64）与 Rust `snap.rs`（f32）必须对同一输入给出同一结果。'
    + '策略 = 边缘吸附 floor(v+0.5)（刻意不用原生 round：负半值上两语言语义相反）。'
    + 'ts 与 f32 求值一致的用例进 scalars/boxes（严格相等）；不一致的进 precisionDivergence（已知台账，两侧读数均锁定）。',
  strategy: 'snap(v) = floor(v + 0.5)；盒 → L=snap(x) T=snap(y) R=snap(x+w) B=snap(y+h)，w=max(0,R-L) h=max(0,B-T)',
  scalars: scalarsStrict,
  boxes: boxesStrict,
  precisionDivergence: {
    note: '★表示精度边界（非算法差异）：输入距 .5 边界小于 f32 的 ulp/2 时，f32 解析值落在边界另一侧。'
      + '两侧公式相同（floor(v+0.5)）；同一端内不影响相邻元素对齐（边值同源 ⇒ 同一整数）。'
      + '不修（改 f64/定点代价远超收益）——改为锁定：任一环变化即红。',
    scalars: scalarsDivergent,
    boxes: boxesDivergent,
  },
}

const content = JSON.stringify(payload, null, 2) + '\n'

if (CHECK) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  if (existing !== content) {
    console.error(`✗ 跨语言吸附 golden 漂移：${path.relative(ROOT, OUT)}`)
    console.error('  ⇒ 跑 `node scripts/gen-pixel-snap-golden.mjs` 重新生成（并确认两侧测试随 golden 更新）')
    process.exit(1)
  }
  console.log(
    `✅ 跨语言吸附 golden 一致（严格 ${payload.scalars.length} 标量 + ${payload.boxes.length} 盒`
      + ` · 已知精度边界 ${payload.precisionDivergence.scalars.length} 标量 + ${payload.precisionDivergence.boxes.length} 盒）`,
  )
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, content)
  console.log(`[pixel-snap] ✅ 生成 ${path.relative(ROOT, OUT)}`)
  console.log(
    `    严格相等：${payload.scalars.length} 标量 · ${payload.boxes.length} 盒`
      + `（half 值 / 负数 / 亚像素 / 三列均分）`,
  )
  console.log(
    `    精度边界：${payload.precisionDivergence.scalars.length} 标量 · ${payload.precisionDivergence.boxes.length} 盒`
      + '（已分析、已锁定，见 golden 内注释）',
  )
  if (payload.precisionDivergence.scalars.length) {
    for (const d of payload.precisionDivergence.scalars) {
      console.log(`      · 标量 ${d.in}：TS(f64)→${d.tsOut} · Rust(f32=${d.f32Value})→${d.f32Out}`)
    }
  }
  if (payload.precisionDivergence.boxes.length) {
    for (const d of payload.precisionDivergence.boxes) {
      console.log(`      · 盒 ${JSON.stringify(d.in)}：TS→${JSON.stringify(d.tsOut)} · Rust→${JSON.stringify(d.f32Out)}`)
    }
  }
}
