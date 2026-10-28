// embed_view.m —— Studio PoC B2：Tauri 2 窗口里承载原生 GL 画面（决策 #1169）
//
// 【本文件解决什么】PoC B1 证明「原生窗口里 decode→compose→present 只要 1.4ms/帧」，
//   但 B1 是**自己开的 NSWindow**。Studio 的真实形态是：Tauri 2 的窗口里，
//   **WKWebView 做 UI，原生 GL 画面垫在下面**（检查器/参考线/按钮是 HTML 叠上去的）。
//   本文件把这层挂进 Tauri 的 contentView，并把 WKWebView 的背景设成透明。
//
// 【对外接口（给 Rust 调）】
//   poc_attach(ns_view)  → 挂载 + 建 GL + 开解码器；返回 0 成功
//   poc_tick()           → 渲染一帧（由 Rust 在 main thread 上按节奏调用）
//   poc_report(path)     → 落 JSON 读数
//   poc_probe()          → 返回位掩码：bit0=找到 WKWebView，bit1=背景已透明
#import <Cocoa/Cocoa.h>
/* ★决策 #1292：iPhone「USB 整屏采集」要用 AVFoundation 的设备发现与采集会话。
   之前这个文件只做 GL/解码，不需要它；探针/采集加上后必须有这一行头文件。 */
#import <AVFoundation/AVFoundation.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>

#include <math.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/hwcontext.h>
#include <libswscale/swscale.h>

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#include "live_stream.h"

#define MAX_SAMPLES 40000
#define WARMUP_MS 2000

static double now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}
static int cmp_double(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}
static double pct(const double *v, int n, double p) {
  if (n <= 0) return -1;
  int i = (int)(p * (n - 1) + 0.5);
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  return v[i];
}

static const char *VS =
    "#version 150\nout vec2 vUV;\n"
    "void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);\n"
    // ★v 轴必须翻：GL 的 (0,0) 在左下，而纹理首行是画面的**顶部**。
    //   直接用 p 会让画面上下颠倒（实测：手机状态栏跑到画布底部）。
    "  vUV = vec2(p.x, 1.0 - p.y);\n"
    "  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }\n";
/* ★上屏这趟的顶点着色器：**不再翻 v**（决策 #1259）。
 *   合成 pass 已经把"纹理首行是画面顶部"这件事翻正并写进 FBO；FBO 的行序和 GL 一致
 *   （第 0 行 = 底部），所以上屏时再翻一次 = **整幅画面上下颠倒**（实测：手机桌面 Dock 跑到窗口顶部）。
 *   这个 bug 从 B2 就在——因为 `poc_dump` 读的是 **FBO**（永远是对的），没人把"窗口里看到的"
 *   和"dump 出来的"做 1:1 对比。 */
static const char *VS_BLIT =
    "#version 150\nout vec2 vUV;\n"
    "void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);\n"
    "  vUV = p;\n"
    "  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }\n";
static const char *FS_YUV =
    "#version 150\nin vec2 vUV;\nout vec4 o;\n"
    "uniform sampler2D texY; uniform sampler2D texUV; uniform float uFullRange;\n"
    /* ★★颜色范围必须按**源**区分（决策 #1296）：ReplayKit/VT 给的是 **full range**（JPEG），
       而 Android screenrecord 是 **limited**（video）。之前一律按 limited 转 ⇒
       iOS 的浅灰背景（≈240）被 (240-16)*1.164≈261 放大后**截成纯白**（用户实测：灰底全白）。 */
    "void main(){ float y = texture(texY, vUV).r; vec2 uv = texture(texUV, vUV).rg - vec2(0.5);\n"
    "  if (uFullRange > 0.5) { y = y; } else { y = (y - 16.0/255.0) * 1.164383; }\n"
    "  o = vec4(y + 1.596027*uv.y, y - 0.391762*uv.x - 0.812968*uv.y, y + 2.017232*uv.x, 1.0); }\n";
static const char *FS_BLIT =
    "#version 150\nin vec2 vUV;\nout vec4 o;\nuniform sampler2D texCanvas; uniform vec2 uFit;\n"
    // ★★等比适配（contain）：uFit = 画面占视口的比例（两轴都 ≤1），画面外填底背景色。
    //   之前是 `o = texture(texCanvas, vUV)` —— 把纹理**铺满整个视口**，
    //   视口宽高比 ≠ 画面宽高比时画面被**拉伸**：Android 的 1280x720 塞进约 1.25 的方形区
    //   会纵向拉伸约 40%，888x1920 的 iPhone 塞进同一区域会横向拉伸约 2.7 倍。
    //   ★这个 bug 从 B2 就在，一直没被发现的原因是 `poc_dump` 读的是 **FBO（g_canvas 纹理）**，
    //     不是屏幕 —— dump 出来的像素永远是正确的，只有人眼看窗口才看得出变形。
    //   现在 HTML 侧把原生视图**收成设备宽高比**，正常情况 uFit≈1（无黑边，像素 1:1）；
    //   万一两边漂移（窗口刚 resize、首帧尺寸未到），这里兜底：**宁可留黑边，也不变形**。
    "void main(){ vec2 t = (vUV - 0.5) / uFit + 0.5;\n"
    "  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) { o = vec4(0.043, 0.047, 0.059, 1.0); return; }\n"
    "  o = texture(texCanvas, t); }\n";

static GLuint compile_sh(GLenum t, const char *src) {
  GLuint s = glCreateShader(t);
  glShaderSource(s, 1, &src, NULL);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[1024]; glGetShaderInfoLog(s, sizeof log, NULL, log); fprintf(stderr, "shader: %s\n", log); exit(2); }
  return s;
}
static GLuint link_prog(const char *vs, const char *fs) {
  GLuint p = glCreateProgram();
  glAttachShader(p, compile_sh(GL_VERTEX_SHADER, vs));
  glAttachShader(p, compile_sh(GL_FRAGMENT_SHADER, fs));
  glBindFragDataLocation(p, 0, "o");
  glLinkProgram(p);
  GLint ok = 0; glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { fprintf(stderr, "link fail\n"); exit(2); }
  return p;
}

/* ─────────── 指针输入：**这里不处理**（修正 B1 的错误前提）───────────
 *
 * 【曾经的误解】B1 以为"画布是叠在 HTML 之上的原生 NSView，HTML 收不到它的点击"，
 *   于是在这里重写 `mouseDown:` + 注册 C 回调，把坐标经 Rust emit 给前端。
 *
 * 【事实（见 poc_attach_impl 的 addSubview）】GL 视图是用
 *   `addSubview:positioned:NSWindowBelow relativeTo:nil` 挂的 —— 它在**所有兄弟视图的最下面**，
 *   而 WKWebView 铺满整个 contentView。AppKit 的 `hitTest:` 从最上层子视图开始找，
 *   所以**真实点击永远被 webview 吃掉，`mouseDown:` 一次都不会触发**。
 *   ⇒ 那条通路是死路，判据却一直绿（因为判据是从 JS 事件入口注入的）。
 *
 * 【正确的做法】输入源就是 HTML：`#canvas`（透明 div）本身有真实几何、也真实收到 pointer 事件，
 *   Studio 侧坐标换算、点击落点、拖拽平移全部在前端完成（零 C 接缝、零坐标翻转）。
 *   ⇒ 这里刻意**不实现任何输入处理**：不是"还没做"，是"不该在这里做"。
 *   ★若将来真要让原生视图接收输入（例如把 GL 提到 webview 之上做纯画布模式），
 *     必须同时重做 HTML 叠加层（marker/HUD/工具条会被 GL 挡住）——那是一次架构变更，不是加个回调。
 */

@interface PocGLView : NSOpenGLView
@end
@implementation PocGLView
- (BOOL)isOpaque { return YES; }
@end

/* ─────────── 状态 ─────────── */
static NSView *g_parent = nil;
static PocGLView *g_view = nil;
static NSOpenGLContext *g_ctx = nil;
static GLuint g_fbo = 0, g_canvas = 0, g_vao = 0, g_ty = 0, g_tuv = 0, g_progComp = 0, g_progBlit = 0;
static GLint g_uFit = -1;
/// YUV→RGB 的范围开关（1 = full/JPEG，0 = limited/video）。见 FS_YUV 注释。
static GLint g_uFullRange = -1;

static AVFormatContext *g_fmt = NULL;
static AVCodecContext *g_cc = NULL;
static AVBufferRef *g_hwdev = NULL;
static AVPacket *g_pkt = NULL;
static AVFrame *g_frm = NULL, *g_nv12 = NULL;
static struct SwsContext *g_sws = NULL;
static int g_vs = -1, g_W = 0, g_H = 0;
static double g_fps = 30.0, g_budget = 33.333;
static bool g_hw = false, g_eof = false, g_live = false;
static long g_recv_ok = 0, g_send_ok = 0;
static long g_ticks = 0, g_empty = 0, g_maxq = 0;   /* 诊断：tick 总数 / 空转 / 队列峰值 */
static AVFrame *g_last = NULL;   /* live：本拍解出的最后一帧 */

static double g_t_start = 0, g_base_pts = -1, g_last_out = -1, g_wall0 = 0;
static long g_frames = 0, g_late = 0;
static double g_iv[MAX_SAMPLES], g_rc[MAX_SAMPLES], g_pr[MAX_SAMPLES];
static double g_tr[MAX_SAMPLES];   /* 硬解帧回拷 GPU→CPU 的耗时（用来判断零拷贝还有多少油水） */
static int g_n_tr = 0;
/* ── 延迟三段（全部同一时钟域 CLOCK_MONOTONIC，起点 = 该帧首字节到达）── */
static double g_lat[MAX_SAMPLES], g_qw[MAX_SAMPLES], g_dec[MAX_SAMPLES];
static int g_n_lat = 0, g_n_qw = 0, g_n_dec = 0;
static double g_last_t_first = 0;  /* 当前渲染帧的首字节时刻 */

/* ── 硬解健康度（决策 #1256）────────────────────────────────────────────────
 * 【为什么需要】VideoToolbox 在**某些参数集**上会逐帧拒绝（实测：小米竖屏 884×1920 / High@5.1，
 *   8 秒 411 次 `hardware accelerator failed to decode picture`），而被拒的包在
 *   `avcodec_send_packet` 返回错之后被**静默丢弃** ⇒ 画面全黑，面板却仍显示"运行中 + 硬解"。
 *   同一份码流软解 0 错、1.1ms/帧 ⇒ 不是"流坏了"，是"这台机器硬解吃不了这份参数集"。
 * 【判据】不按"失败数 > 0"判（纯 SPS/PPS 的 AU、重复 IDR 本来就会失败），而是
 *   **失败包数显著多于成功解出的帧**（>2 倍且 ≥4 个）⇒ 判硬解这条路走不通。
 * 【动作】用同一份 extradata 重开一个**不带 hw_device_ctx** 的解码器并 flush；
 *   g_hw 置 false ⇒ `out[17]` 跟着变 ⇒ 面板如实显示"软解"（不再是假读数）。 */
static int g_force_sw = 0;       /* 一旦判定"这台机器硬解跑不动"就置 1，后续会话直接软解 */
static int poc_live_restart(const char *cmd);   /* 定义在后面（降级要用它重启会话） */
static long g_dec_fail = 0;      /* send_packet 失败的包数（原先被静默丢掉） */
static long g_hw_frames = 0;     /* 真正由 VT 解出的帧（format == VIDEOTOOLBOX） */
static long g_sw_frames = 0;     /* 硬解会话里**回退成软解**解出的帧（format 是 YUV 平面） */
static int g_dec_sw = 0;         /* 已从硬解切到软解 */
static double g_dec_t0 = 0;      /* 本次解码会话的起点（给首个 IDR 留时间） */
static unsigned char g_dec_params[4096];
static int g_dec_plen = 0;

