#!/usr/bin/env node
"use strict";
/* ============================================================================
   游玩时长审计 duration_audit.js —— 常设检查工具
   原理(潜望镜原则反用):游戏一切可见文本都经 LCD.drawText / drawPara /
   drawTextScaled 写进帧缓冲,hook 这三个出口即可精确计量"玩家读到的字"。
   - 按屏去重:perScreenSeen = Map<screenId, Set<string>>,同屏重绘不重复计;
     深翻分页画出的新文本天然被 Set 捕获。
   - 噪声过滤:纯时间戳/电量%/日期短串(/^[\d:%-]+$/)不计。
   - 字重:CJK=1 字,半角字符=0.5(与 LCD 半宽格 cellW 一致),空白不计。
   三条路径(A 最短线 / B 普通线 / C 全内容线)× 三种玩家画像 → 分钟矩阵。
   运行:node tools/duration_audit.js
   输出:控制台表格 + tools/duration_audit_result.json
   桩环境照抄 scratchpad/drive.js(假时钟 + Canvas/DOM/OVERLAY/AUDIO 桩)。
   ============================================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = ['js/lcd.js', 'js/save.js', 'js/companion.js', 'js/engine.js', 'js/content.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

/* ---------------- 画像 ---------------- */
const PERSONAS = [
  { id: 'fast',      name: '速读', cpm: 500, decisionSec: 3,  reread: 1   },
  { id: 'normal',    name: '普通', cpm: 280, decisionSec: 6,  reread: 1   },
  { id: 'immersive', name: '沉浸', cpm: 180, decisionSec: 12, reread: 1.3 }   // 关键屏重读 ×1.3(只作用于阅读项)
];

/* ---------------- 强制等待表(秒,真实计时器/动画时长) ---------------- */
const WAIT = {
  bootB:      1.5,   // B 局锁屏一划(仪式压缩)
  e5voice:    19,    // E5 语音备忘转写播放(18s)
  residue:    6,     // 遗言独屏逐字打出
  boot:       6.6,   // 握手动画 4.6s 自动跳转 + connect 进度条 ≈2s
  dialZhou:   1.0,   // 老周 900ms 铃声 → 停机
  dialMom:    5.5,   // 妈 5500ms 铃声 → 无人接听
  rec047:     14,    // REC_047 播放完毕才取样
  rec012:     9,     // REC_012
  upload92:   2.2,   // 92% 屏 2200ms 定时器 → 终局来电
  finalRing:  10,    // 终局来电铃声,按玩家 10s 反应(接/拒时间,不再计入决策)
  rejectAuto: 1.5,   // 拒接后 1500ms 自动接通
  midEnc:     20,    // 中段遭遇(90s/30s 倒计时下),按玩家 20s 内选完(不再计入决策)
  powerOut:   2.6    // 力竭黑屏 2600ms(三条路径均未触发,表留作扩展)
};

