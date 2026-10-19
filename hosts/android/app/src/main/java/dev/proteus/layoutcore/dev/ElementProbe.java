package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/ElementProbe.java
// ★★★决策 #1081（`useElement` 选择器通路）：**端到端真机判据**（Android 腿）。
//
// 【它证明什么（三件事，缺一即红）】
//   ① **编译/实例化透传**：`LayoutTemplate` 里模板静态 `id` → `InstantiatedNode.elementId`（superapp 首页的
//      `#idx-read-theme` 等真实静态 id 来自 `superapp/pages/index.vue`）；
//   ② **索引命中**：`#id` 经 `element-registry` 解析成**引擎 nodeId**（不是壳自报的猜测值）；
//   ③ **几何真源**：`element.rect` 回的矩形与内核 `readRects()` 里**同一 nodeId** 的矩形逐值对齐
//      （÷density 后）——★关键：不能只信 `element.rect` 自己，否则就是"桥自证桥"（本仓禁止的自我认证）。
//   另附两条**诚实边界**判据：不存在的 id ⇒ `not-found`；class 选择器 ⇒ 明确拒绝（不近似匹配）。
//
// 【为什么单列一个文件】`MainActivity` 已是 6618 行（`check:file-size` 基线 6619，**只减不增**）
//   ⇒ 判据装置落在独立文件，MainActivity 只加一行分派。
//
// 【与真机壳同一栈】这里用的装配（`VaporRenderHost` + `SuperappRuntimeHost` + `HostBridge`）与
//   `SuperappActivity` **逐件相同**——判据跑的就是真实壳的那条链，不是另搭一条"测试专用"通路。

import android.app.Activity;
import android.view.ViewGroup;

import org.json.JSONObject;

public final class ElementProbe {

    private ElementProbe() {}

    /** 报告名（脚本按此轮询；与 `superapp.json` 同目录） */
    public static final String REPORT = "element-probe.json";

    /**
     * 跑一次完整探针。
     * @return 报告 JSON 串（失败也返回**结构化**失败原因，不抛——壳侧统一落盘）
     */
    public static String run(Activity activity, ViewGroup root) {
        JSONObject out = new JSONObject();
        try {
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) {
                return out.put("ok", false).put("error", "引擎未加载：" + QuickJsEngine.getLoadError()).toString(2);
            }
            String bundle = readAsset(activity, "bundle-superapp.js");
            if (bundle == null) return out.put("ok", false).put("error", "缺 assets/bundle-superapp.js").toString(2);
            out.put("bundle_chars", bundle.length());

            // ① 与真实壳同一栈（见文件头）
            android.util.DisplayMetrics dm = activity.getResources().getDisplayMetrics();
            VaporRenderHost draw = new VaporRenderHost(activity, root);
            draw.setLengthScale(dm.density);
            // ★与真实壳**同一张 env 表**（`runtime/EnvVars`）：页根 `minHeight: env:--pf-vh` 等 token
            //   必须解析成数值，否则内核 serde「expected f32」⇒ create 返 0 ⇒ 整树建不起来（首跑实测）。
            org.json.JSONObject envObj = EnvVars.collect(activity, dm.density);
            envObj.put("--pf-vw", dm.widthPixels / dm.density);
            envObj.put("--pf-vh", dm.heightPixels / dm.density);
            draw.setEnvVars(envObj);
            HostCapabilities caps = new HostCapabilities(activity);
            ScreenHost screenHost = new ScreenHost(root);
            HostBridge bridge = new HostBridge(caps, screenHost);
            // ★#1083：探针装置有自己的 caps 实例 ⇒ 录屏/截屏 provider 必须同注入（否则全 unsupported）
            CaptureCapability cap = new CaptureCapability(activity, p -> QuickJsEngine.eval(
                    "__proteusHostCapture(" + org.json.JSONObject.quote(p.toString()) + ")"));
            cap.installUserCapture();
            caps.setCaptureProvider(() -> {
                try { return cap.state().toString(); }
                catch (Throwable t) { return "{\"error\":\"state 失败\"}"; }
            });
            caps.setElementRectProvider(args -> ElementRectProbe.rect(
                    draw, dm.density, draw.view() != null ? draw.view().getContentScrollY() : 0, args));
            SuperappRuntimeHost rtHost = new SuperappRuntimeHost(draw, bridge);

            QuickJsEngine.eval("globalThis.__PROTEUS_HOST_ID__ = 'android';"
                    + "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'Choreographer';");
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, rtHost);
            out.put("bundle_load_ok", load.ok);
            if (!load.ok) return out.put("ok", false).put("error", "bundle eval 失败：" + load.error).toString(2);

            // ② boot + 渲染首页（真实运行期实例化 → host.mount → 内核建树）
            QuickJsEngine.EvalResult boot = QuickJsEngine.eval("__proteusSuperappBootJson()");
            out.put("boot_ok", boot.ok);
            QuickJsEngine.nativeRunPendingJobs();
            double w = dm.widthPixels / dm.density;
            double h = dm.heightPixels / dm.density;
            String renderArgs = new JSONObject()
                    .put("name", "index")
                    .put("viewport", new JSONObject().put("width", w).put("height", h))
                    .put("remount", true)
                    .toString();
            // ★诊断：截获运行期交给宿主的整树（mount 失败时用来定位"内核拒绝的是不是这份树"）
            QuickJsEngine.eval("(function(){var h=globalThis.proteusHost;if(h&&typeof h.mount==='function'){"
                    + "var o=h.mount;h.mount=function(t){globalThis.__CAPTURED_TREE__=t;return o.call(h,t);};}})()");
            QuickJsEngine.EvalResult render = QuickJsEngine.eval(
                    "__proteusSuperappRender(" + JSONObject.quote(renderArgs) + ")");
            try { out.put("tree_chars", evalStr("String((globalThis.__CAPTURED_TREE__||'').length)")); } catch (Throwable ignored) { }
            out.put("render_ok", render.ok);
            out.put("render_reply", render.value == null ? "null" : render.value);
            QuickJsEngine.nativeRunPendingJobs();

