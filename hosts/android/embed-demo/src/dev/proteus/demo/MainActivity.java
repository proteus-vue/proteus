// hosts/android/embed-demo/src/dev/proteus/demo/MainActivity.java
package dev.proteus.demo;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileWriter;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;

import dev.proteus.sdk.ProteusEngine;
import dev.proteus.sdk.ProteusHost;

/**
 * ★★**HA5 的"客户 App 嵌入单页面"demo**（模拟第三方 App）
 *
 * 【它证明什么（方案 §8.1/§8.2 的核心收益）】Proteus 可以作为 **AAR** 嵌进**已有 App**——
 *   本 Activity 属于 `dev.proteus.demo.embed`（**独立包名**），只依赖 `proteus-sdk.aar`：
 *   · 不引 Proteus 工具链（没有 Gradle 插件、没有代码生成）
 *   · 不引内核源码（`classes.jar` + `jni/arm64-v8a/libproteus_jni.so` 就是全部）
 *   ⇒ 这就是"客户不用推翻现有 App 就能试用"的**可执行证据**。
 *
 * 【接入步骤（与文档 `docs/proteus-host-abi-integration.md` 逐条对应）】
 *   ① `ProteusEngine.prewarm()`（App 启动阶段；避免首屏白屏，方案 §8.5）
 *   ② 实现 {@link ProteusHost}（**两个回调**：量文本 + 请求帧）
 *   ③ `ProteusEngine.create(host)` → `loadTree(json)` → 每帧 `frame()` / `frameUpdates()`
 *   ④ 把 `frameUpdates()` 的五值套到自己的视图上（本 demo 用一个自绘 View 演示）
 *
 * 【★一个设计要点：demo 里没有"宿主集成"也没有"平台适配"的重复实现】
 *   Surface / 生命周期 / 输入 / 调度 / 能力 / 原生组件的**编排**都在引擎里（HA0–HA4 的成果）——
 *   客户这份代码只写了"量文本"与"排帧"两件事，共 ~40 行。
 *   换平台（iOS）时这两件事要重写（那是平台成本），而**其余一行不用动**（那是 ABI 的收益）。
 */
public class MainActivity extends Activity implements ProteusHost {

    /* ── ③ 宿主回调实现（本 demo 的全部"平台代码"就这两段） ── */

    private final Paint measurePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    @Override
    public long measureText(String text, float fontSize, int fontWeight, String fontFamily) {
        // ★必须按引擎给的字号设 paint（内核把 fontSize 交给宿主——它不知道平台字号语义）
        measurePaint.setTextSize(fontSize > 0 ? fontSize : 14f);
        measurePaint.setFakeBoldText(fontWeight >= 600);
        measurePaint.setTypeface(typefaceFor(fontFamily));
        float w = measurePaint.measureText(text);
        Paint.FontMetrics fm = measurePaint.getFontMetrics();
        float h = fm.descent - fm.ascent;
        // ★打包成 long（零分配；见 ProteusHost 的契约注释）
        return (Float.floatToRawIntBits(w) & 0xFFFFFFFFL) | (((long) Float.floatToRawIntBits(h)) << 32);
    }

    private static android.graphics.Typeface typefaceFor(String family) {
        if ("monospace".equals(family)) return android.graphics.Typeface.MONOSPACE;
        if ("serif".equals(family)) return android.graphics.Typeface.SERIF;
        return android.graphics.Typeface.DEFAULT;
    }

    private volatile boolean frameRequested = false;

    @Override
    public void requestFrame() {
        // ★引擎不自建线程（方案 §5.1）⇒ 排帧归宿主。本 demo 用最简单的方式：打标记，
        //   由自己的 run 循环消费（真实 App 里应接 Choreographer.postFrameCallback）。
        frameRequested = true;
    }

    /* ── 小工具：把几何/更新字节流解出来画 ── */

    private static final class Box {
        float x, y, w, h;
        float tx = 0, ty = 0, scale = 1, rotate = 0, opacity = 1;
    }

    private final Map<Integer, Box> boxes = new HashMap<>();
    private final Paint boxPaint = new Paint();
    private FrameLayout root;

    private void applyRects(byte[] rects) {
        boxes.clear();
        if (rects == null || rects.length < ProteusEngine.RECTS_HEADER_BYTES) return;
        ByteBuffer bb = ByteBuffer.wrap(rects).order(ByteOrder.LITTLE_ENDIAN);
        bb.position(ProteusEngine.RECTS_HEADER_BYTES);
        while (bb.remaining() >= ProteusEngine.RECT_BYTES) {
            int id = bb.getInt();
            Box b = new Box();
            b.x = bb.getFloat(); b.y = bb.getFloat(); b.w = bb.getFloat(); b.h = bb.getFloat();
            boxes.put(id, b);
        }
    }

