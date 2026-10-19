package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ElementRectProbe.java
// ★★★决策 #1081（`useElement` 选择器通路）：**元素几何回执**（Android 腿）。
//
// 【为什么单列一个文件（不是"顺手写在 VaporRenderHost 里"）】`VaporRenderHost` 已是 3070 行存量巨型文件
//   （`check:file-size` 基线**只减不增**）；几何回执是**独立职责**（坐标单位换算 + 回执形状）。
//   ⇒ 按「反大文件巨型化」纪律拆出来：本类只做换算，不碰渲染/布局。
//
// 【单位与坐标（三端同一口径）】
//   · 内核几何是**物理 px**（`physicalizeTree` 把整树 ×density）⇒ 这里 ÷lengthScale 还原**逻辑 px（dp）**；
//   · 同时回 `scrollY`（当前内容滚动偏移，逻辑 px）——由 **JS 侧统一减掉**得到 Web
//     `getBoundingClientRect()` 的**视口坐标**语义（三端只写这一份归一，宿主不各算一套）。
// 【为什么不在这里减 scroll】滚动是**视图状态**、矩形是**树状态**；两处分头减会让三端在
//   "滚动中/惯性中"读到不同的中间值（本仓「几何只在核心算」纪律的同族）。
// 【诚实边界】`display:none` / 不在树上 ⇒ 内核回 `ok:false`，原样透传（不伪造成 0 尺寸）。
public final class ElementRectProbe {

    private ElementRectProbe() {}

    /**
     * @param host       渲染宿主（用其 `nodeRectJson` 读内核几何——同包内可见，不新增公开面）
     * @param lengthScale 逻辑 → 物理的换算系数（= display density）
     * @param contentScrollY 视图当前内容滚动偏移（**物理 px**，由 `ProteusHostView.getContentScrollY()`）
     * @param argsJson   `{nodeId}`
     * @return `{ok,x,y,width,height,scrollY}`（逻辑 px；失败 `{ok:false,reason}`）
     */
    public static String rect(VaporRenderHost host, float lengthScale, int contentScrollY, String argsJson) {
        final float d = lengthScale > 0 ? lengthScale : 1f;
        int nodeId;
        try {
            nodeId = new org.json.JSONObject(argsJson == null ? "{}" : argsJson).optInt("nodeId", -1);
        } catch (Throwable t) {
            return err("element.rect: 入参非 JSON");
        }
        if (nodeId < 0) return err("element.rect: 缺 nodeId");
        if (host == null) return err("element.rect: 尚未 mount");
        try {
            org.json.JSONObject r = new org.json.JSONObject(host.nodeRectJson(nodeId));
            // ★内核说 ok:false（不在树上/display:none）⇒ 原样拒绝，不静默画成 0 尺寸
            if (!r.optBoolean("ok", false)) return err("element.rect: 节点无几何（不在树上或 display:none）");
            org.json.JSONObject out = new org.json.JSONObject();
            out.put("ok", true);
            out.put("x", r.optDouble("x", 0) / d);
            out.put("y", r.optDouble("y", 0) / d);
            out.put("width", r.optDouble("width", 0) / d);
            out.put("height", r.optDouble("height", 0) / d);
            out.put("scrollY", contentScrollY / d);
            return out.toString();
        } catch (Throwable t) {
            return err("element.rect: " + String.valueOf(t.getMessage()));
        }
    }

    private static String err(String reason) {
        try {
            org.json.JSONObject e = new org.json.JSONObject();
            e.put("ok", false);
            e.put("reason", reason);
            return e.toString();
        } catch (Throwable ignored) {
            return "{\"ok\":false}";
        }
    }
}
