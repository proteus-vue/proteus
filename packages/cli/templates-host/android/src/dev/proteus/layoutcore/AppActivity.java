// {{appName}} —— Proteus 最小 Android 宿主入口（CLI 生成）
//
// 【它做什么】把 **Proteus 编译产物**（`assets/app-screen-content.json`：项目路由 → 真实 SFC →
//   编译器 → 屏内容）经 **runtime（AAR `dev.proteus.layoutcore`）** 真上屏。壳只做三件事：
//     ① 建一个 FrameLayout 根；② 起 `VaporRenderHost`；③ 取产物页 `mount` 上屏。
//   ★本壳**不含项目身份/业务逻辑**（起始页名从 Manifest `ProteusHomePage` 读，默认 index）；
//     换一个项目只需替换 `app-screen-content.json`。与 iOS/鸿蒙最小壳同形。
//
// 【★同包】runtime AAR 的类在包 `dev.proteus.layoutcore`（与壳同包）⇒ 直接引用，无需 import 前缀。
package dev.proteus.layoutcore;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public final class AppActivity extends Activity {
    private static final String TAG = "ProteusHost";

    private FrameLayout content;
    private VaporRenderHost draw;
    private float density = 1f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        density = getResources().getDisplayMetrics().density;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF101020);          // 深色底（启动瞬间/未覆盖区）
        content = new FrameLayout(this);
        content.setBackgroundColor(0xFFF4F5F7);        // 页面浅色底（与 Web 一致）
        content.setVerticalScrollBarEnabled(false);
        content.setHorizontalScrollBarEnabled(false);
        root.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        draw = new VaporRenderHost(this, content);
        draw.setLengthScale(density);                  // 逻辑单位 → 物理像素（唯一换算点）
        draw.enableContentScrollRange();               // 内容装不下才滚（与 Web 页面语义一致）

        Log.i(TAG, "PROTEUS_HOST_READY");
        // 等宿主测量就绪再挂载（视口 = 实测视图尺寸；布局未就绪时 render 内回落屏尺寸）
        content.post(new Runnable() {
            @Override public void run() { render(); }
        });
    }

    private String homePage() {
        try {
            Bundle md = getPackageManager()
                    .getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA).metaData;
            if (md != null && md.getString("ProteusHomePage") != null) return md.getString("ProteusHomePage");
        } catch (Exception ignore) { /* 回落 index */ }
        return "index";
    }

    private void render() {
        try {
            String sc = readAsset("app-screen-content.json");
            if (sc == null) { Log.w(TAG, "缺 assets/app-screen-content.json——无法上屏"); return; }
            String page = homePage();
            JSONObject all = new JSONObject(sc);
            if (!all.has(page)) page = all.has("index") ? "index" : all.keys().next();
            JSONArray nodes = all.getJSONObject(page).getJSONArray("nodes");

            int wPx = content.getWidth() > 0 ? content.getWidth() : getResources().getDisplayMetrics().widthPixels;
            int hPx = content.getHeight() > 0 ? content.getHeight() : getResources().getDisplayMetrics().heightPixels;
            JSONObject tree = new JSONObject();
            tree.put("viewport", new JSONObject().put("width", wPx / density).put("height", hPx / density));
            tree.put("nodes", nodes);

            String out = draw.mount(tree.toString());   // 内核排版 → ProteusHostView 自绘
            if (draw.view() != null) draw.view().invalidate();
            boolean ok = out != null && out.contains("\"ok\":true");
            Log.i(TAG, "HOST_PAGE_RENDER page=" + page + " ok=" + ok + " nodes=" + nodes.length());
            writeReport(page, ok, out);
        } catch (Throwable t) {
            Log.e(TAG, "render 失败：" + t);
        }
    }

    private String readAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    /** 落盘报告（供验证脚本断言；external files dir ⇒ `adb pull` 免 run-as 可读） */
    private void writeReport(String page, boolean ok, String raw) {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) return;
            JSONObject body = new JSONObject();
            body.put("host_id", "android");
            body.put("page", page);
            body.put("ok", ok);
            body.put("raw", raw == null ? "" : raw);
            File f = new File(dir, "HOST_REPORT.json");
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(body.toString().getBytes("UTF-8"));
            }
            Log.i(TAG, "HOST_REPORT_READY " + f.getAbsolutePath());
        } catch (Throwable t) {
            Log.w(TAG, "写报告失败：" + t);
        }
    }
}
