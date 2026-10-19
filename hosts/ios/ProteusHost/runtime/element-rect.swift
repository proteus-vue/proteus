// hosts/ios/ProteusHost/runtime/element-rect.swift
// ★★★决策 #1081（`useElement` 选择器通路）：**元素几何回执**（iOS 腿）。
//
// 【为什么单列一个文件（不是"顺手写在 selfdraw-scene.swift 里"）】该文件已是 8831 行存量巨型文件
//   （`check:file-size` 基线**只减不增**）；几何回执是**独立职责**（内核几何读 + 回执形状）。
//   ⇒ 按「反大文件巨型化」纪律用 **extension** 拆出来：只加一个属性可见性修饰，零新增行。
//
// 【单位与坐标（三端同一口径）】
//   · 内核几何是**逻辑 pt**（iOS 建树不做 ×scale，与 Android 的物理 px / 鸿蒙的 vp 各自换算后同口径）
//     ⇒ 直接回 pt；
//   · 同时回 `scrollY`（当前内容滚动偏移，pt）——由 **JS 侧统一减掉**得到 Web
//     `getBoundingClientRect()` 的**视口坐标**语义（三端只写这一份归一，宿主不各算一套）。
// 【诚实边界】不在树上 / `display:none` ⇒ 内核回 `ok:false`，原样透传（不伪造成 0 尺寸）。

import Foundation


extension SelfDrawBridge {
    /// `{nodeId}` → `{ok,x,y,width,height,scrollY}`（逻辑 pt；失败 `{ok:false,reason}`）。
    func elementRect(_ argsJson: String) -> String {
        guard handle != 0 else { return "{\"ok\":false,\"reason\":\"尚未 mount\"}" }
        guard let data = argsJson.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let nodeId = obj["nodeId"] as? Int, nodeId >= 0 else {
            return "{\"ok\":false,\"reason\":\"element.rect: 缺 nodeId\"}"
        }
        let raw = takeCString(proteus_layout_node_rect(handle, UInt32(nodeId)))
        guard let rd = raw.data(using: .utf8),
              var r = (try? JSONSerialization.jsonObject(with: rd)) as? [String: Any] else {
            return "{\"ok\":false,\"reason\":\"element.rect: 内核回执非 JSON\"}"
        }
        // ★内核说 ok:false（不在树上/display:none）⇒ 原样拒绝，不静默画成 0 尺寸
        guard (r["ok"] as? Bool) == true else {
            return "{\"ok\":false,\"reason\":\"element.rect: 节点无几何（不在树上或 display:none）\"}"
        }
        r["ok"] = true
        r["scrollY"] = Double(view?.contentOffset.y ?? 0)
        r.removeValue(forKey: "id")
        guard let out = try? JSONSerialization.data(withJSONObject: r),
              let s = String(data: out, encoding: .utf8) else {
            return "{\"ok\":false,\"reason\":\"element.rect: 回执序列化失败\"}"
        }
        return s
    }
}
