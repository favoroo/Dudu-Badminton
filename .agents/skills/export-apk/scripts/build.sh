#!/bin/bash
# ============================================================
# Android 构建脚本(export-apk skill 的执行体)
#
# 铁律:任何一步失败都必须立即终止 —— 从前 Cocos 构建失败也 || true 继续走
# Gradle,拿上一次成功构建留下的 build/android/data 旧 JS 资源打出「新版本号
# + 旧内容」的 APK,而 release.py 只校验版本字符串,根本拦不住。现在的三道闸:
#   ① set -e + 去掉全部 || true:任何命令失败即停;
#   ② 新鲜度闸:build/android/data 里必须有比本次构建开始时间戳更新的文件,
#      否则视为 Cocos 没有真正产出,拒绝进 Gradle;
#   ③ 应用名注入后回读校验:sed 对「没有匹配」也返回 0,必须 grep 确认真注入了。
# 机器相关路径(JDK/SDK/NDK)全部支持环境变量覆盖,硬编码值只作本机兜底。
# ============================================================
set -eu

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
echo "=== Project Root: $PROJECT_ROOT ==="

# ---- 机器相关路径:环境变量优先,本机值兜底(换机改环境变量,不改脚本) ----
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -n "${ANDROID_NDK_HOME:-}" ]; then
    export ANDROID_NDK_HOME
else
    # 未显式指定时取 sdk/ndk 下版本号最大的一个(排序取尾)
    NDK_DETECTED="$(ls -1 "$ANDROID_HOME/ndk" 2>/dev/null | sort -V | tail -1 || true)"
    if [ -z "$NDK_DETECTED" ]; then
        echo "Error: ANDROID_NDK_HOME 未设置且 $ANDROID_HOME/ndk 下没有任何 NDK" >&2
        exit 1
    fi
    export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_DETECTED"
fi
export NDK_ROOT="$ANDROID_NDK_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:${NODE_BIN:-$HOME/.local/bin/node-bin/bin}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH"

MODE="${1:-all}" # all | make-only | cocos-only | release | release-make
BUILD_TYPE="${2:-debug}" # debug | release

if [ "$MODE" = "release" ] || [ "$MODE" = "release-make" ]; then
    BUILD_TYPE="release"
fi

DATA_DIR="$PROJECT_ROOT/build/android/data"
APP_STRINGS="$PROJECT_ROOT/build/android/proj/res/values/strings.xml"
inject_app_name() {
    # sed 对「模式没匹配上」也返回 0 —— 注入完必须回读,否则应用名静默退回引擎默认
    if [ -f "$APP_STRINGS" ]; then
        sed -i '' 's#<string name="app_name" translatable="false">.*</string>#<string name="app_name" translatable="false">嘟嘟羽毛球</string>#g' "$APP_STRINGS"
        grep -q '<string name="app_name" translatable="false">嘟嘟羽毛球</string>' "$APP_STRINGS" \
            || { echo "Error: 应用名注入失败($APP_STRINGS 里没有匹配行)" >&2; exit 1; }
    fi
}

