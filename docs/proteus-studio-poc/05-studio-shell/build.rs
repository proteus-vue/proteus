fn main() {
    // 与 PoC B2 共用同一份原生视图（docs/proteus-studio-poc/native/embed_view.m）
    cc::Build::new()
        .file("../native/embed_view.m")
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
