// 场景进程脚本:被主进程通过 execute-scene-script 调用,回报编辑器当前打开的场景名。
'use strict';

exports.methods = {
  query() {
    const s = typeof cc !== "undefined" ? cc.director.getScene() : null;
    return s ? s.name : null;
  },
};

exports.load = function () {};
exports.unload = function () {};
