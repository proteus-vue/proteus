// fbo_harness.c —— Proteus Studio PoC A：H.264 解码 → 我们的 GL FBO（决策 #1167）
//
// 【测什么】把设备投屏那样的 H.264 720p30 流解码后，**合成进我们自己的 FBO**
//   （YUV→RGB 在着色器里做，模拟 Studio 的检查器叠加层），并按源节奏出帧。
//   这正是 `device.native`（四宿主唯一 ✅）的技术前提；**不是**让播放器自己开窗。
//
// 【为什么不是 libmpv】原计划用 libmpv，实测在本机装不上（github 不通 + 独立前缀不吃瓶装包
//   + 瓶装解包被沙箱挡，三重叠加）。而且设备投屏要的是**解码器**不是播放器——
//   ffmpeg + VideoToolbox 是更贴的选型。见 docs/proteus-studio-poc/README.md。
//
// 【判据（README 先注册，这里只量）】
//   P1 帧间隔 p99 ≤ 1.5×帧预算（33.3ms ⇒ 50ms）· P2 渲染段 p95 ≤ 5ms
//   P3 丢帧 ≤ 1% · P4 CPU ≤ 40% 单核，且 ≤ 纯解码基线的 1.3×
//
// 退出码：0 产出读数 / 2 环境缺失 / 3 参数错误
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/hwcontext.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>

#include <OpenGL/gl3.h>
#include <OpenGL/OpenGL.h>

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

/* ───────────── GL：全屏三角形 + NV12→RGB ───────────── */
static const char *VS =
    "#version 150\n"
    "out vec2 vUV;\n"
    "void main(){\n"
    "  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);\n"
    "  vUV = p;\n"
    "  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);\n"
    "}\n";

/* BT.601 limited range；NV12 的 UV 平面是 (U,V) 交错 ⇒ 取 .r/.g */
static const char *FS =
    "#version 150\n"
    "in vec2 vUV;\n"
    "out vec4 o;\n"
    "uniform sampler2D texY;\n"
    "uniform sampler2D texUV;\n"
    "void main(){\n"
    "  float y = texture(texY, vUV).r;\n"
    "  vec2 uv = texture(texUV, vUV).rg - vec2(0.5);\n"
    "  y = (y - 16.0/255.0) * 1.164383;\n"
    "  float r = y + 1.596027*uv.y;\n"
    "  float g = y - 0.391762*uv.x - 0.812968*uv.y;\n"
    "  float b = y + 2.017232*uv.x;\n"
    "  o = vec4(r, g, b, 1.0);\n"
    "}\n";

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

