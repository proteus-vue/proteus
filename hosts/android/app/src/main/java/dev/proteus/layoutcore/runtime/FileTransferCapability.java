package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/FileTransferCapability.java
// ★★★决策 #1095（2026-10-19）：C29/C30 上传/下载的 **Android 文件系统腿**
//   （`fs.writeBytes` / `fs.readBytes` / `fs.remove`）。
//
// 【为什么需要】App 端没有 wx 的 uploadFile/downloadFile；上传/下载靠 `http.request` 的字节腿
//   收发**裸字节**，而"字节 ↔ 文件"必须由宿主做（JS 侧没有文件系统）。
//
// 【沙箱（G-49 的同一条纪律：deny-by-default）】
//   · 所有路径都相对 **app 私有目录**（`context.getFilesDir()`），**不接受绝对路径**；
//   · 任何 `..` 段一律拒绝（防目录穿越）——不做"规范化后放行"的宽松判断；
//   · 目录不存在 ⇒ 自动创建（只创建沙箱内的）。
//
// 【诚实边界】
//   · 整块读写（byte[] 一次性进内存）——与本单 JS 侧的实现一致；大文件分块协议属后续批次。
//   · 写入是**覆盖**语义（与 wx `writeFile` 一致）；不做原子替换（.tmp + rename）——
//     中断可能留半截文件。★已在能力页端边界写明。
//   · `fs.remove` 幂等：不存在也算成功（与 wx `unlink` 的 "file not found" 报错不同——
//     这里选幂等，因为上传/下载的清理路径不该因"文件已不在"而失败）。

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

public final class FileTransferCapability {

    private static final String TAG = "proteus-fs";

    private FileTransferCapability() { }

    /**
     * 把沙箱相对路径解析成 File。
     *
     * @throws IllegalArgumentException 路径非法（绝对路径 / 含 `..` / 空）
     */
    /**
     * ★#1119：由 private 放宽到 package-private —— `HttpCapability` 的落盘路径**必须复用本校验**。
     *   ★为什么不能各写一份：沙箱校验（拒绝绝对路径 / `..`）一旦分叉，迟早有一边漏。
     */
    static File resolve(Context ctx, String path) {
        if (path == null || path.isEmpty()) throw new IllegalArgumentException("fs: path 为空");
        if (path.startsWith("/")) throw new IllegalArgumentException("fs: 只接受沙箱相对路径（收到绝对路径 " + path + "）");
        for (String seg : path.split("/")) {
            if ("..".equals(seg)) throw new IllegalArgumentException("fs: 路径不得含 '..'（拒绝目录穿越）：" + path);
        }
        File root = ctx.getFilesDir();
        return new File(root, path);
    }

    /** `fs.writeBytes`：`{ path, bytes: number[] }` → `{ path, size }`（覆盖写）。 */
    public static JSONObject writeBytes(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        JSONArray arr = args.optJSONArray("bytes");
        if (arr == null) throw new IllegalArgumentException("fs.writeBytes 需要 { path, bytes: number[] }");
        File f = resolve(ctx, path);
        File parent = f.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("fs.writeBytes 无法创建目录：" + parent);
        }
        byte[] buf = new byte[arr.length()];
        for (int i = 0; i < buf.length; i++) buf[i] = (byte) arr.optInt(i, 0);
        try (FileOutputStream out = new FileOutputStream(f, false)) {
            out.write(buf);
            out.flush();
        }
        JSONObject o = new JSONObject();
        o.put("path", path);
        o.put("size", buf.length);
        return o;
    }

    /** `fs.readBytes`：`{ path }` → `{ bytes: number[], size }`。 */
    public static JSONObject readBytes(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File f = resolve(ctx, path);
        if (!f.isFile()) throw new IOException("fs.readBytes: 文件不存在 " + path);
        long len = f.length();
        // ★上限保护：一次读进 JS 内存，超过 64 MiB 直接拒绝（避免把宿主/引擎打爆）
        final long MAX = 64L * 1024 * 1024;
        if (len > MAX) throw new IOException("fs.readBytes: 文件过大（" + len + "B > " + MAX + "B）——分块读取属后续批次");
        byte[] buf = new byte[(int) len];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        JSONArray arr = new JSONArray();
        for (byte b : buf) arr.put(b & 0xFF);
        JSONObject o = new JSONObject();
        o.put("bytes", arr);
        o.put("size", buf.length);
        return o;
    }

    /** `fs.remove`：`{ path }` → `{}`（**幂等**：不存在也算成功）。 */
    public static JSONObject remove(Context ctx, JSONObject args) throws Exception {
        String path = args.optString("path", "");
        File f = resolve(ctx, path);
        if (f.exists() && !f.delete()) {
            // ★删除失败要如实报错（不能静默当成功——清理路径失败会让磁盘悄悄涨）
            throw new IOException("fs.remove 删除失败：" + path);
        }
        return new JSONObject();
    }

    /** 诊断读数：沙箱根（判据确认"写到了哪里"）。 */
    public static String sandboxRoot(Context ctx) {
        return ctx.getFilesDir().getAbsolutePath();
    }
}
