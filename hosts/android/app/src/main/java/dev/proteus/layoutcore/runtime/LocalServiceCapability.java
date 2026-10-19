package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/LocalServiceCapability.java
// ★★★决策 #1097（2026-10-19）：C78 局域网服务发现（mDNS）的 **Android 宿主实现**
//   （`localService.start` / `localService.stop`）。
//
// 【为什么用 NsdManager】`android.net.nsd.NsdManager` 是系统自带的 DNS-SD（mDNS）实现，
//   无需第三方依赖、无需特殊权限（局域网发现本身不要求；Android 13+ 的 NEARBY_WIFI_DEVICES
//   仅影响部分 WiFi 扫描接口，不影响 NsdManager 的 mDNS 发现）。
//
// 【★两段解析（NsdManager 的固定形态）】
//   `discoverServices` 先回调 `onServiceFound`（只给名字与类型），**地址要靠 `resolveService` 二次拿**。
//   ⇒ 本实现在 found 时立即 resolve，成功后才推 `found`（带 ip/port），
//     失败推 `resolveFail`——与 wx 的 `onLocalServiceResolveFail` 语义对齐。
//
// 【错误分档（与能力层一致）】
//   · 无 NsdManager / 系统禁用 ⇒ `UnsupportedOperationException` ⇒ JS 侧 `*.unsupported`
//   · 搜索已在进行 ⇒ `IllegalStateException("ALREADY")` ⇒ JS 侧 `*.failed`（如实报，不静默）
//
// 【诚实边界】
//   · `serviceType` 原样传给 NsdManager（调用方给 `"_http._tcp"`；Android 接受不带尾点形态）
//   · 只做 **discovery**（发现），不做 **register**（广播自身服务）——契约里没有 advertise。

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.ConcurrentHashMap;

public final class LocalServiceCapability {

    private static final String TAG = "proteus-mdns";

    private static final ConcurrentHashMap<Integer, NsdManager.DiscoveryListener> LISTENERS = new ConcurrentHashMap<>();
    private static volatile String currentType = null;
    private static volatile NsdManager.DiscoveryListener active = null;

    private LocalServiceCapability() { }

    /** 壳推出口（由 HostCapabilities 注入；与 ws/capture 同款）。 */
    public interface Pusher { void push(JSONObject payload); }
    private static volatile Pusher pusher = null;

    public static void setPusher(Pusher p) { pusher = p; }

    private static NsdManager nsd(Context ctx) {
        NsdManager m = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        if (m == null) throw new UnsupportedOperationException("localService: 本机无 NsdManager（系统未提供 mDNS）");
        return m;
    }

    /** `localService.start`：`{ serviceType }` → `{}`（受理即返，服务经壳推到达）。 */
    public static JSONObject start(Context ctx, JSONObject args) throws Exception {
        String type = args.optString("serviceType", "");
        if (type.isEmpty()) throw new IllegalArgumentException("localService.start 需要 serviceType（如 \"_http._tcp\"）");
        NsdManager m = nsd(ctx);
        if (active != null) {
            // ★幂等：已用同一类型在搜 ⇒ 直接成功（不重复注册监听器）
            if (type.equals(currentType)) return new JSONObject();
            stop(ctx, new JSONObject());
        }
        final NsdManager manager = m;
        NsdManager.DiscoveryListener l = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                currentType = null;
                active = null;
                pushEvent("resolveFail", null, "start 失败 errorCode=" + errorCode);
            }
            @Override public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                pushEvent("stop", null, "stop 失败 errorCode=" + errorCode);
            }
            @Override public void onDiscoveryStarted(String serviceType) {
                Log.i(TAG, "discovery started: " + serviceType);
            }
            @Override public void onDiscoveryStopped(String serviceType) {
                pushEvent("stop", null, null);
            }
            @Override public void onServiceFound(NsdServiceInfo info) {
                // ★二次解析拿地址（NsdManager 的固定两段形态）
                try {
                    manager.resolveService(info, new NsdManager.ResolveListener() {
                        @Override public void onResolveFailed(NsdServiceInfo failed, int errorCode) {
                            pushEvent("resolveFail", failed, "resolve 失败 errorCode=" + errorCode);
                        }
                        @Override public void onServiceResolved(NsdServiceInfo resolved) {
                            pushEvent("found", resolved, null);
                        }
                    });
                } catch (Throwable t) {
                    pushEvent("resolveFail", info, String.valueOf(t));
                }
            }
            @Override public void onServiceLost(NsdServiceInfo info) {
                pushEvent("lost", info, null);
            }
        };
        manager.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, l);
        active = l;
        currentType = type;
        return new JSONObject();
    }

    /** `localService.stop`：`{}` → `{}`（幂等：没在搜也算成功）。 */
    public static JSONObject stop(Context ctx, JSONObject args) throws Exception {
        NsdManager.DiscoveryListener l = active;
        if (l == null) return new JSONObject();
        active = null;
        currentType = null;
        try {
            nsd(ctx).stopServiceDiscovery(l);
        } catch (Throwable t) {
            // ★停止失败如实记，但不抛给 JS（清理路径不该因为系统忙而报错）
            Log.w(TAG, "stopServiceDiscovery 失败：" + t);
        }
        return new JSONObject();
    }

    /** 把一条服务事件推给 JS。 */
    private static void pushEvent(String event, NsdServiceInfo info, String error) {
        Pusher p = pusher;
        if (p == null) return;
        try {
            JSONObject o = new JSONObject();
            o.put("event", event);
            if (info != null) {
                JSONObject s = new JSONObject();
                s.put("serviceName", info.getServiceName() == null ? "" : info.getServiceName());
                s.put("serviceType", info.getServiceType() == null ? "" : info.getServiceType());
                if (info.getHost() != null) {
                    String host = info.getHost().getHostAddress();
                    if (host != null && !host.isEmpty()) s.put("ip", host);
                }
                if (info.getPort() > 0) s.put("port", info.getPort());
                o.put("service", s);
            }
            if (error != null) o.put("error", error);
            p.push(o);
        } catch (Throwable t) {
            Log.w(TAG, "推送 mDNS 事件失败：" + t);
        }
    }
}
