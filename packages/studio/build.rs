fn main() {
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
    for fw in ["Cocoa", "OpenGL", "VideoToolbox", "CoreVideo", "QuartzCore"] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
    tauri_build::build();
}
