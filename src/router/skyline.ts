// src/router/skyline.ts
// Skyline wx.router 自定义路由 bridge（P3-3）
// ★ 本模块是整个项目唯一允许直连 wx.router 的模块（执行规则 5）
// ★ 只保留 router 需要的运行能力；builder 的注册由应用在 main.mp.ts 中编写
//   （平台约束：builder 必须与 addRouteBuilder 同文件静态可分析，配置驱动注册表真机不可行，
//    详见 PROJECT_MEMORY 决策 #33/#37——示例见 examples/main.mp.ts）
// ★拆包解耦（docs/packages.md 步骤 1）：skyline 开关改 __PROTEUS_SKYLINE__ 构建期注入（vite define）

/** 判断是否处于 Skyline 渲染环境（Web 端 wx 不存在 → false；开关由构建期注入） */
export function isSkyline(): boolean {
  if (typeof wx === 'undefined' || !wx.getWindowInfo) return false
  return typeof __PROTEUS_SKYLINE__ !== 'undefined' && __PROTEUS_SKYLINE__
}

/** 使用自定义路由跳转（仅 MP 环境被调用；Web 端 routeType 直接忽略） */
export function navigateWithCustomRoute(url: string, routeType: string): Promise<void> {
  return new Promise((resolve) => {
    wx.navigateTo({
      url,
      routeType,
      success: () => resolve(),
      fail: () => {
        // 降级：自定义路由失败 → 普通跳转
        wx.navigateTo({ url, success: () => resolve() })
      },
    })
  })
}