static void maybe_degrade_to_sw(void) {
  if (!g_hw || g_dec_sw) return;
  if (now_ms() - g_dec_t0 < 1200) return;
  /* ★判据用**实际出帧率**（用户看到的就是这个）：
     · 第一版用 send_packet 返回值 —— VT 逐帧失败时 ffmpeg 内部回退软解并返回成功，失败计数恒 0；
     · 第二版用帧格式（VT vs YUV）—— VT 确实出了一部分帧，仍不触发；
     · 现在：1.5 秒后实测出帧率 < 30fps 就判定"硬解这条路在这份参数集上跑不动"。 */
  double el = now_ms() - g_dec_t0;
  if (el < 1500) return;
  /* ★★判据必须是"**硬解一帧都出不来**"，不能是"fps 不够高"（决策 #1294）。
     实测：iOS 静止 0fps、动起来 ~5fps；Android screenrecord ~15fps ⇒
     "fps < 30 就降级"会让**两个平台每轮都降级**：强制软解 + 重启会话（断开连接、重新等 IDR）。
     真正该降级的场景只有一个：**AUS 在进来，但一帧都没解出来**（VT 拒绝这份参数集）。 */
  if (g_live_aus < 10) return;                       /* 还没数据，别急着判 */
  if (g_hw_frames > 0 || g_sw_frames > 0) return;    /* 出过帧就说明这条路能用 */
  double fps = (double)g_frames / (el / 1000.0);
  g_dec_sw = 1;
  g_force_sw = 1;
  /* ★★降级 = **重启采集会话**，不是"原地换一个软解解码器"（决策 #1264 实测修正）。
     原地换解码器的坑：新解码器没有参考帧，必须等到**下一个 IDR** 才能出画；
     而静止画面（桌面/文档）很久才有一个 IDR ⇒ 表现为"本该降级救场，结果黑屏更久"。
     重启会话则必然从 SPS/PPS + IDR 开始，一次到位。
     代价：一次重启（几百毫秒黑一下），但比"黑到下一次关键帧"好得多。 */
  fprintf(stderr, "实时：收到 %ld 个 AU 但**一帧都没解出来**（出帧 %.1f）⇒ 判定硬解不可用，重启会话并强制软解\n",
          g_live_aus, fps);
  poc_live_restart(g_live_cmd);
}

/* ── 实时直方图（面板用）：固定窗口的环形缓冲，取值时排序求分位 ──
   为什么不用 g_iv/g_lat 那批：那些是"给最终报告用"的一次性全量数组，只增不滑；
   面板要的是**最近**表现，所以这里单独一套滑动窗口（240 帧 ≈ 4s@60fps）。 */
#define HIST_N 240
typedef struct { double v[HIST_N]; int n, i; } PocoHist;
static PocoHist h_iv, h_lat, h_qw, h_dec, h_cmp, h_pres;
static int g_rec = 0;   /* 预热结束、开始记账 */

static void hist_add(PocoHist *h, double v) {
  h->v[h->i] = v;
  h->i = (h->i + 1) % HIST_N;
  if (h->n < HIST_N) h->n++;
}

static int cmp_d(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x < y) ? -1 : (x > y) ? 1 : 0;
}

/** 分位；样本不足返回 -1（**不返回 0**——0ms 会被读成"很快"） */
static double hist_pct(const PocoHist *h, double q) {
  if (h->n == 0) return -1;
  double tmp[HIST_N];
  memcpy(tmp, h->v, sizeof(double) * (size_t)h->n);
  qsort(tmp, (size_t)h->n, sizeof(double), cmp_d);
  int idx = (int)(q * (double)(h->n - 1) + 0.5);
  if (idx < 0) idx = 0;
  if (idx >= h->n) idx = h->n - 1;
  return tmp[idx];
}
static int g_n_iv = 0, g_n_rc = 0, g_n_pr = 0;
static struct rusage g_ru0;
static int g_probe_bits = 0;

static bool g_inited = false;

/* 在 contentView 的子视图里找 WKWebView，并把背景设透明（Studio 要的"原生画面 + HTML 叠加"） */
static int probe_and_flatten_webview(NSView *parent) {
  int bits = 0;
  for (NSView *v in [parent subviews]) {
    NSString *cls = NSStringFromClass([v class]);
    if ([cls containsString:@"WebView"] || [cls containsString:@"WK"]) {
      bits |= 1;
      @try {
        [v setValue:@NO forKey:@"drawsBackground"];
        if ([[v valueForKey:@"drawsBackground"] boolValue] == NO) bits |= 2;
      } @catch (NSException *e) {
        fprintf(stderr, "drawsBackground 设置失败：%s\n", [[e reason] UTF8String]);
      }
      break;
    }
  }
  return bits;
}

static const char *video_path(void) {
  const char *p = getenv("POC_VIDEO");
  return p ? p : "/tmp/proteus-poc/720p30.mp4";
}

/* ── 打开实时流解码器（决策 #1263：从 poc_attach 抽出来，切换分辨率要能重入）──
 * 为什么必须抽：切分辨率 = 重启采集会话 = 重建解码器（旧 extradata 对应旧 SPS）。
 * 抽成一个函数，attach 与 restart 走**同一条**初始化路径——两条必然漂移。 */
static int live_open_decoder(void) {
  static unsigned char params[4096];
  int plen = 0, waited = 0;
  /* ★顺序很关键：**先起读取线程，等 SPS/PPS 到齐，再开解码器**。
     VideoToolbox 硬解必须有 extradata（参数集），而裸流里 SPS/PPS 随第一个 IDR 才出现；
     第一版是"先开解码器后读流"，VT 拿不到参数集 ⇒ 直接拒绝解码（只能退回软解）。
     live_peek_params 只窥探不取走，首个 IDR 仍在队列里，解出来就是完整一帧。 */
  while (!live_peek_params(params, (int)sizeof(params), &plen)) {
    if (waited >= 5000) break;
    usleep(10000);
    waited += 10;
  }

  if (g_cc) avcodec_free_context(&g_cc);
  const AVCodec *dec = avcodec_find_decoder(AV_CODEC_ID_H264);
  g_cc = avcodec_alloc_context3(dec);
  g_cc->flags |= AV_CODEC_FLAG_LOW_DELAY;
  if (plen > 0) {
    g_cc->extradata = (uint8_t *)av_mallocz((size_t)plen + AV_INPUT_BUFFER_PADDING_SIZE);
    memcpy(g_cc->extradata, params, (size_t)plen);
    g_cc->extradata_size = plen;
  }
  g_hw = false;
  if (!g_force_sw && getenv("POC_LIVE_SW") == NULL &&
      av_hwdevice_ctx_create(&g_hwdev, AV_HWDEVICE_TYPE_VIDEOTOOLBOX, NULL, NULL, 0) >= 0) {
    g_cc->hw_device_ctx = av_buffer_ref(g_hwdev);
    g_hw = true;
  }
  int open_rc = avcodec_open2(g_cc, dec, NULL);
  /* 留一份参数集：硬解失败后要用它重开软解解码器（决策 #1256） */
  g_dec_plen = plen < (int)sizeof(g_dec_params) ? plen : (int)sizeof(g_dec_params);
  if (g_dec_plen > 0) memcpy(g_dec_params, params, (size_t)g_dec_plen);
  g_dec_t0 = now_ms();
  { /* 取证钩子：POC_DUMP_PARAMS=<path> 把抽出的参数集落盘（决策 #1256 就是靠它抓到
       "设备日志文本被当成 SPS" 的）。默认不写，零开销。 */
    const char *dp = getenv("POC_DUMP_PARAMS");
    if (dp) { FILE *f = fopen(dp, "wb"); if (f) { fwrite(params, 1, (size_t)plen, f); fclose(f); } }
  }
  fprintf(stderr, "实时：参数集 %d 字节（等 %dms）· 硬解=%d · open rc=%d\n", plen, waited, (int)g_hw, open_rc);
  /* ★**没拿到参数集时把抓流日志的尾巴打出来**（决策 #1324）：
     否则现象只有一个"0 字节"，昨天为此猜了一下午（实际是 cast 卡在 SCStream.startCapture）。
     抓流的 stderr 落在 ~/Library/Logs/Proteus Studio/cast.err（见 capture_preset）。 */
  if (plen == 0) {
    char path[512];
    const char *home = getenv("HOME");
    snprintf(path, sizeof(path), "%s/Library/Logs/Proteus Studio/cast.err", home ? home : "");
    FILE *f = fopen(path, "rb");
    if (f) {
      char buf[601] = {0};
      if (fseek(f, 0, SEEK_END) == 0) {
        long sz = ftell(f);
        long take = sz > 600 ? 600 : sz;
        if (sz > 0 && fseek(f, sz - take, SEEK_SET) == 0) {
          size_t n = fread(buf, 1, (size_t)take, f);
          buf[n] = 0;
        }
      }
      fclose(f);
      fprintf(stderr, "实时：抓流没有数据 —— cast 日志尾部：\n%s\n", buf);
    } else {
      fprintf(stderr, "实时：抓流没有数据，且没有 cast 日志（%s）\n", path);
    }
  }
  if (open_rc < 0) { fprintf(stderr, "实时：解码器打开失败\n"); return -1; }

  /* 尺寸：SPS 里已经解析出来了，优先用它（screenrecord --size 只是请求值，设备可能改） */
  g_W = getenv("POC_LIVE_W") ? atoi(getenv("POC_LIVE_W")) : 1280;
  g_H = getenv("POC_LIVE_H") ? atoi(getenv("POC_LIVE_H")) : 720;
  if (g_cc->width > 0 && g_cc->height > 0) { g_W = g_cc->width; g_H = g_cc->height; }
  g_fps = 60.0; g_budget = 1000.0 / g_fps;
  fprintf(stderr, "实时投屏：%s（%dx%d）\n", g_live_cmd, g_W, g_H);
  return 0;
}

/* ── 重启请求（决策 #1263）────────────────────────────────────────────────────
 * ★为什么不在 IPC 线程直接重启：`poc_tick` 正在用 g_cc 解码，那边若 free 掉就是 UAF。
 *   这里只落一个"待办"，真正的重启由**渲染线程**在 tick 开头（还没碰解码器时）执行。
 *   代价：切换瞬间主线程会阻塞几百毫秒（等新会话的 SPS/PPS），窗口会顿一下——这是诚实的代价，
 *   比"偶尔崩"好。 */
static char g_pending_cmd[1024];
static volatile int g_pending = 0;

/* ── 原生"选路径"对话框（决策 #1268）──────────────────────────────────────────
 * 【为什么要它】让开发者手打 `/Volumes/…/Xcode.app` 是错误的门槛：路径长、易错、
 *   而且 Xcode 可以装在任意磁盘。IDE 的做法是「浏览…」→ 系统面板点两下。
 * 【为什么自己写而不加 tauri-plugin-dialog】本仓刻意不加依赖（装依赖要改根 lockfile，
 *   历史上两次都失败）；而 AppKit 的 NSOpenPanel 就够，且我们已经有 ObjC 桥。
 * 【线程】AppKit 的模态面板必须在**主线程**开；调用方在 worker 线程 ⇒ 投递到主队列再等信号量。
 * 【返回】写进调用方给的缓冲区（1 = 选中，0 = 取消），避免跨语言传字符串所有权。 */