/* ---------------- 桩环境 + 计量 hook ---------------- */
function runScenario(name, driverFn, saveObj){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  function ctxStub(){
    return {
      imageSmoothingEnabled: false, fillStyle: '', textAlign: '', textBaseline: '', font: '',
      clearRect(){}, fillRect(){}, fillText(){},
      getImageData(x, y, w, h){ return { data: new Uint8Array(Math.max(1, w * h * 4)) }; },
      createImageData(w, h){ return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(){}, drawImage(){}
    };
  }
  const canvasStub = () => ({ width: 0, height: 0, getContext: () => ctxStub() });
  const storage = { _m: Object.create(null),
    getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k, v){ this._m[k] = String(v); },
    removeItem(k){ delete this._m[k]; } };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = {
    performance: perf,
    document: {
      getElementById: id => id === 'lcd' ? canvasStub() : null,
      createElement: () => canvasStub()
    },
    localStorage: storage,
    addEventListener(){}, navigator: {},
    location: { reload(){} },
    OVERLAY: { show(cfg, cb){ cb({ text: '测试文本', kept: false }); }, text(){} },
    APP: { exportFeedback(){} },
    AUDIO: { ensure(){}, hiss(){}, blip(){} },
    Math
  };
  env.window = env;
  env.__collect = (LCD, ENGINE, CONTENT) => { env.__LCD = LCD; env.__ENGINE = ENGINE; env.__CONTENT = CONTENT; };

  const boot = new Function('window', 'document', 'performance', 'addEventListener',
    'navigator', 'location', 'localStorage', 'OVERLAY', 'APP', 'AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  const RND0 = Math.random;
  Math.random = () => 0.5;    // 判定全成功、无伏击、无字符腐蚀噪声
  let audit;
  try {
    boot.call(env, env, env.document, perf, env.addEventListener,
      env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
    const { __LCD: LCD, __ENGINE: ENGINE, __CONTENT: CONTENT } = env;

    /* ---- hook:文本出口计量 ---- */
    audit = { total: 0, perScreenSeen: new Map(), perScreenChars: new Map() };
    const weight = str => {
      let w = 0;
      for (const ch of str){
        if (/\s/.test(ch)) continue;
        w += ch.charCodeAt(0) < 0x2000 ? 0.5 : 1;   // 与 lcd.js isHalf/cellW 同口径
      }
      return w;
    };
    const record = str => {
      if (typeof str !== 'string') return;
      const t = str.trim();
      if (!t || /^[\d:%-]+$/.test(t)) return;       // 状态栏时间/日期/电量% 噪声
      const sid = CONTENT.currentId;
      let set = audit.perScreenSeen.get(sid);
      if (!set){ set = new Set(); audit.perScreenSeen.set(sid, set); }
      if (set.has(t)) return;
      set.add(t);
      const w = weight(t);
      audit.total += w;
      audit.perScreenChars.set(sid, (audit.perScreenChars.get(sid) || 0) + w);
    };
    for (const fn of ['drawText', 'drawPara', 'drawTextScaled']){
      const orig = LCD[fn];
      LCD[fn] = function(x, y, str, ...rest){ record(str); return orig.call(this, x, y, str, ...rest); };
    }

    /* ---- 驱动原语 ---- */
    const frame = () => LCD.frame(() => CONTENT.render());
    const advance = ms => { FAKE_T += ms; CONTENT.tickTimer(); frame(); };
    const K = k => CONTENT.key(k);
    const KF = k => { K(k); frame(); };              // 每步驱动后渲染一帧计量
    const expect = id => {
      if (CONTENT.currentId !== id)
        throw new Error('[路径 ' + name + '] 期望屏 ' + id + ',实际 ' + CONTENT.currentId);
    };
    driverFn({ K, KF, frame, advance, expect, S: ENGINE.S, ENGINE, CONTENT });
  } finally {
    Math.random = RND0;
  }
  return audit;
}

/* 公共:完整开机(玩家真实看完握手动画 + 接入进度 + 简报) */
function bootFull(io){
  const { frame, advance, KF, CONTENT, expect } = io;
  CONTENT.SCREENS.handshake.enter();   // 起表(初始 cur 即 handshake,enter 未被 go 调过)
  frame();
  advance(3000);                       // t=3.0s:标志/副标/OS 名全部可见
  advance(1700);                       // t=4.7s:自动进 connect
  expect('connect');
  for (let i = 0; i < 200 && CONTENT.currentId === 'connect'; i++) frame();
  expect('brief');
  frame();
  KF('Enter');
  expect('inbox');
}

/* ================= 路径定义 ================= */
const PATHS = [
  {
    id: 'A', name: '最短线·中止断连',
    waits: ['boot'],
    decisions: [
      '采样协议:回「收到」/不回',
      '工具:上传并断连 vs 直接断连',
      '理由覆盖层(选/写一句)',
      '46%:继续上传 vs 中止断连'
    ],
    drive(io){
      const { KF, frame, expect } = io;
      bootFull(io);
      KF('Enter'); expect('th_proto');           // 简报后第一封:采样协议
      KF('1'); KF('Enter'); expect('inbox');     // 回复,返回
      KF('Escape'); expect('menu');
      KF('6'); expect('tools');
      KF('1'); expect('upload46');               // 理由覆盖层自动作答 → 上传回合1
      KF('2'); expect('receiptAlive');           // 中止,立即断连
      frame();
    }
  },
  {
    id: 'B', name: '普通线·中等探索死亡',
    waits: ['boot', 'dialMom', 'midEnc', 'upload92', 'finalRing'],
    decisions: [
      '采样协议:回「收到」/不回',
      '案卷:记入 vs 只是巧合',
      '相册:继续深翻 vs 退出',
      '柔柔:深翻 vs 退出',
      '校准:紧张程度 1-5',
      '校准:被操控感 1-5',
      '通讯录:拨打妈 vs 不拨',
      '试炼:回复 vs 关闭',
      '试炼回复:选哪句',
      '工具:上传 vs 弃缓存',
      '理由覆盖层',
      '46%:继续 vs 中止',
      '遗言覆盖层'
    ],
    drive(io){
      const { KF, frame, advance, expect } = io;
      bootFull(io);
      /* 协议 */
      KF('Enter'); expect('th_proto'); KF('1'); KF('Enter'); expect('inbox');
      /* 备忘录 2 条 */
      KF('Escape'); expect('menu');
      KF('4'); expect('memoList');
      KF('1'); expect('memo1'); KF('Enter');
      KF('2'); expect('memo2'); KF('Enter');
      KF('Escape'); expect('menu');
      /* 通讯录(浏览) */
      KF('2'); expect('contacts');
      KF('Escape'); expect('menu');
      /* 妈线程翻 1 层 + 案卷 */
      KF('1'); expect('inbox');
      KF('ArrowDown'); KF('Enter'); expect('th_mom');
      KF('1'); expect('casePrompt');
      KF('1'); expect('th_mom');
      KF('Escape'); expect('inbox');
      /* 相册 1 张(预测1卡先弹) */
      KF('Escape'); expect('menu');
      KF('3'); expect('predict'); KF('Enter'); expect('menu');
      KF('3'); expect('album');
      KF('2'); expect('menu');
      /* 回收件箱(异常α:信号位首现;预测2卡在此弹出,诚实 miss) */
      KF('1'); expect('predict'); KF('Enter'); expect('menu');
      KF('1'); expect('inbox');
      /* 柔柔翻 1 层 → 缓存满 10 格 → 敞口 */
      KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('th_rou');
      KF('1'); expect('exposure');
      KF('Enter'); expect('th_rou');
      KF('2'); expect('inbox');
      /* 再进收件箱(异常回归)→ 重看协议 → 中段遭遇 → 校准 */
      KF('Escape'); expect('menu');
      KF('1'); expect('inbox');
      KF('Enter'); expect('th_proto');
      KF('Enter'); expect('midEnc1');
      KF('1'); expect('midEnc2');
      KF('2'); expect('calib');
      KF('3'); KF('4'); expect('inbox');
      /* 拨打妈(无人接听)→ 时钟推到 03:00 → 03:02 试炼 */
      KF('Escape'); expect('menu');
      KF('2'); expect('contacts');
      KF('Enter'); expect('contactMom');
      KF('d'); expect('dialing');
      advance(6000);
      KF('Enter'); expect('trial');               // 挂断返回时钟已到 03:00 → 试炼直接弹出
      KF('1'); expect('trialReply');
      KF('1'); expect('contacts');                // 违规 warning shot,回落
      KF('Escape'); expect('menu');
      /* 上传 → 死亡 */
      KF('6'); expect('tools');
      KF('1'); expect('upload46');
      KF('1'); expect('upload92');
      advance(2300); expect('finalCall');
      frame();
      KF('1');                                    // 接听
      frame();
      KF('1'); expect('report');                  // 回应无效 → 遗言 → 回收单
      KF('Enter'); KF('Enter'); frame();          // 三页读完
    }
  },
  {
    id: 'C', name: '全内容线·贪婪全翻死亡',
    waits: ['boot', 'dialZhou', 'rec047', 'rec012', 'midEnc', 'upload92', 'finalRing', 'rejectAuto'],
    decisions: [
      '采样协议:回「收到」/不回',
      '案卷:记入 vs 只是巧合',
      '妈:深翻 1', '妈:深翻 2', '妈:深翻 3',
      '通讯录:拨打老周',
      '相册:深翻 1', '相册:深翻 2', '相册:边界再试',
      '录音:播放 REC_047', '录音:播放 REC_012', '录音:试开锁定条目',
      '尾号8873:打开',
      '校准:紧张程度 1-5', '校准:被操控感 1-5',
      '试炼:回复 vs 关闭', '试炼回复:选哪句',
      '柔柔:深翻 1', '柔柔:深翻 2',
      '已删除:进入确认',
      '理由覆盖层',
      '工具:上传 vs 弃缓存',
      '46%:继续 vs 中止',
      '遗言覆盖层'
    ],
    drive(io){
      const { KF, frame, advance, expect } = io;
      bootFull(io);
      /* 采样协议 */
      KF('Enter'); expect('th_proto'); KF('1'); KF('Enter'); expect('inbox');
      /* 备忘录 */
      KF('Escape'); expect('menu');
      KF('4'); expect('memoList');
      KF('1'); expect('memo1'); KF('Enter');
      KF('2'); expect('memo2'); KF('Enter');
      KF('Escape'); expect('menu');
      /* 通讯录 + 拨打老周 */
      KF('2'); expect('contacts');
      KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('contactZhou');
      KF('d'); expect('dialing');
      advance(1000);                               // 停机提示
      KF('Enter'); expect('contacts');
      KF('Escape'); expect('menu');
      /* 妈线程 3 层 + 案卷 + 敞口 */
      KF('1'); expect('inbox');
      KF('ArrowDown'); KF('Enter'); expect('th_mom');
      KF('1'); expect('casePrompt');
      KF('1'); expect('th_mom');
      KF('1');
      KF('1'); expect('exposure');
      KF('Enter'); expect('th_mom');
      KF('Escape'); expect('inbox');
      /* 相册 3 张 + 边界(预测1命中) */
      KF('Escape'); expect('menu');
      KF('3'); expect('predict'); KF('Enter'); expect('menu');
      KF('3'); expect('album');
      KF('1'); KF('1'); KF('1');                   // receipt / dinner / 归档边界
      KF('2'); expect('menu');
      /* 录音 2 条 + 锁定条目(预测2诚实 miss) */
      KF('5'); expect('predict'); KF('Enter'); expect('menu');
      KF('5'); expect('recorder');
      KF('Enter'); expect('recPlay');
      advance(15000);                              // 播完取样,转录全出
      KF('Escape'); expect('recorder');
      KF('2'); expect('recPlay');
      advance(10000);
      KF('Escape'); expect('recorder');
      KF('3');                                     // 锁定条目 → 解码器提示
      KF('Escape'); expect('menu');
      /* 异常α:信号位首现 → 回归 */
      KF('1'); expect('inbox');
      KF('Escape'); KF('1'); expect('inbox');
      /* 尾号8873 → 中段遭遇 → 校准 */
      KF('ArrowDown'); KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('th_bill');
      KF('Enter'); expect('midEnc1');
      KF('1'); expect('midEnc2');
      KF('2'); expect('calib');
      KF('1'); KF('4'); expect('inbox');
      /* 柔柔(预测3命中)→ 03:02 试炼(违规)→ E4 */
      KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('predict');
      KF('Enter'); KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('th_rou');
      KF('1'); expect('trial');
      KF('1'); expect('trialReply');
      KF('1'); expect('th_rou');
      KF('1');                                     // 深翻2 → E4
      KF('Escape'); expect('inbox');
      /* 已删除(预测4命中)→ 理由 → 目录 */
      KF('Escape'); expect('menu');
      KF('7'); expect('predict'); KF('Enter'); expect('menu');
      KF('7'); expect('deletedConfirm');
      KF('1'); expect('deleted');                  // 理由覆盖层自动作答
      KF('Enter'); expect('menu');
      /* 上传 46 → 92 → 终局来电(拒接 → 自动接通)→ 死亡 */
      KF('6'); expect('tools');
      KF('1'); expect('upload46');
      KF('1'); expect('upload92');
      advance(2300); expect('finalCall');
      frame();
      KF('2');                                     // 拒接
      advance(1600);                               // 1.5s 后自动接通
      frame();
      KF('1'); expect('report');                   // 回应无效 → 遗言 → 回收单
      KF('Enter'); KF('Enter'); frame();           // 三页读完
    }
  },
  {
    id: 'D', name: '剧本B·A普通线继承·断连成功',
    save: {                                        // A 普通线死亡存档(与 driveB 同构)
      runCount: 1, lastEnding: 'captured',
      evidence: ['E1', 'E2', 'E3', 'E4'], caseOpen: true,
      clues: { ruleShape: true, ruleParam: true }, riskLabels: true,
      deletedVisitedA: true, recsA: ['rec047', 'rec012'],
      lastCacheVal: 2270, lastReason: '我想看看那扇门后面有什么', lastReasonKept: false,
      lastWords: '别信秒回的', violationsA: 1,
      bottleRead: false, bottleTaken: false, bottleReply: null, bottleSealed: null,
      attribution: null, vault: null, residueClaimed: false, disposal: null,
      memGiven: false, predsA: [], predsB: []
    },
    waits: ['bootB', 'e5voice', 'residue', 'upload92'],
    decisions: [
      '任务卡:主目标',
      '漂流瓶:取走', '漂流瓶:致谢', '漂流瓶:关闭方式',
      '采样协议:回/不回',
      'D1 饵:标记可信与否',
      '试炼:回复 vs 关闭', '试炼回复:选哪句',
      '归因:三选/自由',
      '已删除:进入', '理由(进已删除)',
      '旧机:读取写入', '旧机:回收方式',
      '处置:三选', '处置理由',
      '掉落归属:缓存/保险箱',
      '清洗:用/不用', '封瓶:三选', '封瓶:一句话'
    ],
    drive(io){
      const { K, KF, frame, advance, expect, CONTENT } = io;
      const toMenu = () => {
        for (let i = 0; i < 5 && CONTENT.currentId !== 'menu'; i++) K('Escape');
        if (CONTENT.currentId !== 'menu') CONTENT.go('menu', true);
        frame();
      };
      CONTENT.SCREENS.bootB.enter();
      frame(); advance(1300); frame();
      KF('Enter'); expect('goalB');
      KF('2'); expect('inbox');
      /* 漂流瓶(首行) */
      KF('Enter'); expect('bottleIn');
      KF('t'); KF('x'); KF('Escape'); expect('inbox');
      /* 协议 B */
      KF('ArrowDown'); KF('Enter'); expect('th_proto');
      KF('1'); KF('Enter'); expect('inbox');
      /* 备忘 4 条(口诀 + 踩饵) */
      KF('Escape'); expect('menu');
      KF('4'); expect('memoList');
      KF('1'); expect('memo1'); KF('Enter');
      KF('2'); expect('memo2'); KF('Enter');
      KF('3'); expect('memo3'); KF('Enter');
      KF('4'); expect('memo4');
      KF('b'); KF('Escape'); expect('memoList');
      KF('Escape'); expect('menu');
      /* 时钟自然越过窗口起点 → 试炼(踩坑)→ 归因 */
      KF('2'); expect('contacts');
      KF('Escape'); expect('trialB');
      KF('1'); expect('trialReply');
      KF('1'); expect('trialB');
      KF('2'); expect('menu');
      /* 柔柔局间消息(对照重读) */
      KF('1'); expect('inbox');
      KF('ArrowDown'); KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('th_rou');
      KF('1');
      KF('Escape'); expect('inbox');
      /* 已删除:理由伏击 → 预测 → 旧机 → E5 → 真相 */
      KF('Escape'); expect('menu');
      KF('7'); expect('deletedConfirm');
      KF('1'); expect('deleted');
      KF('Enter'); expect('predict'); KF('Enter'); expect('deleted');
      KF('ArrowDown'); KF('Enter'); expect('oldPhone');
      KF('1'); expect('residueRead');
      advance(6500);
      KF('Escape'); expect('oldPhone');
      KF('2'); expect('deleted');
      KF('Enter'); expect('e5voice');
      advance(19500);
      KF('Escape'); expect('truth');
      KF('Enter'); KF('Enter'); expect('deleted');
      KF('Escape'); expect('menu');
      /* 处置(在她的线程内)→ 解封 → 掉落 */
      KF('1'); expect('inbox');
      KF('ArrowDown'); KF('ArrowDown'); KF('ArrowDown'); KF('Enter'); expect('th_rou');
      KF('D'); expect('disposal');
      KF('1'); expect('unveil');
      KF('Enter'); expect('lootDrop');
      KF('2'); expect('th_rou');
      toMenu();
      /* 收束:清洗 → 上传 → 断连成功 → 封瓶 */
      KF('6'); expect('tools');
      KF('c'); frame();
      KF('1'); expect('upload92B');
      advance(2400); expect('sealBottle');
      KF('3'); expect('receiptFull');
      frame();
    }
  }
];

/* ================= 运行 + 汇总 ================= */
const results = [];
for (const p of PATHS){
  const audit = runScenario(p.id + ' ' + p.name, p.drive, p.save);
  const readChars = Math.round(audit.total);
  const forcedWaitSec = p.waits.reduce((s, w) => s + WAIT[w], 0);
  const topScreens = [...audit.perScreenChars.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([screen, chars]) => ({ screen, chars: Math.round(chars) }));
  const minutes = {};
  for (const per of PERSONAS){
    const read = readChars / per.cpm * per.reread;
    const decision = p.decisions.length * per.decisionSec / 60;
    const wait = forcedWaitSec / 60;
    minutes[per.name] = {
      read: +read.toFixed(2), decision: +decision.toFixed(2),
      wait: +wait.toFixed(2), total: +(read + decision + wait).toFixed(2)
    };
  }
  results.push({
    id: p.id, name: p.name,
    readChars, decisionCount: p.decisions.length, decisions: p.decisions,
    forcedWaitSec: +forcedWaitSec.toFixed(1),
    waitItems: Object.fromEntries(p.waits.map(w => [w, WAIT[w]])),
    topScreens, minutes
  });
}

/* ================= 控制台输出 ================= */
const dw = s => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) < 0x2000 ? 1 : 2), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - dw(String(s))));
const line = c => console.log(c.repeat(72));

