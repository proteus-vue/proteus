/* packages/host-abi/include/proteus_host_abi.h
 * ★★Proteus **Host ABI v1** —— 宿主抽象层的稳定契约（Host ABI 方案 §2 的八个接口）
 *
 * 【这个文件是什么】宿主（Proteus App / Playground 壳 / 客户既有 App）实现**宿主侧**的
 *   N 个回调 + 调用**引擎侧**的若干入口，即可驱动 Proteus 内核。**换宿主 = 重新实现本文件**，
 *   内核一行不改（这正是本层的价值）。
 *
 * 【与内核的关系（两条互不越界）】
 *   · 宿主 → 引擎：surface / lifecycle / pointers / frame / submit_frame / load_tree / 能力注册
 *   · 引擎 → 宿主：request_frame / measure_text / decode_image / native_view_*（经 vtable 回调）
 *
 * 【硬约束（方案原文，违反即设计错误）】
 *   ① **批处理红线**：所有跨边界调用必须批处理——一帧的全部指令走**一次**
 *      `proteus_submit_frame`（禁止"一个节点变更 = 一次调用"）。
 *   ② **内核不自建线程**：帧调度权归宿主（宿主在自己的 vsync 回调里调 `proteus_frame`）；
 *      所有 ABI 调用必须在**同一线程**（platform thread），且线程绑定在引擎生命周期内稳定。
 *   ③ **平台能力注入而非分支**：文本度量 / 图片解码由宿主注入（本文件第 5、6 号接口），
 *      内核不得出现 `target_os` 分支。
 *   ④ **版本协商不得静默**：不兼容 ⇒ 返回错误码 + **可操作**的升级提示（不是"版本不符"四个字）。
 *   ⑤ **未注册能力必须明确报错**（禁止静默失败）。
 *
 * 【内存与所有权】
 *   · 返回 `const` 指针的读取入口（frame_updates / rects）指向**引擎内部缓冲**，
 *     有效期到下一次同类调用或 `proteus_engine_destroy` —— 宿主需要保留时必须自己拷贝。
 *   · 返回 `const char*` 的 JSON 入口同理（引擎持有的 CString，下次调用即失效）。
 *   · 入参里的 `const char*` / 指针由**宿主**拥有，调用期间必须有效。
 *
 * 【版本】PROTEUS_ABI_VERSION 见下；语义与 `packages/slot-runtime/src/version.ts` 同源
 *   （`versionInfo()`），`scripts/check-host-abi.mjs` 做跨语言对账。
 */
#ifndef PROTEUS_HOST_ABI_H
#define PROTEUS_HOST_ABI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ────────────────────────── 版本 ────────────────────────── */

#define PROTEUS_ABI_VERSION 1u

typedef struct {
    uint32_t abi_version;        /* Host ABI 版本（本文件形态） */
    uint32_t ir_version;         /* IR 契约版本 */
    uint32_t ops_wire_version;   /* 指令流线格式版本（与 slot-runtime 的 OPS_VERSION 同源） */
    uint32_t min_shell_version;  /* 本 SDK 要求的最低宿主版本 */
} ProteusVersionInfo;

/* ────────────────────────── 错误码 ────────────────────────── */

#define PROTEUS_OK 0
#define PROTEUS_ERR_INVALID_ARG (-1)
#define PROTEUS_ERR_VERSION_MISMATCH (-2)
#define PROTEUS_ERR_CAPABILITY_UNREGISTERED (-3)
#define PROTEUS_ERR_NO_TREE (-4)
#define PROTEUS_ERR_INTERNAL (-5)

/* ────────────────────────── ① Surface（宿主 → 引擎） ────────────────────────── */

typedef struct {
    void*    native_surface;  /* Android: Surface / iOS: CALayer / 桌面: 窗口句柄；引擎只持不透明指针 */
    int32_t  width;           /* 逻辑像素 */
    int32_t  height;
    float    density;         /* 像素密度 */
    float    content_scale;   /* 实际缩放（2x / 3x） */
} ProteusSurface;

/* ────────────────────────── ② 生命周期（宿主 → 引擎） ────────────────────────── */

typedef enum {
    PROTEUS_LIFECYCLE_CREATED   = 0,
    PROTEUS_LIFECYCLE_RESUMED   = 1,
    PROTEUS_LIFECYCLE_PAUSED    = 2,
    PROTEUS_LIFECYCLE_DESTROYED = 3
} ProteusLifecycleState;

/* ────────────────────────── ③ 输入事件（宿主 → 引擎） ────────────────────────── */

typedef enum {
    PROTEUS_POINTER_DOWN   = 0,
    PROTEUS_POINTER_MOVE   = 1,
    PROTEUS_POINTER_UP     = 2,
    PROTEUS_POINTER_CANCEL = 3
} ProteusPointerType;

