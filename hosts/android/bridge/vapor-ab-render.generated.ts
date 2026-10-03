// GENERATED - do not edit (gen-vapor-fixture.mjs from the same SFC)
// source: @vue/compiler-sfc (mode=module, runtimeModuleName=@vue/runtime-core)
// @ts-nocheck
/* eslint-disable */
import { createTextVNode as _createTextVNode, resolveComponent as _resolveComponent, withCtx as _withCtx, createVNode as _createVNode, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, toDisplayString as _toDisplayString, createBlock as _createBlock, setBlockTracking as _setBlockTracking, withMemo as _withMemo, vShow as _vShow, withDirectives as _withDirectives, Transition as _Transition, KeepAlive as _KeepAlive, Teleport as _Teleport, Suspense as _Suspense } from "@vue/runtime-core"

export function render(_ctx, _cache) {
  const _component_p_text = _resolveComponent("p-text")
  const _component_p_view = _resolveComponent("p-view")
  const _component_KidPanel = _resolveComponent("KidPanel")
  const _component_MyKeep = _resolveComponent("MyKeep")

  return (_openBlock(), _createBlock(_component_p_view, { style: {"width":1080,"height":1600,"flexDirection":"column","padding":{"top":24},"backgroundColor":"#14141c"} }, {
    default: _withCtx(() => [
      _createVNode(_component_p_text, { style: {"fontSize":20,"color":"#ffffff","margin":{"bottom":12}} }, {
        default: _withCtx(() => [...(_cache[8] || (_cache[8] = [
          _createTextVNode("Vapor · 设备端", -1 /* CACHED */)
        ]))]),
        _: 1 /* STABLE */
      }),
      _createVNode(_component_p_view, { style: {"height":90,"margin":{"bottom":8},"borderRadius":18,"backgroundColor":"#2a3f66"} }),
      _createVNode(_component_p_view, { style: {"height":90,"margin":{"bottom":8},"fillGradient":{"kind":"linear","angle":90,"stops":[{"offset":0,"color":"#7c5cff"},{"offset":1,"color":"#ff9a6c"}]}} }),
      _createVNode(_component_p_view, { style: {"height":90,"margin":{"bottom":8},"backgroundColor":"#1f2c44","glow":{"color":"#fff6d8","radius":26,"alpha":0.9}} }),
      _createVNode(_component_p_view, { style: {"height":90,"margin":{"bottom":8},"backgroundColor":"#24405e","clipPath":{"kind":"inset","params":[0,0,0.45,0]}} }),
      _createVNode(_component_p_view, { style: {"height":80,"margin":{"bottom":8},"backgroundColor":"#16203a","svgPath":{"d":"M16 64 Q 270 8 524 64","stroke":"#cfe0ff","strokeWidth":7,"progress":1}} }),
      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.list, (item) => {
        return (_openBlock(), _createBlock(_component_p_view, {
          key: item.id,
          style: {"height":44,"margin":{"bottom":6},"backgroundColor":"#285ac8"}
        }, {
          default: _withCtx(() => [
            _createCommentVNode(" ★★混合文本（P2-2，2026-10-03）：静态段 + 两个插值段 ⇒ 运行时求值拼接。\n           判据核的是**完整串**（\"row-1·row 1\"）真的到了内核（text_probe），\n           以及改数据后重发的 SET_TEXT 仍是完整串（不是只剩一个字段）。 "),
            _createVNode(_component_p_text, {
              width: item.w,
              style: {"fontSize":12,"color":"#ffffff"}
            }, {
              default: _withCtx(() => [
                _createTextVNode("row-" + _toDisplayString(item.id) + "·" + _toDisplayString(item.title), 1 /* TEXT */)
              ]),
              _: 2 /* DYNAMIC */
            }, 1032 /* PROPS, DYNAMIC_SLOTS */, ["width"])
          ]),
          _: 2 /* DYNAMIC */
        }, 1024 /* DYNAMIC_SLOTS */))
      }), 128 /* KEYED_FRAGMENT */)),
      _createVNode(_component_p_view, { style: {"height":30,"margin":{"top":10},"backgroundColor":"#6a4bf0"} }),
      _createVNode(_component_p_view, {
        width: _ctx.padW,
        onClick: _cache[1] || (_cache[1] = $event => (_ctx.padW += 5)),
        style: {"height":96,"margin":{"top":8},"backgroundColor":"#1c2b3f"}
      }, {
        default: _withCtx(() => [
          _createVNode(_component_p_view, {
            width: _ctx.boxW,
            onClick: _cache[0] || (_cache[0] = $event => (_ctx.boxW += 30)),
            style: {"height":56,"margin":{"top":8},"backgroundColor":"#2f6fed"}
          }, null, 8 /* PROPS */, ["width"])
        ]),
        _: 1 /* STABLE */
      }, 8 /* PROPS */, ["width"]),
      _createCommentVNode(" ★★事件修饰符夹具（P2-3，2026-10-03）：外层 @click（无修饰）+ 内层 @click.stop。\n         **内层刻意不遮住外层的中心**（内层 40px 贴顶，外层 220px ⇒ 外层中心 y=110 在内层之外）\n         ——宿主注入 tap 是按\"节点中心\"点的：若重叠，点外层也会命中内层 ⇒ 判据拿不到\n         「祖先 handler 本会跑、但被 .stop 挡下」的证据。 "),
      _createVNode(_component_p_view, {
        width: _ctx.stopOuterW,
        onClick: _cache[3] || (_cache[3] = $event => (_ctx.stopOuterW += 5)),
        style: {"height":220,"margin":{"top":8},"backgroundColor":"#223344"}
      }, {
        default: _withCtx(() => [
          _createVNode(_component_p_view, {
            width: _ctx.stopInnerW,
            onClick: _cache[2] || (_cache[2] = _withModifiers($event => (_ctx.stopInnerW += 30), ["stop"])),
            style: {"height":40,"backgroundColor":"#445566"}
          }, null, 8 /* PROPS */, ["width"])
        ]),
        _: 1 /* STABLE */
      }, 8 /* PROPS */, ["width"]),
      _createCommentVNode(" ★★P2-5（2026-10-03）：v-once 冻结 / v-memo 组门 夹具。\n         · once 行：{{ onceVal }} 只在首帧写，之后**源怎么改都不再写**（判据 ⑪ 用）；\n         · memo 行：v-memo=\"[memoDep]\" + {{ memoVal }} —— 改 memoVal（依赖净）⇒ **跳过**、\n                     改 memoDep（依赖脏）⇒ 放行（把最新 memoVal 写下去）。\n         ★两行的文本初值刻意可区分（once-x / memo-y），判据核\"跳过\"与\"放行\"的**不同**结果。 "),
      _createVNode(_component_p_text, { style: {"fontSize":12,"color":"#ffffff"} }, {
        default: _withCtx(() => [
          _createTextVNode("once-" + _toDisplayString(_ctx.onceVal), 1 /* TEXT */)
        ]),
        _: 1 /* STABLE */
      }),
      _cache[4] || (
        _setBlockTracking(-1, true),
        (_cache[4] = _createVNode(_component_p_text, { style: {"fontSize":12,"color":"#ffffff"} }, {
          default: _withCtx(() => [
            _createTextVNode("once-" + _toDisplayString(_ctx.onceVal), 1 /* TEXT */)
          ]),
          _: 1 /* STABLE */
        })).cacheIndex = 4,
        _setBlockTracking(1),
        _cache[4]
      ),
      _withMemo([_ctx.memoDep], () => (_openBlock(), _createBlock(_component_p_text, {
        key: 'memo',
        style: {"fontSize":12,"color":"#ffffff"}
      }, {
        default: _withCtx(() => [
          _createTextVNode("memo-" + _toDisplayString(_ctx.memoVal), 1 /* TEXT */)
        ]),
        _: 1 /* STABLE */
      })), _cache, 5),
      _createCommentVNode(" ★★P2-6~P2-9（2026-10-03）：\n         · v-text（P2-6）：与插值同槽位；\n         · 白名单纯函数（P2-8）：Math.round / String 等 + Math.PI 编译期内联（此前静默渲染成空）；\n         · 纯方法（P2-8 续）：arr.join（真实项目用法）；\n         · 可选链（P2-9）：obj?.x 编译期降级为 cond 程序（空值 ⇒ 空串，不是 'undefined'）。\n         判据 ⑫ 核：这些节点的**首帧文本**是求值结果（不是空串、也不是 \"undefined\"/\"null\" 字面量）。 "),
      _createVNode(_component_p_text, {
        textContent: _toDisplayString('vt-' + _ctx.exprA),
        style: {"fontSize":12,"color":"#ffffff"}
      }, null, 8 /* PROPS */, ["textContent"]),
      _createVNode(_component_p_text, { style: {"fontSize":12,"color":"#ffffff"} }, {
        default: _withCtx(() => [
          _createTextVNode("pi-" + _toDisplayString(Math.PI.toFixed(2)), 1 /* TEXT */)
        ]),
        _: 1 /* STABLE */
      }),
      _createVNode(_component_p_text, { style: {"fontSize":12,"color":"#ffffff"} }, {
        default: _withCtx(() => [
          _createTextVNode("mx-" + _toDisplayString(Math.max(_ctx.exprA, 7)), 1 /* TEXT */)
        ]),
        _: 1 /* STABLE */
      }),
      _createVNode(_component_p_text, { style: {"fontSize":12,"color":"#ffffff"} }, {
        default: _withCtx(() => [
          _createTextVNode("jn-" + _toDisplayString(_ctx.exprArr.join('|')), 1 /* TEXT */)
        ]),
        _: 1 /* STABLE */
      }),
      _createVNode(_component_p_text, { style: {"fontSize":12,"color":"#ffffff"} }, {
        default: _withCtx(() => [
          _createTextVNode("oc-" + _toDisplayString(_ctx.exprObj?.inner), 1 /* TEXT */)
        ]),
        _: 1 /* STABLE */
      }),
      _createCommentVNode(" ★★★P3-3（2026-10-03）Transition 桥接夹具：**外层 Transition 透传**（不占节点 id、\n         不产包裹盒）+ 内层元素带 v-show（可见性切换是过渡的驱动源）。\n         判据 ⑬ 核：可见性翻转后 transition_started 大于 0（动画真的交给了宿主）。\n         ★本注释**不得**含反引号或美元花括号（它在 JS 模板串里——本仓已踩四次）。 "),
      _createVNode(_Transition, {
        name: "fade-slide-up",
        persisted: ""
      }, {
        default: _withCtx(() => [
          _withDirectives(_createVNode(_component_p_view, { style: {"height":40,"backgroundColor":"#7c5cff"} }, null, 512 /* NEED_PATCH */), [
            [_vShow, _ctx.trVisible]
          ])
        ]),
        _: 1 /* STABLE */
      }),
      _createCommentVNode(" ★★★P1-3（2026-10-03）组件内部渲染夹具：Kids 子组件（构建期编译成 ComponentDef）+\n         props 绑**响应式源**（kidLabelW / kidLabel）⇒ 判据核「父改 props ⇒ 子节点真的更新」。\n         ★底色避开 #2f6fed（A/B 判据的按钮色锚）。 "),
      _createVNode(_component_KidPanel, {
        label: _ctx.kidLabel,
        labelW: _ctx.kidLabelW,
        onBump: _cache[6] || (_cache[6] = $event => (_ctx.bumpTotal = $event + 100)),
        style: {"height":30}
      }, null, 8 /* PROPS */, ["label", "labelW"]),
      _createCommentVNode(" ★★★P1-3 emits（2026-10-03）：上面 @bump 监听子组件 $emit；本节点是**几何锚**——\n         宽度绑 bumpTotal（初始 0 ⇒ 几何 0 宽），判据核「子 emit ⇒ 父 handler 跑 ⇒ **内核几何真变**」。\n         ★为什么用宽度而不是文本（本仓判据口径）：文本改动可能被文本同步链路掩盖；几何是内核真值。 "),
      _createVNode(_component_p_view, {
        width: _ctx.bumpTotal,
        style: {"height":6,"backgroundColor":"#3aa0ff"}
      }, null, 8 /* PROPS */, ["width"]),
      _createCommentVNode(" ★★★P1-3 生命周期（2026-10-03）：vue:mounted 模板钩子——首帧 mount 后触发动作表\n         （改 lifeW ⇒ 走订阅 → 指令 → 内核重排）。本节点是**几何锚**（宽绑 lifeW，初值 0）。\n         ★为什么用宽度：文本改动可能被文本同步链路掩盖；几何是内核真值。 "),
      _createVNode(_component_p_view, {
        onVnodeMounted: _cache[7] || (_cache[7] = $event => (_ctx.lifeW = 250)),
        width: _ctx.lifeW,
        style: {"height":6,"backgroundColor":"#ff9a6c"}
      }, null, 8 /* PROPS */, ["width"]),
      _createCommentVNode(" ★★★P3 批次（2026-10-03）逻辑容器**透传**夹具：三者都**不产包裹盒**\n         （Vue 语义：逻辑容器不渲染元素）——判据核「节点数守恒 + 几何与 Vue 等价」。\n         ★本注释不得含反引号或美元花括号（在 JS 模板串里——护栏见 check:script-compile）。 "),
      _createCommentVNode(" ★★KeepAlive 的官方约束（本仓实测被 Vue 编译器当场拦下）：它要求「恰好一个子组件」\n         ——p-view（原生标签）会被拒：SyntaxError: KeepAlive expects exactly one child component.\n         ⇒ 夹具改用真组件形态（MyKeep）验证透传。\n         ★底色避开 #2f6fed（A/B 判据的按钮色锚——本仓已踩：重复 ⇒ 判据红）。 "),
      (_openBlock(), _createBlock(_KeepAlive, null, [
        _createVNode(_component_MyKeep, null, {
          default: _withCtx(() => [
            _createVNode(_component_p_view, { style: {"height":20,"backgroundColor":"#4a5f8a"} })
          ]),
          _: 1 /* STABLE */
        })
      ], 1024 /* DYNAMIC_SLOTS */)),
      (_openBlock(), _createBlock(_Teleport, { to: "#nowhere" }, [
        _createVNode(_component_p_view, { style: {"height":20,"backgroundColor":"#6f4ae8"} })
      ])),
      (_openBlock(), _createBlock(_Suspense, null, {
        default: _withCtx(() => [
          _createVNode(_component_p_view, { style: {"height":20,"backgroundColor":"#1b2a4a"} })
        ]),
        fallback: _withCtx(() => [
          _createVNode(_component_p_text, { style: {"color":"#ffffff"} }, {
            default: _withCtx(() => [...(_cache[9] || (_cache[9] = [
              _createTextVNode("suspense-fallback", -1 /* CACHED */)
            ]))]),
            _: 1 /* STABLE */
          })
        ]),
        _: 1 /* STABLE */
      }))
    ]),
    _: 1 /* STABLE */
  }))
}
/* ★宿主侧 withModifiers（见生成器头注：官方只在 runtime-dom，自绘宿主没有 DOM） */
const modifierGuards = {
  stop: (e) => { if (typeof e.stopPropagation === 'function') e.stopPropagation() },
  prevent: (e) => { if (typeof e.preventDefault === 'function') e.preventDefault() },
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey, shift: (e) => !e.shiftKey, alt: (e) => !e.altKey, meta: (e) => !e.metaKey,
  left: (e) => 'button' in e && e.button !== 0,
  middle: (e) => 'button' in e && e.button !== 1,
  right: (e) => 'button' in e && e.button !== 2,
  exact: (e, modifiers) => ['ctrl','shift','alt','meta'].some((m) => e[m + 'Key'] && !modifiers.includes(m)),
}
const withModifiers = (fn, modifiers) => {
  if (!fn) return fn
  const cache = fn._withMods || (fn._withMods = {})
  const cacheKey = modifiers.join('.')
  return cache[cacheKey] || (cache[cacheKey] = (event, ...args) => {
    for (const m of modifiers) {
      const guard = modifierGuards[m]
      if (guard && guard(event, modifiers)) return
    }
    return fn(event, ...args)
  })
}
// ★生成物里的调用名是**别名** _withModifiers（编译器按 withModifiers as _withModifiers 产出）——
//   我们摘掉了那条 import，这里必须把别名绑上（首版只定义 withModifiers ⇒ 引用处仍是 undefined，实测踩到）
const _withModifiers = withModifiers

export { render as abRender }
