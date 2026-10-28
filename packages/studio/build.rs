fn main() {
    // ★显式声明原生源文件的依赖（决策 #1235）：不写这几行，**改了 .m 也不会重编**。
    //   2026-10-25 实测：给 embed_view.m 追加 `poc_copy_text()` 后 cargo 仍用旧 .o，
    //   链接期报 `Undefined symbols: _poc_copy_text` —— 而 `cc` 自己发的 seen-if-changed
    //   在 build script 被 cargo 判定为 fresh 时根本没机会发出来。
    //   ⇒ 这三行是"改了原生代码却没生效"的开关，别删。
    println!("cargo:rerun-if-changed=native/embed_view.m");
    println!("cargo:rerun-if-changed=native/live_stream.h");
    println!("cargo:rerun-if-changed=build.rs");

    // 原生视图的唯一真源：packages/studio/native/embed_view.m（决策 #1187 —— 出门时从
    // docs/proteus-studio-poc/native/ 升为产品代码；PoC B2 反过来引用这里，不再各存一份）
    cc::Build::new()
        .file("native/embed_view.m")
        .flag("-fobjc-arc")
        .flag("-DGL_SILENCE_DEPRECATION")
        .include("/opt/homebrew/opt/ffmpeg/include")
        .compile("poc_view");

    println!("cargo:rustc-link-search=native=/opt/homebrew/opt/ffmpeg/lib");
    for lib in ["avformat", "avcodec", "avutil", "swscale"] {
        println!("cargo:rustc-link-lib={lib}");
    }
    /* ★AVFoundation/CoreMedia：决策 #1292 起要用「iPhone 屏幕」USB 采集
       （AVCaptureDeviceDiscoverySession + AVCaptureVideoDataOutput），
       它们不在 Cocoa 里，必须显式链接，否则 `linker command failed`。 */
    for fw in [
        "Cocoa",
        "OpenGL",
        "VideoToolbox",
        "CoreVideo",
        "QuartzCore",
        "AVFoundation",
        "CoreMedia",
        "CoreMediaIO",
    ] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
    tauri_build::build();
}
