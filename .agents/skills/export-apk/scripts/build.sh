#!/bin/bash
set -e
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
echo "=== Project Root: $PROJECT_ROOT ==="

export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
export ANDROID_HOME="/Users/a1/Library/Android/sdk"
export ANDROID_NDK_HOME="/Users/a1/Library/Android/sdk/ndk/28.2.13676358"
export NDK_ROOT="$ANDROID_NDK_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:/Users/a1/.local/bin/node-bin/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH"

MODE="${1:-all}" # all | make-only | cocos-only | release | release-make
BUILD_TYPE="${2:-debug}" # debug | release

if [ "$MODE" = "release" ] || [ "$MODE" = "release-make" ]; then
    BUILD_TYPE="release"
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "cocos-only" ] || [ "$MODE" = "release" ]; then
    echo "--- Step 1: Building Android Native Project via Cocos Creator CLI ---"
    /Applications/CocosCreator.app/Contents/MacOS/CocosCreator \
        --project "$PROJECT_ROOT" \
        --build "configPath=$PROJECT_ROOT/build-android.json" || true

    # 适配国内 Gradle 镜像源与 Wrapper 下载加速
    WRAPPER_PROP="$PROJECT_ROOT/build/android/proj/gradle/wrapper/gradle-wrapper.properties"
    if [ -f "$WRAPPER_PROP" ]; then
        sed -i '' 's#https\://services.gradle.org/distributions/#https\://mirrors.cloud.tencent.com/gradle/#g' "$WRAPPER_PROP" 2>/dev/null || true
    fi

    ROOT_GRADLE="$PROJECT_ROOT/build/android/proj/build.gradle"
    if [ -f "$ROOT_GRADLE" ] && ! grep -q "maven.aliyun.com" "$ROOT_GRADLE"; then
        sed -i '' 's#repositories {#repositories {\n        maven { url "https://maven.aliyun.com/repository/public" }\n        maven { url "https://maven.aliyun.com/repository/google" }#g' "$ROOT_GRADLE" 2>/dev/null || true
    fi

    NATIVE_GRADLE="$PROJECT_ROOT/native/engine/android/build.gradle"
    if [ -f "$NATIVE_GRADLE" ] && ! grep -q "maven.aliyun.com" "$NATIVE_GRADLE"; then
        sed -i '' 's#repositories {#repositories {\n        maven { url "https://maven.aliyun.com/repository/public" }\n        maven { url "https://maven.aliyun.com/repository/google" }#g' "$NATIVE_GRADLE" 2>/dev/null || true
    fi
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "make-only" ] || [ "$MODE" = "release" ] || [ "$MODE" = "release-make" ]; then
    echo "--- Step 2: Compiling APK with Gradle ($BUILD_TYPE) ---"
    cd "$PROJECT_ROOT/build/android/proj"
    chmod +x gradlew
    if [ "$BUILD_TYPE" = "release" ]; then
        ./gradlew assembleRelease
        APK_PATH="$PROJECT_ROOT/build/android/proj/build/dudu-cocos/outputs/apk/release/dudu-cocos-release.apk"
    else
        ./gradlew assembleDebug
        APK_PATH="$PROJECT_ROOT/build/android/proj/build/dudu-cocos/outputs/apk/debug/dudu-cocos-debug.apk"
    fi

    if [ -f "$APK_PATH" ]; then
        echo "=== APK Build Success ==="
        ls -lh "$APK_PATH"
    else
        echo "Error: APK not found at $APK_PATH"
        exit 1
    fi
fi