int poc_pick_path(const char *message, char *out, int cap) {
  /* ★不能用 `__block char buf[4096]`：C 不允许在 block 里引用**数组**类型的自动变量
     （clang 直接报 "cannot refer to declaration with an array type inside block"）。
     改成堆上的指针，block 里只捕获指针。 */
  char *buf = calloc(1, 4096);
  if (!buf) return 0;
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_main_queue(), ^{
    @autoreleasepool {
      NSOpenPanel *p = [NSOpenPanel openPanel];
      p.canChooseFiles = YES;
      p.canChooseDirectories = YES;
      p.allowsMultipleSelection = NO;
      /* ★`treatsFilePackagesAsDirectories = NO`：`.app` 是"包"，当成对象才选得中；
         置 YES 会让 Xcode.app 退化成可进入的目录，用户只能选到 Contents 里面去。 */
      p.treatsFilePackagesAsDirectories = NO;
      p.prompt = @"选择";
      if (message) p.message = [NSString stringWithUTF8String:message];
      if ([p runModal] == NSModalResponseOK && p.URL.path.length > 0) {
        snprintf(buf, 4096, "%s", p.URL.path.UTF8String);
      }
    }
    dispatch_semaphore_signal(sem);
  });
  dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
  int ok = (buf[0] != 0);
  if (ok) snprintf(out, (size_t)cap, "%s", buf);
  free(buf);
  return ok;
}

/* ★「切设备后画布还显示上一台」的根因（决策 #1286）：
 *   live 分支在没有新 AU 时走 `if (!got) { g_empty++; return 0; }` **直接返回、不绘制**
 *   ⇒ GL 后台缓冲里留着上一台设备的最后一帧，窗口就"卡"在那张图上。
 *   用户看到的是"点了没反应"，于是再点一次。⇒ 切源时必须**主动抹一次**：
 *   ① 丢掉 g_last（不让它被当作可用帧）；② 清空读数（面板/界面回到"等推流"）；
 *   ③ 画一帧黑（把残留像素盖掉）—— 只画一次，新流一到就恢复。 */
static int g_blank_once = 0;
/* ★"流断了"的检测（决策 #1290）：手机端一旦停止推流（回桌面/退出/断网），
   live 分支没有新 AU ⇒ tick 直接 return、不绘制 ⇒ **画布永远停在最后一帧**，
   看起来像"还在跑"（面板 fps 也还是旧值）。用户实测就撞到这个：
   手机已经回到桌面，Studio 里画面还是那个页面。
   ⇒ 记录最后一次收到 AU 的时刻，超过阈值就抹黑一次并置 g_stalled（fps 归 0）。 */
static double g_last_au_ms = 0;
static int g_stalled = 0;
#define STALL_MS 1500.0

static void draw_blank_frame(void) {
  if (!g_view || !g_ctx) return;
  NSSize bs = [g_view convertRectToBacking:[g_view bounds]].size;
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(0, 0, (GLsizei)bs.width, (GLsizei)bs.height);
  glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT);
  [g_ctx flushBuffer];
}

void poc_live_request_restart(const char *cmd) {
  if (!cmd || !*cmd) return;
  snprintf(g_pending_cmd, sizeof(g_pending_cmd), "%s", cmd);
  g_pending = 1;
}

/* 切换采集参数（决策 #1263）：停旧会话 → 清软解上下文 → 起新会话 → 重建解码器。
 * 纹理不用管：首帧尺寸与 `g_W/g_H` 不一致时，poc_tick 里已有"就地重建纹理"的分支。 */
int poc_live_restart(const char *cmd) {
  if (!g_live || !cmd || !*cmd) return 1;
  fprintf(stderr, "实时：切换采集 ⇒ %s\n", cmd);
  live_stop();                                   /* 杀进程组 + 设备侧 pkill + join */
  /* ★切源即"上一台的画面作废"（决策 #1286）：不丢 g_last 的话，下一拍 tick 找不到新 AU
     就会把旧设备的最后一帧一直重画在屏幕上（实测：切到 iOS 后画布永远是安卓那张）。 */
  /* ★这里**不能** `av_frame_unref(g_last)`（虽然直觉上"作废"就该 unref）：
     实测这么写会 **SIGABRT** —— `Assertion desc failed at libswscale/swscale_internal.h:737`。
     一个被 unref 的 AVFrame（width/height=0、format=NONE）仍可能被后面的 sws 路径当成有效帧，
     `sws_getContext` 拿到 format=-1 就断言。A/B 对照：去掉 unref ⇒ rc=0 / 117 帧 / 零断言。
     ⇒ 正确做法是**不碰帧的生命周期，只"不画它"**：切源后主动抹一次黑（g_blank_once），
       新流第一帧到达时自然会覆盖 g_last，旧画面就再没有机会被画出来。 */
  g_blank_once = 1;
  /* 读数归零：面板的"出帧/码率/延迟"必须跟着新会话从 0 起，否则界面显示还在跑旧流 */
  g_frames = 0; g_late = 0; g_live_aus = 0; g_live_bytes = 0;
  g_last_out = -1; g_wall0 = 0; g_last_t_first = 0;
  g_n_iv = g_n_rc = g_n_pr = g_n_tr = g_n_lat = g_n_qw = g_n_dec = 0;
  if (g_sws) { sws_freeContext(g_sws); g_sws = NULL; }
  if (g_nv12) av_frame_unref(g_nv12);
  g_dec_sw = 0; g_dec_fail = 0; g_hw_frames = 0; g_sw_frames = 0;
  if (live_start(cmd) != 0) { fprintf(stderr, "实时：重启读取线程失败\n"); return 2; }
  return live_open_decoder() == 0 ? 0 : 3;
}

/* 找 **iPhone 镜像** 窗口：`CGWindowListCopyWindowInfo`（纯 CoreGraphics，**不碰 SCK**）。
 *
 * ★★为什么不用 helper 的 `--list`（决策 #1321）：
 *   那个走 `SCShareableContent`，在 Studio 里实测**挂满 8 秒**回不来（子进程 + 内存紧张时更糟），
 *   于是设备列表里"镜像"那行**时有时无**、选中还报"不在列表里"。
 *   而"窗口在不在、多大、谁拥有"用 CGWindowList 就够了 —— 毫秒级、不要权限、不起进程。
 *   只有**抓画面**（SCK）才需要 helper。
 * 返回 1 = 找到（写回 id/宽/高），0 = 没有。
 */
int poc_find_mirror_window(uint32_t *out_id, uint32_t *out_w, uint32_t *out_h) {
  CFArrayRef arr = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  if (!arr) return 0;
  int found = 0;
  CFIndex n = CFArrayGetCount(arr);
  for (CFIndex i = 0; i < n && !found; i++) {
    NSDictionary *d = (__bridge NSDictionary *)CFArrayGetValueAtIndex(arr, i);
    NSString *title = d[(id)kCGWindowName];
    NSString *owner = d[(id)kCGWindowOwnerName];
    NSString *hay = [NSString stringWithFormat:@"%@ %@", title ?: @"", owner ?: @""];
    NSString *low = hay.lowercaseString;
    BOOL isMirror = ([hay containsString:@"镜像"] || [low containsString:@"iphone mirroring"] ||
                     [low containsString:@"screencontinuity"]);
    if (!isMirror) continue;
    NSDictionary *b = d[(id)kCGWindowBounds];
    if (!b) continue;
    double w = [b[@"Width"] doubleValue], h = [b[@"Height"] doubleValue];
    if (w < 100 || h < 200) continue; /* 过滤掉奇怪的附属窗口 */
    if (out_id) *out_id = (uint32_t)[d[(id)kCGWindowNumber] unsignedIntValue];
    if (out_w) *out_w = (uint32_t)w;
    if (out_h) *out_h = (uint32_t)h;
    found = 1;
  }
  CFRelease(arr);
  return found;
}

/* ── iPhone 镜像的输入注入（决策 #1318）────────────────────────────────────────
 * 镜像窗口是**普通 macOS 窗口**，所以输入不需要任何私有 HID：
 * 用公开的 `CGEvent` 往那个窗口的屏幕坐标投递鼠标/键盘事件，Apple 自己会转成真机触摸。
 *
 * ★需要「辅助功能」（Accessibility）授权；没有时事件会被系统静默丢弃（不报错），
 *   所以调用方必须先查 `poc_accessibility_granted()`，否则用户只会看到"点了没反应"。
 * ★窗口必须在前台才有意义：先用 owner pid 激活它，否则首次点击只会"激活窗口"而不传递。
 */
static CGRect mirror_window_rect(uint32_t win) {
  CGRect r = CGRectZero;
  CFArrayRef arr = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, win);
  if (arr) {
    if (CFArrayGetCount(arr) > 0) {
      NSDictionary *d = (__bridge NSDictionary *)CFArrayGetValueAtIndex(arr, 0);
      NSDictionary *b = d[(id)kCGWindowBounds];
      if (b) {
        r = CGRectMake([b[@"X"] doubleValue], [b[@"Y"] doubleValue],
                       [b[@"Width"] doubleValue], [b[@"Height"] doubleValue]);
      }
    }
    CFRelease(arr);
  }
  return r;
}

int poc_accessibility_granted(void) { return AXIsProcessTrusted() ? 1 : 0; }

void poc_request_accessibility(void) {
  NSDictionary *opts = @{(__bridge id)kAXTrustedCheckOptionPrompt: @YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
}

/* 取镜像窗口的属主 pid —— 用 `CGEventPostToPid` 投递事件给它。
 *
 * ★★为什么**不能**用 `CGEventPost(kCGHIDEventTap, ...)`（决策 #1319，用户实测的 bug）：
 *   那是"全局 HID 投递"，会**把真实鼠标指针搬到目标坐标**并真的在那里按下/拖动
 *   ⇒ 用户在**我们画布**上拖拉时，指针瞬间跳到镜像窗口里去操作它，
 *     画布自己的拖拽被打断，体验是"每次滑动都在滑镜像"。
 *   `CGEventPostToPid` 把事件**直接塞进目标进程的事件队列**，不动真实指针、也不抢焦点。
 * ★同样不再 `activate` 窗口：抢焦点会让用户正在用的 Studio 失焦。 */
static pid_t mirror_owner_pid(uint32_t win) {
  pid_t out = 0;
  CFArrayRef arr = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, win);
  if (!arr) return 0;
  if (CFArrayGetCount(arr) > 0) {
    NSDictionary *d = (__bridge NSDictionary *)CFArrayGetValueAtIndex(arr, 0);
    NSNumber *pid = d[(id)kCGWindowOwnerPID];
    if (pid) out = (pid_t)pid.intValue;
  }
  CFRelease(arr);
  return out;
}

/* 往指定进程投递一个鼠标事件（不动全局指针） */
static void post_to_pid(pid_t pid, CGEventType type, CGPoint p) {
  CGEventRef ev = CGEventCreateMouseEvent(NULL, type, p, kCGMouseButtonLeft);
  if (!ev) return;
  CGEventPostToPid(pid, ev);
  CFRelease(ev);
}

/* 把镜像窗口挪到主屏**右下角**（决策 #1326）：让它"在屏幕上、可点到，但不占主工作区"。
 *
 * ★为什么必须留在屏幕上（不能藏/最小化）：我们的点击是**真实 HID 事件**，
 *   它落在"屏幕上该坐标的最上层窗口" ⇒ 窗口离屏则点不到，被 Studio 盖住则点到 Studio。
 *   所以只能"挪到角落"，不能"隐藏"。这是 HID 方案的天花板，不是实现偷懒。
 * 用 AX 设置窗口位置（需要「辅助功能」，和注入同一份权限）。
 */