typedef struct {
    uint32_t type;          /* ProteusPointerType */
    uint32_t pointer_id;
    float    x, y;          /* 引擎坐标系（逻辑像素） */
    int64_t  timestamp_ns;  /* ★必须带系统时间戳——输入延迟指标依赖它（方案 §2.4） */
} ProteusPointerEvent;

/* ────────────────────────── ⑤⑥ 平台能力注入（宿主实现，引擎回调） ────────────────────────── */

typedef struct {
    const char* text;
    uint32_t    node_id;
    uint32_t    style_key;    /* 字体身份键（宿主自己的 style 表索引；0 = 未指定） */
    float       font_size;    /* 0 = 未指定（宿主按自身默认处理） */
    int32_t     font_weight;  /* 400 = normal；0 = 未指定 */
    const char* font_family;  /* 语义角色名（system/serif/…）；可为 NULL */
    float       max_width;    /* 可用宽度（引擎给的约束；<=0 = 不限制） */
} ProteusTextInput;

typedef struct {
    float width;
    float height;
} ProteusTextMetrics;

/* 文本度量：返回 PROTEUS_OK 表示 out 已填；非 0 时引擎按"零尺寸"处理并计数 */
typedef int32_t (*ProteusMeasureTextFn)(const ProteusTextInput* in, ProteusTextMetrics* out, void* user_data);

typedef struct {
    uint32_t       request_id;
    const uint8_t* data;      /* 编码后的图片字节（宿主拥有） */
    uint32_t       len;
    uint32_t       node_id;
} ProteusImageRequest;

/* 图片解码完成回调（**必须回到 platform thread** 再调入引擎） */
typedef void (*ProteusImageDoneFn)(uint32_t request_id, const uint8_t* pixels, uint32_t width,
                                   uint32_t height, int32_t status, void* cb_data);

/* 图片解码：允许宿主在别的线程执行，但回调必须回 platform thread（方案 §5.3） */
typedef int32_t (*ProteusDecodeImageFn)(const ProteusImageRequest* req, ProteusImageDoneFn done,
                                        void* cb_data, void* user_data);

/* ────────────────────────── ④ 调度 & ⑦ 原生组件 & 信号（宿主实现，引擎回调） ────────────────────────── */

/* 引擎告知宿主：本帧有内容需要提交（宿主据此 schedule 下一次 proteus_frame） */
typedef void (*ProteusRequestFrameFn)(void* user_data);

typedef struct {
    float x, y, width, height;
} ProteusRect;

/* 原生组件宿主（map / video / web-view）：内核请求，宿主创建/更新/销毁；内核只持不透明句柄 */
typedef void* (*ProteusCreateNativeViewFn)(const char* kind, const ProteusRect* frame, void* user_data);
typedef void  (*ProteusUpdateNativeViewFrameFn)(void* handle, const ProteusRect* frame, void* user_data);
typedef void  (*ProteusDestroyNativeViewFn)(void* handle, void* user_data);

/* ────────────────────────── ⑧ 能力插件（宿主 → 引擎注册；引擎 → 宿主调用） ────────────────────────── */

typedef int32_t (*ProteusCapabilityFn)(const char* arg_json, char* out, size_t out_len, void* user_data);

/* ────────────────────────── 宿主 vtable（宿主提供，引擎回调） ────────────────────────── */

typedef struct {
    void* user_data;
    ProteusRequestFrameFn         request_frame;      /* 必需 */
    ProteusMeasureTextFn          measure_text;       /* 必需（无文本场景可 NULL） */
    ProteusDecodeImageFn          decode_image;       /* 可选 */
    ProteusCreateNativeViewFn     native_view_create; /* 可选 */
    ProteusUpdateNativeViewFrameFn native_view_update;
    ProteusDestroyNativeViewFn    native_view_destroy;
} ProteusHostVTable;

/* ────────────────────────── 引擎生命周期 ────────────────────────── */

typedef struct ProteusEngine ProteusEngine;  /* 不透明 */

/* 引擎侧版本声明 + 与宿主声明协商。
 * 返回 PROTEUS_OK / PROTEUS_ERR_VERSION_MISMATCH；不兼容时向 hint_out 写**可操作**提示。 */
ProteusVersionInfo proteus_abi_version_info(void);
int32_t proteus_check_versions(const ProteusVersionInfo* host_version,
                               char* hint_out, size_t hint_len);

/* 预热（方案 §8.5：宿主在 App 启动阶段调用，避免首次渲染白屏）。可重复调用（幂等）。 */
void proteus_prewarm(void);

