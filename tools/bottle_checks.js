"use strict";
/* 漂流瓶信道:四张 canon NPC 采样员的瓶(D-112 新增 #8891-R)。
   验收:轮换(没读过的优先) / 四条 14③ 文案纪律 / 无附件瓶不给东西 / 查扣反事实 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function mkEnv(saveObj){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  const ctxStub = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data: new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; },
    putImageData(){}, drawImage(){} });
  const canvasStub = () => ({ width:0, height:0, getContext: () => ctxStub() });
  const storage = { _m: Object.create(null),
    getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k] = String(v); }, removeItem(k){ delete this._m[k]; } };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const LOG = [];
  const env = {
    performance: perf,
    document: { getElementById: id => id==='lcd'?canvasStub():null, createElement: () => canvasStub() },
    localStorage: storage, addEventListener(){}, navigator: {},
    location: { reload(){} },
    OVERLAY: { show(cfg,cb){ LOG.push('OVL:'+cfg.title); cb({ text:'测试文本', kept:false }); }, text(){} },
    APP: { exportFeedback(){} }, AUDIO: { ensure(){}, hiss(){}, blip(){} },
    HOLD: { active:false }, Math
  };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const boot = new Function('window','document','performance','addEventListener','navigator',
    'location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  boot.call(env, env, env.document, perf, env.addEventListener, env.navigator,
            env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const { __LCD:LCD, __ENGINE:ENGINE, __CONTENT:CONTENT } = env;
  let ft = [];
  for (const fn of ['drawText','drawPara','drawTextScaled']){
    const o = LCD[fn];
    LCD[fn] = function(x,y,str,...r){ if (typeof str === 'string') ft.push(str); return o.call(this,x,y,str,...r); };
  }
  return { LCD, ENGINE, CONTENT, env, LOG, storage,
    frame: () => { ft = []; LCD.frame(() => CONTENT.render()); return ft.join('|'); },
    tick: ms => { FAKE_T += ms; CONTENT.tickTimer(); },
    sav: () => JSON.parse(storage.getItem('escape_ai_save') || 'null') };
}

function scenario(name, saveObj, fn){
  const errs = [];
  const RND0 = Math.random;
  try {
    const g = mkEnv(saveObj);
    fn(Object.assign(g, { A: (c,m) => { if (!c) errs.push(m); },
                          K: k => g.CONTENT.key(k), S: g.ENGINE.S,
                          rnd: v => { Math.random = () => v; } }));
  } catch(e){ errs.push('异常: ' + e.message + ' @ ' + (e.stack.split('\n')[1]||'').trim()); }
  Math.random = RND0;
  if (errs.length){ failures++; console.log('X [' + name + ']'); errs.forEach(e => console.log('   - ' + e)); }
  else console.log('OK [' + name + ']');
}

const BASE = {
  runCount:1, lastEnding:'captured', evidence:['E1','E2','E3','E4'], caseOpen:true,
  clues:{ruleShape:true,ruleParam:true}, deletedVisitedA:true, recsA:['rec047','rec012'],
  lastCacheVal:2270, lastReason:'我想看看那扇门后面有什么', lastWords:'别信秒回的',
  bottleSealed:null, vault:null, residueClaimed:false, disposal:null, memGiven:false,
  predsA:[], predsB:[], history:[{inst:'#7741-A',kind:'captured',cacheVal:2270,ev:4}]
};
const save = extra => Object.assign({}, BASE, extra);

/* ---- 1. 轮换:没读过的优先 ---- */
scenario('轮换1: 只剩 #5502-D 没读过 -> 必给它', save({ seenBottles: ['#3120-K','#1177-B','#8891-R'] }), g => {
  const { A, CONTENT, frame } = g;
  CONTENT.go('bottleIn', true);
  const t = frame();
  A(t.includes('#5502-D'), '应给 #5502-D,实际帧: ' + t.slice(0, 90));
  A(g.S.bottleId === '#5502-D', 'bottleId 记录');
});
scenario('轮换2: 只剩 #3120-K 没读过 -> 必给它', save({ seenBottles: ['#5502-D','#1177-B','#8891-R'] }), g => {
  const { A, CONTENT, frame } = g;
  CONTENT.go('bottleIn', true);
  const t = frame();
  A(t.includes('#3120-K'), '应给 #3120-K,实际帧: ' + t.slice(0, 90));
  A(t.includes('先传,再贪'), '她的原话应在瓶面');
});
scenario('轮换3: 只剩 #1177-B 没读过 -> 必给它', save({ seenBottles: ['#5502-D','#3120-K','#8891-R'] }), g => {
  const { A, CONTENT, frame } = g;
  CONTENT.go('bottleIn', true);
  const t = frame();
  A(t.includes('#1177-B'), '应给 #1177-B,实际帧: ' + t.slice(0, 90));
  A(t.includes('#6404-C'), '他在替 #6404-C 传话——世界纵深');
});
scenario('轮换4: 只剩 #8891-R 没读过 -> 必给它', save({ seenBottles: ['#5502-D','#3120-K','#1177-B'] }), g => {
  const { A, CONTENT, frame } = g;
  CONTENT.go('bottleIn', true);
  const t = frame();
  A(t.includes('#8891-R'), '应给 #8891-R,实际帧: ' + t.slice(0, 90));
});
scenario('轮换5: 四张都读过 -> 仍能给出一张(不空)', save({ seenBottles: ['#5502-D','#3120-K','#1177-B','#8891-R'] }), g => {
  const { A, CONTENT, frame } = g;
  CONTENT.go('bottleIn', true);
  const t = frame();
  A(/#5502-D|#3120-K|#1177-B|#8891-R/.test(t), '读全后仍应随机给一张');
});

/* ---- 2. 四条 14③ 文案纪律(逐张核对;D-112 新增 #8891-R 后 3→4) ---- */
scenario('文案纪律: 四张 NPC 瓶用「我那次」句式 + 都不是恶意', save({}), g => {
  const { A } = g;
  const src = fs.readFileSync(ROOT + '/js/content.js', 'utf8');
  /* 精确框定 BOTTLE_POOL 数组本身(到它自己的 `];`),不吃后面的 OWN_BOTTLE */
  const start = src.indexOf('const BOTTLE_POOL = [');
  const block = src.slice(start, src.indexOf('\n  ];', start));
  ['#5502-D','#3120-K','#1177-B','#8891-R'].forEach(id => {
    A(block.includes(id), '瓶 ' + id + ' 应在表中');
  });
  const bodies = block.split('body:').slice(1);
  A(bodies.length === 4, '四张 NPC 瓶应有 4 条 body,实际 ' + bodies.length);
  bodies.forEach((b, i) => {
    A(/我那次/.test(b), '第 ' + (i+1) + ' 张必须含「我那次」(归因载体),实际: ' + b.slice(0, 60));
  });
  A(!/一定|必须|永远都/.test(block), '瓶面不得断言全局真理');
});

/* ---- 2b. 恐怖游轮化 · 你自己的信:另一套纪律(只种钉子,不套 NPC 句式) ---- */
scenario('文案纪律: 你自己的信只两句、不解释机制、非恶意', save({}), g => {
  const { A } = g;
  const src = fs.readFileSync(ROOT + '/js/content.js', 'utf8');
  const m = src.match(/const OWN_BOTTLE = \{[\s\S]*?body:\s*'([^']*)'/);
  A(!!m, '应能取到 OWN_BOTTLE.body');
  const body = m ? m[1] : '';
  A(body.split('\\n').length <= 2, '只两句(≤2 行),实际: ' + body);
  A(!/我那次/.test(body), '不套用 NPC 的「我那次」句式');
  A(!/窗口|信号|查扣|概率|03:|删除那个/.test(body), '不解释任何机制(只种钉子)');
  A(!/[!！]/.test(body), '无感叹号');
  A(/self:\s*true/.test(src), 'OWN_BOTTLE 应标记 self');
});

/* ---- 3. 无附件的瓶:取走键不给东西 ---- */
scenario('无附件瓶: 取走无效,致谢仍可用', save({ seenBottles: ['#5502-D','#1177-B','#8891-R'] }), g => {
  const { A, K, CONTENT, frame, S } = g;
  CONTENT.go('bottleIn', true); frame();
  A(S.bottleId === '#3120-K', '应是无附件的 #3120-K');
  const bat0 = S.battery;
  K('t');
  A(!S.bottleTaken, '无附件时取走不应生效');
  A(S.battery === bat0, '不应扣电');
  K('x');
  A(S.settle.join('|').includes('致谢·已送达'), '致谢仍可用(互赖不要钱)');
});

/* ---- 4. 存档:读过的瓶记进 seenBottles ---- */
scenario('存档: 读过的瓶写入 seenBottles', save({ seenBottles: ['#3120-K'] }), g => {
  const { A, K, CONTENT, frame, S, tick } = g;
  g.rnd(0.5);
  CONTENT.go('bottleIn', true); frame();
  const got = S.bottleId;
  A(got === '#5502-D' || got === '#1177-B' || got === '#8891-R', '应给没读过的三张之一,实际 ' + got);
  /* 走到结局写档 */
  S.alive = true; S.uploadedOK = true;
  CONTENT.go('receiptFull', true); frame();
  const sv = g.sav();
  A(sv.seenBottles.indexOf('#3120-K') >= 0, '旧记录保留');
  A(sv.seenBottles.indexOf(got) >= 0, '本局读的 ' + got + ' 应入档,实际 ' + JSON.stringify(sv.seenBottles));
});

/* ---- 5. 查扣反事实:只在读过 #3120-K 时认领 ---- */
scenario('查扣反事实: 读过 #3120-K 才点名她', save({ seenBottles: ['#5502-D','#1177-B','#8891-R'] }), g => {
  const { A, K, CONTENT, frame, S, tick, ENGINE } = g;
  CONTENT.go('bottleIn', true); frame();
  A(S.bottleId === '#3120-K', '本局是她的瓶');
  K('Escape');
  /* 布置:高信号 + 上传到 92% + 强制查扣 */
  S.trace = 80; S.cacheVal = 1000; S.cacheSlots = 10;
  ENGINE.setClock(3, 50); S.beats.trial = 'replied';
  /* 已知 flaky 根因(和 D-122 countermeasures_checks.js 撞上的是同一个坑):
     SCREENS.tools.enter() 里挂着 D-115 的 maybeLegacyNode('tools')(20% 真随机、
     跑到这里时还没被下面 g.rnd() 摁死),小概率把这一屏悄悄换成 legacyNode,
     后面两次 K('1') 就打空了,断言看起来像"没查扣"。提前摁死这个开关,不让
     它跟这条用例本身要测的"查扣反事实"扯上关系。 */
  S.legacyNodeShown = true;
  CONTENT.go('tools', true); frame();
  g.rnd(0.1);                       // <0.25 -> 查扣发生;同时 d11 <= 60 断连成功
  K('1'); frame(); K('1');          // 两回合 -> 92%
  tick(2400); frame();
  A(S.settle.join('|').includes('过滤层查扣'), '应发生查扣,实际 ' + S.settle.join('|'));
  A(S.settle.join('|').includes('#3120-K'), '应点名她的错,实际 ' + S.settle.join('|'));
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL BOTTLE CHECKS PASS');
process.exit(failures ? 1 : 0);