int poc_place_mirror_window(uint32_t win, int margin) {
  if (!AXIsProcessTrusted()) return -2;
  pid_t pid = mirror_owner_pid(win);
  if (pid <= 0) return -3;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  if (!app) return -4;
  CFTypeRef winsRef = NULL;
  int rc = -4;
  if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, &winsRef) == kAXErrorSuccess &&
      winsRef && CFGetTypeID(winsRef) == CFArrayGetTypeID() && CFArrayGetCount(winsRef) > 0) {
    AXUIElementRef winEl = (AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)winsRef, 0);
    CGRect r = mirror_window_rect(win);
    CGDirectDisplayID disp = CGMainDisplayID();
    double sw = CGDisplayPixelsWide(disp) / (CGDisplayPixelsWide(disp) > 0 ? 1 : 1);
    /* 用"屏幕的 Cocoa 坐标"（左上原点）算目标位置：右下角，留 margin */
    NSScreen *main = NSScreen.mainScreen;
    if (main) {
      NSRect vf = main.visibleFrame; /* Cocoa 坐标（左下原点） */
      double ww = r.size.width, hh = r.size.height;
      double targetX = vf.origin.x + vf.size.width - ww - margin;
      /* Cocoa 的 y 是左下原点 ⇒ 底部对齐：y = vf.origin.y + margin */
      double targetY = vf.origin.y + margin;
      /* AX 的 position 是**左上原点**的全局坐标 ⇒ y 需要换算 */
      double screenH = main.frame.size.height;
      double axY = screenH - (targetY + hh);
      CGPoint p = CGPointMake(targetX, axY);
      AXValueRef posVal = AXValueCreate(kAXValueCGPointType, &p);
      if (posVal) {
        if (AXUIElementSetAttributeValue(winEl, kAXPositionAttribute, posVal) == kAXErrorSuccess) rc = 0;
        CFRelease(posVal);
      }
    }
    (void)sw;
  }
  if (winsRef) CFRelease(winsRef);
  CFRelease(app);
  return rc;
}

/* ── 真实 HID 投递 + 事后还原（决策 #1325）─────────────────────────────────
 * ★为什么放弃 `CGEventPostToPid`：实测事件发出去了（我们的日志有 17 条），
 *   但**镜像 app 直接忽略**——这类"直接塞进某个进程队列"的鼠标事件在很多 app 上不生效
 *   （苹果文档也只保证键盘事件可靠）。所以只能走真实 HID。
 * ★代价与补偿：HID 会移动真实指针、并把镜像窗口激活。所以：
 *   ① 投递前记住**指针位置**与**原前台 app**；
 *   ② 把镜像窗口拉到前台（否则点击会落到它上面盖着的窗口）；
 *   ③ 投递完成后**还原指针**、并把**焦点还给原来的 app**。
 *   用户看到的是"指针闪一下、点到了手机上"，而不是"我正在用的窗口被抢走"。
 */
typedef struct {
  CGPoint cursor;
  pid_t front;
} MirrorSaved;

static MirrorSaved mirror_begin(uint32_t win) {
  MirrorSaved sv = {{0, 0}, 0};
  CGEventRef ev0 = CGEventCreate(NULL);
  if (ev0) {
    sv.cursor = CGEventGetLocation(ev0);
    CFRelease(ev0);
  }
  /* ★**投递期间把真实指针藏起来**（决策 #1326）：HID 必然移动指针，用户看到的是
     "鼠标突然飞到镜像窗口里"。指针移动只有几十毫秒，藏起来就几乎无感；
     投递结束后先还原位置、再显示。 */
  CGDisplayHideCursor(kCGDirectMainDisplay);
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  sv.front = front ? front.processIdentifier : 0;
  /* 把镜像窗口所属 app 拉到前台（否则点击/滚动落不到它上面）。
     ★**已经在前台就不要再激活、也不要等**（决策 #1328）：连续滚动时每次省 80ms，
       否则用户看到的是"滚一下顿一下"。 */
  pid_t pid = mirror_owner_pid(win);
  if (pid > 0 && sv.front != pid) {
    NSRunningApplication *app =
        [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    usleep(80000);
  } else if (pid > 0) {
    usleep(5000); /* 已在前台：只让出一次调度，别空等 */
  }
  return sv;
}

static void mirror_end(MirrorSaved sv) {
  CGWarpMouseCursorPosition(sv.cursor);
  CGDisplayShowCursor(kCGDirectMainDisplay);
  if (sv.front > 0) {
    NSRunningApplication *prev =
        [NSRunningApplication runningApplicationWithProcessIdentifier:sv.front];
    [prev activateWithOptions:NSApplicationActivateIgnoringOtherApps];
  }
}

static void hid_post(CGEventType type, CGPoint p) {
  CGEventRef ev = CGEventCreateMouseEvent(NULL, type, p, kCGMouseButtonLeft);
  if (!ev) return;
  CGEventPost(kCGHIDEventTap, ev);
  CFRelease(ev);
}


static CGPoint mirror_point(uint32_t win, double nx, double ny, CGRect *out) {
  CGRect r = mirror_window_rect(win);
  if (out) *out = r;
  return CGPointMake(r.origin.x + nx * r.size.width, r.origin.y + ny * r.size.height);
}

int poc_mirror_click(uint32_t win, double nx, double ny) {
  if (!AXIsProcessTrusted()) return -2;
  if (mirror_owner_pid(win) <= 0) return -3;
  CGRect r;
  CGPoint p = mirror_point(win, nx, ny, &r);
  if (r.size.width < 2) return -1;
  MirrorSaved sv = mirror_begin(win);
  hid_post(kCGEventMouseMoved, p);
  usleep(15000);
  hid_post(kCGEventLeftMouseDown, p);
  usleep(45000);
  hid_post(kCGEventLeftMouseUp, p);
  usleep(30000);
  mirror_end(sv);
  return 0;
}

int poc_mirror_drag(uint32_t win, double x1, double y1, double x2, double y2, int ms) {
  if (!AXIsProcessTrusted()) return -2;
  if (mirror_owner_pid(win) <= 0) return -3;
  CGRect r;
  CGPoint a = mirror_point(win, x1, y1, &r);
  if (r.size.width < 2) return -1;
  CGPoint b = mirror_point(win, x2, y2, NULL);
  int steps = 12;
  if (ms <= 0) ms = 220;
  MirrorSaved sv = mirror_begin(win);
  hid_post(kCGEventMouseMoved, a);
  usleep(15000);
  hid_post(kCGEventLeftMouseDown, a);
  for (int i = 1; i <= steps; i++) {
    double t = (double)i / steps;
    CGPoint p = CGPointMake(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    hid_post(kCGEventLeftMouseDragged, p);
    usleep((useconds_t)(ms * 1000 / steps));
  }
  hid_post(kCGEventLeftMouseUp, b);
  usleep(30000);
  mirror_end(sv);
  return 0;
}

/* ── 滚动会话（决策 #1329）───────────────────────────────────────────────
 * ★为什么要有"会话"：滚轮是**连续输入**，而每条消息都做一遍"藏指针+激活+还原"要 30~80ms，
 *   串行发就成了"一格一格"（用户实测："没有在镜像里直接滚那么丝滑"）。
 *   开会话后：begin 做一次准备（藏指针、激活、把指针停到目标点），
 *   post 只投滚动事件（~1ms，并且拆成多步逼近连续），end 才还原一次。
 */
/* ★★滚动**不抢焦点**（决策 #1330，用户实测的 bug）：
 *   原实现复用 `mirror_begin`（会 activate 镜像 app），会话结束时再 activate 回 Studio
 *   ⇒ 连续滚动时焦点来回跳，用户看到**左上角菜单在 Studio 和镜像之间闪**。
 *   而 macOS 的滚轮事件投给"**指针下方**的窗口"，**不需要**该 app 在前台 ⇒
 *   滚动路径只做"藏指针 + 把指针停到目标点"，一个焦点都不动。
 */
/* 取"屏幕上该点最上层的普通窗口"（layer 0）——用来判断镜像窗口有没有被遮住。
 * 被遮住时 HID 滚动会落到上层窗口上（用户实测：焦点正常了，但页面不动）。 */
static uint32_t top_window_at(CGPoint p) {
  CFArrayRef arr = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  if (!arr) return 0;
  uint32_t found = 0;
  CFIndex n = CFArrayGetCount(arr);
  for (CFIndex i = 0; i < n; i++) {
    NSDictionary *d = (__bridge NSDictionary *)CFArrayGetValueAtIndex(arr, i);
    NSNumber *layer = d[(id)kCGWindowLayer];
    if (layer && layer.intValue != 0) continue; /* 只看普通窗口层 */
    NSDictionary *b = d[(id)kCGWindowBounds];
    if (!b) continue;
    CGRect r = CGRectMake([b[@"X"] doubleValue], [b[@"Y"] doubleValue],
                          [b[@"Width"] doubleValue], [b[@"Height"] doubleValue]);
    if (CGRectContainsPoint(r, p)) {
      found = (uint32_t)[d[(id)kCGWindowNumber] unsignedIntValue];
      break; /* 列表是前→后有序，第一个命中的就是最上层 */
    }
  }
  CFRelease(arr);
  return found;
}

static int g_scroll_dbg = -1;
static int g_scroll_active = 0;
static MirrorSaved g_scroll_sv;
static CGPoint g_scroll_pt = {0, 0};

int poc_mirror_scroll_begin(uint32_t win, double nx, double ny) {
  if (!AXIsProcessTrusted()) return -2;
  if (mirror_owner_pid(win) <= 0) return -3;
  CGRect r;
  CGPoint p = mirror_point(win, nx, ny, &r);
  if (r.size.width < 2) return -1;
  if (g_scroll_active) {
    g_scroll_pt = p;
    return 0;
  }
  /* ★★**一个像素都不动**（决策 #1332）：之前"藏指针 + 移指针 + 每帧还原"会让用户看到
     指针不停变化（闪烁），而且滚轮事件还得跟真实指针抢。现在滚动全部走 `CGEventPostToPid`，
     指针位置、显隐、焦点都不碰。 */
  g_scroll_sv.cursor = CGPointZero;
  g_scroll_sv.front = 0;
  g_scroll_pt = p;
  g_scroll_active = 1;
  return 0;
}

int poc_mirror_scroll_post(uint32_t win, double nx, double ny, double dy) {
  if (!g_scroll_active) return -5;
  pid_t pid = mirror_owner_pid(win);
  if (pid <= 0) return -3;
  CGRect r;
  CGPoint p = mirror_point(win, nx, ny, &r);

  /* ★★滚轮事件**透传**（决策 #1335，用户指出的正解）：
     镜像 app 只把"滚动事件"映射成手机滚动；**拖动指针在镜像里不会滚动**（合成拖动是错的）。
     这里直接构造**连续型**滚动事件投给镜像进程，指针一动不动：
       · `kCGScrollWheelEventIsContinuous = 1` —— 触控板式连续滚动（缺这个字段很多 app 会忽略）；
       · `kCGScrollWheelEventPointDeltaAxis1` 与 `FixedPtDeltaAxis1` 同时给；
       · 事件里带上窗口号，让接收方知道"这一滚是给哪个窗口的"；
       · 分 3 步递减发送，近似惯性。
     `CGEventPostToPid` 对鼠标按键不可靠，但对**滚动**是可用的（此前失败更像字段不全）。 */
  int32_t total = (int32_t)(-dy);
  if (total == 0) total = dy > 0 ? -1 : 1;
  for (int i = 0; i < 3; i++) {
    int32_t v = total * (3 - i) / 3; /* 3/3, 2/3, 1/3 递减 */
    if (v == 0) continue;
    CGEventRef ev = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 1, v);
    if (!ev) break;
    CGEventSetIntegerValueField(ev, kCGScrollWheelEventIsContinuous, 1);
    CGEventSetIntegerValueField(ev, kCGScrollWheelEventPointDeltaAxis1, v);
    CGEventSetDoubleValueField(ev, kCGScrollWheelEventFixedPtDeltaAxis1, (double)v);
    CGEventSetLocation(ev, p);
    CGEventSetIntegerValueField(ev, kCGMouseEventWindowUnderMousePointer, (int64_t)win);
    CGEventPostToPid(pid, ev);
    CFRelease(ev);
    usleep(12000);
  }
  return 0;
}

int poc_mirror_scroll_end(void) {
  if (!g_scroll_active) return 0;
  g_scroll_active = 0;
  /* 什么都没动过 ⇒ 什么都不用还原（不显示/隐藏指针、不动焦点） */
  return 0;
}

/* 滚轮 → 镜像窗口（决策 #1327）：iPhone 镜像会把 Mac 的滚动换算成手机的上下滑。
 * 单位用**像素**（`kCGScrollEventUnitPixel`）：按"行"投递太慢，一次滚不动多远。
 * 调用方保证此刻已有辅助功能权限；窗口位置/前台由 mirror_begin 处理（含指针隐藏与还原）。 */
int poc_mirror_scroll(uint32_t win, double nx, double ny, double dy) {
  if (!AXIsProcessTrusted()) return -2;
  if (mirror_owner_pid(win) <= 0) return -3;
  CGRect r;
  CGPoint p = mirror_point(win, nx, ny, &r);
  if (r.size.width < 2) return -1;
  MirrorSaved sv = mirror_begin(win);
  hid_post(kCGEventMouseMoved, p);
  usleep(12000);
  CGEventRef ev = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 1, (int32_t)(-dy));
  if (!ev) {
    mirror_end(sv);
    return -4;
  }
  CGEventSetLocation(ev, p);
  CGEventPost(kCGHIDEventTap, ev);
  CFRelease(ev);
  usleep(20000);
  mirror_end(sv);
  return 0;
}

