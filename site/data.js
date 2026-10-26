// 由 tools/export-site-data.ts 生成 —— 不要手改。改数字请改 assets/scripts/core/config.ts
window.GAME_DATA = {
  "version": "0.0.39",
  "versionName": "v0.0.39",
  "repo": {
    "githubOwner": "favoroo",
    "githubRepo": "Dudu-Badminton",
    "giteeOwner": "favo9",
    "giteeRepo": "dudu-badminton"
  },
  "stats": [
    {
      "n": 20,
      "unit": "关",
      "label": "闯关关卡"
    },
    {
      "n": 7,
      "unit": "款",
      "label": "主动技能"
    },
    {
      "n": 39,
      "unit": "款",
      "label": "皮肤与球具"
    },
    {
      "n": 47,
      "unit": "件",
      "label": "可换装扮"
    },
    {
      "n": 4,
      "unit": "座",
      "label": "主题球馆"
    },
    {
      "n": 4,
      "unit": "档",
      "label": "AI 难度"
    }
  ],
  "modes": [
    {
      "key": "match",
      "tag": "MATCH",
      "name": "对练",
      "role": "primary",
      "line": "四档难度 · 选球馆 · 随时开局",
      "body": "从入门到极限四档 AI，四个主题球馆任选。11 分制、平分需领先 2 分，打完就地看结算。"
    },
    {
      "key": "campaign",
      "tag": "CHALLENGE",
      "name": "闯关模式",
      "role": "star",
      "line": "20 关 · 4 章",
      "body": "海滩到黄昏馆四章 20 关，每关带一条独立机制：沙尘、迷雾、电磁脉冲、全息双生、赛点开局。"
    },
    {
      "key": "endless",
      "tag": "ENDLESS",
      "name": "无限练习",
      "role": "drill",
      "line": "无视比分 · 持续对拉",
      "body": "不判赛点、不结束，想打多久打多久。适合把手感磨顺，或者单纯享受对拉。"
    },
    {
      "key": "drill",
      "tag": "TRAIN",
      "name": "专项训练",
      "role": "info",
      "line": "6 项球种专项",
      "body": "后场重杀、高远对拉、网前点杀、搓放、平抽、挑高 —— 每关只喂一种球，打出有效球才算过。"
    },
    {
      "key": "career",
      "tag": "CAREER",
      "name": "生涯与商店",
      "role": "record",
      "line": "等级 · 金币 · 皮肤",
      "body": "打赢攒金币，升级解锁新技能与新皮肤。六项生涯统计、十八档里程碑、每日每周任务。"
    }
  ],
  "activities": {
    "daily": 6,
    "weekly": 3
  },
  "diffs": [
    {
      "key": "easy",
      "name": "入门",
      "tag": "EASY",
      "accent": "#7dff9e",
      "desc": "球速温和 · 回球稳定 · 适合热身"
    },
    {
      "key": "normal",
      "name": "普通",
      "tag": "NORMAL",
      "accent": "#ffe14d",
      "desc": "攻守兼备 · 会抓空当 · 标准拉吊"
    },
    {
      "key": "hard",
      "name": "大师",
      "tag": "HARD",
      "accent": "#ff6a1f",
      "desc": "反应迅捷 · 跳起重扣 · 落点很刁"
    },
    {
      "key": "expert",
      "name": "极限",
      "tag": "EXPERT",
      "accent": "#f43f5e",
      "desc": "反应极限 · 几乎不失误 · 天花板"
    }
  ],
  "skills": [
    {
      "id": "lunge",
      "name": "强力跨步",
      "short": "跨步",
      "tag": "敏捷突进",
      "desc": "快速滑步突进救球，跨完自动回球，并短时激活强力暴击状态；跳跃中同样可释放",
      "unlock": 1,
      "cd": 48,
      "accent": "#38bdf8"
    },
    {
      "id": "smash",
      "name": "百分百重击",
      "short": "重击",
      "tag": "绝杀附魔",
      "desc": "球拍聚能爆发烈焰，来球就位自动轰出暴扣，无视高度必定重扣；挥空不进冷却",
      "unlock": 2,
      "cd": 210,
      "accent": "#f43f5e"
    },
    {
      "id": "flash",
      "name": "闪现扣杀",
      "short": "闪现",
      "tag": "空中折跃",
      "desc": "折跃瞬间时停悬空，闪至羽毛球下方高点，必定凌空劈扣",
      "unlock": 3,
      "cd": 300,
      "accent": "#eab308"
    },
    {
      "id": "magnet",
      "name": "引力吸球",
      "short": "吸球",
      "tag": "空间掌控",
      "desc": "展开重力力场，将全场羽毛球瞬间抓回拍前强力回抽；空中释放直接转跳杀",
      "unlock": 4,
      "cd": 360,
      "accent": "#a855f7"
    },
    {
      "id": "focus",
      "name": "时空减速",
      "short": "时空",
      "tag": "领域掌控",
      "desc": "开启时空子弹时间，自身高速穿梭，接球后强力反击并脱离领域进入冷却",
      "unlock": 5,
      "cd": 270,
      "accent": "#06b6d4"
    },
    {
      "id": "shadow",
      "name": "影分身",
      "short": "分身",
      "tag": "影遁协战",
      "desc": "凝出三个影分身各守一方，颜色各异；各自接三球后消散，跨回合未耗尽则补满",
      "unlock": 6,
      "cd": 60,
      "accent": "#8b5cf6"
    },
    {
      "id": "rage",
      "name": "怒气重击",
      "short": "怒气",
      "tag": "越战越勇",
      "desc": "越打越满最多攒 3 管，按一下耗一管；满管必定暴扣，不满一管也能放零头",
      "unlock": 7,
      "cd": 20,
      "accent": "#f97316"
    }
  ],
  "skins": {
    "tabs": [
      {
        "key": "player",
        "label": "人物",
        "count": 14
      },
      {
        "key": "racket",
        "label": "球拍",
        "count": 8
      },
      {
        "key": "shuttle",
        "label": "羽毛球",
        "count": 8
      },
      {
        "key": "face",
        "label": "脸面",
        "count": 9
      }
    ],
    "player": [
      {
        "id": "p-red",
        "name": "经典红",
        "rarity": "common",
        "price": 0,
        "unlock": 0,
        "art": "img/skin/p-red.svg",
        "color": "#ff4d4d"
      },
      {
        "id": "p-orange",
        "name": "活力橙",
        "rarity": "common",
        "price": 88,
        "unlock": 0,
        "art": "img/skin/p-orange.svg",
        "color": "#ff8a3d"
      },
      {
        "id": "p-navy",
        "name": "深海蓝",
        "rarity": "common",
        "price": 88,
        "unlock": 0,
        "art": "img/skin/p-navy.svg",
        "color": "#3f6df0"
      },
      {
        "id": "p-sakura",
        "name": "樱花粉",
        "rarity": "common",
        "price": 88,
        "unlock": 0,
        "art": "img/skin/p-sakura.svg",
        "color": "#ff7bac"
      },
      {
        "id": "p-flame",
        "name": "烈焰少年",
        "rarity": "rare",
        "price": 158,
        "unlock": 0,
        "art": "img/skin/p-flame.svg",
        "color": "#ff5a2e"
      },
      {
        "id": "p-shinobi",
        "name": "影忍",
        "rarity": "rare",
        "price": 178,
        "unlock": 0,
        "art": "img/skin/p-shinobi.svg",
        "color": "#2a3d66"
      },
      {
        "id": "p-shadow",
        "name": "影分身",
        "rarity": "rare",
        "price": 178,
        "unlock": 0,
        "art": "img/skin/p-shadow.svg",
        "color": "#000000"
      },
      {
        "id": "p-white",
        "name": "纯白分身",
        "rarity": "rare",
        "price": 178,
        "unlock": 0,
        "art": "img/skin/p-white.svg",
        "color": "#ffffff"
      },
      {
        "id": "p-blossom",
        "name": "樱花少女",
        "rarity": "epic",
        "price": 288,
        "unlock": 3,
        "art": "img/skin/p-blossom.svg",
        "color": "#ff8fb8"
      },
      {
        "id": "p-cyber",
        "name": "赛博骇客",
        "rarity": "epic",
        "price": 328,
        "unlock": 4,
        "art": "img/skin/p-cyber.svg",
        "color": "#19d3a2"
      },
      {
        "id": "p-king",
        "name": "球场之王",
        "rarity": "legendary",
        "price": 888,
        "unlock": 8,
        "art": "img/skin/p-king.svg",
        "color": "#f5f2e6"
      },
      {
        "id": "p-sprout",
        "name": "萌芽豆丁",
        "rarity": "rare",
        "price": 168,
        "unlock": 0,
        "art": "img/skin/p-sprout.svg",
        "color": "#4fae5a"
      },
      {
        "id": "p-cat",
        "name": "猫系少女",
        "rarity": "epic",
        "price": 328,
        "unlock": 5,
        "art": "img/skin/p-cat.svg",
        "color": "#b06bff"
      },
      {
        "id": "p-sage",
        "name": "金羽宗师",
        "rarity": "legendary",
        "price": 888,
        "unlock": 8,
        "art": "img/skin/p-sage.svg",
        "color": "#e8e4f0"
      }
    ],
    "families": 39
  },
  "rarity": {
    "common": {
      "name": "经典",
      "color": "#8a93a8"
    },
    "rare": {
      "name": "稀有",
      "color": "#3ea6ff"
    },
    "epic": {
      "name": "史诗",
      "color": "#b06bff"
    },
    "legendary": {
      "name": "传说",
      "color": "#ffb020"
    }
  },
  "courts": [
    {
      "id": "arena",
      "name": "黄昏馆",
      "title": "黄昏球馆",
      "sub": "COURT 01 · DUSK ARENA",
      "tag": "室内专业",
      "desc": "工业钢架与阶梯看台，温暖聚光灯下的专业赛场",
      "accent": "#ffe14d"
    },
    {
      "id": "beach",
      "name": "海滩场",
      "title": "阳光海滩",
      "sub": "COURT 02 · SUNNY BEACH",
      "tag": "露天沙滩",
      "desc": "海风微拂、椰林与浪花翻滚的热带度假沙滩",
      "accent": "#38bdf8"
    },
    {
      "id": "cyber",
      "name": "赛博场",
      "title": "赛博霓虹",
      "sub": "COURT 03 · CYBER NEON",
      "tag": "霓虹暗夜",
      "desc": "摩天大楼数码矩阵与激光扫描的未来都市夜市",
      "accent": "#f43f5e"
    },
    {
      "id": "dojo",
      "name": "竹林道场",
      "title": "竹林道场",
      "sub": "COURT 04 · BAMBOO DOJO",
      "tag": "和风古韵",
      "desc": "青岚水墨竹林、和纸灯笼与草编榻榻米",
      "accent": "#4ade80"
    }
  ],
  "drills": [
    {
      "id": "smash",
      "label": "后场重杀",
      "tag": "SMASH",
      "desc": "跳起来把球压下去",
      "goal": 3
    },
    {
      "id": "clear",
      "label": "高远对拉",
      "tag": "CLEAR",
      "desc": "把球顶到对方底线",
      "goal": 3
    },
    {
      "id": "slash",
      "label": "网前点杀",
      "tag": "SLASH",
      "desc": "高点球收力点到前场",
      "goal": 3
    },
    {
      "id": "netshot",
      "label": "网前搓放",
      "tag": "NET",
      "desc": "贴网低球搓近网短球",
      "goal": 3
    },
    {
      "id": "drive",
      "label": "平抽快挡",
      "tag": "DRIVE",
      "desc": "中场快球又平又深地顶回去",
      "goal": 3
    },
    {
      "id": "lob",
      "label": "低位挑高",
      "tag": "LOB",
      "desc": "贴地低球铲起来过渡",
      "goal": 3
    }
  ],
  "chapters": [
    "阳光海滩",
    "竹林道场",
    "赛博街区",
    "黄昏馆"
  ],
  "tutorial": [
    {
      "id": "move",
      "label": "移动",
      "lines": [
        "按住屏幕下方的滑轨,按哪里都行",
        "左右拖动:手指在哪,人就在哪",
        "松手,人立刻停住"
      ]
    },
    {
      "id": "hit",
      "label": "击球",
      "lines": [
        "按「击球」键就挥拍,不用蓄力",
        "按住向右滑 = 打深球,向左滑 = 放网前",
        "按住向上滑 = 挑高球,向下滑 = 平抽快球",
        "球到身前肩高再按,回球又快又准"
      ]
    },
    {
      "id": "jump",
      "label": "起跳",
      "lines": [
        "手指按在滑轨上,向上快速一滑 = 起跳",
        "也可以在滑轨上快速双击起跳",
        "跳起来能打到高球,还能扣杀"
      ]
    }
  ],
  "accessories": {
    "total": 47,
    "slots": [
      "肤色",
      "体型",
      "发型",
      "上衣",
      "脸面",
      "光环",
      "头饰",
      "面饰",
      "颈饰",
      "手部",
      "球鞋",
      "球袜"
    ]
  },
  "gestures": [
    {
      "dir": "→",
      "name": "右滑",
      "desc": "打深球，压底线"
    },
    {
      "dir": "←",
      "name": "左滑",
      "desc": "放网前，短球"
    },
    {
      "dir": "↑",
      "name": "上滑",
      "desc": "挑高球到后场"
    },
    {
      "dir": "↓",
      "name": "下滑",
      "desc": "平抽快球"
    },
    {
      "dir": "⇢",
      "name": "长滑",
      "desc": "滑出按键浮现锁定，松手锁向"
    }
  ],
  "touchAim": {
    "commitPx": 10,
    "commitPxY": 16
  }
};
