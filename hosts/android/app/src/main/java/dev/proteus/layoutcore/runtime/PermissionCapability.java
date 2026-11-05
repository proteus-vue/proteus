// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/PermissionCapability.java
// ★★★App 能力 C16：`permission.check` —— 权限状态查询（Android 侧宿主实现）。
//
// 【为什么需要】`usePermission` 要的 `bridge.getPermission(name)` 在 App 端一直没有宿主方法
//   ⇒ 恒抛 `permission.unsupported`。Android 本来就有 `Context.checkSelfPermission` ⇒ 属
//   "有平台能力、没接线"（与 #1285 拨号 / #1336 分享 / #1384 文档预览同一形态）。
//
// 【★只查不申请】本方法**不弹授权框**。`usePermission` 的契约是"读当前状态"；真正的申请发生在
//   业务实际使用该能力时（打开相机 / 请求定位）——那时系统自己弹。擅自弹框会让"只想了解状态"
//   的调用产生用户可见副作用。
//
// 【★★为什么回执里必须有 `declared`（这不是过度设计）】
//   `checkSelfPermission` 在**清单根本没声明**该权限时同样返回 DENIED。此时若只回 `denied`，
//   业务会读成"用户拒绝了"，去引导用户到系统设置里找——而那里根本没有这个开关（永远找不到）。
//   ⇒ 区分"没声明"与"声明了但没授予"（`requestedPermissions` 可查），前者回 `declared:false`，
//     JS 层据此报 `permission.notDeclared`（可操作：去补 manifest，而不是让用户白折腾）。
//
// 【★★为什么分不出 prompt（未询问 / 永久拒绝）】
//   Android 区分这两者需要 `getPermissionFlags()`——那是 **SystemApi**（第三方应用调不到）。
//   ⇒ 未授予一律回 `denied`（口径在 `capability-app-permission.ts` 头注释里，与鸿蒙一致）。
//   ★不猜：猜 `prompt` 会让业务在"永久拒绝"时反复弹框（用户已经点过"不再询问"，什么都不会发生）。
//
// 【★scope 映射（三端同一集，改一处要改三处）】
//   camera → CAMERA · microphone → RECORD_AUDIO · geolocation → FINE 或 COARSE（任一授予即 granted）
//   ★geolocation 两个都要查：用户可能只给了"大致位置"（COARSE），只查 FINE 会误报 denied。
//
// 【诚实边界】回执是**查询瞬间**的状态；用户在系统设置里改权限后，下次调用才反映（本层不缓存）。
package dev.proteus.layoutcore.runtime;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

public final class PermissionCapability {

    /** 与 `capability-app-permission.ts` 的 `APP_PERMISSION_SCOPES` **同一集** */
    private static final String[] SCOPES = { "camera", "microphone", "geolocation" };

    private PermissionCapability() {}

    /**
     * `permission.check`：`{scope}` → `{scope, state, declared}`
     * @throws IllegalArgumentException scope 缺失或不在支持集（**不静默回 denied**——
     *         把"框架不认识"伪装成"系统拒绝"会让业务永远查不出问题）
     */
    public static JSONObject check(Context ctx, JSONObject args) throws Exception {
        // ★可用性探测（`appPermissionAvailable()` 发 `{probe:true}`）：只要方法在就回 ok。
        //   显式处理而不是靠"抛错但不 missing"——后者会让日志里出现一串假错误，排查时误导人。
        if (args != null && args.optBoolean("probe", false)) {
            JSONObject p = new JSONObject();
            p.put("probe", true);
            p.put("scopes", new JSONArray(java.util.Arrays.asList(SCOPES)));
            return p;
        }
        String scope = args.optString("scope", null);
        if (scope == null || scope.isEmpty()) {
            throw new IllegalArgumentException("permission.check: 缺少 scope（支持 " + String.join(" / ", SCOPES) + "）");
        }
        String[] manifestPerms;
        switch (scope) {
            case "camera":
                manifestPerms = new String[] { Manifest.permission.CAMERA };
                break;
            case "microphone":
                manifestPerms = new String[] { Manifest.permission.RECORD_AUDIO };
                break;
            case "geolocation":
                // ★任一授予即 granted（用户可能只给了"大致位置"）
                manifestPerms = new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                };
                break;
            default:
                throw new IllegalArgumentException(
                        "permission.check: 不认识的 scope「" + scope + "」（支持 " + String.join(" / ", SCOPES) + "）");
        }

        // ① 清单是否声明（见文件头「为什么必须有 declared」）
        boolean declared = allDeclared(ctx, manifestPerms);
        // ② 当前授予状态
        boolean granted = false;
        for (String p : manifestPerms) {
            if (ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) {
                granted = true;
                break;
            }
        }

        JSONObject out = new JSONObject();
        out.put("scope", scope);
        out.put("state", granted ? "granted" : "denied");
        out.put("declared", declared);
        // 诊断读数：真机判据据此核对"查的是哪几个系统权限"（不是只看 state）
        JSONArray perms = new JSONArray();
        for (String p : manifestPerms) perms.put(p);
        out.put("manifestPermissions", perms);
        return out;
    }

    /** 清单里是否**全部**声明了这些权限（缺一个就说明"这个 scope 在本包里根本没打开"） */
    private static boolean allDeclared(Context ctx, String[] perms) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(
                    ctx.getPackageName(), PackageManager.GET_PERMISSIONS);
            String[] requested = pi.requestedPermissions;
            if (requested == null) return false;
            for (String p : perms) {
                boolean found = false;
                for (String r : requested) {
                    if (p.equals(r)) { found = true; break; }
                }
                if (!found) return false;
            }
            return true;
        } catch (Throwable t) {
            // 查不到清单 ⇒ **不谎报"已声明"**（宁可让 JS 层报 notDeclared，也不给一个乐观猜测）
            return false;
        }
    }
}
