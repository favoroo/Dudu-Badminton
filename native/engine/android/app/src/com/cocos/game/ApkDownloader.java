/****************************************************************************
 Copyright (c) 2017-2018 Xiamen Yaji Software Co., Ltd.

 http://www.cocos2d-x.org

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/

package com.cocos.game;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内 APK 流式下载器 —— 给更新弹窗提供真实字节进度。
 *
 * 为什么需要它:Cocos 3.8 原生端的 XMLHttpRequest 是 jsb.XMLHttpRequest
 * (native/cocos/bindings/manual/jsb_xmlhttprequest.cpp),底层走
 * HttpClient::sendImmediate,响应体在线程池里一次性读完才回调 JS,
 * 只派发 onloadstart / onreadystatechange / onloadend,从不派发 progress。
 * 于是 JS 侧的 xhr.onprogress 在 Android 上一次都不进,进度条只能恒为 0。
 *
 * 这里用 HttpURLConnection 自己边读边写 .part 文件,把 loaded/total 挂在
 * volatile 静态字段上,JS 侧每 150ms 反射调用 state() 轮询即可拿到真实进度、
 * 速度和剩余时间;顺带把整包一次性压在内存里的问题也去掉了。
 *
 * 所有对外方法都只接受/返回 String:cc 的 JNI 反射桥(JavaScriptJavaBridge)
 * 对 String 与基础类型最稳,长整型参数用字符串传再在 Java 侧解析。
 */
public final class ApkDownloader {

    private static final String TAG = "ApkDownloader";

