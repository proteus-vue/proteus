// tests/pg-glass-layers.test.ts —— ★pg-glass 装饰层被圆角裁剪（决策 #886）
//
// 【它防什么】大圆角时玻璃装饰层（`.pg-glass__noise` 噪点 / `.pg-glass__highlight` 高光条）**戳出圆角外**
//   （噪点的 4 个角 = 深色方块；高光条两端 = 水平线溢出）。根因：装饰层是**方角矩形**（全盒 / 全宽），
//   而玻璃根 `border-radius` + `overflow: visible` ⇒ 方形边缘露在圆角切掉的区域。
//   修法 = 装饰层包一层**裁剪容器** `.pg-glass__deco`（`overflow:hidden` + `border-radius:inherit`）。
//   本测试从源码钉住该结构（回归锁——删掉 deco 或去掉裁剪即红）。
//
// 【为什么用源码断言】这是"DOM 结构 + 关键 CSS 声明必须存在"的静态事实，源码扫描即可锁（与 p-batch2-contract 同法）。
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

describe('★pg-glass 装饰层被圆角裁剪（#886 大圆角方块/线溢出修复）', () => {
  it('模板：噪点与高光边包在裁剪容器 .pg-glass__deco 内', () => {
    const inTpl = SRC.indexOf('<template>')
    const endTpl = SRC.indexOf('</template>')
    const tpl = SRC.slice(inTpl, endTpl)
    expect(tpl).toMatch(/class="pg-glass__deco"/)
    // deco 容器内既有 noise 又有 highlight（v-if 守卫装饰层）
    expect(tpl).toMatch(/pg-glass__deco[\s\S]*pg-glass__noise[\s\S]*pg-glass__highlight/)
  })

  it('裁剪容器 .pg-glass__deco 带 overflow:hidden + border-radius:inherit', () => {
    const b = blockOf('.pg-glass__deco {')
    expect(b).toMatch(/overflow:\s*hidden/)
    expect(b).toMatch(/border-radius:\s*inherit/)
  })

  it('内层容器 .pg-glass__in 带 border-radius: inherit', () => {
    expect(blockOf('.pg-glass__in {')).toMatch(/border-radius:\s*inherit/)
  })
})
