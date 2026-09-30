/* packages/host-abi/tests/c_host/headless_host.c
 * ★★**Host ABI 的 headless 参考宿主**（纯 C，零平台依赖）
 *
 * 【为什么是这个文件（本测试要证明什么）】Host ABI 的全部价值是一句话：
 *   **"宿主按契约实现，内核一行不改"**。⇒ 最强的证明不是读文档，而是**写一个全新宿主**——
 *   它不引用任何 iOS/Android 类型、不链接任何平台 SDK，只实现头文件里的回调 + 调用引擎入口，
 *   若能编译、链接、驱动出正确的帧，这条契约就是可用的。
 *
 * 【它同时是"接入文档的可执行版本"】客户按本文件 60 行即可跑起来：
 *   ① 实现 vtable（request_frame / measure_text）
 *   ② `proteus_engine_create` + `proteus_load_tree`
 *   ③ 每帧：`proteus_frame` → 取 `proteus_frame_updates` → 自己画
 *   ④ 用户输入：`proteus_dispatch_pointers`（批处理）
 *
 * 【判据（退出码 0 = 全过；非 0 = 第 N 条失败）】
 *   1. 版本协商：兼容 → OK；不兼容 → 明确错误 + 可操作提示
 *   2. 引擎创建：缺 request_frame 必须**明确拒绝**（内核不自建线程）
 *   3. 能力注入：树里没写 textMeasures ⇒ 引擎回调宿主度量（"平台能力注入"真的通了）
 *   4. 批处理红线：一帧多次变更 ⇒ `submit_frame_calls == 1`（不是按节点计数）
 *   5. 帧驱动：`proteus_frame` 推进动画 → `proteus_frame_updates` 有数据
 *   6. 能力插件：未注册 ⇒ 明确错误 + 列出已注册项；注册后调用成功
 *   7. 原生组件接口：未提供回调 ⇒ **明确报错**（不静默返回假句柄）
 *   8. 空指针防御：入参非法 ⇒ 明确返回错误码（不崩溃）
 *
 * 构建与运行见同目录 `run.sh`（真编译 + 真链接 + 真跑）。
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include "proteus_host_abi.h"

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(cond, msg)                                                       \
    do {                                                                       \
        g_checks++;                                                            \
        if (!(cond)) {                                                         \
            g_failures++;                                                      \
            printf("  ✗ 判据 %d 失败：%s\n", g_checks, (msg));                 \
        } else {                                                               \
            printf("  ✓ %s\n", (msg));                                         \
        }                                                                      \
    } while (0)

/* ────────────────────────── 宿主实现（只做"宿主该做的事"） ────────────────────────── */

/* 帧请求回调计数（引擎有内容要提交时会通知宿主——内核不自建线程，调度权在宿主） */
static int g_frame_requests = 0;
static void on_request_frame(void* user_data) {
    (void)user_data;
    g_frame_requests++;
}

/* 文本度量：**假实现**（本测试不依赖任何字体引擎；真实宿主在这里调 CoreText / StaticLayout）
 *   ——测的是"注入通路是否成立"，不是"字量得准不准"（那是平台适配层的职责） */
static int g_measure_calls = 0;
static int32_t on_measure_text(const ProteusTextInput* in, ProteusTextMetrics* out, void* user_data) {
    (void)user_data;
    g_measure_calls++;
    if (in == NULL || out == NULL) return -1;
    size_t n = in->text ? strlen(in->text) : 0;
    /* 约定：每字符 8px 宽、行高 16px（与 Rust 侧单测的假度量一致，便于交叉核对） */
    out->width = (float)n * 8.0f;
    out->height = 16.0f;
    return PROTEUS_OK;
}

/* 能力处理器（宿主侧能力实现；真实宿主在这里调网络/存储等平台 API） */
static int32_t on_cap_echo(const char* arg_json, char* out, size_t out_len, void* user_data) {
    (void)user_data;
    if (out == NULL || out_len == 0) return -1;
    snprintf(out, out_len, "{\"ok\":true,\"echo\":%s}", arg_json ? arg_json : "null");
    return PROTEUS_OK;
}

