// hosts/harmony/host-app/entry/src/main/ets/runtime/ElementProbe.ets
// ★★★决策 #1082（2026-10-19）：**元素查询探针读数**（鸿蒙腿）——`useElement` 选择器通路的真机判据数据源。
//
// 【为什么单列（反大文件 + 职责单一）】`Superapp.ets` 已贴着 1000 行硬上限（`check:file-size`），
//   而"把 hostAppRender 回执里的探针字段转成 JSON 文本"是**独立的展示逻辑**——
//   与键盘探针（`KeyboardProbe.ets`）同一处置：壳只管调，细节在 runtime。
//
// 【它解决的真 bug（真机抓到）】回执经 `JSON.parse` 后 `elementProbe` 已是**对象**，
//   壳里用 `String(obj)` 拼报告 ⇒ 得到 `"[object Object]"` ⇒ 报告变成**非法 JSON**（取回即解析失败）。
//   ⇒ 必须 `JSON.stringify`；而 native 侧新版回的是**字符串**（探针原文）⇒ 两种形态都收，不静默丢。

import { appScreenNodeRect } from 'proteus_render';

/** 把回执里的一个探针字段转成 **JSON 文本**（报告直接拼它；`undefined`/`null` ⇒ `'null'`）。 */
export function elementFieldToJson(v: Object | undefined): string {
  if (v === undefined || v === null) { return 'null'; }
  if (typeof v === 'string') { return v as string; }
  try {
    return JSON.stringify(v);
  } catch (e) {
    return 'null';
  }
}

/** 元素探针读数打包（壳侧一次取全，报告字段名与 Android/iOS 对齐）。 */
export interface ElementProbeReadout {
  /** ★#1083：录屏/截屏能力探针（两段式结果） */
  capture: string;
  registry: string;
  probe: string;
  cls: string;
  compound: string;
  pseudo: string;
}

/**
 * 从 `hostAppRender` 回执里取元素探针读数。
 * @param rt 回执对象（`JSON.parse(hostAppRender(...))`）
 */
export function readElementProbes(rt: Record<string, Object>): ElementProbeReadout {
  return {
    registry: elementFieldToJson(rt['elementRegistry'] as Object | undefined),
    probe: elementFieldToJson(rt['elementProbe'] as Object | undefined),
    cls: elementFieldToJson(rt['elementClass'] as Object | undefined),
    compound: elementFieldToJson(rt['elementCompound'] as Object | undefined),
    pseudo: elementFieldToJson(rt['elementPseudo'] as Object | undefined),
    capture: elementFieldToJson(rt['captureProbe'] as Object | undefined),
  };
}

/** 把五个探针读数拼成报告尾段（`,"element_registry":…,"element_probe":…}` 形态的**追加片段**）。 */
export function elementReportFragment(r: ElementProbeReadout): string {
  return ',"element_registry":' + r.registry + ',"element_probe":' + r.probe
    + ',"element_class":' + r.cls + ',"element_compound":' + r.compound
    + ',"element_pseudo":' + r.pseudo
    + ',"capture_probe":' + r.capture;
}

/**
 * ★★★决策 #1082：把探针解出的 **nodeId** 换成**视口坐标矩形**（vp）——鸿蒙的几何腿。
 *
 * 【为什么宿主自己取几何（不调 `element.rect`）】鸿蒙 `hostAppRender` 期间内核树**尚未建**
 *   （ArkTS 之后才调 `appScreenCommands`）⇒ 那时 `element.rect` 必回「尚未建树」（真机实证）。
 *   ⇒ 分工：JS 只解析 selector→nodeId（索引在 JS，宿主不认识 `#foo`）；宿主建树后用
 *   `appScreenNodeRect`（**同一棵内核树**，早已是 dev 高亮的几何源）取矩形。
 * 【单位】`appScreenNodeRect` 回**物理 px** ⇒ ÷ density 得 vp；再减 `scrollOffset` 得**视口坐标**
 *   （与 Web `getBoundingClientRect()` / Android / iOS 同一语义）。
 * 【不伪造】解析失败/未支持/几何取不到 ⇒ **原样透传**上游读数（不编 0 尺寸）。
 */
export function measureElementRect(rawProbe: string, scrollOffset: number): string {
  if (!rawProbe || rawProbe === 'null') { return 'null'; }
  try {
    const o = JSON.parse(rawProbe) as Record<string, Object>;
    if (o['ok'] !== true) { return rawProbe; }
    const id: number = o['nodeId'] as number;
    if (typeof id !== 'number' || id < 0) { return rawProbe; }
    const geo = JSON.parse(appScreenNodeRect(id)) as Record<string, Object>;
    if (geo['ok'] !== true) { return rawProbe; }
    const d: number = vp2px(1);
    const x: number = (geo['x'] as number) / d;
    const y: number = (geo['y'] as number) / d - scrollOffset;
    const w: number = (geo['w'] as number) / d;
    const h: number = (geo['h'] as number) / d;
    return JSON.stringify({
      ok: true, selector: o['selector'], nodeId: id, source: o['source'], screen: o['screen'],
      left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, scrollY: scrollOffset,
    });
  } catch (e) {
    return rawProbe;
  }
}
