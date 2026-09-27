package dev.proteus.layoutcore;

import android.content.Context;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import java.util.HashMap;
import java.util.Map;

/**
 * ★★**原生镜像**：用 Android 自己的 View 体系复现同一棵几何树，再问**平台自己的派发**命中了谁。
 *
 * 【为什么需要它（这是本验收的核心方法论）】
 *   如果只验证「Rust 命中 == app 自己报告的命中」，那是**自己判自己的卷**——
 *   本仓已在此栽过（截图回归初版用 app 自己写的坐标去采样，注入 3px 偏移后仍全绿）。
 *   故必须有一个**独立实现**回答同一个问题。这里选 Android 的 `ViewGroup.dispatchTouchEvent`：
 *     · 它的算法（子级**逆序**探测 → 边界判定 → 消费判定）是平台自己的实现，
 *       与我的 Rust 实现**无共享代码**
 *     · 两者都是「屏幕坐标 → 节点」的同义问题 → 结果可直接对拍
 *
 * 【对照的**语义边界**（必须如实标注，不能当作全等）】
 *   · **一致**：兄弟重叠时谁在上（逆序）、嵌套层级、命中优先级
 *   · **有差异**：*溢出*。CSS `overflow:visible` 时子级可溢出父盒并**仍可命中**；
 *     而 Android 的子 View 超出父边界**收不到触摸**（平台默认裁剪触摸）。
 *     ⇒ 故本镜像**只用于「子级都在父盒内」的用例**；溢出/裁剪语义由 Rust 侧单测 +
 *       浏览器 golden 覆盖（那里才是它的真值基准）。混用两者会得出错误的「不一致」结论。
 *   · Android 的绝对定位/层叠语义与 CSS 不同（CSS 定位元素整体绘制在在流之上），
 *     ⇒ 本镜像**不**用于验证层叠相位（那由浏览器 golden 负责）。
 *     镜像里的子级顺序 = 我给出的顺序，仅用于验证「逆序 + 嵌套」。
 */
final class MirrorHit {

    /** 节点 id → 该节点的镜像 View */
    private final Map<Integer, ViewGroup> groups = new HashMap<>();
    private final ViewGroup root;
    /** 最近一次派发中，实际接收触摸的节点 id（-1 = 无人接收） */
    private int lastTarget = -1;

    MirrorHit(Context ctx) {
        root = new FrameLayout(ctx);
        root.setLayoutParams(new ViewGroup.LayoutParams(0, 0));
    }

    Map<Integer, ViewGroup> groups() { return groups; }
    ViewGroup root() { return root; }
    int lastTarget() { return lastTarget; }

    /**
     * 加一个节点（`parentId <= 0` = 根）。
     *
     * `children` 顺序 = **绘制顺序**（后加的在上面，与 Rust 树序一致）——
     * 镜像不重排，故意让平台自己按它的规则决定谁先谁后。
     */
    void add(int nodeId, int parentId, Context ctx) {
        FrameLayout v = new FrameLayout(ctx);
        final int id = nodeId;
        v.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View view, MotionEvent event) {
                // ★★只记**第一个**接收者（= 最深/最上层的那一个）。
                //
                // 踩坑记录（真机实测）：初版无条件覆盖 `lastTarget` 且返回 false 让事件冒泡
                // → 最终记录到的是**最后一个**接收者（即根节点）→ 每次命中都返回 1，
                // 六条探针全部「不一致」——**看起来像 Rust 错了，实际是镜像测错了**。
                // 这正是「测量装置本身必须先被验证」的又一例。
                if (lastTarget == -1) lastTarget = id;
                return false;   // 返回 false 让事件继续冒泡（不影响记录，只是不消费）
            }
        });
        groups.put(nodeId, v);
        if (parentId <= 0) {
            root.addView(v);
        } else {
            ViewGroup p = groups.get(parentId);
            if (p == null) throw new IllegalStateException("父节点 " + parentId + " 尚未加入");
            p.addView(v);
        }
    }

    /**
     * 用**外部给的几何**（来自 Rust 核心）逐节点 `layout`。
     *
     * ★几何必须由 Rust 提供：这样两边面对的是**同一组矩形**，
     *   差异只可能来自「派发算法」——正是要比较的那一项。
     */
    void layoutAll(Map<Integer, float[]> rects, Map<Integer, Integer> parents) {
        layoutRec(root, 0f, 0f, rects, parents);
    }

    private void layoutRec(ViewGroup parent, float ox, float oy,
                           Map<Integer, float[]> rects, Map<Integer, Integer> parents) {
        for (int i = 0; i < parent.getChildCount(); i++) {
            View child = parent.getChildAt(i);
            int id = idOf(child);
            float[] r = rects.get(id);
            if (r == null) continue;
            // rects 是**绝对**坐标 → 子级布置在父的局部坐标里
            child.layout(Math.round(r[0] - ox), Math.round(r[1] - oy),
                         Math.round(r[0] - ox + r[2]), Math.round(r[1] - oy + r[3]));
            if (child instanceof ViewGroup) {
                layoutRec((ViewGroup) child, r[0], r[1], rects, parents);
            }
        }
    }

    private int idOf(View v) {
        for (Map.Entry<Integer, ViewGroup> e : groups.entrySet()) {
            if (e.getValue() == v) return e.getKey();
        }
        return -1;
    }

    /** 问平台：点 (x,y)（**View 坐标**）由哪个节点接收？ */
    int hitAt(float x, float y) {
        lastTarget = -1;
        MotionEvent down = MotionEvent.obtain(0L, 0L, MotionEvent.ACTION_DOWN, x, y, 0);
        root.dispatchTouchEvent(down);
        down.recycle();
        MotionEvent up = MotionEvent.obtain(0L, 1L, MotionEvent.ACTION_UP, x, y, 0);
        root.dispatchTouchEvent(up);
        up.recycle();
        return lastTarget;
    }
}