/* 屏幕录制权限是否已授予（决策 #1309）。
   ★为什么需要它：SCK 抓窗口在**没有权限**时表现为"拿不到窗口"，
   于是上层报"找不到模拟器窗口"——**错误指向了错误的原因**（用户实测被误导）。 */
int poc_screen_capture_granted(void) {
  return CGPreflightScreenCaptureAccess() ? 1 : 0;
}

/* 主动请求一次（只会弹一次系统对话框）。
   ★为什么要单独一个函数：没有权限时**每次**去抓窗口（`cast --list`）都会触发一次弹窗，
   而我们在等窗口时每 500ms 调一次 ⇒ 用户看到"弹窗连环"（实测反馈"体验极差"）。
   ⇒ 启动路径先查 → 没权限就**只请求一次**，然后直接告诉用户去设置里勾选，不再重试。 */
void poc_request_screen_capture(void) {
  (void)CGRequestScreenCaptureAccess();
}

/* ★探针（决策 #1292）：列一下 AVCaptureDevice 里有没有 iPhone 屏幕。
   QuickTime 能录 = 系统有这个采集设备；但**第三方进程要有「屏幕录制」TCC 授权**才看得见。
   这一段只在 `POC_IOS_USB_PROBE=1` 时跑，用来判定"USB 整屏采集"这条路能不能走。 */
static void probe_ios_capture_devices(void) {
  if (!getenv("POC_IOS_USB_PROBE")) return;
  @autoreleasepool {
    /* ★TCC 判定（决策 #1292）：iPhone「屏幕」设备在**没有屏幕录制权限**时会被系统
       静默隐藏（相机照样列得出来 ⇒ 很容易误判成"没有这个设备"）。
       这里主动问一次，把"有没有权限"变成可读的事实。 */
    bool pre = CGPreflightScreenCaptureAccess();
    fprintf(stderr, "[probe] 屏幕录制权限（预检）=%s\n", pre ? "已授权" : "未授权");
    if (!pre) {
      bool req = CGRequestScreenCaptureAccess();
      fprintf(stderr, "[probe] 已发起授权请求 ⇒ %s（授权后需重启本程序才生效）\n",
              req ? "系统已授权" : "等待用户在系统设置里勾选");
    }
    NSMutableArray *types = [NSMutableArray array];
    /* `.external` 是 DAL/插件类设备（iPhone 屏幕属于这类） */
    [types addObject:AVCaptureDeviceTypeExternal];
    if (@available(macOS 13.0, *)) [types addObject:AVCaptureDeviceTypeContinuityCamera];
    AVCaptureDeviceDiscoverySession *ds =
        [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types
                                                               mediaType:AVMediaTypeVideo
                                                                position:AVCaptureDevicePositionUnspecified];
    fprintf(stderr, "[probe] DiscoverySession(.external/.continuity) 共 %lu 台\n",
            (unsigned long)ds.devices.count);
    for (AVCaptureDevice *d in ds.devices) {
      fprintf(stderr, "[probe]   · %s（type=%s）\n", d.localizedName.UTF8String, d.deviceType.UTF8String);
    }
    /* ★再列"所有视频设备"（含系统/插件类）：QuickTime 的「iPhone 屏幕」可能不在
       .external 里，而是另一类（DAL 插件设备）。这一步决定能不能用 AVFoundation 抓屏幕。 */
    NSArray<AVCaptureDevice *> *all = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    fprintf(stderr, "[probe] 全部视频设备 %lu 台\n", (unsigned long)all.count);
    for (AVCaptureDevice *d in all) {
      fprintf(stderr, "[probe]   · %s（type=%s model=%s）\n", d.localizedName.UTF8String,
              d.deviceType.UTF8String, d.modelID.UTF8String);
    }
  }
}

static int poc_attach_impl(void *parent_nsview) {
  @autoreleasepool {
    probe_ios_capture_devices();
    // ★tauri 的 `ns_window()` 给的是 **NSWindow**（TaoWindow），不是 NSView。
    //   第一版直接当 NSView 用 ⇒ `-[TaoWindow bounds]: unrecognized selector` ⇒ ObjC 异常穿进 Rust ⇒ abort。
    id obj = (__bridge id)parent_nsview;
    if (!obj) { fprintf(stderr, "attach: parent 为空\n"); return 2; }
    if ([obj isKindOfClass:[NSWindow class]]) g_parent = [(NSWindow *)obj contentView];
    else g_parent = (NSView *)obj;
    if (!g_parent) { fprintf(stderr, "attach: contentView 为空\n"); return 2; }

    /* ① 解码器 —— 两条路：录制流（文件）或实时投屏（管道） */
    const char *live_cmd = getenv("POC_LIVE");
    if (live_cmd) {
      g_live = true;
      g_pkt = av_packet_alloc();
      g_frm = av_frame_alloc();
      g_nv12 = av_frame_alloc();

      /* ★顺序很关键：**先起读取线程，等 SPS/PPS 到齐，再开解码器**。
         VideoToolbox 硬解必须有 extradata（参数集），而裸流里 SPS/PPS 随第一个 IDR 才出现；
         第一版是"先开解码器后读流"，VT 拿不到参数集 ⇒ 直接拒绝解码（只能退回软解）。
         live_peek_params 只窥探不取走，首个 IDR 仍在队列里，解出来就是完整一帧。 */
      if (live_start(live_cmd) != 0) { fprintf(stderr, "实时：起读取线程失败\n"); return 2; }
      if (live_open_decoder() != 0) return 2;
      goto gl_init;   /* 跳过后面的文件打开/流信息 */
    }
    const char *file = video_path();
    if (avformat_open_input(&g_fmt, file, NULL, NULL) < 0) { fprintf(stderr, "打开失败：%s\n", file); return 2; }
    if (avformat_find_stream_info(g_fmt, NULL) < 0) return 2;
    g_vs = av_find_best_stream(g_fmt, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    if (g_vs < 0) return 2;
    AVStream *st = g_fmt->streams[g_vs];
    g_cc = avcodec_alloc_context3(avcodec_find_decoder(st->codecpar->codec_id));
    avcodec_parameters_to_context(g_cc, st->codecpar);
    if (av_hwdevice_ctx_create(&g_hwdev, AV_HWDEVICE_TYPE_VIDEOTOOLBOX, NULL, NULL, 0) >= 0) {
      g_cc->hw_device_ctx = av_buffer_ref(g_hwdev);
      g_hw = true;
    }
    if (avcodec_open2(g_cc, avcodec_find_decoder(st->codecpar->codec_id), NULL) < 0) return 2;
    g_W = g_cc->width; g_H = g_cc->height;
    g_fps = av_q2d(st->avg_frame_rate); if (!(g_fps > 0)) g_fps = 30.0;
    g_budget = 1000.0 / g_fps;

gl_init:
    /* ② 原生 GL 视图垫在 webview 下面 */
    NSOpenGLPixelFormatAttribute attrs[] = {
        NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFAAccelerated, NSOpenGLPFADoubleBuffer,
        NSOpenGLPFAColorSize, 24, NSOpenGLPFAAlphaSize, 8, 0,
    };
    NSOpenGLPixelFormat *pf = [[NSOpenGLPixelFormat alloc] initWithAttributes:attrs];
    if (!pf) { fprintf(stderr, "像素格式失败\n"); return 2; }
    /* ★初始 frame 用**零尺寸**而不是 [g_parent bounds]（决策 #1256）：
       以前它一出生就铺满整个 contentView ⇒ 用户会看到投屏"先在一个大窗口里闪一下"，
       等前端 `set_canvas_rect` 到了才收进设备框。零尺寸起步 = 第一帧就在正确的框里出现。 */
    g_view = [[PocGLView alloc] initWithFrame:NSMakeRect(0, 0, 0, 0) pixelFormat:pf];
    [g_view setWantsBestResolutionOpenGLSurface:YES];
    [g_parent addSubview:g_view positioned:NSWindowBelow relativeTo:nil];

    g_ctx = [g_view openGLContext];
    [g_ctx makeCurrentContext];
    GLint swapInterval = 1;
    [g_ctx setValues:&swapInterval forParameter:NSOpenGLContextParameterSwapInterval];
    [g_ctx update];

    fprintf(stderr, "GL_RENDERER=%s | GL_VERSION=%s\n",
            (const char *)glGetString(GL_RENDERER), (const char *)glGetString(GL_VERSION));

    /* ③ FBO + 程序 */
    glGenFramebuffers(1, &g_fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
    glGenTextures(1, &g_canvas);
    glBindTexture(GL_TEXTURE_2D, g_canvas);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, g_W, g_H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_canvas, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { fprintf(stderr, "FBO 不完整\n"); return 2; }

    g_progComp = link_prog(VS, FS_YUV);
    g_progBlit = link_prog(VS_BLIT, FS_BLIT);
    glGenVertexArrays(1, &g_vao);
    glBindVertexArray(g_vao);
    glGenTextures(1, &g_ty); glBindTexture(GL_TEXTURE_2D, g_ty);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, g_W, g_H, 0, GL_RED, GL_UNSIGNED_BYTE, NULL);
    glGenTextures(1, &g_tuv); glBindTexture(GL_TEXTURE_2D, g_tuv);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RG8, g_W / 2, g_H / 2, 0, GL_RG, GL_UNSIGNED_BYTE, NULL);
    GLuint planes[2] = {g_ty, g_tuv};
    for (int i = 0; i < 2; i++) {
      glBindTexture(GL_TEXTURE_2D, planes[i]);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    }
    glUseProgram(g_progComp);
    glUniform1i(glGetUniformLocation(g_progComp, "texY"), 0);
    glUniform1i(glGetUniformLocation(g_progComp, "texUV"), 1);
    glUseProgram(g_progBlit);
    glUniform1i(glGetUniformLocation(g_progBlit, "texCanvas"), 2);
    g_uFit = glGetUniformLocation(g_progBlit, "uFit");
    // ★-1 = 编译器把 uniform 优化掉了（源里没用/拼错）。此时 uFit 恒为 0 ⇒ 着色器里除零
    //   ⇒ 整个画面变成背景色（全黑），而且**不会报错**。宁可启动即失败，也不要"看起来能跑但全黑"。
    if (g_uFit < 0) { fprintf(stderr, "blit: 找不到 uFit uniform（着色器与查表不一致）\n"); exit(2); }
    g_uFullRange = glGetUniformLocation(g_progComp, "uFullRange");
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

    g_pkt = av_packet_alloc();
    g_frm = av_frame_alloc();
    g_nv12 = av_frame_alloc();

    getrusage(RUSAGE_SELF, &g_ru0);
    g_t_start = now_ms() + WARMUP_MS;

    g_probe_bits = probe_and_flatten_webview(g_parent);
    fprintf(stderr, "webview 探测：found=%d transparent=%d\n", g_probe_bits & 1, (g_probe_bits >> 1) & 1);

    g_inited = true;
    return 0;
  }
}

