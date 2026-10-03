package dev.proteus.layoutcore;

/**
 * ★★**Vapor 指令流 golden 夹具**（**生成物，勿手改**——改请跑 `node hosts/android/gen-ops-fixture.mjs`）。
 *
 * 【这份夹具在验证什么（跨语言契约，本仓纪律）】
 *   TS 的真实编码器（`@proteus-vue/slot-runtime` 的 `encodeOps`）在**构建期**编出字节，
 *   冻在这里；设备上由 **Rust 核心解码**（经 JNI `nativeApplyOps`）并执行。
 *   ⇒ 若两侧对**字段宽度 / 端序 / 操作码号 / 池布局**的理解有任何分歧，设备侧会直接红。
 *   ★为什么不在 Java 里再写一个编码器：那是第三份实现，且只测出"我自己编我自己解"
 *     —— 跨语言契约根本没被验证（本仓纪律：只测自身往返等于没测）。
 *
 * 场景：3 节点小树（根 column → row(边界) → 叶子），指令为
 *   SET_STYLE(nodeId=2, layout.width, 期望宽度)
 * 期望：设备上该节点几何宽度 == **期望宽度**（该值来自**指令输入**，
 *   不是"核心算出的另一个数" ⇒ 断言不是循环论证）。
 * ★本块不得含反引号或美元花括号（它在生成器的 JS 模板串里——见 check:script-compile 的护栏）。
 */
public final class OpsFixture {
    private OpsFixture() {}

    /** TS 编码器产出的指令流（45 字节：20B 头 + 键池 + 串池 + 指令体） */
    public static final byte[] OPS_BYTES = new byte[] {
        (byte) 80, (byte) 86, (byte) 79, (byte) 80, (byte) 2, (byte) 0, (byte) 0, (byte) 0, (byte) 1, (byte) 0, (byte) 0, (byte) 0, (byte) 1, (byte) 0, (byte) 0, (byte) 0,
        (byte) 0, (byte) 0, (byte) 0, (byte) 0, (byte) 12, (byte) 0, (byte) 108, (byte) 97, (byte) 121, (byte) 111, (byte) 117, (byte) 116, (byte) 46, (byte) 119, (byte) 105, (byte) 100,
        (byte) 116, (byte) 104, (byte) 2, (byte) 2, (byte) 0, (byte) 0, (byte) 0, (byte) 0, (byte) 0, (byte) 0, (byte) 0, (byte) 52, (byte) 67
    };

    /** 键池（诊断用：确认池布局与 TS 侧一致） */
    public static final String[] KEYS = new String[] { "layout.width" };

    /** 节点 id（指令作用对象） */
    public static final int NODE_ID = 2;

    /** 改动前的宽度（设备侧先断言基线，再发指令） */
    public static final float WIDTH_BEFORE = 50f;

    /** 指令声明的期望宽度（**判据值**——来自编码端的输入，非核心自报） */
    public static final float WIDTH_AFTER = 180f;

    /** 指令条数（与 Rust 解码结果对账） */
    public static final int OP_COUNT = 1;

    /* ══════════ ★splice（结构变更）夹具：payload 取自**适配器真实产出** ══════════ */

    /**
     * 适配器 takeSplice() 的真实输出（追加一行）——由构建期跑真实适配器得到，**非手搓**。
     *
     * 形状：{removes:[…], inserts:[{parentId, nodes:[…], index}], textMeasures:{…}}
     * ★本块不得含反引号或美元花括号（在生成器 JS 模板串里——见护栏）。
     */
    public static final String SPLICE_JSON = "{\"removes\":[],\"inserts\":[{\"parentId\":3,\"index\":2,\"nodes\":[{\"id\":6,\"parentId\":3,\"height\":50,\"flexShrink\":0,\"paintHint\":{\"isMonochrome\":false,\"isPureBackground\":false}}]}]}";

    /** 该 splice 插入的节点数（与核心回报的 inserted 对账） */
    public static final int SPLICE_NODE_COUNT = 1;

    /** 插入块数 */
    public static final int SPLICE_INSERT_COUNT = 1;

    /** 文本度量（适配器从宿主回传的度量表；本夹具场景无文本 ⇒ 空对象） */
    public static final String SPLICE_MEASURES = "{}";
}
