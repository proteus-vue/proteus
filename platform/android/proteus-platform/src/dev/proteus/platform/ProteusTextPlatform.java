// platform/android/proteus-platform/src/dev/proteus/platform/ProteusTextPlatform.java
// ★★**Android 平台适配层：字形（HA0.5 从 `hosts/android/.../runtime/ProteusHostView.java` 抽出）**
//
// 【这一层是什么（Host ABI 方案 §0.4.8 的判断标准）】"这段代码换到同平台的另一个 App 里，需要改吗？"
//   · 字体角色映射（system/serif/monospace/… → Android Typeface）—— **不用改** ⇒ **平台适配**
//   · 自定义字体注册表（`custom:<族名>` → Typeface）—— 同平台内通用 ⇒ 同属本层
//   ⇒ 因此它属于 `platform/`；而**宿主集成**（Surface / 生命周期 / 输入 / 调度 / 能力注册 / 绘制执行）留在 `hosts/`。
//
// 【依赖方向（硬性，`scripts/check-platform-layering.mjs` 把它机器化）】
//   platform/* ──→ **禁止**引用 hosts/* 与 Host ABI（平台层不感知宿主契约）
//   本文件只依赖 `android.graphics.Typeface` ⇒ 任何 Android 宿主都能复用它。
//
// 【与 iOS 的对称】iOS 对应件 = `platform/ios/ProteusPlatform/ProteusTextAdapter.swift` 的
//   `font(size:weight:family:)` + 自定义字体注册段。两端共用同一份**角色词汇表**
//   （`system`/`serif`/`monospace`/`rounded`/`condensed` + `custom:<名>`），跨端一致由该契约保证。
//
// 【诚实边界】本文件是**机械抽取**（逐行搬移，零语义改动）——`ProteusHostView` 的同名方法改为**委托**，
//   故所有既有调用方零改动、行为不变；由 `check:android-host-compile`（真 javac）与真机渲染守住。

package dev.proteus.platform;

import android.graphics.Typeface;

import java.util.HashMap;
import java.util.Map;

/** Android 字形（字体角色映射 + 自定义字体注册）的**唯一实现**（换壳不改）。 */
public final class ProteusTextPlatform {

    private ProteusTextPlatform() {}

    /** 与适配器 `CUSTOM_FONT_PREFIX` **同一常量**（两端契约；不一致则自定义族永远命中不了） */
    public static final String CUSTOM_FONT_PREFIX = "custom:";

    /** 族名 → 字体（注册表） */
    private static final Map<String, Typeface> customFonts = new HashMap<>();

    /** 未注册的自定义族名命中次数（诊断：>0 ⇒ 宿主缺字体资源，**不是**静默回退） */
    public static int customFontMisses = 0;
    /** 最近一个未注册的族名（诊断用：报告里可读出到底缺哪个字体） */
    public static String lastMissingCustomFont = null;

    /**
     * 角色 + 字重 → Android `Typeface`（**度量与绘制共用同一支** —— 防"度量用 A、绘制用 B"分叉）。
     *
     * | 角色 | 映射 |
     * |---|---|
     * | `system` | `sans-serif` |
     * | `serif` | `serif` |
     * | `monospace` | `monospace` |
     * | `rounded` | `sans-serif-rounded`（API 21+ 有该族；缺则回退 DEFAULT 并计数） |
     * | `condensed` | `sans-serif-condensed`（同上） |
     *
     * ★★**为什么这是"映射"而不是"自己发明一套"**：角色字符串由**适配器**产出（`normalizeFontFamily`
     *   已把 CSS 候选清单归一到 5 个角色）。平台侧只做「角色 → 本平台字体」——这是唯一平台相关的部分。
     *   iOS 侧已按同一契约实现（`ProteusTextAdapter.font`）。**两端共用一份词汇表**，未知角色显式回退 + 计数。
     *   ★诚实边界：Android 的族名是**系统族（family）**，与 iOS 的 `SystemDesign`/具体字体名**不是同一批字体**
     *     ⇒ 两端"衬线体"长得不完全一样（平台字体库的固有差异，能力对齐 ≠ 像素一致）。
     */
    public static Typeface typefaceOf(String role, int weight, int[] fallbackCounter) {
        boolean bold = weight >= 600;
        // ★★自定义字体（`custom:<族名>`）——**先查注册表**
        //   契约见适配器 `CUSTOM_FONT_PREFIX`。未注册 ⇒ **回退 system + 计数**（不静默：
        //   "未识别"与"识别为默认"必须可区分）。
        if (role != null && role.startsWith(CUSTOM_FONT_PREFIX)) {
            String name = role.substring(CUSTOM_FONT_PREFIX.length());
            Typeface tf = customFonts.get(name);
            if (tf != null) return tf;
            customFontMisses++;
            lastMissingCustomFont = name;
            return Typeface.create("sans-serif",
                    bold ? Typeface.BOLD : Typeface.NORMAL);
        }
        String fam;
        switch (role == null ? "system" : role) {
            case "serif": fam = "serif"; break;
            case "monospace": fam = "monospace"; break;
            case "rounded": fam = "sans-serif-rounded"; break;
            case "condensed": fam = "sans-serif-condensed"; break;
            case "system": fam = "sans-serif"; break;
            default:
                // ★未知角色：**显式回退 + 计数**（不静默——两端契约不一致时必须可见）
                if (fallbackCounter != null) fallbackCounter[0]++;
                fam = "sans-serif";
                break;
        }
        return Typeface.create(fam, bold ? Typeface.BOLD : Typeface.NORMAL);
    }

    /**
     * 注册自定义字体（**族名 → 字体文件路径**）。
     *
     * 【为什么需要显式注册】平台无法从族名"猜"出字体文件：`Typeface.create(name,…)` 只在
     *   **系统已安装字体**里查找，打包进 assets 或外部路径的字体必须先 `createFromFile` 加载。
     *   ⇒ 注册是应用（宿主）的责任；框架提供通道 + 未注册时的**显式可见降级**。
     *
     * @return true = 注册成功（字体文件可解析）；false = 失败（调用方应记日志，**不静默**）
     */
    public static boolean registerFont(String family, String filePath) {
        try {
            Typeface tf = Typeface.createFromFile(filePath);
            customFonts.put(family, tf);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 注册表规模（验收判据用） */
    public static int registeredFontCount() { return customFonts.size(); }

    /** 清空注册表（测试隔离用——跨用例共享状态必须可归零，本仓纪律 #10） */
    public static void clearFonts() {
        customFonts.clear();
        customFontMisses = 0;
        lastMissingCustomFont = null;
    }
}