    /** ★把每帧更新（24B/条）套到几何上——**无 JSON 解析**（与内核的二进制通道对齐） */
    private void applyUpdates(byte[] updates) {
        if (updates == null) return;
        ByteBuffer bb = ByteBuffer.wrap(updates).order(ByteOrder.LITTLE_ENDIAN);
        while (bb.remaining() >= ProteusEngine.FRAME_UPDATE_BYTES) {
            int id = bb.getInt();
            Box b = boxes.get(id);
            float tx = bb.getFloat(), ty = bb.getFloat(), sc = bb.getFloat();
            float rot = bb.getFloat(), op = bb.getFloat();
            if (b != null) { b.tx = tx; b.ty = ty; b.scale = sc; b.rotate = rot; b.opacity = op; }
        }
    }

    /* ── 引擎与 run ── */

    private ProteusEngine engine;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ① 预热（方案 §8.5：真实 App 应在 Application.onCreate 调这里）
        ProteusEngine.prewarm();

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF101020);
        View canvasView = new View(this) {
            @Override
            protected void onDraw(Canvas canvas) {
                for (Map.Entry<Integer, Box> e : boxes.entrySet()) {
                    Box b = e.getValue();
                    int save = canvas.save();
                    canvas.translate(b.tx, b.ty);
                    float cx = b.x + b.w / 2f, cy = b.y + b.h / 2f;
                    if (b.rotate != 0) canvas.rotate(b.rotate, cx, cy);
                    if (b.scale != 1f) canvas.scale(b.scale, b.scale, cx, cy);
                    // 用 id 派生颜色（demo 里没有样式信息——真实宿主会从产物里拿颜色）
                    int c = Color.HSVToColor(new float[]{(e.getKey() * 47f) % 360f, 0.6f, 0.9f});
                    boxPaint.setColor(c);
                    boxPaint.setAlpha((int) (255 * Math.max(0f, Math.min(1f, b.opacity))));
                    canvas.drawRect(b.x, b.y, b.x + b.w, b.y + b.h, boxPaint);
                    canvas.restoreToCount(save);
                }
            }
        };
        root.addView(canvasView, new FrameLayout.LayoutParams(-1, -1));

        TextView tv = new TextView(this);
        tv.setText("Proteus 已嵌入（AAR）：见 files/embed-demo.json");
        tv.setTextColor(0xFFFFFFFF);
        tv.setPadding(24, 24, 24, 24);
        root.addView(tv);
        setContentView(root);

        // 广播触发（脚本用；与既有宿主同一模式——`--es path` 不会自动跑，必须广播）
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { runDemo(canvasView); }
        };
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            registerReceiver(r, new IntentFilter("dev.proteus.embed.RUN"), Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(r, new IntentFilter("dev.proteus.embed.RUN"));
        }
    }

    /** 一次完整的"嵌入使用"：建引擎 → 校验能力 → 装树 → 提交一帧 → 跑若干帧 → 落报告 */
    private void runDemo(View canvasView) {
        org.json.JSONObject out = new org.json.JSONObject();
        try {
            // ③ 建引擎（宿主回调 = 本 Activity）
            engine = ProteusEngine.create(this);
            out.put("created", true);
            out.put("prewarm", true);

            // 能力清单（HA3）：壳声明自己提供什么（**用 CLI 产出的同形**）
            engine.setShellCapabilities("{\"capabilities\":[{\"id\":\"network.request\",\"tier\":1}]}");
            int capOk = engine.checkCapabilities("[\"network.request\"]");
            out.put("capability_check_ok_rc", capOk);
            int capMiss = engine.checkCapabilities("[\"network.request\",\"camera.capture\"]");
            out.put("capability_check_missing_rc", capMiss);
            out.put("capability_missing_is_explicit", capMiss == ProteusEngine.ERR_CAPABILITY_UNREGISTERED);

            // 装树（含 requiredCapabilities ⇒ 引擎**加载前**校验；这里是**满足**的那一侧）
            String tree = "{\"viewport\":{\"width\":390,\"height\":844},"
                    + "\"requiredCapabilities\":[\"network.request\"],"
                    + "\"nodes\":["
                    + "{\"id\":1,\"width\":390,\"height\":844,\"flexDirection\":\"column\",\"padding\":{\"top\":80,\"left\":24,\"right\":24}},"
                    + "{\"id\":2,\"parentId\":1,\"width\":342,\"height\":120,\"margin\":{\"bottom\":16}},"
                    + "{\"id\":3,\"parentId\":1,\"text\":\"Hello from AAR\",\"isText\":true,\"fontSize\":22},"
                    + "{\"id\":4,\"parentId\":1,\"width\":342,\"height\":80,\"margin\":{\"top\":16}}"
                    + "]}";
            int rc = engine.loadTree(tree);
            out.put("load_tree_rc", rc);
            if (rc != ProteusEngine.OK) {
                throw new IllegalStateException("loadTree 失败 rc=" + rc + " stats=" + engine.stats());
            }
            // ★度量回调确实发生了（宿主实现被引擎调用；不是"我们说它会调"）
            out.put("measure_calls", statsField("measure_calls"));

            applyRects(engine.rects());
            out.put("box_count", boxes.size());

            // ★批处理红线：一帧的两条指令走**一次** submitFrame
            byte[] ops = opsToggleVis(2, false, 4, true);
            int sub = engine.submitFrame(ops);
            out.put("submit_frame_rc", sub);

            // ★先起一条动画（否则 `frameUpdates()` 恒空——那些数据**来自动画**）
            //   客户端点：`animStart(JSON)` 与内核语义一致（曲线/弹簧/序列/滚动窗口）
            int animRc = engine.animStart(
                    "{\"anims\":[{\"nodeId\":2,\"kind\":0,\"curve\":1,\"from\":0,\"to\":120,"
                            + "\"durMs\":300,\"takeover\":false}]}");
            out.put("anim_start_rc", animRc);

            // 跑若干帧（时间驱动；真实 App 由 Choreographer 驱动）
            long t0 = System.nanoTime();
            int updatesSeen = 0;
            for (int i = 0; i < 20; i++) {
                engine.frame(t0 + i * 16_666_667L);
                byte[] up = engine.frameUpdates();
                if (up != null && up.length > 0) updatesSeen += up.length / ProteusEngine.FRAME_UPDATE_BYTES;
                applyUpdates(up);
            }
            out.put("frames_driven", 20);
            out.put("update_records_seen", updatesSeen);
            canvasView.invalidate();

            // 输入：单点（内部走批处理入口）——坐标取节点 2 的中心（padding 后的第一块）
            float tapX = 24f + 171f, tapY = 80f + 60f;
            long hit = engine.tap(tapX, tapY, System.nanoTime());
            out.put("tap_hit_id", hit);
            out.put("tap_xy", tapX + "," + tapY);

            // 诊断读数（客户排查入口）
            org.json.JSONObject st = new org.json.JSONObject(engine.stats());
            out.put("stats_submit_frame_calls", st.optInt("submit_frame_calls"));
            out.put("stats_measure_calls", st.optInt("measure_calls"));
            out.put("last_error", st.opt("last_error"));
            out.put("ok", true);
        } catch (Throwable t) {
            try {
                out.put("ok", false);
                out.put("error", t.getClass().getSimpleName() + ": " + t.getMessage());
            } catch (Exception ignored) { /* JSONObject 不会失败 */ }
        } finally {
            if (engine != null) { engine.close(); engine = null; }
        }
        writeReport(out.toString());
    }

    private int statsField(String key) {
        try {
            return new org.json.JSONObject(engine.stats()).optInt(key);
        } catch (Exception e) {
            return -1;
        }
    }

    /** 造一帧指令流：两条 TOGGLE_VIS（头 20B + 每条 6B；见 instruction-spec.md） */
    private static byte[] opsToggleVis(int nodeA, boolean visA, int nodeB, boolean visB) {
        ByteBuffer bb = ByteBuffer.allocate(20 + 12).order(ByteOrder.LITTLE_ENDIAN);
        bb.putInt(0x504F5650);      // magic "PVOP"
        bb.putInt(2);               // OPS_VERSION
        bb.putInt(2);               // opCount
        bb.putInt(0);               // keyCount（无键池）
        bb.putInt(0);               // strCount
        bb.put((byte) 0x05); bb.putInt(nodeA); bb.put((byte) (visA ? 1 : 0));
        bb.put((byte) 0x05); bb.putInt(nodeB); bb.put((byte) (visB ? 1 : 0));
        return bb.array();
    }

    private void writeReport(String json) {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) dir = getFilesDir();
            File f = new File(dir, "embed-demo.json");
            try (FileWriter w = new FileWriter(f)) { w.write(json); w.flush(); }
        } catch (Exception ignored) { /* 报告写失败不该崩 demo */ }
    }
}