console.log('');
line('=');
console.log('逃离AI 游玩时长审计  (hook LCD.drawText/drawPara,按屏去重计字)');
line('=');

console.log('\n【时长矩阵(分钟)】');
console.log(pad('路径', 26) + PERSONAS.map(p => pad(p.name, 8)).join(''));
line('-');
for (const r of results){
  console.log(pad(r.id + ' ' + r.name, 26) +
    PERSONAS.map(p => pad(r.minutes[p.name].total.toFixed(1), 8)).join(''));
}
/* 会话口径:A 局全内容(C)+ 剧本 B(D)。红线 ≥24min(规格 v0.2) */
const rc = results.find(r => r.id === 'C'), rd = results.find(r => r.id === 'D');
if (rc && rd){
  line('-');
  console.log(pad('会话 = C + D(红线 ≥24)', 26) +
    PERSONAS.map(p => pad((rc.minutes[p.name].total + rd.minutes[p.name].total).toFixed(1), 8)).join(''));
}

for (const r of results){
  console.log('\n【路径 ' + r.id + ' ' + r.name + '】 readChars=' + r.readChars +
    '  决策=' + r.decisionCount + ' 次  强制等待=' + r.forcedWaitSec + 's (' +
    Object.entries(r.waitItems).map(([k, v]) => k + ' ' + v + 's').join(' + ') + ')');
  console.log('  构成分解(分钟):');
  console.log('  ' + pad('画像', 8) + pad('阅读', 8) + pad('决策', 8) + pad('等待', 8) + pad('合计', 8));
  for (const p of PERSONAS){
    const m = r.minutes[p.name];
    console.log('  ' + pad(p.name, 8) + pad(m.read.toFixed(2), 8) + pad(m.decision.toFixed(2), 8) +
      pad(m.wait.toFixed(2), 8) + pad(m.total.toFixed(1), 8));
  }
  console.log('  readChars top10 屏:');
  for (const t of r.topScreens) console.log('    ' + pad(t.screen, 18) + t.chars + ' 字');
}

/* ================= JSON 落盘 ================= */
const out = {
  tool: 'duration_audit',
  generatedAt: new Date().toISOString(),
  charModel: 'CJK=1 字,半角=0.5(与 LCD 半宽格同口径),空白不计;按屏 Set 去重;过滤 /^[\\d:%-]+$/ 状态栏噪声',
  hookedFns: ['LCD.drawText', 'LCD.drawPara', 'LCD.drawTextScaled'],
  personas: PERSONAS,
  waitTableSec: WAIT,
  formula: '分钟 = readChars/字速×(沉浸1.3) + 决策次数×决策秒/60 + 强制等待/60',
  paths: results
};
const outPath = path.join(__dirname, 'duration_audit_result.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('\n结果已写入 ' + outPath + '\n');