if [ "$MODE" = "all" ] || [ "$MODE" = "cocos-only" ] || [ "$MODE" = "release" ]; then
    echo "--- Step 1: Building Android Native Project via Cocos Creator CLI ---"
    # 新鲜度基准:建一个比后续一切产物都旧的戳,构建完用它断言 data 真的更新过
    STAMP="$(mktemp)"
    # Cocos CLI 的退出码不可靠 —— 登录服务超时/启动期 layout.json 解析报错等都会让
    # 进程退出码非零,即使 build task 本身已 success。靠下面的新鲜度闸判断 Cocos 是否
    # 真产出了数据,不靠退出码(否则会误拦一次成功的构建)。
    # Cocos Creator 路径:COCOS_CREATOR 环境变量优先,默认 /Applications/CocosCreator.app/...
    COCOS_BIN="${COCOS_CREATOR:-/Applications/CocosCreator.app/Contents/MacOS/CocosCreator}"
    "$COCOS_BIN" \
        --project "$PROJECT_ROOT" \
        --build "configPath=$PROJECT_ROOT/build-android.json" || echo "warn: Cocos CLI 退出码非零,交由新鲜度闸判定"

    if [ ! -d "$DATA_DIR" ]; then
        echo "Error: $DATA_DIR 不存在 —— Cocos 构建没有产出数据目录" >&2
        exit 1
    fi
    if [ -z "$(find "$DATA_DIR" -type f -newer "$STAMP" -print -quit 2>/dev/null)" ]; then
        echo "Error: build/android/data 里没有任何文件比本次构建开始更新 —— Cocos 构建疑似失败," >&2
        echo "       继续走 Gradle 会把上一次的旧 JS 资源打进新版本号的包,拒绝继续。" >&2
        exit 1
    fi
    rm -f "$STAMP"

    # 适配国内 Gradle 镜像源与 Wrapper 下载加速
    WRAPPER_PROP="$PROJECT_ROOT/build/android/proj/gradle/wrapper/gradle-wrapper.properties"
    if [ -f "$WRAPPER_PROP" ]; then
        sed -i '' 's#https\://services.gradle.org/distributions/#https\://mirrors.cloud.tencent.com/gradle/#g' "$WRAPPER_PROP"
    fi

    ROOT_GRADLE="$PROJECT_ROOT/build/android/proj/build.gradle"
    if [ -f "$ROOT_GRADLE" ] && ! grep -q "maven.aliyun.com" "$ROOT_GRADLE"; then
        sed -i '' 's#repositories {#repositories {\n        maven { url "https://maven.aliyun.com/repository/public" }\n        maven { url "https://maven.aliyun.com/repository/google" }#g' "$ROOT_GRADLE"
    fi

    NATIVE_GRADLE="$PROJECT_ROOT/native/engine/android/build.gradle"
    if [ -f "$NATIVE_GRADLE" ] && ! grep -q "maven.aliyun.com" "$NATIVE_GRADLE"; then
        sed -i '' 's#repositories {#repositories {\n        maven { url "https://maven.aliyun.com/repository/public" }\n        maven { url "https://maven.aliyun.com/repository/google" }#g' "$NATIVE_GRADLE"
    fi

    # 注入自定义 Splash Screen
    if [ -f "$PROJECT_ROOT/tools/apply-splash.py" ]; then
        echo "--- Injecting custom splash screen ---"
        python3 "$PROJECT_ROOT/tools/apply-splash.py"
    fi

    # 替换 Android 应用名为「嘟嘟羽毛球」
    inject_app_name
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "make-only" ] || [ "$MODE" = "release" ] || [ "$MODE" = "release-make" ]; then
    echo "--- Step 2: Compiling APK with Gradle ($BUILD_TYPE) ---"
    cd "$PROJECT_ROOT/build/android/proj"
    chmod +x gradlew

    # 再次确保应用名正确(Gradle 打包前资源可能被重新生成)
    inject_app_name

    GRADLE_EXTRA_ARGS=""
    if [ -n "${PROP_VERSION_NAME:-}" ]; then
        GRADLE_EXTRA_ARGS="$GRADLE_EXTRA_ARGS -PPROP_VERSION_NAME=$PROP_VERSION_NAME"
    fi
    if [ -n "${PROP_VERSION_CODE:-}" ]; then
        GRADLE_EXTRA_ARGS="$GRADLE_EXTRA_ARGS -PPROP_VERSION_CODE=$PROP_VERSION_CODE"
    fi

    if [ "$BUILD_TYPE" = "release" ]; then
        ./gradlew assembleRelease $GRADLE_EXTRA_ARGS
        APK_PATH="$PROJECT_ROOT/build/android/proj/build/dudu-cocos/outputs/apk/release/dudu-cocos-release.apk"
    else
        ./gradlew assembleDebug $GRADLE_EXTRA_ARGS
        APK_PATH="$PROJECT_ROOT/build/android/proj/build/dudu-cocos/outputs/apk/debug/dudu-cocos-debug.apk"
    fi

    if [ -f "$APK_PATH" ]; then
        echo "=== APK Build Success ==="
        ls -lh "$APK_PATH"
        # 产物新鲜度终检:APK 的 mtime 必须晚于 data 目录(防陈旧包残留误判成功)
        if [ "$(stat -f %m "$APK_PATH")" -lt "$(stat -f %m "$DATA_DIR")" ]; then
            echo "Error: APK 比构建数据还旧 —— 可能是上一次的产物残留,拒绝交付" >&2
            exit 1
        fi
    else
        echo "Error: APK not found at $APK_PATH"
        exit 1
    fi
fi
