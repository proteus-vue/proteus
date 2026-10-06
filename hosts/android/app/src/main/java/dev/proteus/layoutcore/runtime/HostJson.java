package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HostJson.java
// ★★关注点分层（见 hosts/README-LAYERS.md）：**项目无关的宿主 JSON/报告工具**。
//
// 【为什么独立成类（2026-10-07 分层重构）】此前这两个静态工具塞在 `MainActivity`（dev 装置）里，
//   而**引擎（runtime）也用它** ⇒ `JsRenderHost`（runtime）反向依赖 `MainActivity`（dev）——
//   分层门禁（`check:host-layering`）的硬性规则「runtime 不得依赖 shell/dev」由此被破坏。
//   ⇒ 抽为 runtime 工具，方向恢复为「dev/shell → runtime」单向。

final class HostJson {
    private HostJson() {}

    /** `#RRGGBB` / `#AARRGGBB`（本仓约定，8 位为 AARRGGBB 与 Android ARGB 同序）→ ARGB int；非法 ⇒ 0。 */
    static int parseHex(String s) {
        if (s == null || s.isEmpty()) return 0;
        String h = s.startsWith("#") ? s.substring(1) : s;
        try {
            long v = Long.parseLong(h, 16);
            if (h.length() == 6) return (int) (0xFF000000L | v);
            if (h.length() == 8) return (int) v;   // #AARRGGBB
        } catch (NumberFormatException ignored) { }
        return 0;
    }

    /** 把一段 JSON/文本写入应用外部私有目录（验收报告落盘；失败仅记日志，不抛）。 */
    static void writeReport(android.content.Context ctx, String name, String content) {
        try {
            java.io.File d = ctx.getExternalFilesDir(null);
            java.io.File dir = d != null ? d : ctx.getFilesDir();
            java.io.File f = new java.io.File(dir, name);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
            fos.write(content.getBytes("UTF-8"));
            fos.close();
        } catch (Exception e) {
            android.util.Log.e("proteus", "写报告失败 " + name, e);
        }
    }
}