            // ③ 索引读数（证明索引里真有条目，而不是"查询恒 not-found"）
            out.put("registry", evalStr("__proteusHostAppElementRegistry()"));

            // ④ 目标选择器（superapp/pages/index.vue 的真实静态 id）
            String sel = "#idx-read-theme";
            out.put("target_selector", sel);
            String probe = evalStr("__proteusHostAppElementRect("
                    + JSONObject.quote(new JSONObject().put("selector", sel).toString()) + ")");
            out.put("probe", probe);

            // ⑤ ★独立交叉核对：内核 `readRects()` 里同一 nodeId 的物理矩形 ÷density
            JSONObject p = new JSONObject(probe);
            if (p.optBoolean("ok", false)) {
                int nodeId = p.optInt("nodeId", -1);
                out.put("resolved_node_id", nodeId);
                JSONObject rects = new JSONObject(draw.readRects()).optJSONObject("rects");
                JSONObject kr = rects == null ? null : rects.optJSONObject(String.valueOf(nodeId));
                if (kr == null) {
                    out.put("cross_check", "FAIL：内核 readRects 里没有该 nodeId");
                    out.put("cross_check_ok", false);
                } else {
                    JSONObject logical = new JSONObject()
                            .put("x", kr.optDouble("x", 0) / dm.density)
                            .put("y", kr.optDouble("y", 0) / dm.density)
                            .put("width", kr.optDouble("width", 0) / dm.density)
                            .put("height", kr.optDouble("height", 0) / dm.density);
                    out.put("kernel_rect_logical", logical);
                    // 几何**未滚动**时元素应落在视口内且尺寸 > 0（真机首页可观察的事实）
                    boolean ok = logical.optDouble("width", 0) > 0 && logical.optDouble("height", 0) > 0
                            && Math.abs(logical.optDouble("x", 0) - p.optDouble("left", 0)) < 0.51
                            && Math.abs(logical.optDouble("y", 0) - (p.optDouble("top", 0) + p.optDouble("scrollY", 0))) < 0.51
                            && Math.abs(logical.optDouble("width", 0) - p.optDouble("width", 0)) < 0.51
                            && Math.abs(logical.optDouble("height", 0) - p.optDouble("height", 0)) < 0.51;
                    out.put("cross_check_ok", ok);
                }
            } else {
                out.put("cross_check_ok", false);
                out.put("cross_check", "probe 未成功 ⇒ 无从交叉核对");
            }

            // ⑥ 诚实边界 + ★#1082 扩面：class / 属性 / 复合 / 后代 真机可解析；不支持形态明确拒绝
            out.put("not_found_probe", evalStr("__proteusHostAppElementRect("
                    + JSONObject.quote(new JSONObject().put("selector", "#no-such-element-xyz").toString()) + ")"));
            // ★#1082：`.sa-item` 现在**受支持**（静态 class 已进产物）⇒ 应命中真实节点
            out.put("class_probe", evalStr("__proteusHostAppElementRect("
                    + JSONObject.quote(new JSONObject().put("selector", ".sa-item").toString()) + ")"));
            // 复合选择器（tag + class）与后代组合——与 Web 同一语义
            out.put("compound_probe", evalStr("__proteusHostAppElementRect("
                    + JSONObject.quote(new JSONObject().put("selector", "view.sa-item").toString()) + ")"));
            // ★不支持形态（伪类）⇒ 必须 unsupported + 原因（不近似匹配）
            out.put("pseudo_probe", evalStr("__proteusHostAppElementRect("
                    + JSONObject.quote(new JSONObject().put("selector", "view:hover").toString()) + ")"));

            // ★**宿主栈自检**：同一宿主 + 一棵最小树（证明"几何腿本身可用"，排除"栈不可用"误判）
            try {
                String mini = "{\"viewport\":{\"width\":390,\"height\":844},\"nodes\":[{\"id\":1,\"width\":390,\"height\":844,\"backgroundColor\":\"#ff0000\"}]}";
                out.put("mini_mount_reply", draw.mount(mini));
            } catch (Throwable t2) { out.put("mini_mount_reply", "throw: " + t2); }
            // ★★★决策 #1083：录屏/截屏能力探针（两段式：先调一次，再读异步结果）
            out.put("capture_probe_call", evalStr("__proteusHostAppCapture()"));
            try { QuickJsEngine.nativeRunPendingJobs(); } catch (Throwable ignored) { }
            out.put("capture_probe", evalStr("String(globalThis.__proteusCaptureProbeResult ?? 'null')"));
            boolean ok = p.optBoolean("ok", false) && out.optBoolean("cross_check_ok", false);
            out.put("ok", ok);
        } catch (Throwable t) {
            try {
                out.put("ok", false);
                out.put("error", String.valueOf(t));
            } catch (Throwable ignored) { /* JSONObject 极端情况 */ }
        }
        try {
            return out.toString(2);
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"报告序列化失败\"}";
        }
    }

    /** eval 一个返回字符串的全局函数（失败给 null 字符串，不伪造） */
    private static String evalStr(String expr) {
        try {
            QuickJsEngine.EvalResult r = QuickJsEngine.eval(expr);
            return r != null && r.ok && r.value != null ? r.value : "null";
        } catch (Throwable t) {
            return "null";
        }
    }

    private static String readAsset(Activity activity, String name) {
        try (java.io.InputStream is = activity.getAssets().open(name)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return null;
        }
    }
}
