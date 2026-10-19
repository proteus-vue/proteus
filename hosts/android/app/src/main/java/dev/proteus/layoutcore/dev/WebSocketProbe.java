package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/WebSocketProbe.java
// ★★★决策 #1093（C27 `useWebSocket` · Android 腿）：**端到端真机判据**。
//
// 【它证明什么（缺一即红）】
//   ① `ws.open` 真的建立了连接（不是"受理了就算"）——证据是收到 `open` 事件；
//   ② 文本往返：`ws.send('ping')` → 服务端 echo → `message` 事件内容逐字相等；
//   ③ **二进制往返**：发 4 字节 `[1,2,3,255]` → 回执逐字节相等（掩码/长度编码错了这里必炸）；
//   ④ 大消息（>125 字节，触发 2 字节长度扩展）：文本 300 字节能原样回来；
//   ⑤ 对端关闭 → `close` 事件带 code（RFC 6455 的 close 帧解析）；
//   ⑥ 活跃连接表在关闭后归零（不泄漏）。
//
// 【★为什么必须真机（不能只跑单测）】
//   单测验证的是**桥的通道语义**（`capability-websocket.ts`：id 路由/事件分发/清理）；
//   真机验证的是**宿主腿**（`WebSocketCapability.java`：RFC 6455 握手 / 掩码 / 帧编解码 /
//   SSL / ping-pong）。两者正交，缺任一半都可能是"看起来通、实际不通"。
//
// 【服务端】脚本 `hosts/android/run-ws-probe.sh` 在本机起一个 Node echo 服务（`ws` 包），
//   设备经 `adb reverse` 访问 `ws://127.0.0.1:PORT`——**不经公网**（判据可复现、无需外网）。
//
// 【与真机壳同一栈】用真实的 `HostCapabilities` + `SuperappRuntimeHost`，与 `SuperappActivity` 逐件相同。

