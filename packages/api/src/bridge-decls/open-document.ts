// packages/api/src/bridge-decls/open-document.ts —— 声明式能力：文档预览（C84）
//
// 【为什么要做它（用户 2026-09-30 裁定）】原稿把它归为"需宿主文档能力 → 长期搁置"，
//   用户指出：**「这个本身就是我们原生能力落地的范畴，目标就是 99% 的业务代码不需要写原生代码」**
//   ⇒ 重新审视，判定**应该做**：
//   · **MP 有官方 API**：`wx.openDocument`（doc/docx/xls/xlsx/ppt/pptx/pdf；需传平台临时文件路径）；
//   · **Web 有可用对等**：`window.open` → 浏览器自带查看器（PDF/图片/文本内联预览）——
//     ★**诚实边界**：office 格式浏览器通常**转为下载**而非预览，取决于浏览器能力（写进 doc，不粉饰）；
//   · **原生宿主**（iOS `QLPreviewController` / Android `ACTION_VIEW`）属**声明层**，
//     随宿主工程批次接线（与 C83 及既有 capability.* 同口径）。
//
// 【形态选择】Web 用 `direct` + **`assert`**：`window.open` 在非用户手势触发时**返回 null**
//   （弹窗被浏览器拦截）——若不管它，业务代码会"点了没反应"（最危险的失败形态）⇒ 必须转成 Err。
import { defineCapability } from '../bridge-decl'

export const openDocument = defineCapability({
  id: 'C84',
  semantic: 'capability.document-preview',
  hook: 'useOpenDocument',
  method: 'openDocument',
  params: [{ name: 'filePath', type: 'string' }],
  errPrefix: 'document.open',
  mp: { kind: 'callback', api: 'openDocument', map: { filePath: 'filePath' } },
  web: {
    kind: 'direct',
    guard: "typeof g.open === 'function'",
    guardMessage: 'window.open 不可用（非浏览器运行环境？）',
    call: "g.open($0, '_blank')",
    assert: { message: '新窗口被浏览器拦截（预览须由用户手势触发）' },
  },
  doc: '文档预览（MP wx.openDocument / Web window.open）。★Web 诚实边界：PDF/图片/文本由浏览器内联预览，office 格式通常转为下载（取决于浏览器能力）；MP 需传平台临时文件路径（如 wxfile://…）。',
})
