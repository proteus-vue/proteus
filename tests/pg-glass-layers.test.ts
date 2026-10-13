// tests/pg-glass-layers.test.ts —— ★pg-glass 装饰层随圆角裁剪（决策 #886）
//
// 【它防什么】大圆角时玻璃内部冒出 4 个深色小方块——根因：装饰层（`.pg-glass__noise` 噪点 / 高光边）
//   是**方角**且玻璃根 `overflow: visible` ⇒ 方形噪点层的 4 个角**戳出圆角切掉的区域**（用户实测：
//   §05 交互调参 radius=48 时四角残留噪点矩形）。修法 = 装饰层 `border-radius: inherit`（随玻璃圆角裁剪）。
//   本测试从源码钉住：两个装饰层选择器**必须**带 `border-radius: inherit`（回归锁——删掉即红）。
//
// 【为什么用源码断言而非像素】Web 端像素断言需 CDP；此契约是"CSS 声明必须存在"的静态事实——
//   源码扫描即可锁（与 p-batch2-contract 等组件的源码契约测同法）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = fs.readFileSync(path.resolve(__dirname, '../packages/components/pg-glass/index.vue'), 'utf-8')

/** 取某选择器的样式块（简单取到下一个 `}`） */
function blockOf(selector: string): string {
  const i = SRC.indexOf(selector)
  expect(i, `找不到选择器 ${selector}`).toBeGreaterThanOrEqual(0)
  const j = SRC.indexOf('}', i)
  return SRC.slice(i, j)
}

describe('★pg-glass 装饰层随圆角裁剪（#886 大圆角四角方块修复）', () => {
  it('噪点层 .pg-glass__noise 带 border-radius: inherit（否则方角戳出圆角）', () => {
    expect(blockOf('.pg-glass__noise {')).toMatch(/border-radius:\s*inherit/)
  })

  it('高光边 .pg-glass__highlight 带 border-radius: inherit', () => {
    expect(blockOf('.pg-glass__highlight {')).toMatch(/border-radius:\s*inherit/)
  })

  it('内层容器 .pg-glass__in 带 border-radius: inherit（装饰层锚点随圆角）', () => {
    expect(blockOf('.pg-glass__in {')).toMatch(/border-radius:\s*inherit/)
  })
})
