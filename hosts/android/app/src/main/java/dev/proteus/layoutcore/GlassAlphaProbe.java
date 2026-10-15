package dev.proteus.layoutcore;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.HardwareRenderer;
import android.graphics.Paint;
import android.graphics.RenderNode;
import android.graphics.RuntimeShader;
import android.hardware.HardwareBuffer;
import android.media.Image;
import android.media.ImageReader;
import android.util.Log;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * ★★★决策 #983 的可回归诊断：**RuntimeShader 返回的 alpha 在本设备是否生效**。
 *
 * <p>【为什么保留成诊断（而不是删掉）】#966 曾断言"本设备忽略 RuntimeShader 返回的 alpha"，
 * 并据此绕开 shader alpha、改走宿主几何 `clipPath`；#983 用三形态探针**证伪**了它
 * （真因是 `glass.wgsl` 把 alpha 硬编 `1.0`）。本类把该探针**固化**，防该结论再次漂移——
 * 跑 `bash hosts/android/check-shader-alpha.sh` 即可复验。</p>
 *
 * <p>【做法】离屏 `HardwareRenderer`（#979 已证本设备可用）画三个 RuntimeShader 方块到一个已知底
 * （品红），读回中心/角点像素判 alpha 是否被尊重：① `alpha=0` 应露出底；② `alpha=0.5` 应为半透混合；
 * ③ 圆覆盖率应画出圆、角上露底。三者全对 ⇒ `PROBE-PASS`，否则 `PROBE-FAIL`。</p>
 */
public final class GlassAlphaProbe {
    private GlassAlphaProbe() {}

    private static final String TAG = "proteus-alphaprobe";

    public static void runAsync() {
        new Thread(GlassAlphaProbe::run, "alpha-probe").start();
    }

    private static void run() {
        final int W = 720, H = 300;
        ImageReader reader = null;
        HardwareRenderer hr = null;
        android.os.HandlerThread ht = null;
        try {
            reader = ImageReader.newInstance(W, H, HardwareBuffer.RGBA_8888, 2,
                    HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_GPU_COLOR_OUTPUT);
            ht = new android.os.HandlerThread("alpha-probe-img");
            ht.start();
            final CountDownLatch latch = new CountDownLatch(1);
            reader.setOnImageAvailableListener(r -> latch.countDown(), new android.os.Handler(ht.getLooper()));
            hr = new HardwareRenderer();
            hr.setSurface(reader.getSurface());
            RenderNode node = new RenderNode("alpha-probe");
            node.setPosition(0, 0, W, H);
            hr.setContentRoot(node);
            Canvas c = node.beginRecording(W, H);

            final float y0 = 0, sz = 220, x0 = 10, gap = 20;
            Paint bg = new Paint();
            bg.setColor(0xFFFF00FF);   // 品红底（R=255,G=0,B=255）
            c.drawRect(0, 0, W, H, bg);
            // ① 全透明  ② 半透  ③ 圆覆盖率（画布坐标）
            String[] frags = {
                "half4 main(float2 p){ return half4(0.0,0.0,0.0,0.0); }",
                "half4 main(float2 p){ return half4(0.0,0.0,0.0,0.5); }",
                "uniform vec2 ctr;\nuniform float rr;\nhalf4 main(float2 p){ float d=length(p-ctr)-rr; return half4(0.0,0.0,0.0, clamp(-d/1.5,0.0,1.0)); }"
            };
            float[] cx = new float[3];
            for (int i = 0; i < 3; i++) {
                float rx = x0 + i * (sz + gap);
                cx[i] = rx + sz / 2f;
                RuntimeShader rs = new RuntimeShader(frags[i]);
                if (i == 2) { rs.setFloatUniform("ctr", cx[i], y0 + sz / 2f); rs.setFloatUniform("rr", sz * 0.32f); }
                Paint p = new Paint();
                p.setShader(rs);
                c.drawRect(rx, y0, rx + sz, y0 + sz, p);
            }
            node.endRecording();
            hr.createRenderRequest().syncAndDraw();

            latch.await(3, TimeUnit.SECONDS);
            Image img = reader.acquireLatestImage();
            if (img == null) { Log.e(TAG, "PROBE-FAIL 无读回"); return; }
            HardwareBuffer buf = img.getHardwareBuffer();
            Bitmap wrap = Bitmap.wrapHardwareBuffer(buf, null);
            Bitmap bmp = wrap.copy(Bitmap.Config.ARGB_8888, false);
            int a0 = bmp.getPixel((int) cx[0], (int) (y0 + sz / 2));          // ① 中心
            int a5 = bmp.getPixel((int) cx[1], (int) (y0 + sz / 2));          // ② 中心
            int ci = bmp.getPixel((int) cx[2], (int) (y0 + sz / 2));          // ③ 圆内
            int co = bmp.getPixel((int) (cx[2] - sz * 0.48f), (int) (y0 + sz * 0.06f));  // ③ 圆外角
            // 判定（品红底 R=255,G=0,B=255）：① 应≈底；② 应显著暗于底但非纯黑；③ 圆内≈黑、圆外≈底
            boolean ok0 = near(a0, 234, 51, 247, 60);           // 露出底（各机型品红略有别，取宽阈值）
            boolean ok5 = lum(a5) < lum(a0) - 40 && lum(a5) > 20;
            boolean okCi = lum(ci) < 40;
            boolean okCo = near(co, 234, 51, 247, 60);
            boolean pass = ok0 && ok5 && okCi && okCo;
            Log.i(TAG, (pass ? "PROBE-PASS" : "PROBE-FAIL")
                    + " ①alpha0=" + Integer.toHexString(a0) + "(露底=" + ok0 + ")"
                    + " ②alpha0.5=" + Integer.toHexString(a5) + "(半透=" + ok5 + ")"
                    + " ③圆内=" + Integer.toHexString(ci) + "(黑=" + okCi + ") 圆外=" + Integer.toHexString(co) + "(露底=" + okCo + ")");
            wrap.recycle(); bmp.recycle(); img.close();
        } catch (Throwable t) {
            Log.e(TAG, "PROBE-FAIL 异常 " + t);
        } finally {
            try { if (hr != null) hr.destroy(); } catch (Throwable ignored) {}
            try { if (reader != null) reader.close(); } catch (Throwable ignored) {}
            try { if (ht != null) ht.quitSafely(); } catch (Throwable ignored) {}
        }
    }

    private static boolean near(int c, int r, int g, int b, int tol) {
        return Math.abs(((c >> 16) & 255) - r) <= tol
            && Math.abs(((c >> 8) & 255) - g) <= tol
            && Math.abs((c & 255) - b) <= tol;
    }
    private static double lum(int c) {
        return 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
    }
}
