// window_harness.m —— Proteus Studio PoC B1：同一管线放进**真实窗口**，拆开量「合成」与「上屏(swap)」（决策 #1168）
//
// 【与 PoC A 的关系】A 证明了「解码 → 我们自己的 FBO」成立（30fps / 0 丢帧 / 单核 5.2%），
//   但全程无窗口 ⇒ **swap（上屏）与 vsync 等待完全没量到**。Studio 的 `device.native`
//   最终要在一个真窗口里被用户看到，这一段不能靠推测。
//
// 【本文件测三段，分开记账】
//   ① render：解码帧 → NV12 上传 → 画进**离屏 FBO**（与 A 同一条路径）
//   ② composite：FBO → 窗口 backbuffer 的全屏 blit（模拟"把设备画面合成到 Studio 画布"）
//   ③ present：`[NSOpenGLContext flushBuffer]`——**含 vsync 等待**，这才是上屏的真实代价
//   ★把 ③ 混进 ① 是最常见的测量谎言（视频"渲染 16ms"其实 15ms 在等 vsync）。
//
// 【为什么不用 Tauri 壳】Tauri 2 的窗口是 WKWebView；本文件先证明**原生 NSView 承载**这一段
//   的代价。Tauri 里只是把这层 NSView 挂进它的 contentView——挂载可行性是独立风险（B2），
//   性能面与这里同源。
//
// 用法：window_harness --file <video> --seconds 30 [--json out.json]
// 退出码：0 出读数 / 2 环境缺失 / 3 参数错
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
    "#version 150\n"
    "out vec2 vUV;\n"
    "void main(){\n"
    "  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);\n"
    "  vUV = p;\n"
    "  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);\n"
    "}\n";

/* 同一段 BT.601 NV12→RGB（合成阶段用） */
static const char *FS_YUV =
    "#version 150\n"
    "in vec2 vUV;\n"
    "out vec4 o;\n"
    "uniform sampler2D texY;\n"
    "uniform sampler2D texUV;\n"
    "void main(){\n"
    "  float y = texture(texY, vUV).r;\n"
    "  vec2 uv = texture(texUV, vUV).rg - vec2(0.5);\n"
    "  y = (y - 16.0/255.0) * 1.164383;\n"
    "  o = vec4(y + 1.596027*uv.y, y - 0.391762*uv.x - 0.812968*uv.y, y + 2.017232*uv.x, 1.0);\n"
    "}\n";

/* FBO → 屏幕：直接采样 RGBA（= Studio 把画布贴到窗口的那一步） */
static const char *FS_BLIT =
    "#version 150\n"
    "in vec2 vUV;\n"
    "out vec4 o;\n"
    "uniform sampler2D texCanvas;\n"
    "void main(){ o = texture(texCanvas, vUV); }\n";

static GLuint compile(GLenum type, const char *src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, NULL);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[1024];
    glGetShaderInfoLog(s, sizeof log, NULL, log);
    fprintf(stderr, "shader 编译失败：%s\n", log);
    exit(2);
  }
  return s;
}
static GLuint link_prog(const char *vs, const char *fs) {
  GLuint p = glCreateProgram();
  glAttachShader(p, compile(GL_VERTEX_SHADER, vs));
  glAttachShader(p, compile(GL_FRAGMENT_SHADER, fs));
  glBindFragDataLocation(p, 0, "o");
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { fprintf(stderr, "程序链接失败\n"); exit(2); }
  return p;
}

@interface HarnessView : NSOpenGLView
@end
@implementation HarnessView
- (BOOL)isOpaque { return YES; }
@end