/* ★ObjC 异常不能穿进 Rust（会直接 abort："Rust cannot catch foreign exceptions"）⇒ 在这里兜住 */
int poc_attach(void *parent_nsview) {
  @try {
    return poc_attach_impl(parent_nsview);
  } @catch (NSException *e) {
    fprintf(stderr, "poc_attach NSException: %s — %s\n",
            [[e name] UTF8String], [[e reason] UTF8String]);
    return 3;
  }
}

int poc_probe(void) { return g_probe_bits; }

/* ── Studio 骨架用：让 HTML 布局决定原生画布的位置/大小 ──
   x/y 是 **CSS 坐标（左上原点）**，要翻成 AppKit 的左下原点。 */
void poc_set_frame(double x, double y, double w, double h) {
  if (!g_view) return;
  double ph = [g_parent bounds].size.height;
  NSRect r = NSMakeRect(x, ph - y - h, w, h);
  [g_view setFrame:r];
  [g_view.openGLContext update];
}

/* 调试用：把画布 FBO 读回成 PPM（截图权限被 TCC 拦时，用它自证"画布真的有画面"） */
int poc_dump(const char *path) {
  if (!g_inited || !g_W) return 2;
  @autoreleasepool {
    [g_ctx makeCurrentContext];
    size_t n = (size_t)g_W * g_H * 3;
    unsigned char *px = (unsigned char *)malloc(n);
    if (!px) return 2;
    glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, g_W, g_H, GL_RGB, GL_UNSIGNED_BYTE, px);
    FILE *f = fopen(path, "wb");
    if (!f) { free(px); return 2; }
    fprintf(f, "P6\n%d %d\n255\n", g_W, g_H);
    /* GL 原点在左下，PPM 在左上 ⇒ 逐行倒序写 */
    for (int y = g_H - 1; y >= 0; y--) fwrite(px + (size_t)y * g_W * 3, 1, (size_t)g_W * 3, f);
    fclose(f);
    free(px);
    /* ★全链路延迟对账用：把「这一帧的首字节到达 / 上屏」换算成 epoch 毫秒打出来。
       配合 `screenrecord --bugreport` 烧进画面左上角的设备时间戳，就能算
       设备出帧 → 我们上屏 的总延迟（跨时钟域，误差 = 设备与 Mac 的时钟偏差）。 */
    struct timespec rt;
    clock_gettime(CLOCK_REALTIME, &rt);
    double epoch_img = (double)rt.tv_sec * 1e3 + (double)rt.tv_nsec / 1e6;
    double mono_img = now_ms();
    fprintf(stderr,
            "[lat] mono_now=%.0f epoch_now=%.0f present_epoch=%.0f arrive_epoch=%.0f hold_ms=%.1f\n",
            mono_img, epoch_img,
            epoch_img - (mono_img - g_last_out),
            epoch_img - (mono_img - g_last_t_first),
            mono_img - g_last_out);
    return 0;
  }
}

long poc_frames(void) { return g_frames; }
long poc_recv_ok(void) { return g_recv_ok; }
long poc_send_ok(void) { return g_send_ok; }
long poc_live_aus(void) { return g_live_aus; }
/* 面板取数：把实时读数写进 out（调用方按固定下标读，避免每次改结构就动 IPC）。
   返回字段数。★分位样本不足时写 -1（不是 0）。 */
int poc_live_stats(double *out) {
  double wall = (g_last_out > 0 && g_wall0 > 0) ? (g_last_out - g_wall0) : 0;
  double mbps = wall > 0 ? (double)g_live_bytes * 8.0 / (wall / 1000.0) / 1e6 : -1;
  /* ★stall 时 fps 必须归 0：否则面板显示"14.8 fps"，用户以为还在跑（实测踩到） */
  /* fps 语义 = **当前是否在出帧**：断连 → 0；静止（>1.5s 无新帧）→ 0；否则累计平均。
     ★不要用累计平均硬撑：静止时显示 4.8fps，用户会以为还在跑（实测）。 */
  double nowm = now_ms();
  double idle_ms = g_last_au_ms > 0 ? nowm - g_last_au_ms : -1;
  out[0] = (g_stalled || idle_ms > STALL_MS) ? 0.0 : (wall > 0 ? (double)g_frames / (wall / 1000.0) : -1);
  out[1] = hist_pct(&h_iv, 0.50);
  out[2] = hist_pct(&h_iv, 0.95);
  out[3] = hist_pct(&h_lat, 0.50);
  out[4] = hist_pct(&h_lat, 0.95);
  out[5] = hist_pct(&h_qw, 0.50);
  out[6] = hist_pct(&h_dec, 0.50);
  out[7] = hist_pct(&h_cmp, 0.50);
  out[8] = hist_pct(&h_pres, 0.50);
  out[9] = (double)g_late;
  out[10] = (double)g_frames;
  out[11] = (double)g_live_aus;
  out[12] = mbps;
  out[13] = (double)g_empty;
  out[14] = (double)g_ticks;
  out[15] = (double)g_W;
  out[16] = (double)g_H;
  out[17] = g_hw ? 1.0 : 0.0;
  out[18] = g_stalled ? 1.0 : 0.0;   /* 推流是否已中断（决策 #1290） */
  return 19;
}

long poc_ticks(void) { return g_ticks; }
long poc_empty(void) { return g_empty; }
int poc_live_restarts(void) { return g_live_restarts; }
long poc_late(void) { return g_late; }

double poc_cpu_pct(void) {
  struct rusage ru;
  getrusage(RUSAGE_SELF, &ru);
  double cpu = (ru.ru_utime.tv_sec - g_ru0.ru_utime.tv_sec) + (ru.ru_utime.tv_usec - g_ru0.ru_utime.tv_usec) / 1e6 +
               (ru.ru_stime.tv_sec - g_ru0.ru_stime.tv_sec) + (ru.ru_stime.tv_usec - g_ru0.ru_stime.tv_usec) / 1e6;
  double wall = (now_ms() - g_t_start + WARMUP_MS) / 1000.0;
  return wall > 0 ? cpu / wall * 100.0 : -1;
}

/* 上传一个平面。★必须按 linesize 走：解码器给的 stride 常被对齐到 16/32 的倍数
   （实测 VT 回拷帧 linesize 可能 > width），直接 `glTexSubImage2D(..., w, h, data)` 会
   把每行都读偏 ⇒ 画面斜切/块状失真。stride == w 时走整块上传（快路径）。 */
static void upload_plane(GLuint tex, int w, int h, GLenum fmt, const unsigned char *data, int stride) {
  glBindTexture(GL_TEXTURE_2D, tex);
  if (!data || w <= 0 || h <= 0) return;
  if (stride == w) {
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, fmt, GL_UNSIGNED_BYTE, data);
    return;
  }
  for (int y = 0; y < h; y++) {
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, y, w, 1, fmt, GL_UNSIGNED_BYTE, data + (size_t)y * (size_t)stride);
  }
}

