// packages/api/src/bridge-decl.ts —— ★NC1 声明式能力桥（能力桥的**声明层**）
//
// 【NC1 要解决的问题（《Proteus_原生能力接入方案》§5 腿一/腿三）】
//   现状：新增一个能力要手写 5 处——WxLike 字段 / CapabilityBridge 成员 / wxBridge 实现 /
//   webBridge 实现 / CapabilityHooks 成员与实现。其中 wx 桥**高度模板化**
//   （`wx.api({...params, success, fail})` → Promise 包装 + `unsupported`/`failed` 双态诚实降级）。
//   目标（方案 §5 腿三）：**「声明一下接口」应该是全部工作量**（8 小时 → 30 分钟）。
//
// 【分层（判据：什么该声明、什么该生成）】
//   · **声明**（本文件定义的类型 + `bridge-decls/*.ts`）：能力标识、桥方法签名、双端映射形态。
//     这是**架构事实**（该能力叫什么、两端各自对等什么 API）——必须人写，且要能 review。
//   · **生成**（`scripts/gen-bridge-ext.mjs` → `src/generated/bridge-ext.ts`）：模板化的包装代码
//     （Promise 化、错误码、缺失检测、状态闭包）。**手写这段 = 第 N 份副本**（本仓纪律禁止）。
//   · **不生成**：域特化的富接口（如摄像机控制器、画布上下文）——它们形态各异，价值在语义而非模板。
//
// 【诚实边界（必须写清，否则会被当成"什么都能生成"）】
//   ① 本机制的产出是 `Partial<CapabilityBridge>`，只覆盖**声明过的**能力；未声明者仍由手写桥承担；
//   ② 「web 端对等」只在**声明里写了 web 映射**时才生成真实实现，否则生成 `unsupported` 降级
//      （诚实降级优于虚构对等——G-32.3 语义）；
//   ③ 生成物**必须在运行路径上**（capability.ts 真实 import 并合并）——否则是摆设
//      （本仓纪律：生成物必须在构建路径上）。

/** ★错误构造器类型（结构化——生成物不需 import capability.ts 的 CapError，避免类型耦合） */
export type BridgeErrorCtor = new (code: string, message: string, cause?: unknown) => Error

/** 桥方法的参数声明（只支持可 JSON 描述的简单形态——复杂形态走 custom 实现） */
export interface BridgeParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  /** 缺省值（TS 字面量文本，原样写入生成物） */
  default?: string
}

/** wx 侧形态（决定生成哪套模板） */
export type MpForm =
  | { kind: 'callback'; api: string; map: Record<string, string> }
  | { kind: 'sync'; api: string; call: string }
  | { kind: 'unsupported'; reason?: string }

/** web 侧形态 */
export type WebForm =
  /** 直接调用：表达式里用 `$0`/`$1`… 占位参数（如 `nav.clipboard.writeText($0)`） */
  | {
      kind: 'direct'
      call: string
      guard?: string
      /** 守卫失败时的消息（缺省 `${guard} 不支持`） */
      guardMessage?: string
      /** ★结果须为真值，否则报 `<errPrefix>.failed`：某些 Web API 用「返回 null」表示被拦截
       *  （如 `window.open` 在非用户手势触发时）——**静默无反应是最危险的失败形态**，必须转成 Err */
      assert?: { message: string }
    }
  /** 有状态：需要持有句柄（如 Screen Wake Lock 的 sentinel）；`onExpr`/`offExpr` 在闭包内求值 */
  | { kind: 'stateful'; onExpr: string; offExpr: string; guard?: string; guardMessage?: string }
  /** 诚实降级（web 无对等） */
  | { kind: 'unsupported'; reason?: string }

export interface CapabilityDecl {
  /** 能力编号（与 PRIMITIVE_CATALOG 一致，如 C83） */
  id: string
  /** 语义标识（capability.xxx） */
  semantic: string
  /** Hook 名（useXxx） */
  hook: string
  /** 桥方法名（CapabilityBridge 上的成员名） */
  method: string
  /** 桥方法参数（首个参数即主参数） */
  params: BridgeParam[]
  /** 错误码前缀（如 `screen.keep-on` → `screen.keep-on.unsupported`） */
  errPrefix: string
  mp: MpForm
  web: WebForm
  /** Hook 文档（写入生成物的 JSDoc，供读者理解能力边界） */
  doc: string
}

/** 声明辅助（仅做类型收窄，便于声明文件获得 IDE 补全） */
export function defineCapability(decl: CapabilityDecl): CapabilityDecl {
  return decl
}
