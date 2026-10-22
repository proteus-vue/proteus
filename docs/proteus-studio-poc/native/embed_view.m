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
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>

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
static const char *FS_YUV =
    "#version 150\nin vec2 vUV;\nout vec4 o;\n"
    "uniform sampler2D texY; uniform sampler2D texUV;\n"
    "void main(){ float y = texture(texY, vUV).r; vec2 uv = texture(texUV, vUV).rg - vec2(0.5);\n"
    "  y = (y - 16.0/255.0) * 1.164383;\n"
    "  o = vec4(y + 1.596027*uv.y, y - 0.391762*uv.x - 0.812968*uv.y, y + 2.017232*uv.x, 1.0); }\n";
static const char *FS_BLIT =
    "#version 150\nin vec2 vUV;\nout vec4 o;\nuniform sampler2D texCanvas;\n"
    "void main(){ o = texture(texCanvas, vUV); }\n";

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

static AVFormatContext *g_fmt = NULL;
static AVCodecContext *g_cc = NULL;
static AVBufferRef *g_hwdev = NULL;
static AVPacket *g_pkt = NULL;
static AVFrame *g_frm = NULL, *g_nv12 = NULL;
static struct SwsContext *g_sws = NULL;
static int g_vs = -1, g_W = 0, g_H = 0;
static double g_fps = 30.0, g_budget = 33.333;
static bool g_hw = false, g_eof = false;

static double g_t_start = 0, g_base_pts = -1, g_last_out = -1, g_wall0 = 0;
static long g_frames = 0, g_late = 0;
static double g_iv[MAX_SAMPLES], g_rc[MAX_SAMPLES], g_pr[MAX_SAMPLES];
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

static int poc_attach_impl(void *parent_nsview) {
  @autoreleasepool {
    // ★tauri 的 `ns_window()` 给的是 **NSWindow**（TaoWindow），不是 NSView。
    //   第一版直接当 NSView 用 ⇒ `-[TaoWindow bounds]: unrecognized selector` ⇒ ObjC 异常穿进 Rust ⇒ abort。
    id obj = (__bridge id)parent_nsview;
    if (!obj) { fprintf(stderr, "attach: parent 为空\n"); return 2; }
    if ([obj isKindOfClass:[NSWindow class]]) g_parent = [(NSWindow *)obj contentView];
    else g_parent = (NSView *)obj;
    if (!g_parent) { fprintf(stderr, "attach: contentView 为空\n"); return 2; }

    /* ① 解码器 */
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

    /* ② 原生 GL 视图垫在 webview 下面 */
    NSOpenGLPixelFormatAttribute attrs[] = {
        NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFAAccelerated, NSOpenGLPFADoubleBuffer,
        NSOpenGLPFAColorSize, 24, NSOpenGLPFAAlphaSize, 8, 0,
    };
    NSOpenGLPixelFormat *pf = [[NSOpenGLPixelFormat alloc] initWithAttributes:attrs];
    if (!pf) { fprintf(stderr, "像素格式失败\n"); return 2; }
    g_view = [[PocGLView alloc] initWithFrame:[g_parent bounds] pixelFormat:pf];
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
    g_progBlit = link_prog(VS, FS_BLIT);
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
    return 0;
  }
}

long poc_frames(void) { return g_frames; }
long poc_late(void) { return g_late; }

double poc_cpu_pct(void) {
  struct rusage ru;
  getrusage(RUSAGE_SELF, &ru);
  double cpu = (ru.ru_utime.tv_sec - g_ru0.ru_utime.tv_sec) + (ru.ru_utime.tv_usec - g_ru0.ru_utime.tv_usec) / 1e6 +
               (ru.ru_stime.tv_sec - g_ru0.ru_stime.tv_sec) + (ru.ru_stime.tv_usec - g_ru0.ru_stime.tv_usec) / 1e6;
  double wall = (now_ms() - g_t_start + WARMUP_MS) / 1000.0;
  return wall > 0 ? cpu / wall * 100.0 : -1;
}

