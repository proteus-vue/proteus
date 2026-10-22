fn main() {
    // 原生渲染视图（Objective-C）：编译成静态库，由 main.rs 里的 extern "C" 调用。
    // ★2026-10-22 出门（决策 #1187）：真源迁到 packages/studio/native/（产品代码）。
    //   本 PoC 保留为历史取证入口，引用同一份源码——不复制。
    cc::Build::new()
        .file("../../packages/studio/native/embed_view.m")
        .flag("-fobjc-arc")
        .flag("-DGL_SILENCE_DEPRECATION")
        .include("/opt/homebrew/opt/ffmpeg/include")
        .compile("poc_view");

    println!("cargo:rustc-link-search=native=/opt/homebrew/opt/ffmpeg/lib");
    println!("cargo:rustc-link-lib=avformat");
    println!("cargo:rustc-link-lib=avcodec");
    println!("cargo:rustc-link-lib=avutil");
    println!("cargo:rustc-link-lib=swscale");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=OpenGL");
    println!("cargo:rustc-link-lib=framework=VideoToolbox");
    println!("cargo:rustc-link-lib=framework=CoreVideo");
    println!("cargo:rustc-link-lib=framework=QuartzCore");

    tauri_build::build();
}
