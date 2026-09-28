// 自动打开 main 场景:项目由命令行 --project 直开时没有「当前场景」,
// 预览服务器(7456)因此拿不到场景。此扩展在启动后轮询调用 scene 包的
// open-scene 消息,把 main 场景拉起来,并用 execute-scene-script 回查证实。
'use strict';

const SCENE_UUID = '7689a3bd-ed7b-4bab-9f1e-41d2db124ece';
const RETRY_MS = 5000;
const MAX_TRIES = 60;   // 最多 5 分钟

exports.load = function () {
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    if (tries > MAX_TRIES) {
      clearInterval(timer);
      console.error('[scene-opener] 超时:场景始终打不开,请手动打开 assets/scenes/main.scene');
      return;
    }
    try {
      await Editor.Message.request('scene', 'open-scene', SCENE_UUID);
      // 回查:场景进程里真的有场景吗?
      const cur = await Editor.Message.request('scene', 'execute-scene-script', {
        name: 'scene-opener', method: 'query', args: [],
      });
      if (cur) {
        clearInterval(timer);
        console.log(`[scene-opener] 场景已打开并证实:当前场景 = ${cur}(第 ${tries} 次尝试)`);
      } else if (tries === 1) {
        console.log('[scene-opener] open-scene 已受理,但场景进程暂无场景,继续重试…');
      }
    } catch (err) {
      if (tries === 1) console.log('[scene-opener] 等待场景进程就绪…', String(err).slice(0, 120));
    }
  }, RETRY_MS);
};

exports.unload = function () {};