static int poc_tick_impl(void) {
  if (!g_inited || g_eof) return g_eof ? 1 : 2;
  /* 取证/回归钩子（决策 #1263）：POC_SWITCH_AFTER_MS + POC_SWITCH_CMD ⇒ 到点自动切一档。
     用来在**无头**模式验证"重启采集会话"这条路（切档位按钮背后就这一条路）。 */
  {
    static int fired = 0;
    const char *at = getenv("POC_SWITCH_AFTER_MS");
    if (!fired && at && now_ms() - g_t_start > atof(at)) {
      fired = 1;
      const char *c = getenv("POC_SWITCH_CMD");
      if (c) poc_live_request_restart(c);
    }
  }
  /* 切换采集档位的待办（决策 #1263）：必须在碰解码器**之前**做 */
  if (g_pending) {
    g_pending = 0;
    poc_live_restart(g_pending_cmd);
  }
  g_ticks++;
  @autoreleasepool {
    [g_ctx makeCurrentContext];
    /* 切源后的第一拍：把上一台的残留画面抹掉（只做一次；新流一到就覆盖它） */
    if (g_blank_once) {
      g_blank_once = 0;
      draw_blank_frame();
    }

    if (g_live) {
      /* ★★「画面静止」≠「流断了」（决策 #1291 修正 #1290 的误判）：
         iOS 的 ReplayKit 只在屏幕**变化**时出帧 ⇒ 静止时 0fps 完全正常，
         之前的"1.5s 没帧就抹黑"会把静置的手机判成断流（用户实测：不动屏幕就黑屏）。
         ⇒ 断连只看 **管道 EOF**（`g_link_lost`，由 live_stream.h 在读线程里置位）；
            静止则什么都不做 —— 保持最后一帧（那本来就是当前屏幕内容），只把 fps 报 0。 */
      if (g_link_lost) {
        if (!g_stalled) {
          g_stalled = 1;
          draw_blank_frame();
          fprintf(stderr, "实时：推流中断（手机端停止直播/连接关闭）⇒ 画布置空\n");
        }
      } else if (g_stalled) {
        g_stalled = 0;
        fprintf(stderr, "实时：推流恢复\n");
      }
      /* 排障开关：`POC_STALL_DIAG=1` ⇒ 每秒打一行，区分"tick 停了/静止/断连" */
      if (getenv("POC_STALL_DIAG")) {
        static double last_diag = 0;
        double t = now_ms();
        if (t - last_diag > 1000) {
          last_diag = t;
          fprintf(stderr, "[diag] tick=%ld idle=%.0fms aus=%ld lost=%d stalled=%d\n",
                  g_ticks, g_last_au_ms > 0 ? t - g_last_au_ms : -1, g_live_aus, g_link_lost, g_stalled);
        }
      }
      // ★必须**排空队列**：tick 60Hz 而流 ~120fps，只解一帧/拍会让队列积压并丢帧，
      //   而 H.264 丢一帧参考帧 ⇒ 后续全花屏（实测：块状拖影）。
      //   做法：把这一拍到达的 AU 全解掉，只把**最后一帧**拿去渲染。
      LiveAu au;
      int got = 0;
      while (live_pop(&au)) {
        double t_pop = now_ms();
        g_last_au_ms = t_pop;
        if (g_link_lost) g_link_lost = 0;   /* 新数据到了 ⇒ 链路恢复 */
        if (g_n_qw < MAX_SAMPLES) g_qw[g_n_qw++] = t_pop - au.t_ms;   /* 在队列里躺了多久 */
        if (g_rec) hist_add(&h_qw, t_pop - au.t_ms);
        if (av_new_packet(g_pkt, au.size) < 0) { free(au.data); continue; }
        memcpy(g_pkt->data, au.data, (size_t)au.size);
        free(au.data);
        double t_dec0 = now_ms();
        int sret = avcodec_send_packet(g_cc, g_pkt);
        if (sret >= 0) g_send_ok++;
        else g_dec_fail++;   /* 原先静默丢掉 ⇒ 全黑但没人知道（决策 #1256） */
        av_packet_unref(g_pkt);
        if (sret < 0) continue;
        while (avcodec_receive_frame(g_cc, g_frm) == 0) {
          /* 硬解会话里数一下"到底谁解的"（#1256）：
             VT 成功 ⇒ format=VIDEOTOOLBOX；VT 被拒后 ffmpeg 回退 ⇒ 普通 YUV 平面。 */
          if (g_hw && !g_dec_sw) {
            if (g_frm->format == AV_PIX_FMT_VIDEOTOOLBOX) g_hw_frames++;
            else g_sw_frames++;
          }
          if (!g_last) g_last = av_frame_alloc();
          av_frame_unref(g_last);
          av_frame_move_ref(g_last, g_frm);
          g_recv_ok++;
          got = 1;
        }
        double dec_ms = now_ms() - t_dec0;
        if (g_n_dec < MAX_SAMPLES) g_dec[g_n_dec++] = dec_ms;  /* 解码（含 VT 异步等待） */
        if (g_rec) hist_add(&h_dec, dec_ms);
        g_last_t_first = au.t_ms;
      }
      maybe_degrade_to_sw();   /* 硬解逐帧被拒时切软解（#1256） */
      if (!got) { g_empty++; return 0; }
      goto use_last;
    }
    if (av_read_frame(g_fmt, g_pkt) < 0) {
      // 骨架要长期跑：回到片头重新解码（真机实时流不需要，这里是为了"有画面可看"）
      // 用 avformat_seek_file 而不是 av_seek_frame(…, AVSEEK_FLAG_BACKUP)：后者在 ffmpeg 7 的
      // 头里没有直接暴露（实测 undeclared identifier）。
      if (avformat_seek_file(g_fmt, g_vs, INT64_MIN, 0, INT64_MAX, 0) >= 0) {
        avcodec_flush_buffers(g_cc);
        g_base_pts = -1;
        return 0;
      }
      g_eof = true;
      return 1;
    }
    if (g_pkt->stream_index != g_vs) { av_packet_unref(g_pkt); return 0; }
    if (avcodec_send_packet(g_cc, g_pkt) < 0) { av_packet_unref(g_pkt); return 0; }
    av_packet_unref(g_pkt);

have_frame:
    {
    AVFrame *frm = g_frm;
    int rret;
    if (g_live) {
use_last:
      frm = g_last;
      rret = 0;
    } else {
      rret = avcodec_receive_frame(g_cc, frm);
      if (rret >= 0) g_recv_ok++;
    }
    if (rret < 0) {
      if (rret != AVERROR(EAGAIN)) {
        static int once2 = 0;
        if (once2++ < 5) fprintf(stderr, "live recv err=%d\n", rret);
      }
      return 0;
    }

    if (g_live) {
      static int once = 0;
      if (once++ < 2) fprintf(stderr, "live frame %dx%d fmt=%d linesize=%d/%d（我们按 %dx%d 上传）\n", frm->width, frm->height, frm->format, frm->linesize[0], frm->linesize[1], g_W, g_H);
      /* ★★★2026-10-23（决策 #1190 续）：**按首帧尺寸自动重建纹理**。
       *
       * 【为什么需要】VT 硬解路径下 `avcodec_open2` 之后 `g_cc->width` 仍是 **0**（SPS 要等首帧才生效），
       *   于是 235 行的「用 SPS 里的真实尺寸」根本没生效，g_W/g_H 停在 POC_LIVE_W 的默认 1280×720。
       *   Android 的 screenrecord 恰好就是 1280×720 ⇒ 一直没暴露；**iOS ReplayKit 给 888×1920**
       *   ⇒ 按 1280×720 分配纹理 + 上传 ⇒ 画面错位（实测：不改就是花屏/裁切）。
       *
       * 【为什么不改成"先解一帧再 init GL"】live 流是异步队列，init 时刻未必有帧 ⇒ 要么阻塞启动、
       *   要么在首帧就地重建。就地重建只多一次 glTexImage2D×3，且**只在尺寸不符时执行**
       *   ⇒ Android 那条路（1280×720 一致）零影响，不改变已验证行为。 */
      if (frm->width > 0 && frm->height > 0 && (frm->width != g_W || frm->height != g_H)) {
        int old_w = g_W, old_h = g_H;
        g_W = frm->width;
        g_H = frm->height;
        glBindTexture(GL_TEXTURE_2D, g_canvas);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, g_W, g_H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
        glBindTexture(GL_TEXTURE_2D, g_ty);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, g_W, g_H, 0, GL_RED, GL_UNSIGNED_BYTE, NULL);
        glBindTexture(GL_TEXTURE_2D, g_tuv);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RG8, g_W / 2, g_H / 2, 0, GL_RG, GL_UNSIGNED_BYTE, NULL);
        if (g_sws) { sws_freeContext(g_sws); g_sws = NULL; }
        if (g_nv12) av_frame_unref(g_nv12);
        fprintf(stderr, "实时：首帧尺寸 %dx%d ≠ 预设 %dx%d ⇒ 重建纹理\n", g_W, g_H, old_w, old_h);
      }
    }
    AVFrame *src = frm;
    if (frm->format == AV_PIX_FMT_VIDEOTOOLBOX) {
      av_frame_unref(g_nv12);
      double t0 = now_ms();
      int trc = av_hwframe_transfer_data(g_nv12, frm, 0);
      if (g_n_tr < MAX_SAMPLES) g_tr[g_n_tr++] = now_ms() - t0;
      if (trc < 0) { av_frame_unref(frm); return 0; }
      src = g_nv12;
    }
    if (src->format != AV_PIX_FMT_NV12) {
      if (!g_sws) g_sws = sws_getContext(g_W, g_H, src->format, g_W, g_H, AV_PIX_FMT_NV12, SWS_POINT, NULL, NULL, NULL);
      g_nv12->format = AV_PIX_FMT_NV12; g_nv12->width = g_W; g_nv12->height = g_H;
      if (!g_nv12->data[0]) av_frame_get_buffer(g_nv12, 32);
      sws_scale(g_sws, (const uint8_t *const *)src->data, src->linesize, 0, g_H, g_nv12->data, g_nv12->linesize);
      src = g_nv12;
    }

    /* 取证钩子：POC_DUMP_FRAME=<path.ppm> 把**解码后（GL 之前）**的一帧落成 PPM（决策 #1259）。
       用来把"解码出来的帧就花了"和"上传/着色器解释错了"这两件事分开——否则只能猜。 */
    {
      static int dumped = 0, want = -2;
      if (want == -2) { const char *a = getenv("POC_DUMP_FRAME_AT"); want = a ? atoi(a) : 0; }
      const char *dp = (dumped || (long)want != g_frames) ? NULL : getenv("POC_DUMP_FRAME");
      if (dp) {
        struct SwsContext *c2 = sws_getContext(g_W, g_H, AV_PIX_FMT_NV12, g_W, g_H, AV_PIX_FMT_RGB24,
                                              SWS_POINT, NULL, NULL, NULL);
        if (c2) {
          int stride = g_W * 3;
          unsigned char *rgb = malloc((size_t)stride * g_H);
          uint8_t *dstp[4] = {rgb, NULL, NULL, NULL};
          int dsts[4] = {stride, 0, 0, 0};
          sws_scale(c2, (const uint8_t *const *)src->data, src->linesize, 0, g_H, dstp, dsts);
          FILE *f = fopen(dp, "wb");
          if (f) { fprintf(f, "P6\n%d %d\n255\n", g_W, g_H); fwrite(rgb, 1, (size_t)stride * g_H, f); fclose(f); }
          free(rgb);
          sws_freeContext(c2);
          dumped = 1;
          fprintf(stderr, "已落盘解码帧 %s（%dx%d）\n", dp, g_W, g_H);
        }
      }
    }

    // ★实时投屏：**到帧即出**（不按 PTS 等）——g_fmt 在 live 模式是 NULL，绝不能碰
    if (!g_live) {
      AVStream *st = g_fmt->streams[g_vs];
      double show_ms = (src->pts != AV_NOPTS_VALUE && src->pts >= 0)
                           ? (double)src->pts * 1000.0 * av_q2d(st->time_base)
                           : (double)g_frames * g_budget;
      if (g_base_pts < 0) g_base_pts = show_ms;
      if (now_ms() > g_t_start + (show_ms - g_base_pts) + g_budget) g_late++;
    }

    /* ★颜色范围（决策 #1296）：先信任解码帧自带的 `color_range`；
       VT 解出来的硬件帧常常不带这个字段 ⇒ 用"源是不是 iOS 推流(nc)"兜底。
       （Android screenrecord 写 VUI 的 limited，走 else 分支不受影响。） */
    {
      /* ★★判据是"**这一帧由谁解出来的**"，不是"流里标了什么"（决策 #1305 的真因）：
         VideoToolbox 交给我们的 CVPixelBuffer 一律是 **full range**（哪怕码流 VUI 标的是 limited，
         实测：mjpeg→x264 产出 color_range=tv，VT 解出来仍是 full）。
         之前按 limited 转 ⇒ 浅灰(242) 被放大到 >255 **截成纯白**（设置页灰底 34.1% → 0.4%）。
         ⇒ 硬解（g_hw 且未降级）一律 full；软解才信码流自带标记。 */
      int full = 0;
      if (g_hw && !g_dec_sw) {
        full = 1;
      } else {
        full = (src->color_range == AVCOL_RANGE_JPEG) ? 1 : 0;
        if (!full && g_live && g_live_cmd && strncmp(g_live_cmd, "/usr/bin/nc", 11) == 0) full = 1;
      }
      glUseProgram(g_progComp);
      glUniform1f(g_uFullRange, full ? 1.0f : 0.0f);
    }
    double c0 = now_ms();
    glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
    glViewport(0, 0, g_W, g_H);
    glUseProgram(g_progComp);
    glActiveTexture(GL_TEXTURE0);
    upload_plane(g_ty, g_W, g_H, GL_RED, src->data[0], src->linesize[0]);
    glActiveTexture(GL_TEXTURE1);
    upload_plane(g_tuv, g_W / 2, g_H / 2, GL_RG, src->data[1], src->linesize[1]);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    double c1 = now_ms();

    NSSize bs = [g_view convertRectToBacking:[g_view bounds]].size;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, (GLsizei)bs.width, (GLsizei)bs.height);
    glUseProgram(g_progBlit);
    // ★等比适配（contain）：把画面装进视口，两轴取同一缩放 ⇒ 只可能留黑边，绝不变形。
    //   正常路径下 HTML 已把视图收成设备比例（uFit≈1，无黑边、像素 1:1）；
    //   这里兜的是"两边漂移"的时刻（窗口刚 resize / 首帧尺寸未到 / 未知输入源占满）。
    float va = (bs.width > 1 && bs.height > 1) ? (float)(bs.width / bs.height) : 1.0f;
    float ta = (g_W > 0 && g_H > 0) ? (float)g_W / (float)g_H : va;
    float fx = 1.0f, fy = 1.0f;
    if (ta > va) fy = va / ta;   // 画面更宽 ⇒ 上下留边
    else fx = ta / va;           // 画面更高 ⇒ 左右留边
    glUniform2f(g_uFit, fx, fy);
    // ★只在**状态迁移**时打印（不是每帧、也不是"只打前 N 次"）：
    //   迁移点很稀疏（窗口 resize / 首帧尺寸到达 / HTML 首次同步视图），所以不会刷屏；
    //   而"只打前 N 次"会在启动阶段就把额度用光，恰好看不到"兜底 → 恢复 1:1"这个关键转折。
    {
      static int last_state = -1;   /* -1 未知 · 0 等比匹配 · 1 走兜底（有黑边） */
      int st = (fabsf(fx - 1.0f) > 0.004f || fabsf(fy - 1.0f) > 0.004f) ? 1 : 0;
      if (st != last_state) {
        if (st)
          fprintf(stderr, "blit 等比兜底：视口 %.3f 与画面 %.3f 不一致 ⇒ 占视口 %.0f%%x%.0f%%（有黑边，不变形）\n",
                  va, ta, fx * 100.0, fy * 100.0);
        else
          fprintf(stderr, "blit 等比：视口 %.3f == 画面 %.3f ⇒ 无黑边，像素 1:1\n", va, ta);
        last_state = st;
      }
    }
    glActiveTexture(GL_TEXTURE2); glBindTexture(GL_TEXTURE_2D, g_canvas);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    double b1 = now_ms();

    [g_ctx flushBuffer];
    double p1 = now_ms();

    // ★只在预热结束后记账，且墙钟从**第一帧被记账的时刻**起算（否则 fps 会虚高）
    if (p1 >= g_t_start) {
      if (g_wall0 == 0) g_wall0 = p1;
      g_frames++;
      if (g_n_rc < MAX_SAMPLES) g_rc[g_n_rc++] = c1 - c0;
      if (g_n_pr < MAX_SAMPLES) g_pr[g_n_pr++] = p1 - b1;
      if (g_last_out > 0 && g_n_iv < MAX_SAMPLES) g_iv[g_n_iv++] = p1 - g_last_out;
      // 端到端（我们这侧）：该帧首字节到达 → flushBuffer 完成
      if (g_live && g_last_t_first > 0 && g_n_lat < MAX_SAMPLES) g_lat[g_n_lat++] = p1 - g_last_t_first;
      g_rec = 1;
      if (g_last_out > 0) hist_add(&h_iv, p1 - g_last_out);
      hist_add(&h_cmp, c1 - c0);
      hist_add(&h_pres, p1 - b1);
      if (g_live && g_last_t_first > 0) hist_add(&h_lat, p1 - g_last_t_first);
      g_last_out = p1;
    }
    av_frame_unref(frm);
    }   /* have_frame 作用域 */
    return 0;
  }
}

