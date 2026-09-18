// packages/test-core/src/snapshot/index.ts
// @proteus-vue/test-core/snapshot —— 编译快照规范化工具（test-framework B2，02-snapshot-compile.md）
// 用法：快照断言 = canonicalizeWxml/normalizeJson 规范化后走 vitest toMatchSnapshot；
//        结构性校验 = diffWxml/assertWxmlEqual + verifySourceMap + checkJsExports（纯函数，零 vitest 依赖）
export { parseWxml, normalizeWxml, canonicalizeWxml, diffWxml, assertWxmlEqual } from './wxml'
export type { WxmlNode, WxmlElement, WxmlText, WxmlComment, WxmlAttr, WxmlDiff } from './wxml'
export { decodeMappings, decodeVlqSegment, verifySourceMap } from './sourcemap'
export type { DecodedMapping, SourceMapViolation } from './sourcemap'
export { checkJsExports, topLevelConfigKeys, normalizeJson } from './assert'
