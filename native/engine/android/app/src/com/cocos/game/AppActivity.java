/****************************************************************************
Copyright (c) 2015-2016 Chukong Technologies Inc.
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

import android.os.Bundle;
import android.content.Intent;
import android.content.Context;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.content.FileProvider;
import java.io.File;

import com.cocos.service.SDKWrapper;
import com.cocos.lib.CocosActivity;

public class AppActivity extends CocosActivity {

    private static final String TAG = "AppActivity";
    private static Context sContext = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sContext = this;
        // DO OTHER INITIALIZATION BELOW
        SDKWrapper.shared().init(this);

    }

    @Override
    protected void onResume() {
        super.onResume();
        SDKWrapper.shared().onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        SDKWrapper.shared().onPause();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        sContext = null;
        // Workaround in https://stackoverflow.com/questions/16283079/re-launch-of-activity-on-home-button-but-only-the-first-time/16447508
        if (!isTaskRoot()) {
            return;
        }
        SDKWrapper.shared().onDestroy();
    }

    /**
     * 取可用马达:没有 Context / 系统没有 VibratorService / 该设备无马达,一律返回 null。
     * Android 12(API 31)起 VIBRATOR_SERVICE 已废弃,改用 VibratorManager.getDefaultVibrator(),
     * 所以这里按 SDK_INT 分叉;低版本仍走 getSystemService(minSdk=21 上 VibratorManager 不存在)。
     */
    private static Vibrator vib() {
        if (sContext == null) return null;
        try {
            Vibrator v;
            if (Build.VERSION.SDK_INT >= 31) {
                android.os.VibratorManager vm =
                    (android.os.VibratorManager) sContext.getSystemService(Context.VIBRATOR_SERVICE);
                v = (vm == null) ? null : vm.getDefaultVibrator();
            } else {
                v = (Vibrator) sContext.getSystemService(Context.VIBRATOR_SERVICE);
            }
            return (v != null && v.hasVibrator()) ? v : null;
        } catch (Exception e) {
            Log.e(TAG, "vib() exception: " + e.getMessage());
            return null;
        }
    }

    /** 供 JS 探测(game/haptics.ts → hapticStatus()):这台设备到底有没有马达 */
    public static boolean hasVibrator() {
        return vib() != null;
    }

    /**
     * 供 JS 探测:能不能控振幅。不能控振幅的机器上,JS 侧会把振幅差折算成时长差(见 core/haptic.ts plan)。
     * hasVibrator() 在 API 11、hasAmplitudeControl() 在 API 26,所以后者必须卡版本。
     */
    public static boolean hasAmplitudeControl() {
        Vibrator v = vib();
        return v != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && v.hasAmplitudeControl();
    }

    /**
     * 触觉反馈震动:游戏层经 native.reflection 调用(game/haptics.ts)。
     * 强度 = 时长 × 振幅两维 —— 旧版只有时长,12~24ms 的 one-shot 在线性马达上基本无感,
     * 六档打击阶梯在触觉通道上被压成了"全都一样",所以这里补上振幅维度。
     * @param ms  震动时长(毫秒);<=0 不震
     * @param amp 震动幅度 1..255;传其它值(含无振幅控制时的 -1)走 DEFAULT_AMPLITUDE
     * @return 是否真的下发了震动;false 时 JS 侧把它显示成状态读数,不再静默
     */
    public static boolean vibrate(int ms, int amp) {
        try {
            Vibrator v = vib();
            if (v == null || ms <= 0) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // createOneShot 对 amplitude 只接受 1..255 或 DEFAULT_AMPLITUDE(-1),越界直接抛异常
                int a = (amp >= 1 && amp <= 255) ? amp : VibrationEffect.DEFAULT_AMPLITUDE;
                v.vibrate(VibrationEffect.createOneShot((long) ms, a));
            } else {
                v.vibrate((long) ms);
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "vibrate exception: " + e.getMessage());
            return false;
        }
    }

    /** 旧签名(单时长、默认幅度):保留是为了覆盖安装期间 JS/Java 不同步,新代码一律用 vibrate(ms, amp) */
    public static void vibrate(int ms) {
        vibrate(ms, -1);   // -1 == VibrationEffect.DEFAULT_AMPLITUDE,写字面量避免在 API<26 上引用该类
    }

    public static boolean installApk(String filePath) {
        try {
            if (sContext == null) {
                Log.e(TAG, "installApk failed: context is null");
                return false;
            }
            if (filePath == null || filePath.isEmpty()) {
                Log.e(TAG, "installApk failed: filePath is empty");
                return false;
            }
            File file = new File(filePath);
            if (!file.exists()) {
                Log.e(TAG, "installApk failed: file does not exist: " + filePath);
                return false;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW);
            Uri apkUri = FileProvider.getUriForFile(
                sContext,
                sContext.getPackageName() + ".fileprovider",
                file
            );
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            sContext.startActivity(intent);
            Log.i(TAG, "installApk intent started for: " + filePath);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "installApk exception: " + e.getMessage(), e);
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        SDKWrapper.shared().onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        SDKWrapper.shared().onNewIntent(intent);
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        SDKWrapper.shared().onRestart();
    }

    @Override
    protected void onStop() {
        super.onStop();
        SDKWrapper.shared().onStop();
    }

    @Override
    public void onBackPressed() {
        SDKWrapper.shared().onBackPressed();
        super.onBackPressed();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        SDKWrapper.shared().onConfigurationChanged(newConfig);
        super.onConfigurationChanged(newConfig);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        SDKWrapper.shared().onRestoreInstanceState(savedInstanceState);
        super.onRestoreInstanceState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        SDKWrapper.shared().onSaveInstanceState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onStart() {
        SDKWrapper.shared().onStart();
        super.onStart();
    }

    @Override
    public void onLowMemory() {
        SDKWrapper.shared().onLowMemory();
        super.onLowMemory();
    }
}