int poc_tick(void) {
  @try { return poc_tick_impl(); }
  @catch (NSException *e) {
    fprintf(stderr, "poc_tick NSException: %s — %s\n", [[e name] UTF8String], [[e reason] UTF8String]);
    return 4;
  }
}

/** 码率（按入队 AU 的字节数估）—— 与面板口径一致 */
static double mbps_of(double wall_ms) {
  return wall_ms > 0 ? (double)g_live_bytes * 8.0 / (wall_ms / 1000.0) / 1e6 : -1;
}

void poc_report(const char *path) {
  @autoreleasepool {
    /* ★★跨度可能是 **0**（决策 #1278）：`g_last_out` 与 `g_wall0` 相等 = **本次只出了一帧**
       （设备刚释放采集权、断流边缘最常见）。原来这里兜底成 1，随后 `g_frames/(wall/1000)`
       直接用 0 做除数 ⇒ 报告里写出 `"measured_fps": inf` —— 而 **JSON 没有 inf**，
       `JSON.parse` 当场抛 SyntaxError ⇒ `check:studio-live` 崩在解析上，
       而不是给出"只出了 1 帧"这个**可读结论**。判据崩掉比判据变红更糟：它什么都说明不了。
       ⇒ 跨度 <=0 一律按"未知"处理（-1），与 mbps/cpu 那几处口径一致。 */
    double wall = (g_last_out > 0 && g_wall0 > 0) ? (g_last_out - g_wall0) : 0;
    double fps = wall > 0 ? (double)g_frames / (wall / 1000.0) : -1;
    struct rusage ru1;
    getrusage(RUSAGE_SELF, &ru1);
    double cpu = (ru1.ru_utime.tv_sec - g_ru0.ru_utime.tv_sec) + (ru1.ru_utime.tv_usec - g_ru0.ru_utime.tv_usec) / 1e6 +
                 (ru1.ru_stime.tv_sec - g_ru0.ru_stime.tv_sec) + (ru1.ru_stime.tv_usec - g_ru0.ru_stime.tv_usec) / 1e6;
    qsort(g_iv, g_n_iv, sizeof(double), cmp_double);
    qsort(g_rc, g_n_rc, sizeof(double), cmp_double);
    qsort(g_pr, g_n_pr, sizeof(double), cmp_double);
    qsort(g_tr, g_n_tr, sizeof(double), cmp_double);
    qsort(g_lat, g_n_lat, sizeof(double), cmp_double);
    qsort(g_qw, g_n_qw, sizeof(double), cmp_double);
    qsort(g_dec, g_n_dec, sizeof(double), cmp_double);

    char json[2560];
    snprintf(json, sizeof(json),
             "{\n  \"mode\": \"tauri-window\",\n  \"video\": \"%s\",\n  \"size\": \"%dx%d\",\n"
             "  \"hwdec\": \"%s\",\n  \"webview_found\": %s,\n  \"webview_transparent\": %s,\n"
             "  \"frames_presented\": %ld,\n  \"measured_fps\": %.2f,\n"
             "  \"interval_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"p99\": %.2f, \"max\": %.2f},\n"
             "  \"compose_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
             "  \"present_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
             "  \"hw_transfer_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"max\": %.3f},\n"
             "  \"latency_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"p99\": %.2f, \"max\": %.2f},\n"
             "  \"queue_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"max\": %.2f},\n"
             "  \"decode_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"max\": %.2f},\n"
             "  \"ticks\": %ld, \"empty_ticks\": %ld,\n"
             "  \"aus\": %ld, \"mbps\": %.2f,\n"
             "  \"late_frames\": %ld,\n  \"late_pct\": %.2f,\n"
             "  \"cpu\": {\"self_seconds\": %.2f, \"wall_seconds\": %.2f, \"single_core_pct\": %.1f}\n}\n",
             g_live ? "(live pipe)" : video_path(), g_W, g_H, g_hw ? "videotoolbox" : "software",
             (g_probe_bits & 1) ? "true" : "false", (g_probe_bits & 2) ? "true" : "false",
             g_frames, fps,
             pct(g_iv, g_n_iv, 0.50), pct(g_iv, g_n_iv, 0.95), pct(g_iv, g_n_iv, 0.99), g_n_iv ? g_iv[g_n_iv - 1] : -1,
             pct(g_rc, g_n_rc, 0.50), pct(g_rc, g_n_rc, 0.95), pct(g_rc, g_n_rc, 0.99), g_n_rc ? g_rc[g_n_rc - 1] : -1,
             pct(g_pr, g_n_pr, 0.50), pct(g_pr, g_n_pr, 0.95), pct(g_pr, g_n_pr, 0.99), g_n_pr ? g_pr[g_n_pr - 1] : -1,
             pct(g_tr, g_n_tr, 0.50), pct(g_tr, g_n_tr, 0.95), g_n_tr ? g_tr[g_n_tr - 1] : -1,
             pct(g_lat, g_n_lat, 0.50), pct(g_lat, g_n_lat, 0.95), pct(g_lat, g_n_lat, 0.99), g_n_lat ? g_lat[g_n_lat - 1] : -1,
             pct(g_qw, g_n_qw, 0.50), pct(g_qw, g_n_qw, 0.95), g_n_qw ? g_qw[g_n_qw - 1] : -1,
             pct(g_dec, g_n_dec, 0.50), pct(g_dec, g_n_dec, 0.95), g_n_dec ? g_dec[g_n_dec - 1] : -1,
             g_ticks, g_empty, g_live_aus, mbps_of(wall),
             g_late, g_frames ? 100.0 * (double)g_late / (double)g_frames : -1,
             cpu, wall / 1000.0, wall > 0 ? cpu / (wall / 1000.0) * 100.0 : -1);
    fputs(json, stdout);
    fflush(stdout);
    if (path) { FILE *f = fopen(path, "w"); if (f) { fputs(json, f); fclose(f); } }
  }
}

// ── Dock 图标以**当前 bundle 的 icon.icns** 为准（决策 #1230）─────────────────────
// 【为什么需要】Tauri 在 `RunEvent::Ready` 时会把 `tauri.conf.json` 里那张 PNG **嵌进二进制**，
//   并调用 `NSApplication.setApplicationIconImage` 覆盖应用图标。两个通道（正式/预览）**共用同一个
//   二进制** ⇒ 不覆盖的话，预览版的 Dock 图标会变成正式版那张（实测：先绿几秒后变紫）。
//   这里改成读**正在运行的这个 .app** 自己的 `Contents/Resources/icon.icns`——
//   每个通道的包里放的是各自的 icns，于是 Dock 与 Finder 永远一致。
// 【为什么不直接删掉 tauri.conf 的 bundle.icon】那张图标同时被 Linux/Windows 用作窗口图标，
//   删了是把问题换个地方藏；显式覆盖更清楚，也不影响将来的跨平台打包。
void poc_use_bundle_icon(void) {
  @autoreleasepool {
    NSBundle *b = [NSBundle mainBundle];
    NSString *p = [b pathForResource:@"icon" ofType:@"icns"];
    if (p == nil) {
      fprintf(stderr, "[studio] 包内没有 icon.icns，Dock 图标保持 Tauri 嵌入的那张\n");
      return;
    }
    // ★按**数据**读，不按路径读（2026-10-25 踩到）：`.icns` 走 IconServices 的**文件缓存**，
    //   `initWithContentsOfFile:` 在换图之后可能照样返回**上一版**图标——
    //   包里 icns 明明是新的，Dock 却还是旧的。`initWithData:` 直接读字节，绕过这层缓存。
    NSData *data = [NSData dataWithContentsOfFile:p];
    if (data == nil) {
      fprintf(stderr, "[studio] icon.icns 读不出来：%s\n", p.UTF8String);
      return;
    }
    NSImage *img = [[NSImage alloc] initWithData:data];
    if (img == nil) {
      fprintf(stderr, "[studio] icon.icns 解码失败：%s\n", p.UTF8String);
      return;
    }
    [NSApplication sharedApplication].applicationIconImage = img;
    fprintf(stderr, "[studio] Dock 图标已切到包内 icon.icns\n");
  }
}

// ── 写系统剪贴板（决策 #1234）────────────────────────────────────────────────
// 右键菜单的「复制相对路径」用它。不用 navigator.clipboard：WKWebView 里需要用户手势 + 焦点，
// 菜单项点击后焦点在菜单节点上，容易静默失败。
void poc_copy_text(const char *s) {
  @autoreleasepool {
    if (s == NULL) return;
    NSString *str = [NSString stringWithUTF8String:s];
    if (str == nil) return;
    NSPasteboard *pb = [NSPasteboard generalPasteboard];
    [pb clearContents];
    [pb setString:str forType:NSPasteboardTypeString];
  }
}
