package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/EnvVars.java
// ★★★决策 #1081：**内置环境变量采集**（`--pf-*`）——从壳里提出来成为 runtime 唯一实现。
//
// 【为什么提取（本仓「一处实现」纪律 + 反大文件）】`collectEnvVars` 原本是 `SuperappActivity` 的私有方法；
//   元素查询真机判据（`dev/ElementProbe`）需要**同一张表**（否则页根的 `minHeight: env:--pf-vh`
//   解析不出 f32 ⇒ 内核 `create` 返 0 ⇒ 整树建不起来——本探针首跑就是这么红的）。
//   两份手抄必然漂移（本仓反复踩过）⇒ 提到 runtime，壳与判据都调这一份。
//
// 【语义不变】逐键与提之前一致（A 组避让量 / B 组系统栏本体 / C 组挖孔 / E 组设备标量），
//   单位一律**逻辑像素（dp）**。

import android.app.Activity;
import android.view.WindowInsets;

import org.json.JSONObject;

public final class EnvVars {

    private EnvVars() {}

    /**
     * 采集内置环境变量（`--pf-*`，单位 dp）。
     * @param activity 承载视图的 Activity（取 `RootWindowInsets`；无窗口/低版本 ⇒ 空表，如实）
     * @param density  屏幕密度（逻辑 → 物理的换算系数）
     */
    public static JSONObject collect(Activity activity, float density) {
        JSONObject o = new JSONObject();
        try {
            if (activity == null || android.os.Build.VERSION.SDK_INT < 20) return o;
            WindowInsets wi = activity.getWindow().getDecorView().getRootWindowInsets();
            if (wi == null) return o;
            // ★本宿主 edge-to-edge：状态栏恒隐藏 ⇒ statusBars().top 恒 0（= 期望的顶避让）；导航栏可见。
            int sb = wi.getInsets(WindowInsets.Type.statusBars()).top;
            int nav = wi.getInsets(WindowInsets.Type.navigationBars()).bottom;
            int tap = wi.getInsets(WindowInsets.Type.tappableElement()).bottom;
            int cutT = 0, cutL = 0, cutR = 0;
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                android.view.DisplayCutout dc = wi.getDisplayCutout();
                if (dc != null) { cutT = dc.getSafeInsetTop(); cutL = dc.getSafeInsetLeft(); cutR = dc.getSafeInsetRight(); }
            }
            double d = density > 0 ? density : 1.0;
            o.put("--pf-inset-top", Math.max(sb, cutT) / d);
            o.put("--pf-inset-bottom", nav / d);
            o.put("--pf-inset-left", cutL / d);
            o.put("--pf-inset-right", cutR / d);
            boolean gesture = tap < nav * 0.6;   // 手势机：tappable 显著小于 navigationBars
            o.put("--pf-status-bar-height", sb / d);
            o.put("--pf-nav-bar-height", (gesture ? 0 : nav) / d);
            o.put("--pf-indicator-height", (gesture ? nav : 0) / d);
            o.put("--pf-nav-bar-total", nav / d);
            o.put("--pf-cutout-top", cutT / d);
            o.put("--pf-cutout-left", cutL / d);
            o.put("--pf-cutout-right", cutR / d);
            o.put("--pf-keyboard-height", (double) KeyboardWatcher.lastHeightDp);
            o.put("--pf-hairline", 1.0 / d);   // ★E 组（决策 #598）：一条物理像素的逻辑长度
        } catch (Throwable t) {
            // ★采集失败 ⇒ 空表（不伪造 0 以外的值）；调用方据此保留兜底
        }
        return o;
    }
}
