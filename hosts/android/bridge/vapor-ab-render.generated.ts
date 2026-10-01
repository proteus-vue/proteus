// GENERATED - do not edit (gen-vapor-fixture.mjs from the same SFC)
// source: @vue/compiler-sfc (mode=module, runtimeModuleName=@vue/runtime-core)
// @ts-nocheck
/* eslint-disable */
import { createTextVNode as _createTextVNode, resolveComponent as _resolveComponent, withCtx as _withCtx, createVNode as _createVNode, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString, createBlock as _createBlock } from "@vue/runtime-core"

export function render(_ctx, _cache) {
  const _component_p_text = _resolveComponent("p-text")
  const _component_p_view = _resolveComponent("p-view")

  return (_openBlock(), _createBlock(_component_p_view, { style: {"width":1080,"height":1600,"flexDirection":"column","padding":{"top":24},"backgroundColor":"#14141c"} }, {
    default: _withCtx(() => [
      _createVNode(_component_p_text, { style: {"fontSize":20,"color":"#ffffff","margin":{"bottom":12}} }, {
        default: _withCtx(() => [...(_cache[1] || (_cache[1] = [
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
            _createVNode(_component_p_text, {
              width: item.w,
              style: {"fontSize":12,"color":"#ffffff"}
            }, {
              default: _withCtx(() => [
                _createTextVNode(_toDisplayString(item.title), 1 /* TEXT */)
              ]),
              _: 2 /* DYNAMIC */
            }, 1032 /* PROPS, DYNAMIC_SLOTS */, ["width"])
          ]),
          _: 2 /* DYNAMIC */
        }, 1024 /* DYNAMIC_SLOTS */))
      }), 128 /* KEYED_FRAGMENT */)),
      _createVNode(_component_p_view, { style: {"height":30,"margin":{"top":10},"backgroundColor":"#6a4bf0"} }),
      _createVNode(_component_p_view, {
        width: _ctx.boxW,
        onClick: _cache[0] || (_cache[0] = $event => (_ctx.boxW += 30)),
        style: {"height":56,"margin":{"top":8},"backgroundColor":"#2f6fed"}
      }, null, 8 /* PROPS */, ["width"])
    ]),
    _: 1 /* STABLE */
  }))
}
export { render as abRender }