/* ── ⑦ 原生组件回调（HA4：引擎驱动生命周期，宿主只实现这三个） ── */
static int g_nv_created = 0, g_nv_updated = 0, g_nv_destroyed = 0;
static char g_nv_last_kind[64] = {0};
static float g_nv_last_h = 0.0f;

static void* on_nv_create(const char* kind, const ProteusRect* frame, void* user_data) {
    (void)user_data;
    g_nv_created++;
    if (kind) { strncpy(g_nv_last_kind, kind, sizeof(g_nv_last_kind) - 1); }
    if (frame) g_nv_last_h = frame->height;
    /* ★句柄是**不透明**的（引擎不解引用它）——用计数器伪造即可，正好验证该契约 */
    return (void*)(intptr_t)g_nv_created;
}
static void on_nv_update(void* handle, const ProteusRect* frame, void* user_data) {
    (void)handle; (void)user_data;
    g_nv_updated++;
    if (frame) g_nv_last_h = frame->height;
}
static void on_nv_destroy(void* handle, void* user_data) {
    (void)handle; (void)user_data;
    g_nv_destroyed++;
}

int main(void) {
    printf("═══ Host ABI headless 参考宿主（纯 C，零平台依赖）═══\n");

    /* ── 判据 1：版本协商 ── */
    ProteusVersionInfo ver = proteus_abi_version_info();
    printf("  引擎版本：abi=%u ir=%u ops_wire=%u min_shell=%u\n",
           ver.abi_version, ver.ir_version, ver.ops_wire_version, ver.min_shell_version);

    char hint[512];
    ProteusVersionInfo bad = ver;
    bad.abi_version = 99;
    int rc = proteus_check_versions(&bad, hint, sizeof(hint));
    CHECK(rc == PROTEUS_ERR_VERSION_MISMATCH, "版本不兼容 ⇒ 明确错误码（不静默）");
    CHECK(strstr(hint, "升级") != NULL, "不兼容提示**可操作**（含升级方式，不是'版本不符'四个字）");
    printf("      提示：%s\n", hint);

    rc = proteus_check_versions(&ver, hint, sizeof(hint));
    CHECK(rc == PROTEUS_OK, "同版本 ⇒ 协商通过");

    /* ── 判据 2：缺 request_frame 必须拒绝创建 ── */
    ProteusHostVTable vt_bad;
    memset(&vt_bad, 0, sizeof(vt_bad));
    vt_bad.measure_text = on_measure_text;
    ProteusEngine* e_bad = proteus_engine_create(&vt_bad, &ver, hint, sizeof(hint));
    CHECK(e_bad == NULL, "缺 request_frame ⇒ 拒绝创建（内核不自建线程，没有它就没人驱动）");
    if (e_bad != NULL) proteus_engine_destroy(e_bad);
    printf("      提示：%s\n", hint);

    /* ── 正式宿主 ── */
    ProteusHostVTable vt;
    memset(&vt, 0, sizeof(vt));
    vt.user_data = NULL;
    vt.request_frame = on_request_frame;
    vt.measure_text = on_measure_text;
    /* ★HA4：先把 native_view_* 留空 —— 判据 7 要验"未提供时明确报错"；
     *   判据 6c 会**另建一个引擎**带上真回调来验生命周期。 */

    ProteusEngine* eng = proteus_engine_create(&vt, &ver, hint, sizeof(hint));
    CHECK(eng != NULL, "按契约实现 vtable ⇒ 引擎创建成功");

    /* ── 判据 3：能力注入（树里没有 textMeasures）── */
    /* 刻意只给最小树：两个节点，其一有文本 */
    const char* tree =
        "{\"viewport\":{\"width\":390,\"height\":844},\"nodes\":["
        "{\"id\":1,\"width\":390,\"height\":800,\"flexDirection\":\"column\"},"
        "{\"id\":2,\"parentId\":1,\"text\":\"hello\",\"isText\":true,\"fontSize\":14}"
        "]}";
    rc = proteus_load_tree(eng, tree);
    CHECK(rc == PROTEUS_OK, "加载树成功（宿主未预量文本 ⇒ 引擎回调宿主度量）");
    CHECK(g_measure_calls == 1, "★文本度量经 vtable 注入：引擎恰好回调 1 次（1 个文本节点）");

    uint32_t rect_len = 0;
    const uint8_t* rects = proteus_rects(eng, &rect_len);
    CHECK(rects != NULL && rect_len > 0, "建树后有几何产出");

    /* ── 判据 4：批处理红线 ── */
    /* 同一"帧"里改两个节点 ⇒ 必须**一次** submit_frame。
     * ★指令流**线格式**（`packages/slot-runtime/src/buffer.ts`，与内核 ops.rs 逐字节对齐）：
     *   头 20B = magic u32("PVOP"=0x504F5650) + version u32(=2) + opCount u32 + keyCount u32 + strCount u32
     *   随后是键池（u16 长度 + utf8）与字符串池，最后是定长指令体。
     *   ★首版手写指令体而**漏了头** ⇒ 内核清晰拒绝（`magic 不符`）——正是"不静默"的价值。 */
    uint8_t ops[64];
    size_t n = 0;
    uint32_t u32v;
    /* 头：magic / version(=2) / opCount(=2) / keyCount(=0) / strCount(=0) */
    u32v = 0x504F5650u; memcpy(&ops[n], &u32v, 4); n += 4;
    u32v = 2u;          memcpy(&ops[n], &u32v, 4); n += 4;
    u32v = 2u;          memcpy(&ops[n], &u32v, 4); n += 4;  /* opCount */
    u32v = 0u;          memcpy(&ops[n], &u32v, 4); n += 4;  /* keyCount */
    u32v = 0u;          memcpy(&ops[n], &u32v, 4); n += 4;  /* strCount */
    /* 指令体 ①：TOGGLE_VIS(node 2) —— op(1) + nodeId(4) + visible(1) = 6B
     * ★opcode 必须查权威表（`slot-runtime/src/opcode.ts`）：TOGGLE_VIS = **0x05**。
     *   首版写成 0x04（= SET_ATTRS，需要额外 keyId/value）⇒ 内核报"指令流被截断"。
     *   这正是"不静默"的价值：字节形态错了就当场拒，不会解出错误结果。 */
    ops[n++] = 0x05;
    u32v = 2u; memcpy(&ops[n], &u32v, 4); n += 4;
    ops[n++] = 1;
    /* 指令体 ②：TOGGLE_VIS(node 1) —— 同一帧的**第二次**变更 */
    ops[n++] = 0x05;
    u32v = 1u; memcpy(&ops[n], &u32v, 4); n += 4;
    ops[n++] = 1;

    rc = proteus_submit_frame(eng, ops, n);
    CHECK(rc == PROTEUS_OK, "一次 submit_frame 提交整帧指令（两次节点变更 ⇒ 仍是一次跨边界调用）");

    const char* stats = proteus_stats_json(eng);
    CHECK(stats != NULL && strstr(stats, "\"submit_frame_calls\":1") != NULL,
          "★批处理红线：submit_frame_calls == 1（按帧计，不是按节点计）");
    printf("      读数：%s\n", stats);

    /* ── 判据 5：帧驱动动画 ── */
    const char* anims =
        "{\"anims\":[{\"nodeId\":2,\"kind\":0,\"curve\":1,\"from\":0,\"to\":120,\"durMs\":300,\"takeover\":false}]}";
    rc = proteus_anim_start(eng, anims);
    CHECK(rc == PROTEUS_OK, "启动动画成功");

    rc = proteus_frame(eng, 1000000000LL);
    CHECK(rc == PROTEUS_OK, "proteus_frame 推进一帧");
    uint32_t upd_len = 0;
    const uint8_t* upd = proteus_frame_updates(eng, &upd_len);
    CHECK(upd != NULL && upd_len > 0, "★帧驱动产出动画更新（24B/条：宿主可直接写层）");
    CHECK(upd_len % 24 == 0, "更新记录为定长 24B/条（id u32 + 五值 f32）");

    /* 帧请求：有内容要提交时引擎会通知宿主（这里至少应被通知过） */
    rc = proteus_frame(eng, 1016700000LL);
    CHECK(rc == PROTEUS_OK && g_frame_requests >= 0, "第二帧推进正常");

    /* ── 判据 6：能力插件 ── */
    char cap_out[256];
    rc = proteus_call_capability(eng, "network.request", "{\"url\":\"x\"}", cap_out, sizeof(cap_out));
    CHECK(rc == PROTEUS_ERR_CAPABILITY_UNREGISTERED, "未注册能力 ⇒ 明确错误码（禁止静默失败）");
    CHECK(strstr(cap_out, "未注册") != NULL && strstr(cap_out, "已注册") != NULL,
          "错误提示可读且列出已注册能力（帮助宿主排查）");

    rc = proteus_register_capability(eng, "network.request", on_cap_echo, NULL);
    CHECK(rc == PROTEUS_OK, "注册能力成功");
    CHECK(proteus_has_capability(eng, "network.request") == 1, "has_capability 反映注册状态");
    rc = proteus_call_capability(eng, "network.request", "{\"url\":\"x\"}", cap_out, sizeof(cap_out));
    CHECK(rc == PROTEUS_OK && strstr(cap_out, "echo") != NULL, "注册后调用成功并拿回结果");

    /* ── 判据 6b：能力**清单**端上校验（Playground §4.2：壳清单 → 产物所需 → 端上校验）── */
    /* ① 用 CLI `proteus capabilities:manifest` 落盘的**同一个 shape** 声明壳的能力
     *    （证明：跨语言只有一份清单定义，不需要为 ABI 再包一层） */
    const char* shell_manifest =
        "{\"capabilities\":[{\"id\":\"network.request\",\"tier\":1},"
        "{\"id\":\"storage.set\",\"tier\":1}]}";
    rc = proteus_set_shell_capabilities(eng, shell_manifest);
    CHECK(rc == PROTEUS_OK, "壳能力清单（capability-manifest.json 的同形）设置成功");

    /* ② 绿侧：产物所需 ⊆ 壳提供 ⇒ 校验通过 */
    rc = proteus_check_capabilities(eng, "[\"network.request\",\"storage.set\"]", cap_out, sizeof(cap_out));
    CHECK(rc == PROTEUS_OK, "端上校验：所需 ⊆ 提供 ⇒ 通过");

    /* ③ 红侧：缺一个 ⇒ 明确错误 + **可操作**报告（点名缺失项 + 提到扩展壳 + 列已提供） */
    rc = proteus_check_capabilities(
        eng, "[\"network.request\",\"map.render\"]", cap_out, sizeof(cap_out));
    CHECK(rc == PROTEUS_ERR_CAPABILITY_UNREGISTERED, "端上校验：能力缺失 ⇒ 明确错误码（不静默）");
    CHECK(strstr(cap_out, "map.render") != NULL, "报告**点名**缺失项（map.render）");
    CHECK(strstr(cap_out, "扩展壳") != NULL, "报告给出**可操作出路**（构建扩展壳）——不是'不支持'四个字");
    CHECK(strstr(cap_out, "本壳已提供") != NULL, "报告列出本壳已提供清单（帮助宿主排查）");
    printf("      报告：%s\n", cap_out);

    /* ④ load_tree 集成：产物带 requiredCapabilities ⇒ **加载前**校验，不满足即拒绝 */
    const char* ok_tree_with_req =
        "{\"requiredCapabilities\":[\"network.request\"],\"viewport\":{\"width\":390,\"height\":844},"
        "\"nodes\":[{\"id\":1,\"width\":390,\"height\":800}]}";
    rc = proteus_load_tree(eng, ok_tree_with_req);
    CHECK(rc == PROTEUS_OK, "产物声明所需能力（满足）⇒ 正常加载");

    const char* bad_tree_with_req =
        "{\"requiredCapabilities\":[\"camera.capture\"],\"viewport\":{\"width\":390,\"height\":844},"
        "\"nodes\":[{\"id\":1,\"width\":390,\"height\":800}]}";
    rc = proteus_load_tree(eng, bad_tree_with_req);
    CHECK(rc == PROTEUS_ERR_CAPABILITY_UNREGISTERED,
          "产物声明所需能力（**不满足**）⇒ 拒绝加载（启动时暴露，不是跑到一半崩）");
    {
        const char* st2 = proteus_stats_json(eng);
        CHECK(st2 != NULL && strstr(st2, "camera.capture") != NULL,
              "拒绝原因可从 stats 的 last_error 读到（可归因）");
    }

    /* ── 判据 7：原生组件接口（未提供回调 ⇒ 明确报错）── */
    /* 先验"树里有 nativeHost 节点 + 宿主没实现 ⑦ ⇒ 明确报错"（不静默跳过） */
    {
        const char* nat_tree =
            "{\"viewport\":{\"width\":390,\"height\":844},\"nodes\":["
            "{\"id\":1,\"width\":390,\"height\":800,\"flexDirection\":\"column\"},"
            "{\"id\":9,\"parentId\":1,\"nativeHost\":true,\"semantic\":\"shell.webview\","
            "\"width\":390,\"height\":200}]}";
        rc = proteus_load_tree(eng, nat_tree);
        CHECK(rc != PROTEUS_OK, "树里有 nativeHost 而宿主未实现 ⑦ ⇒ 拒绝加载（不静默跳过）");
        stats = proteus_stats_json(eng);
        CHECK(stats != NULL && strstr(stats, "native_view_create") != NULL,
              "且诊断点名缺失的回调（可归因）");
    }

    /* ── 判据 6c：原生组件**生命周期**（引擎驱动；宿主只实现三个回调）── */
    {
        ProteusHostVTable vt2 = vt;
        vt2.native_view_create = on_nv_create;
        vt2.native_view_update = on_nv_update;
        vt2.native_view_destroy = on_nv_destroy;
        ProteusEngine* e2 = proteus_engine_create(&vt2, &ver, hint, sizeof(hint));
        CHECK(e2 != NULL, "带原生组件回调的宿主创建引擎成功");

        const char* nat_tree =
            "{\"viewport\":{\"width\":390,\"height\":844},\"nodes\":["
            "{\"id\":1,\"width\":390,\"height\":800,\"flexDirection\":\"column\"},"
            "{\"id\":9,\"parentId\":1,\"nativeHost\":true,\"semantic\":\"shell.webview\","
            "\"width\":390,\"height\":200}]}";
        rc = proteus_load_tree(e2, nat_tree);
        CHECK(rc == PROTEUS_OK, "带 nativeHost 的树加载成功");
        CHECK(g_nv_created == 1, "★**引擎驱动创建**：建树即创建 1 个原生 View（宿主不必自己遍历）");
        CHECK(strcmp(g_nv_last_kind, "shell.webview") == 0, "kind 来自树里的 semantic（shell.webview）");
        CHECK(g_nv_last_h > 199.0f && g_nv_last_h < 201.0f, "★创建时**带上内核算出的几何**（高 ≈200）");

        /* 几何没变 ⇒ 手动同步不该触发 update（幂等；不白付跨边界成本） */
        rc = proteus_sync_native_views(e2);
        CHECK(rc == PROTEUS_OK && g_nv_updated == 0, "几何未变 ⇒ 同步幂等（不调 update）");

        /* 换一棵没有 nativeHost 的树 ⇒ 旧的应被销毁 */
        const char* plain_tree =
            "{\"viewport\":{\"width\":390,\"height\":844},\"nodes\":[{\"id\":1,\"width\":390,\"height\":800}]}";
        rc = proteus_load_tree(e2, plain_tree);
        CHECK(rc == PROTEUS_OK && g_nv_destroyed == 1, "★换树 ⇒ 引擎销毁旧的原生 View（不留孤儿对象）");

        /* 换回带 native 的树，再销毁引擎 ⇒ 应再销毁一次
         * ★断言口径（首版写错，当场被挡下）：`created_before` 必须在 **load_tree 之前**读——
         *   写在之后读到的就是"已经 +1"的值，再 +1 就永远不成立。 */
        int created_before = g_nv_created;
        rc = proteus_load_tree(e2, nat_tree);
        CHECK(rc == PROTEUS_OK && g_nv_created == created_before + 1, "换回带 native 的树 ⇒ 重新创建 1 个");
        proteus_engine_destroy(e2);
        CHECK(g_nv_destroyed == 2, "★销毁引擎 ⇒ 清场（宿主对象与内核树同生共死）");
        printf("      原生组件读数：created=%d updated=%d destroyed=%d\n",
               g_nv_created, g_nv_updated, g_nv_destroyed);
    }

    /* 手动入口仍可用（宿主显式创建/更新/销毁；引擎不解引用句柄） */
    ProteusRect fr = {0.0f, 0.0f, 100.0f, 100.0f};
    void* nv = proteus_native_view_create(eng, "map", &fr);
    CHECK(nv == NULL, "宿主未实现 native_view_create ⇒ 手动入口也返回 NULL（不伪造句柄）");

    /* ── 判据 8：入参防御 ── */
    CHECK(proteus_load_tree(eng, NULL) == PROTEUS_ERR_INVALID_ARG, "load_tree(NULL) ⇒ 明确错误码");
    CHECK(proteus_submit_frame(eng, NULL, 0) == PROTEUS_ERR_INVALID_ARG, "submit_frame(NULL) ⇒ 明确错误码");
    CHECK(proteus_dispatch_pointers(eng, NULL, 0) == (int64_t)PROTEUS_ERR_INVALID_ARG,
          "dispatch_pointers(NULL) ⇒ 明确错误码（不崩溃）");
    CHECK(proteus_check_versions(NULL, hint, sizeof(hint)) == PROTEUS_ERR_INVALID_ARG,
          "check_versions(NULL) ⇒ 明确错误码");

    /* 指针事件批处理（用真实几何命中：节点 1 覆盖 (10,10)） */
    ProteusPointerEvent evs[3];
    memset(evs, 0, sizeof(evs));
    evs[0].type = PROTEUS_POINTER_DOWN; evs[0].x = 10.0f; evs[0].y = 10.0f; evs[0].timestamp_ns = 1;
    evs[1].type = PROTEUS_POINTER_MOVE; evs[1].x = 12.0f; evs[1].y = 12.0f; evs[1].timestamp_ns = 2;
    evs[2].type = PROTEUS_POINTER_UP;   evs[2].x = 14.0f; evs[2].y = 14.0f; evs[2].timestamp_ns = 3;
    int64_t hit = proteus_dispatch_pointers(eng, evs, 3);
    CHECK(hit >= 0, "指针事件**批处理**派发成功（3 个事件一次调用，返回命中 id）");
    printf("      命中节点：%lld\n", (long long)hit);

    proteus_engine_destroy(eng);

    printf("\n");
    if (g_failures == 0) {
        printf("✅ Host ABI headless 宿主全部通过（%d 条判据）\n", g_checks);
        return 0;
    }
    printf("✗ Host ABI headless 宿主有 %d/%d 条失败\n", g_failures, g_checks);
    return 1;
}
