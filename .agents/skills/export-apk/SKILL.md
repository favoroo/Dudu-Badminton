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

Ensure the required paths are exported before running any tool:

```bash
export JAVA_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
export ANDROID_HOME="/Users/a1/Library/Android/sdk"
export ANDROID_NDK_HOME="/Users/a1/Library/Android/sdk/ndk/28.2.13676358"
export NDK_ROOT="$ANDROID_NDK_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:/Users/a1/.local/bin/node-bin/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH"
```

### 2. Cocos Creator CLI Native Export

Build the native project using `build-android.json` located at the project root:

```bash
/Applications/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project /Users/a1/Documents/01Code/dudu-cocos \
  --build "configPath=/Users/a1/Documents/01Code/dudu-cocos/build-android.json"
```

> **Important**: `build-android.json` must explicitly specify `sdkPath` and `ndkPath` under `packages.android` to avoid profile lookup errors.

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
  /Users/a1/Library/Android/sdk/platform-tools/adb install -r \
    /Users/a1/Documents/01Code/dudu-cocos/build/android/proj/build/dudu-cocos/outputs/apk/debug/dudu-cocos-debug.apk
  ```

- **Open in Android Studio**:
  Open the directory `/Users/a1/Documents/01Code/dudu-cocos/build/android/proj` directly in Android Studio.