import android.app.Activity;
import android.view.ViewGroup;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class WebSocketProbe {

    private WebSocketProbe() { }

    /** 报告名（脚本按此拉取） */
    public static final String REPORT = "ws-probe.json";

    /** 单步等待上限（有界——本仓禁止无界等待）。 */
    private static final long STEP_TIMEOUT_MS = 8000;

    /**
     * 跑一次完整探针。
     *
     * @param url 服务端地址（脚本经 `adb reverse` 指向本机，如 `ws://127.0.0.1:8787`）
     * @return 报告 JSON 串（失败也返回**结构化**原因，不抛）
     */
    public static String run(Activity activity, ViewGroup root, String url) {
        JSONObject out = new JSONObject();
        try {
            out.put("engine_available", QuickJsEngine.isAvailable());
            if (!QuickJsEngine.isAvailable()) {
                return out.put("ok", false).put("error", "引擎未加载：" + QuickJsEngine.getLoadError()).toString(2);
            }
            String bundle = readAsset(activity, "bundle-superapp.js");
            if (bundle == null) return out.put("ok", false).put("error", "缺 assets/bundle-superapp.js").toString(2);

            // 与真实壳同一栈
            android.util.DisplayMetrics dm = activity.getResources().getDisplayMetrics();
            VaporRenderHost draw = new VaporRenderHost(activity, root);
            draw.setLengthScale(dm.density);
            JSONObject envObj = EnvVars.collect(activity, dm.density);
            envObj.put("--pf-vw", dm.widthPixels / dm.density);
            envObj.put("--pf-vh", dm.heightPixels / dm.density);
            draw.setEnvVars(envObj);
            HostCapabilities caps = new HostCapabilities(activity);
            ScreenHost screenHost = new ScreenHost(root);
            HostBridge bridge = new HostBridge(caps, screenHost);
            SuperappRuntimeHost rtHost = new SuperappRuntimeHost(draw, bridge);
            // ★与 ElementProbe 同一装配序列（evalWithHost + boot）——否则 JS 侧没有 proteusHost，
            //   ws.* 的 invoke 通道压根没装上。
            QuickJsEngine.eval("globalThis.__PROTEUS_HOST_ID__ = 'android';"
                    + "globalThis.__PROTEUS_HOST_FRAME_DRIVER__ = 'Choreographer';");
            QuickJsEngine.EvalResult load = QuickJsEngine.evalWithHost(bundle, rtHost);
            if (!load.ok) return out.put("ok", false).put("error", "bundle eval 失败：" + load.error).toString(2);
            QuickJsEngine.EvalResult boot = QuickJsEngine.eval("__proteusSuperappBootJson()");
            out.put("boot_ok", boot.ok);
            QuickJsEngine.nativeRunPendingJobs();
            double vw = dm.widthPixels / dm.density;
            double vh = dm.heightPixels / dm.density;
            String renderArgs = new JSONObject()
                    .put("name", "index")
                    .put("viewport", new JSONObject().put("width", vw).put("height", vh))
                    .put("remount", true)
                    .toString();
            QuickJsEngine.EvalResult render = QuickJsEngine.eval(
                    "__proteusSuperappRender(" + JSONObject.quote(renderArgs) + ")");
            out.put("render_ok", render.ok);
            QuickJsEngine.nativeRunPendingJobs();

            // ── 判定主体（JS 侧脚本，与壳同一 JS 引擎）──
            String js = buildJs(url);
            QuickJsEngine.EvalResult ev = QuickJsEngine.eval(js);
            String raw = ev.ok ? ev.value : null;
            out.put("probe_kick", raw);
            JSONObject kick = raw == null ? null : tryParse(raw);
            // 同步入口直接回错误（钩子缺失/构造失败）⇒ 就此收尾
            if (kick != null && kick.has("error") && !kick.optBoolean("ok", false)) {
                out.put("probe", kick);
                return out.put("ok", false).put("error", kick.optString("error")).toString(2);
            }
            // ★同类移除：第二次调钩子 = 第二条连接（同样会造成 id 错配）
            // ★★★诊断已移除：它会额外开一条 ws 连接，产生**另一个 id**
            //   ⇒ 宿主推的是诊断连接的 id，而探针订阅的是正式连接的 id ⇒ 事件永远对不上。
            //   （真机实测：报告里 invoke0 返回 id=3，而日志里推送的是 id=1/2 —— 就是这个错配。）
            // ★两段式：真实结果填在 __proteusHostWsProbeResult（有界等待 + 驱动 job 泵）
            // ★泵驱动状态机（见 entry-superapp.ts 的 appWsProbeDrive 头注释）：
            //   每轮 = 泵一次 job 队列 + 调一次 drive（同步推进 JS 状态机）⇒ 直到 drive 回 done:true。
            //   ★不依赖定时器（superapp bundle 的 JS 环境没有 setTimeout 宿主——真机实测）。
            String resultJson = null;
            long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS * 6;
            int rounds = 0;
            int drainedTotal = 0;
            String lastPhase = "";
            while (System.currentTimeMillis() < deadline) {
                // ★先把壳推就地分发（探针占着主线程，MAIN.post 排不上——真机死锁修复）
                drainedTotal += WebSocketCapability.drainPendingPushes();
                QuickJsEngine.nativeRunPendingJobs();
                QuickJsEngine.EvalResult dr = QuickJsEngine.eval(
                        "typeof __proteusHostAppWsProbeDrive==='function'?__proteusHostAppWsProbeDrive():'{}'");
                rounds++;
                String dv = dr.ok ? dr.value : null;
                if (dv != null) {
                    JSONObject dObj = tryParse(dv);
                    lastPhase = dObj != null ? dObj.optString("phase", "?") : "unparsable:" + dv;
                    if (dObj != null && dObj.optBoolean("done", false)) {
                        QuickJsEngine.EvalResult rr = QuickJsEngine.eval(
                                "String(globalThis.__proteusHostWsProbeResult || '')");
                        resultJson = rr.ok ? rr.value : null;
                        break;
                    }
                }
                try { Thread.sleep(10); } catch (InterruptedException ie) { break; }
            }
            out.put("probe_rounds", rounds);
            out.put("probe_last_phase", lastPhase);
            // ★宿主侧读数：队列里还剩多少（证明"宿主入队了但 JS 没消费" vs "宿主压根没入队"）
            out.put("pending_left", WebSocketCapability.pendingCount());
            out.put("drained_total", drainedTotal);
            out.put("probe_raw", resultJson);
            JSONObject parsed = resultJson == null ? null : tryParse(resultJson);
            if (parsed == null) {
                return out.put("ok", false).put("error", "探针结果未出现或非 JSON：" + resultJson).toString(2);
            }
            out.put("probe", parsed);
            out.put("ok", parsed.optBoolean("ok", false));
        } catch (Throwable t) {
            try {
                out.put("ok", false).put("error", "探针异常：" + t + "（" + android.util.Log.getStackTraceString(t) + "）");
            } catch (Exception ignored) { }
        }
        return out.toString();
    }

    /**
     * 探针 JS（在真机 JS 引擎里跑，走**真实的桥 + 宿主腿**）。
     *
     * <p>★全部用 Promise + 有界超时：任一步失败都返回结构化结果，不悬挂（本仓禁止无界等待）。
     */
    /**
     * 广播设定的 URL（★广播 extra 在 receiver 的 Intent 上，不在 Activity 的启动 intent 上）；
     * 状态收在本类，MainActivity 是 6600+ 行存量棘轮（只减不增）。
     */
    private static volatile String pendingUrl = null;

    /** 广播入口：暂存 URL（由 MainActivity 的 receiver 调用）。 */
    public static void noteUrl(String url) {
        pendingUrl = (url == null || url.isEmpty()) ? null : url;
    }

    /** 广播入口：用暂存的 URL 跑（用完即清）。 */
    public static String runPending(Activity activity, ViewGroup root) {
        String url = pendingUrl;
        pendingUrl = null;
        return run(activity, root, url != null ? url : "ws://127.0.0.1:8787");
    }

    private static String buildJs(String url) {
        // 启动探针状态机（**同步**返回占位；后续由 drive 推进）
        return "(function(){"
            + "  if (typeof __proteusHostAppWsProbe !== 'function') {"
            + "    return JSON.stringify({ok:false, error:'探针钩子未装配（__proteusHostAppWsProbe 缺失）'});"
            + "  }"
            + "  try { return __proteusHostAppWsProbe(" + JSONObject.quote(url) + "); }"
            + "  catch (e) { return JSON.stringify({ok:false, error:String(e && e.message ? e.message : e)}); }"
            + "})()";
    }

    private static JSONObject tryParse(String s) {
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    private static String readAsset(Activity activity, String name) {
        try (java.io.InputStream in = activity.getAssets().open(name)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
