// tests/e2e-driver-shared.ts
// ★统一测试 API（TestDriver）实战验证：同一份跨端用例代码 → web（Playwright）/ mp（automator）
// 只碰统一能力接口（reLaunch/element/waitFor/text/tap/currentPage/systemInfo/screenshot/waitFor/close）
// 断言通道 = B5 真机验证的最稳通道（currentPage/systemInfo）+ 跨端语义断言（button 文本 'tap' 两端一致）
// ★MP 元素边界（B5 实测）：automator page.$/getElement 受模拟器激活态影响（GUI 未激活挂起）→
//   共享用例默认跑元素层；MP 端当前环境传 elementOps:false 走稳通道（reLaunch/currentPage/systemInfo/evaluate/screenshot）
import { expect } from 'vitest'
import type { TestDriver } from '@proteus-vue/test-core/driver'

export interface SharedSmokeOptions {
  /** 导航路由：web 传绝对 URL（goto 需要）；mp 传 '/pages/index'（automator reLaunch） */
  route: string
  /** 跨端按钮 selector（两端均为原生 button 标签，文本 'tap' 一致） */
  tapSelector: string
  /** 截图输出路径（web 写本地文件；mp automator 返回 path） */
  shotPath: string
  /** 是否执行元素层（waitFor/text/tap）——MP 当前 IDE 模拟器未激活时 $ 挂起 → false 走稳通道 */
  elementOps?: boolean
  /** 是否截图断言（缺省 true）——MP 当前 IDE 下 automator screenshot 挂起（协议/激活态限制，B5 未验证能力）→ false 跳过 */
  screenshotOps?: boolean
  /** 末尾是否 close（缺省 true）——调用方在 runSharedSmoke 后还有专属断言时传 false（如 MP evaluate） */
  closeAtEnd?: boolean
}

/** ★同一份跨端用例：导航 → 等待 → 文本断言 → 点击 → 稳通道断言 → 截图 → 关闭 */
export async function runSharedSmoke(driver: TestDriver, opts: SharedSmokeOptions): Promise<void> {
  await driver.reLaunch(opts.route)
  // ★页面加载等待（MP reLaunch 后页面渲染需要时间；web 无副作用）
  await driver.waitFor(800)
  if (opts.elementOps !== false) {
    const tapBtn = driver.element(opts.tapSelector)
    await tapBtn.waitFor({ timeout: 15_000 })
    // ★跨端语义断言：两端 button 文本都是 'tap'（DOM 各自断言只下沉 p-* 映射，这里是语义级）
    expect(await tapBtn.text()).toContain('tap')
    await tapBtn.tap() // 点击 handleTap → count++
    await driver.waitFor(500)
  }
  // ★稳通道断言（05 经验：currentPage/systemInfo 全链路最稳）
  const cur = await driver.currentPage()
  expect(cur.path).toContain('pages/index')
  const info = await driver.systemInfo()
  expect(info.platform).toBeTruthy()
  // 截图取证（simulator_screenshot 能力；★MP 当前 IDE 下 automator screenshot 挂起 → screenshotOps:false 跳过）
  if (opts.screenshotOps !== false) {
    expect(await driver.screenshot(opts.shotPath)).toBeTruthy()
  }
  if (opts.closeAtEnd !== false) await driver.close()
}