int main(int argc, char **argv) {
  const char *file = NULL, *json_out = NULL;
  double seconds = 60.0;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--file") && i + 1 < argc) file = argv[++i];
    else if (!strcmp(argv[i], "--seconds") && i + 1 < argc) seconds = atof(argv[++i]);
    else if (!strcmp(argv[i], "--json") && i + 1 < argc) json_out = argv[++i];
    else { fprintf(stderr, "未知参数：%s\n", argv[i]); return 3; }
  }
  if (!file) { fprintf(stderr, "缺 --file <video>\n"); return 3; }

  /* ── 解码器 ── */
  AVFormatContext *fmt = NULL;
  if (avformat_open_input(&fmt, file, NULL, NULL) < 0) { fprintf(stderr, "打开失败\n"); return 3; }
  if (avformat_find_stream_info(fmt, NULL) < 0) { fprintf(stderr, "找不到流信息\n"); return 3; }
  int vs = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
  if (vs < 0) { fprintf(stderr, "没有视频流\n"); return 3; }

  AVStream *st = fmt->streams[vs];
  const AVCodec *dec = avcodec_find_decoder(st->codecpar->codec_id);
  AVCodecContext *cc = avcodec_alloc_context3(dec);
  avcodec_parameters_to_context(cc, st->codecpar);

  /* VideoToolbox 硬件解码；不可用则回落软解 */
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
  if (W <= 0 || H <= 0) { fprintf(stderr, "尺寸无效\n"); return 2; }

  /* ── GL 离屏上下文（无窗口 ⇒ 可进 CI） ── */
  CGLPixelFormatAttribute attrs[] = {
      kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
      kCGLPFAAccelerated,
      kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
      kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
      (CGLPixelFormatAttribute)0,
  };
  CGLPixelFormatObj pixf = NULL;
  GLint npix = 0;
  if (CGLChoosePixelFormat(attrs, &pixf, &npix) != kCGLNoError || !pixf) {
    fprintf(stderr, "CGLChoosePixelFormat 失败\n");
    return 2;
  }
  CGLContextObj glctx = NULL;
  if (CGLCreateContext(pixf, NULL, &glctx) != kCGLNoError || !glctx) {
    fprintf(stderr, "CGLCreateContext 失败（无离屏上下文）\n");
    return 2;
  }
  CGLSetCurrentContext(glctx);

  fprintf(stderr, "GL_RENDERER=%s\nGL_VERSION=%s\n",
          (const char *)glGetString(GL_RENDERER), (const char *)glGetString(GL_VERSION));

  GLuint fbo = 0, tex = 0;
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glGenTextures(1, &tex);
  glBindTexture(GL_TEXTURE_2D, tex);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    fprintf(stderr, "FBO 不完整\n");
    return 2;
  }

  GLuint prog = glCreateProgram();
  glAttachShader(prog, compile(GL_VERTEX_SHADER, VS));
  glAttachShader(prog, compile(GL_FRAGMENT_SHADER, FS));
  glBindFragDataLocation(prog, 0, "o");
  glLinkProgram(prog);
  GLint linked = 0;
  glGetProgramiv(prog, GL_LINK_STATUS, &linked);
  if (!linked) { fprintf(stderr, "程序链接失败\n"); return 2; }
  glUseProgram(prog);
  GLuint vao = 0;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);

  GLuint ty = 0, tuv = 0;
  glGenTextures(1, &ty);
  glBindTexture(GL_TEXTURE_2D, ty);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, W, H, 0, GL_RED, GL_UNSIGNED_BYTE, NULL);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glGenTextures(1, &tuv);
  glBindTexture(GL_TEXTURE_2D, tuv);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RG8, W / 2, H / 2, 0, GL_RG, GL_UNSIGNED_BYTE, NULL);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glUniform1i(glGetUniformLocation(prog, "texY"), 0);
  glUniform1i(glGetUniformLocation(prog, "texUV"), 1);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

  const int skip_upload = getenv("POC_SKIP_UPLOAD") != NULL;

  /* ── 解码 → 渲染 ── */
  struct rusage ru0, ru1;
  getrusage(RUSAGE_SELF, &ru0);

  AVPacket *pkt = av_packet_alloc();
  AVFrame *frm = av_frame_alloc();
  AVFrame *nv12 = av_frame_alloc();
  struct SwsContext *sws = NULL;

  static double iv[MAX_SAMPLES], rd[MAX_SAMPLES];
  int n_iv = 0, n_rd = 0;
  long frames = 0, late = 0;
  double t0 = now_ms(), t_start = t0 + WARMUP_MS, t_end = t_start + seconds * 1e3;
  double last_out = -1, base_pts = -1;

  bool eof = false;
  while (now_ms() < t_end && !eof) {
    int r = av_read_frame(fmt, pkt);
    if (r < 0) { av_packet_unref(pkt); break; }         /* 单次播放：不循环 */
    if (pkt->stream_index != vs) { av_packet_unref(pkt); continue; }
    if (avcodec_send_packet(cc, pkt) < 0) { av_packet_unref(pkt); continue; }
    av_packet_unref(pkt);

    while (avcodec_receive_frame(cc, frm) == 0) {
      /* 取 NV12（硬件帧先回拷；软解帧用 sws 转） */
      AVFrame *src = frm;
      if (frm->format == AV_PIX_FMT_VIDEOTOOLBOX) {
        av_frame_unref(nv12);
        if (av_hwframe_transfer_data(nv12, frm, 0) < 0) { av_frame_unref(frm); continue; }
        src = nv12;
      }
      if (src->format != AV_PIX_FMT_NV12) {
        if (!sws) sws = sws_getContext(W, H, src->format, W, H, AV_PIX_FMT_NV12, SWS_POINT, NULL, NULL, NULL);
        nv12->format = AV_PIX_FMT_NV12;
        nv12->width = W; nv12->height = H;
        if (!nv12->data[0]) av_frame_get_buffer(nv12, 32);
        sws_scale(sws, (const uint8_t *const *)src->data, src->linesize, 0, H, nv12->data, nv12->linesize);
        src = nv12;
      }

      /* 按源节奏出帧（落后就丢，计 drop —— 与播放器的 vdrop 同语义） */
      // 按源节奏出帧：**早到就等（不丢帧）**；迟到超一帧预算才算 late（= 播放器 vdrop 语义）
      // ★VideoToolbox 回拷帧的 pts 常为 NOPTS（实测：不兜底会算出 due 在过去 ⇒ 一轮跑出 224fps）
      double show_ms;
      if (src->pts != AV_NOPTS_VALUE && src->pts >= 0) {
        show_ms = (double)src->pts * 1000.0 * av_q2d(st->time_base);
      } else {
        show_ms = (double)frames * budget_ms;
      }
      if (base_pts < 0) base_pts = show_ms;
      double due = t_start + (show_ms - base_pts);
      while (now_ms() < due) usleep(500);
      if (now_ms() > due + budget_ms) late++;

      /* 上传两平面 + 画进 FBO */
      double r0 = now_ms();
      glBindFramebuffer(GL_FRAMEBUFFER, fbo);
      glViewport(0, 0, W, H);
      // POC_SKIP_UPLOAD=1：诊断用——跳过两平面上传，用来把"上传"与"绘制"的开销拆开
      if (!skip_upload) {
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, ty);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, W, H, GL_RED, GL_UNSIGNED_BYTE, src->data[0]);
        glActiveTexture(GL_TEXTURE1);
        glBindTexture(GL_TEXTURE_2D, tuv);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, W / 2, H / 2, GL_RG, GL_UNSIGNED_BYTE, src->data[1]);
      }
      glDrawArrays(GL_TRIANGLES, 0, 3);
      glFinish();
      double r1 = now_ms();

      frames++;
      if (r1 >= t_start) {
        if (n_rd < MAX_SAMPLES) rd[n_rd++] = r1 - r0;
        if (last_out > 0 && n_iv < MAX_SAMPLES) iv[n_iv++] = r1 - last_out;
        last_out = r1;
      }
      av_frame_unref(frm);
    }
    if (r < 0) eof = true;
  }

  double wall = now_ms() - t_start;
  getrusage(RUSAGE_SELF, &ru1);
  double cpu = (ru1.ru_utime.tv_sec - ru0.ru_utime.tv_sec) + (ru1.ru_utime.tv_usec - ru0.ru_utime.tv_usec) / 1e6 +
               (ru1.ru_stime.tv_sec - ru0.ru_stime.tv_sec) + (ru1.ru_stime.tv_usec - ru0.ru_stime.tv_usec) / 1e6;

  qsort(iv, n_iv, sizeof(double), cmp_double);
  qsort(rd, n_rd, sizeof(double), cmp_double);
  double fps = av_q2d(st->avg_frame_rate);
  if (fps <= 0) fps = 30.0;

  char json[2048];
  snprintf(json, sizeof(json),
           "{\n"
           "  \"file\": \"%s\",\n  \"size\": \"%dx%d\",\n  \"hwdec\": \"%s\",\n"
           "  \"seconds\": %.1f,\n  \"frames_rendered\": %ld,\n  \"measured_fps\": %.2f,\n"
           "  \"interval_ms\": {\"p50\": %.2f, \"p95\": %.2f, \"p99\": %.2f, \"max\": %.2f},\n"
           "  \"render_ms\": {\"p50\": %.3f, \"p95\": %.3f, \"p99\": %.3f, \"max\": %.3f},\n"
           "  \"frame_budget_ms\": %.2f,\n  \"late_frames\": %ld,\n  \"late_pct\": %.2f,\n"
           "  \"cpu\": {\"self_seconds\": %.2f, \"wall_seconds\": %.2f, \"single_core_pct\": %.1f}\n"
           "}\n",
           file, W, H, hw ? "videotoolbox" : "software", seconds, frames, frames / (wall / 1000.0),
           pct(iv, n_iv, 0.50), pct(iv, n_iv, 0.95), pct(iv, n_iv, 0.99), n_iv ? iv[n_iv - 1] : -1,
           pct(rd, n_rd, 0.50), pct(rd, n_rd, 0.95), pct(rd, n_rd, 0.99), n_rd ? rd[n_rd - 1] : -1,
           1000.0 / fps, late, frames ? 100.0 * (double)late / (double)frames : -1,
           cpu, wall / 1000.0, wall > 0 ? cpu / (wall / 1000.0) * 100.0 : -1);

  fputs(json, stdout);
  if (json_out) {
    FILE *f = fopen(json_out, "w");
    if (f) { fputs(json, f); fclose(f); }
  }

  av_frame_free(&frm); av_frame_free(&nv12); av_packet_free(&pkt);
  if (sws) sws_freeContext(sws);
  avcodec_free_context(&cc);
  if (hwdev) av_buffer_unref(&hwdev);
  avformat_close_input(&fmt);
  CGLSetCurrentContext(NULL);
  CGLDestroyContext(glctx);
  CGLDestroyPixelFormat(pixf);
  return 0;
}