int main(int argc, char **argv) {
  @autoreleasepool {
    const char *file = NULL, *json_out = NULL;
    double seconds = 30.0;
    for (int i = 1; i < argc; i++) {
      if (!strcmp(argv[i], "--file") && i + 1 < argc) file = argv[++i];
      else if (!strcmp(argv[i], "--seconds") && i + 1 < argc) seconds = atof(argv[++i]);
      else if (!strcmp(argv[i], "--json") && i + 1 < argc) json_out = argv[++i];
      else { fprintf(stderr, "未知参数：%s\n", argv[i]); return 3; }
    }
    if (!file) { fprintf(stderr, "缺 --file <video>\n"); return 3; }

    /* ── 解码器（与 PoC A 同一条路径） ── */
    AVFormatContext *fmt = NULL;
    if (avformat_open_input(&fmt, file, NULL, NULL) < 0) { fprintf(stderr, "打开失败\n"); return 3; }
    if (avformat_find_stream_info(fmt, NULL) < 0) return 3;
    int vs = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    if (vs < 0) return 3;
    AVStream *st = fmt->streams[vs];
    const AVCodec *dec = avcodec_find_decoder(st->codecpar->codec_id);
    AVCodecContext *cc = avcodec_alloc_context3(dec);
    avcodec_parameters_to_context(cc, st->codecpar);
    AVBufferRef *hwdev = NULL;
    bool hw = false;
    if (av_hwdevice_ctx_create(&hwdev, AV_HWDEVICE_TYPE_VIDEOTOOLBOX, NULL, NULL, 0) >= 0) {
      cc->hw_device_ctx = av_buffer_ref(hwdev);
      hw = true;
    }
    if (avcodec_open2(cc, dec, NULL) < 0) { fprintf(stderr, "解码器打开失败\n"); return 2; }
    const int W = cc->width, H = cc->height;
    double fps_src = av_q2d(st->avg_frame_rate);
    if (!(fps_src > 0)) fps_src = 30.0;
    const double budget_ms = 1000.0 / fps_src;

    /* ── 窗口 + GL 上下文（双缓冲 ⇒ flushBuffer 会等 vsync，这正是要量的东西） ── */
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    NSOpenGLPixelFormatAttribute pfAttrs[] = {
        NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFAAccelerated, NSOpenGLPFADoubleBuffer,
        NSOpenGLPFAColorSize, 24, NSOpenGLPFAAlphaSize, 8,
        0,
    };
    NSOpenGLPixelFormat *pf = [[NSOpenGLPixelFormat alloc] initWithAttributes:pfAttrs];
    if (!pf) { fprintf(stderr, "像素格式创建失败\n"); return 2; }

    NSRect rect = NSMakeRect(80, 80, W, H);
    NSWindow *win = [[NSWindow alloc] initWithContentRect:rect
                                                styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                                                  backing:NSBackingStoreBuffered
                                                    defer:NO];
    [win setTitle:@"Proteus Studio PoC B1 — composite + present"];
    HarnessView *view = [[HarnessView alloc] initWithFrame:rect pixelFormat:pf];
    [win setContentView:view];
    [win makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:NO];

    NSOpenGLContext *ctx = [view openGLContext];
    [ctx makeCurrentContext];
    GLint swapInterval = 1;                    /* vsync on：量"真实上屏"而不是"提交即返回" */
    [ctx setValues:&swapInterval forParameter:NSOpenGLContextParameterSwapInterval];
    [ctx update];

    fprintf(stderr, "GL_RENDERER=%s\nGL_VERSION=%s\n",
            (const char *)glGetString(GL_RENDERER), (const char *)glGetString(GL_VERSION));

    /* ── 画布 FBO + 两个程序 ── */
    GLuint fbo = 0, canvas = 0;
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glGenTextures(1, &canvas);
    glBindTexture(GL_TEXTURE_2D, canvas);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, canvas, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
      fprintf(stderr, "FBO 不完整\n"); return 2;
    }

    GLuint progComp = link_prog(VS, FS_YUV);
    GLuint progBlit = link_prog(VS, FS_BLIT);
    GLuint vao = 0;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);

    GLuint ty = 0, tuv = 0;
    glGenTextures(1, &ty);
    glBindTexture(GL_TEXTURE_2D, ty);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, W, H, 0, GL_RED, GL_UNSIGNED_BYTE, NULL);
    glGenTextures(1, &tuv);
    glBindTexture(GL_TEXTURE_2D, tuv);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RG8, W / 2, H / 2, 0, GL_RG, GL_UNSIGNED_BYTE, NULL);
    GLuint planes[2] = {ty, tuv};
    for (int pi = 0; pi < 2; pi++) {
      glBindTexture(GL_TEXTURE_2D, planes[pi]);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    }
    glUseProgram(progComp);
    glUniform1i(glGetUniformLocation(progComp, "texY"), 0);
    glUniform1i(glGetUniformLocation(progComp, "texUV"), 1);
    glUseProgram(progBlit);
    glUniform1i(glGetUniformLocation(progBlit, "texCanvas"), 2);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

    /* ── 主循环 ── */
    struct rusage ru0, ru1;
    getrusage(RUSAGE_SELF, &ru0);
    AVPacket *pkt = av_packet_alloc();
    AVFrame *frm = av_frame_alloc();
    AVFrame *nv12 = av_frame_alloc();
    struct SwsContext *sws = NULL;

    static double iv[MAX_SAMPLES], rc[MAX_SAMPLES], pr[MAX_SAMPLES];
    int n_iv = 0, n_rc = 0, n_pr = 0;
    long frames = 0, late = 0;
    double t_start = now_ms() + WARMUP_MS, t_end = t_start + seconds * 1e3;
    double last_out = -1, base_pts = -1;

    while (now_ms() < t_end) {
      /* 泵事件：不跑 [NSApp run]，但窗口仍响应/可关闭 */
      NSEvent *e;
      while ((e = [NSApp nextEventMatchingMask:NSEventMaskAny
                                     untilDate:[NSDate distantPast]
                                        inMode:NSDefaultRunLoopMode
                                       dequeue:YES])) {
        [NSApp sendEvent:e];
      }

      int r = av_read_frame(fmt, pkt);
      if (r < 0) { av_packet_unref(pkt); break; }
      if (pkt->stream_index != vs) { av_packet_unref(pkt); continue; }
      if (avcodec_send_packet(cc, pkt) < 0) { av_packet_unref(pkt); continue; }
      av_packet_unref(pkt);

      while (avcodec_receive_frame(cc, frm) == 0) {
        AVFrame *src = frm;
        if (frm->format == AV_PIX_FMT_VIDEOTOOLBOX) {
          av_frame_unref(nv12);
          if (av_hwframe_transfer_data(nv12, frm, 0) < 0) { av_frame_unref(frm); continue; }
          src = nv12;
        }
        if (src->format != AV_PIX_FMT_NV12) {
          if (!sws) sws = sws_getContext(W, H, src->format, W, H, AV_PIX_FMT_NV12, SWS_POINT, NULL, NULL, NULL);
          nv12->format = AV_PIX_FMT_NV12; nv12->width = W; nv12->height = H;
          if (!nv12->data[0]) av_frame_get_buffer(nv12, 32);
          sws_scale(sws, (const uint8_t *const *)src->data, src->linesize, 0, H, nv12->data, nv12->linesize);
          src = nv12;
        }

        double show_ms;
        if (src->pts != AV_NOPTS_VALUE && src->pts >= 0) show_ms = (double)src->pts * 1000.0 * av_q2d(st->time_base);
        else show_ms = (double)frames * budget_ms;
        if (base_pts < 0) base_pts = show_ms;
        double due = t_start + (show_ms - base_pts);
        while (now_ms() < due) usleep(500);
        if (now_ms() > due + budget_ms) late++;

        /* ① 合成：解码帧 → 画布 FBO */
        double c0 = now_ms();
        glBindFramebuffer(GL_FRAMEBUFFER, fbo);
        glViewport(0, 0, W, H);
        glUseProgram(progComp);
        glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, ty);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, W, H, GL_RED, GL_UNSIGNED_BYTE, src->data[0]);
        glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, tuv);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, W / 2, H / 2, GL_RG, GL_UNSIGNED_BYTE, src->data[1]);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        double c1 = now_ms();

        /* ② 上屏：画布 → backbuffer（模拟 Studio 把画布贴进窗口） */
        NSSize bs = [view convertRectToBacking:[view bounds]].size;
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, (GLsizei)bs.width, (GLsizei)bs.height);
        glUseProgram(progBlit);
        glActiveTexture(GL_TEXTURE2); glBindTexture(GL_TEXTURE_2D, canvas);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        double b1 = now_ms();

        /* ③ swap：含 vsync 等待 —— 单独记账，别混进渲染 */
        [ctx flushBuffer];
        double p1 = now_ms();

        frames++;
        if (p1 >= t_start) {
          if (n_rc < MAX_SAMPLES) rc[n_rc++] = c1 - c0;
          if (n_pr < MAX_SAMPLES) pr[n_pr++] = p1 - b1;
          if (last_out > 0 && n_iv < MAX_SAMPLES) iv[n_iv++] = p1 - last_out;
          last_out = p1;
        }
        av_frame_unref(frm);
      }
    }

    double wall = now_ms() - t_start;
    getrusage(RUSAGE_SELF, &ru1);
    double cpu = (ru1.ru_utime.tv_sec - ru0.ru_utime.tv_sec) + (ru1.ru_utime.tv_usec - ru0.ru_utime.tv_usec) / 1e6 +
                 (ru1.ru_stime.tv_sec - ru0.ru_stime.tv_sec) + (ru1.ru_stime.tv_usec - ru0.ru_stime.tv_usec) / 1e6;
    qsort(iv, n_iv, sizeof(double), cmp_double);
    qsort(rc, n_rc, sizeof(double), cmp_double);
    qsort(pr, n_pr, sizeof(double), cmp_double);

    char json[2560];
    snprintf(json, sizeof(json),
             "{\n"
             "  \"mode\": \"window\",\n  \"file\": \"%s\",\n  \"size\": \"%dx%d\",\n  \"hwdec\": \"%s\",\n"
             "  \"seconds\": %.1f,\n  \"frames_presented\": %ld,\n  \"measured_fps\": %.2f,\n"
             "  \"interval_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"p99\": %.2f, \"max\": %.2f},\n"
             "  \"compose_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
             "  \"present_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
             "  \"frame_budget_ms\": %.2f,\n  \"late_frames\": %ld,\n  \"late_pct\": %.2f,\n"
             "  \"cpu\": {\"self_seconds\": %.2f, \"wall_seconds\": %.2f, \"single_core_pct\": %.1f}\n"
             "}\n",
             file, W, H, hw ? "videotoolbox" : "software", seconds, frames, frames / (wall / 1000.0),
             pct(iv, n_iv, 0.50), pct(iv, n_iv, 0.95), pct(iv, n_iv, 0.99), n_iv ? iv[n_iv - 1] : -1,
             pct(rc, n_rc, 0.50), pct(rc, n_rc, 0.95), pct(rc, n_rc, 0.99), n_rc ? rc[n_rc - 1] : -1,
             pct(pr, n_pr, 0.50), pct(pr, n_pr, 0.95), pct(pr, n_pr, 0.99), n_pr ? pr[n_pr - 1] : -1,
             budget_ms, late, frames ? 100.0 * (double)late / (double)frames : -1,
             cpu, wall / 1000.0, wall > 0 ? cpu / (wall / 1000.0) * 100.0 : -1);

    fputs(json, stdout);
    if (json_out) { FILE *f = fopen(json_out, "w"); if (f) { fputs(json, f); fclose(f); } }

    av_frame_free(&frm); av_frame_free(&nv12); av_packet_free(&pkt);
    if (sws) sws_freeContext(sws);
    avcodec_free_context(&cc);
    if (hwdev) av_buffer_unref(&hwdev);
    avformat_close_input(&fmt);
    [NSApp terminate:nil];
  }
  return 0;
}