static int poc_tick_impl(void) {
  if (!g_inited || g_eof) return g_eof ? 1 : 2;
  @autoreleasepool {
    [g_ctx makeCurrentContext];

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

    AVFrame *frm = g_frm;
    if (avcodec_receive_frame(g_cc, frm) < 0) return 0;

    AVFrame *src = frm;
    if (frm->format == AV_PIX_FMT_VIDEOTOOLBOX) {
      av_frame_unref(g_nv12);
      if (av_hwframe_transfer_data(g_nv12, frm, 0) < 0) { av_frame_unref(frm); return 0; }
      src = g_nv12;
    }
    if (src->format != AV_PIX_FMT_NV12) {
      if (!g_sws) g_sws = sws_getContext(g_W, g_H, src->format, g_W, g_H, AV_PIX_FMT_NV12, SWS_POINT, NULL, NULL, NULL);
      g_nv12->format = AV_PIX_FMT_NV12; g_nv12->width = g_W; g_nv12->height = g_H;
      if (!g_nv12->data[0]) av_frame_get_buffer(g_nv12, 32);
      sws_scale(g_sws, (const uint8_t *const *)src->data, src->linesize, 0, g_H, g_nv12->data, g_nv12->linesize);
      src = g_nv12;
    }

    AVStream *st = g_fmt->streams[g_vs];
    double show_ms = (src->pts != AV_NOPTS_VALUE && src->pts >= 0)
                         ? (double)src->pts * 1000.0 * av_q2d(st->time_base)
                         : (double)g_frames * g_budget;
    if (g_base_pts < 0) g_base_pts = show_ms;
    if (now_ms() > g_t_start + (show_ms - g_base_pts) + g_budget) g_late++;

    double c0 = now_ms();
    glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
    glViewport(0, 0, g_W, g_H);
    glUseProgram(g_progComp);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, g_ty);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, g_W, g_H, GL_RED, GL_UNSIGNED_BYTE, src->data[0]);
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, g_tuv);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, g_W / 2, g_H / 2, GL_RG, GL_UNSIGNED_BYTE, src->data[1]);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    double c1 = now_ms();

    NSSize bs = [g_view convertRectToBacking:[g_view bounds]].size;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, (GLsizei)bs.width, (GLsizei)bs.height);
    glUseProgram(g_progBlit);
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
      g_last_out = p1;
    }
    av_frame_unref(frm);
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

void poc_report(const char *path) {
  @autoreleasepool {
    double wall = (g_last_out > 0 && g_wall0 > 0) ? (g_last_out - g_wall0) : 1;
    struct rusage ru1;
    getrusage(RUSAGE_SELF, &ru1);
    double cpu = (ru1.ru_utime.tv_sec - g_ru0.ru_utime.tv_sec) + (ru1.ru_utime.tv_usec - g_ru0.ru_utime.tv_usec) / 1e6 +
                 (ru1.ru_stime.tv_sec - g_ru0.ru_stime.tv_sec) + (ru1.ru_stime.tv_usec - g_ru0.ru_stime.tv_usec) / 1e6;
    qsort(g_iv, g_n_iv, sizeof(double), cmp_double);
    qsort(g_rc, g_n_rc, sizeof(double), cmp_double);
    qsort(g_pr, g_n_pr, sizeof(double), cmp_double);

    char json[2560];
    snprintf(json, sizeof(json),
             "{\n  \"mode\": \"tauri-window\",\n  \"video\": \"%s\",\n  \"size\": \"%dx%d\",\n"
             "  \"hwdec\": \"%s\",\n  \"webview_found\": %s,\n  \"webview_transparent\": %s,\n"
             "  \"frames_presented\": %ld,\n  \"measured_fps\": %.2f,\n"
             "  \"interval_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"p99\": %.2f, \"max\": %.2f},\n"
             "  \"compose_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
             "  \"present_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
             "  \"late_frames\": %ld,\n  \"late_pct\": %.2f,\n"
             "  \"cpu\": {\"self_seconds\": %.2f, \"wall_seconds\": %.2f, \"single_core_pct\": %.1f}\n}\n",
             video_path(), g_W, g_H, g_hw ? "videotoolbox" : "software",
             (g_probe_bits & 1) ? "true" : "false", (g_probe_bits & 2) ? "true" : "false",
             g_frames, g_frames / (wall / 1000.0),
             pct(g_iv, g_n_iv, 0.50), pct(g_iv, g_n_iv, 0.95), pct(g_iv, g_n_iv, 0.99), g_n_iv ? g_iv[g_n_iv - 1] : -1,
             pct(g_rc, g_n_rc, 0.50), pct(g_rc, g_n_rc, 0.95), pct(g_rc, g_n_rc, 0.99), g_n_rc ? g_rc[g_n_rc - 1] : -1,
             pct(g_pr, g_n_pr, 0.50), pct(g_pr, g_n_pr, 0.95), pct(g_pr, g_n_pr, 0.99), g_n_pr ? g_pr[g_n_pr - 1] : -1,
             g_late, g_frames ? 100.0 * (double)g_late / (double)g_frames : -1,
             cpu, wall / 1000.0, wall > 0 ? cpu / (wall / 1000.0) * 100.0 : -1);
    fputs(json, stdout);
    fflush(stdout);
    if (path) { FILE *f = fopen(path, "w"); if (f) { fputs(json, f); fclose(f); } }
  }
}