    /** 手动跟随 3xx:GitHub Release 会跳到 objects.githubusercontent.com */
    private static final int MAX_REDIRECTS = 8;
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int BUFFER_SIZE = 32 * 1024;
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android) DuduBadmintonUpdater/1.0";

    /** idle | downloading | done | failed | cancelled */
    private static volatile String phase = "idle";
    private static volatile long loadedBytes = 0L;
    private static volatile long totalBytes = 0L;
    private static volatile String localPath = "";
    private static volatile String errorMessage = "";
    private static volatile boolean cancelRequested = false;
    private static volatile HttpURLConnection activeConnection = null;

    private ApkDownloader() {
    }

    /**
     * 启动一次下载(后台线程)。
     *
     * @param url           下载直链
     * @param savePath      落地绝对路径(getWritablePath() 下的 apk 文件)
     * @param expectedTotal 服务端没给 Content-Length 时用的预估字节,可为 "0"/空串
     * @return 空串表示已启动;非空是失败原因
     */
    public static String start(String url, String savePath, String expectedTotal) {
        if (url == null || url.length() == 0) {
            return "下载链接为空";
        }
        if (savePath == null || savePath.length() == 0) {
            return "保存路径为空";
        }

        cancel();

        long expect = 0L;
        try {
            if (expectedTotal != null && expectedTotal.length() > 0) {
                expect = Long.parseLong(expectedTotal.trim());
            }
        } catch (NumberFormatException ignored) {
            expect = 0L;
        }

        phase = "downloading";
        loadedBytes = 0L;
        totalBytes = expect > 0 ? expect : 0L;
        localPath = "";
        errorMessage = "";

        final String target = url;
        final File dest = new File(savePath);
        final long expectTotal = expect;

        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                doDownload(target, dest, expectTotal);
            }
        }, "apk-download");
        worker.setDaemon(true);
        worker.start();
        return "";
    }

    /**
     * 当前状态,JSON 字符串:
     * {"state":"downloading","loaded":1,"total":2,"path":"","error":""}
     */
    public static String state() {
        StringBuilder sb = new StringBuilder(192);
        sb.append('{');
        appendString(sb, "state", phase, true);
        appendNumber(sb, "loaded", loadedBytes);
        appendNumber(sb, "total", totalBytes);
        appendString(sb, "path", localPath, false);
        appendString(sb, "error", errorMessage, false);
        sb.append('}');
        return sb.toString();
    }

    /**
     * 取消进行中的下载:置标志位并掐断连接,让阻塞中的 read 立刻抛错退出。
     */
    public static String cancel() {
        if (!"downloading".equals(phase)) {
            return "0";
        }
        cancelRequested = true;
        HttpURLConnection conn = activeConnection;
        if (conn != null) {
            try {
                conn.disconnect();
            } catch (Exception ignored) {
            }
        }
        return "1";
    }

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    private static void doDownload(String url, File dest, long expectTotal) {
        File tmp = new File(dest.getAbsolutePath() + ".part");
        HttpURLConnection conn = null;
        InputStream in = null;
        BufferedOutputStream out = null;
        long total = expectTotal;
        long got = 0L;

        try {
            String current = url;
            int code = 0;

            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                conn = open(current);
                code = conn.getResponseCode();
                if (code < 300 || code >= 400) {
                    break;
                }
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                conn = null;
                if (location == null || location.length() == 0) {
                    fail("跳转缺少 Location(HTTP " + code + ")", tmp);
                    return;
                }
                current = new URL(new URL(current), location).toString();
                if (hop == MAX_REDIRECTS) {
                    fail("重定向次数过多", tmp);
                    return;
                }
            }

            if (cancelRequested) {
                markCancelled(tmp);
                return;
            }
            if (code < 200 || code >= 300) {
                fail("HTTP " + code, tmp);
                return;
            }

            int declared = conn.getContentLength();
            if (declared > 0) {
                total = declared & 0xffffffffL;
                totalBytes = total;
            }

            File parent = dest.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                Log.w(TAG, "mkdirs failed: " + parent.getAbsolutePath());
            }
            if (tmp.exists() && !tmp.delete()) {
                Log.w(TAG, "stale part file not removable: " + tmp.getAbsolutePath());
            }

            in = new BufferedInputStream(conn.getInputStream(), BUFFER_SIZE);
            out = new BufferedOutputStream(new FileOutputStream(tmp), BUFFER_SIZE);
            byte[] buf = new byte[BUFFER_SIZE];
            int read;
            while ((read = in.read(buf)) != -1) {
                if (read <= 0) {
                    continue;
                }
                if (cancelRequested) {
                    closeQuietly(in);
                    closeQuietly(out);
                    in = null;
                    out = null;
                    deleteQuietly(tmp);
                    markCancelled(null);
                    return;
                }
                out.write(buf, 0, read);
                got += read;
                loadedBytes = got;
            }
            out.flush();
            closeQuietly(in);
            closeQuietly(out);
            in = null;
            out = null;

            if (cancelRequested) {
                deleteQuietly(tmp);
                markCancelled(null);
                return;
            }
            if (total > 0 && got < total) {
                fail("连接中断,只收到 " + got + "/" + total + " 字节", tmp);
                return;
            }
            if (got <= 0) {
                fail("下载内容为空", tmp);
                return;
            }

            if (dest.exists() && !dest.delete()) {
                Log.w(TAG, "old apk not removable: " + dest.getAbsolutePath());
            }
            if (!tmp.renameTo(dest)) {
                // 某些文件系统 renameTo 会失败,退化成逐块拷贝
                if (!copyThenDelete(tmp, dest)) {
                    fail("重命名安装包失败", tmp);
                    return;
                }
            }

            localPath = dest.getAbsolutePath();
            loadedBytes = total > 0 ? total : got;
            errorMessage = "";
            phase = "done";
            Log.i(TAG, "download done: " + localPath + " (" + got + " bytes)");
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            closeQuietly(in);
            closeQuietly(out);
            if (cancelRequested) {
                deleteQuietly(tmp);
                markCancelled(null);
            } else {
                Log.e(TAG, "download exception: " + msg, e);
                fail(msg, tmp);
            }
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
            activeConnection = null;
        }
    }

    private static HttpURLConnection open(String spec) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(spec).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(CONNECT_TIMEOUT_MS);
        c.setReadTimeout(READ_TIMEOUT_MS);
        c.setUseCaches(false);
        c.setRequestMethod("GET");
        c.setRequestProperty("User-Agent", USER_AGENT);
        // 必须显式要求不压缩:否则透明 gzip 会让 Content-Length 与实际字节不一致
        c.setRequestProperty("Accept-Encoding", "identity");
        activeConnection = c;
        return c;
    }

    private static void fail(String message, File tmp) {
        deleteQuietly(tmp);
        errorMessage = message;
        phase = "failed";
    }

    private static void markCancelled(File tmp) {
        deleteQuietly(tmp);
        errorMessage = "已取消下载";
        phase = "cancelled";
    }

    private static boolean copyThenDelete(File src, File dst) {
        InputStream in = null;
        BufferedOutputStream out = null;
        try {
            in = new BufferedInputStream(new FileInputStream(src), BUFFER_SIZE);
            out = new BufferedOutputStream(new FileOutputStream(dst), BUFFER_SIZE);
            byte[] buf = new byte[BUFFER_SIZE];
            int n;
            while ((n = in.read(buf)) != -1) {
                if (n > 0) {
                    out.write(buf, 0, n);
                }
            }
            out.flush();
            deleteQuietly(src);
            return dst.exists() && dst.length() > 0;
        } catch (Exception e) {
            Log.e(TAG, "copy fallback failed: " + e.getMessage(), e);
            return false;
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
    }

    private static void deleteQuietly(File f) {
        if (f != null && f.exists() && !f.delete()) {
            Log.w(TAG, "delete failed: " + f.getAbsolutePath());
        }
    }

    private static void closeQuietly(InputStream stream) {
        if (stream != null) {
            try {
                stream.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static void closeQuietly(BufferedOutputStream stream) {
        if (stream != null) {
            try {
                stream.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static void appendNumber(StringBuilder sb, String key, long value) {
        sb.append(",\"").append(key).append("\":").append(value);
    }

    private static void appendString(StringBuilder sb, String key, String value, boolean leadingComma) {
        if (!leadingComma) {
            sb.append(',');
        }
        sb.append("\"").append(key).append("\":\"");
        String text = value == null ? "" : value;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '"' || ch == '\\') {
                sb.append('\\').append(ch);
            } else if (ch == '\n') {
                sb.append("\\n");
            } else if (ch == '\r') {
                sb.append("\\r");
            } else if (ch < 0x20) {
                sb.append('?');
            } else {
                sb.append(ch);
            }
        }
        sb.append('"');
    }
}