/* 创建引擎。host 为 NULL 或 host->request_frame 为 NULL ⇒ 返回 NULL。
 * 版本不兼容 ⇒ 返回 NULL 并向 hint_out 写提示（宿主必须展示/记录，不得忽略）。 */
ProteusEngine* proteus_engine_create(const ProteusHostVTable* host,
                                     const ProteusVersionInfo* host_version,
                                     char* hint_out, size_t hint_len);
void proteus_engine_destroy(ProteusEngine* engine);

/* ────────────────────────── ① ② ③ ④ 入口 ────────────────────────── */

void proteus_surface_changed(ProteusEngine* engine, const ProteusSurface* surface);
void proteus_lifecycle(ProteusEngine* engine, uint32_t state);
/* 指针事件批处理。返回命中的节点 id；无命中 = 0；入参非法 = PROTEUS_ERR_INVALID_ARG(-1) */
int64_t proteus_dispatch_pointers(ProteusEngine* engine, const ProteusPointerEvent* events, size_t count);
/* 每帧驱动（宿主在自己的 vsync 回调里调；frame_time_ns 为系统单调时钟）。
 * ★语义：推进引擎时间（含动画求值）→ 缓存本帧的节点视觉更新（供 `proteus_frame_updates` 取）。
 *   若引擎需要后续帧（如动画未结束）⇒ 会经 vtable.request_frame 通知宿主 schedule。 */
int32_t proteus_frame(ProteusEngine* engine, int64_t frame_time_ns);

/* 启动动画（v1 直接入口）。
 * ★诚实边界：动画指令**走 ops 流**（`AnimOp`）是后续工作（见指令集规格；
 *   届时本入口保留为宿主侧直调通路）。声明格式与内核 `anim_start` 一致：
 *   `{"anims":[{nodeId,kind,curve,from,to,durMs,…}]}`（含曲线/弹簧/序列/滚动窗口）。 */
int32_t proteus_anim_start(ProteusEngine* engine, const char* anims_json);
/* 停动画：`{"all":true}` 或 `{"nodeIds":[…]}`（含清值语义） */
int32_t proteus_anim_stop(ProteusEngine* engine, const char* json);

/* ────────────────────────── 数据入口（IR / 指令流 / 树） ────────────────────────── */

/* 加载/替换整棵树（宿主从本地或 CDN 取得 IR 产物后调用）。
 * ★若宿主未在 JSON 里提供 `textMeasures` 而 vtable 有 measure_text ⇒ **引擎逐文本节点回调宿主度量**
 *   （这就是"平台能力注入"：宿主不必预先把全部文本量一遍）。 */
int32_t proteus_load_tree(ProteusEngine* engine, const char* tree_json);

/* ★★批处理红线入口：一帧的全部指令走**一次**调用（方案 §3）。
 * ops 为 Vapor IR 二进制指令流（格式见 docs/generated/instruction-spec.md）。 */
int32_t proteus_submit_frame(ProteusEngine* engine, const uint8_t* ops, size_t byte_len);

/* 本帧动画更新（24B/条：id u32 + tx/ty/scale/rotate/opacity f32，小端）；返回内部缓冲指针 */
const uint8_t* proteus_frame_updates(ProteusEngine* engine, uint32_t* out_len);
/* 当前几何（二进制矩形流）；返回内部缓冲指针 */
const uint8_t* proteus_rects(ProteusEngine* engine, uint32_t* out_len);

/* 诊断读数（JSON：frames / submit_frame_calls / frame_requests / measure_calls /
 * handler_calls / version 等）——判据用它验证"批处理红线"与调用方向 */
const char* proteus_stats_json(ProteusEngine* engine);

/* ────────────────────────── ⑦ 原生组件（契约联通入口；v1 内核暂无自动消费者） ────────────────────────── */

void* proteus_native_view_create(ProteusEngine* engine, const char* kind, const ProteusRect* frame);
void  proteus_native_view_update(ProteusEngine* engine, void* handle, const ProteusRect* frame);
void  proteus_native_view_destroy(ProteusEngine* engine, void* handle);

/* ────────────────────────── ⑧ 能力插件 ────────────────────────── */

int32_t proteus_register_capability(ProteusEngine* engine, const char* name,
                                    ProteusCapabilityFn fn, void* user_data);
int32_t proteus_has_capability(ProteusEngine* engine, const char* name);
/* 调用能力。未注册 ⇒ PROTEUS_ERR_CAPABILITY_UNREGISTERED 且向 out 写可读说明（**不静默**） */
int32_t proteus_call_capability(ProteusEngine* engine, const char* name, const char* arg_json,
                                char* out, size_t out_len);

#ifdef __cplusplus
} /* extern "C" */
#endif
#endif /* PROTEUS_HOST_ABI_H */
