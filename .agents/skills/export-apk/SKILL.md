---
name: export-apk
description: Build and export Android APK for Cocos Creator 3.8.8. Use when asked to export apk, build android, package apk, or generate android application.
---

# Export APK Skill for Cocos Creator 3.8.8

Guide for building and exporting Android APK for this Cocos Creator 3.8.8 project.

## Quick One-Command Build

Run the automated build script located in the skill directory:

```bash
# Full build (Cocos native project export + Gradle APK compile)
bash .agents/skills/export-apk/scripts/build.sh all

# Only recompile APK from existing native project (fast incremental build)
bash .agents/skills/export-apk/scripts/build.sh make-only

# Only run Cocos native export without compiling APK
bash .agents/skills/export-apk/scripts/build.sh cocos-only
```

---

## Detailed Step-by-Step Procedure

### 1. Environment Variables Setup

> **前置:确认工具链在 PATH 中**。IDE 内 shell(Trae 等)常把 PATH 裁剪到只剩自带目录,
> 导致 `git`/`python3`/`node`/`bash` 报 `command not found`。先确认这四个二进制可用:
> ```bash
> command -v git python3 node bash || export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$HOME/.local/bin/node-bin/bin:$PATH"
> ```
> build.sh 内部也会自行重设 PATH(含 JAVA_HOME/bin、node-bin、标准系统目录),所以只要
> 上面四个能找到,build.sh 之后就不依赖外部 PATH。

Ensure the required paths are exported before running any tool:

```bash
export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"   # 取 sdk/ndk 下版本号最大的一个
export NDK_ROOT="$ANDROID_NDK_HOME"
# Cocos Creator 可执行文件:可用环境变量 COCOS_CREATOR 覆盖,默认 /Applications/CocosCreator.app/Contents/MacOS/CocosCreator
export COCOS_CREATOR="${COCOS_CREATOR:-/Applications/CocosCreator.app/Contents/MacOS/CocosCreator}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin/node-bin/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH"
```

> build.sh 对以上路径的读法是「环境变量优先,上述值兜底」;换机器改环境变量即可,不必改脚本。
> Cocos Creator 路径同理:`COCOS_CREATOR` 环境变量优先,build.sh 内硬编码值兜底。
>
> **签名(2026-10-02 起)**:release 包用正式 keystore(`keystore/release.keystore`,别名 `dudu`,
> 口令在本机 `keystore/secret.txt` 保管,**该目录不入库**)。`build-android.json` 已切
> `useDebugKeystore: false`。release.py 发布前会比对 APK 与 keystore 的 SHA-256 指纹,
> 签名不符/keystore 丢失都会被拦下 —— 丢了 keystore 文件+口令,老用户就永远收不到覆盖安装更新。
>
> **三道闸**:①任何一步失败即停(`set -eu`,全部 `|| true` 已移除)—— **唯一例外是 Cocos CLI**:
>   其退出码不可靠(登录服务超时/启动期 `layout.json` 解析报错都会让退出码非零,即使 build task
>   本身已 success),故对 Cocos CLI 用 `|| echo warn` 放行退出码,改由闸②判定;②`build/android/data`
>   里必须有比本次构建开始更新的文件(防「Cocos 失败 → Gradle 打旧数据」,这是判断 Cocos 是否真
>   产出的可靠依据);③应用名 sed 注入后回读校验。

### 2. Cocos Creator CLI Native Export

Build the native project using `build-android.json` located at the project root:

```bash
"$COCOS_CREATOR" \
  --project "$(pwd)" \
  --build "configPath=$(pwd)/build-android.json"
```

> **Important**: `build-android.json` must explicitly specify `sdkPath` and `ndkPath` under `packages.android` to avoid profile lookup errors.
>
> **退出码**:Cocos CLI 的退出码不可靠(登录服务超时/启动期 JSON 解析报错等会让它非零,
> 即使 build task 已 success)。build.sh 已对它放行退出码、改由新鲜度闸判定;若手动跑这步,
> 不要直接 `set -e` 拦它 —— 用 `build/android/data` 是否有新产物来判断成功。

### 3. Gradle Mirror Acceleration (China Network)

Ensure Gradle wrapper and repositories use high-speed mirrors:

1. In `build/android/proj/gradle/wrapper/gradle-wrapper.properties`:
   - Change `distributionUrl` to `https\://mirrors.cloud.tencent.com/gradle/gradle-8.11.1-bin.zip`
2. In `build/android/proj/build.gradle` and `native/engine/android/build.gradle`:
   - Add Aliyun Maven mirrors inside `repositories`:
     ```groovy
     maven { url 'https://maven.aliyun.com/repository/public' }
     maven { url 'https://maven.aliyun.com/repository/google' }
     ```

### 4. Gradle Compilation

Compile the Debug APK using the Gradle wrapper:

```bash
cd /Users/a1/Documents/01Code/dudu-cocos/build/android/proj
chmod +x gradlew
./gradlew assembleDebug
```

---

## Artifact Location and Testing

- **APK Output Path**:
  `build/android/proj/build/dudu-cocos/outputs/apk/debug/dudu-cocos-debug.apk`

- **Install to Connected Android Device via ADB**:
  ```bash
  "$ANDROID_HOME/platform-tools/adb" install -r \
    build/android/proj/build/dudu-cocos/outputs/apk/debug/dudu-cocos-debug.apk
  ```

- **Open in Android Studio**:
  Open the directory `/Users/a1/Documents/01Code/dudu-cocos/build/android/proj` directly in Android Studio.

- **性能/帧率验收必须用 release 包**(`./gradlew assembleRelease`,dudu-release 流程产物):
  debug 包是 `debuggable=true` + 无 minify,帧率与发热和正式包不可比 —— 「真机测出卡顿」
  先确认测的是哪个包,再谈优化。
