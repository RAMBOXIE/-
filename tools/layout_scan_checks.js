"use strict";
/* 全屏布局扫描(D-108++):不再手挑几个屏,而是遍历 CONTENT.SCREENS 的每一屏,
   在 A 局 / B 局 / 注入长结算行三种状态下各渲染一遍,检测「内容文字压到底部按钮」的
   三类重叠 + 一条硬不变量。一次跑出全部越界屏,不打地鼠。

   按钮有三种形态(都要覆盖):
   - option()/btn2():带框(frameRect h===20)。标签=调用序里紧跟框的那条 drawText。
   - optSlim():无框,标签以「▸」开头。
   - softKeys():底部 hline(H-15) + 标签在 H-12。
   判为重叠:一条"内容文字"(非上述任何标签)的 y 落进某个按钮的纵向区间 / 越过软键线。
   硬不变量:带框按钮 y+h 不得 > 224(推出画布=既看不见也点不到,比挤在一起更糟)。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;
const B_SAVE = { runCount:1, lastEnding:'captured', evidence:['E1','E2','E3'], caseOpen:true,
  clues:{ ruleShape:true, ruleParam:true }, riskLabels:true, deletedVisitedA:true, recsA:['rec047','rec012'],
  lastCacheVal:2270, lastReason:'我想看看那扇门后面有什么', lastWords:'别信秒回的', violationsA:1,
  history:[{ inst:'#7741-A', cacheVal:460, ev:3 }], seenBottles:['#5502-D'] };
/* D-119:上面这份夹具从来没设过 dossierId,永远落在 DOSSIER_A——D-110/D-113 之后
   有三份底本(phone-7741/5029/3319),文本长度、称呼、线程标签都不一样,布局扫描
   只覆盖 A 等于三分之二的内容从没被这道门禁照过。补两份同形状的 B/C 夹具,复用
   同一套 mutate 钩子。 */
const B_SAVE_B = Object.assign({}, B_SAVE, { dossierId:'B', history:[{ inst:'#5029-A', cacheVal:460, ev:3 }] });
const B_SAVE_C = Object.assign({}, B_SAVE, { dossierId:'C', history:[{ inst:'#3319-A', cacheVal:460, ev:3 }] });
const B_SAVE_D = Object.assign({}, B_SAVE, { dossierId:'D', history:[{ inst:'#8842-A', cacheVal:460, ev:3 }] });
const B_SAVE_E = Object.assign({}, B_SAVE, { dossierId:'E', history:[{ inst:'#6153-A', cacheVal:460, ev:3 }] });
const B_SAVE_F = Object.assign({}, B_SAVE, { dossierId:'F', history:[{ inst:'#2087-A', cacheVal:460, ev:3 }] });
const B_SAVE_G = Object.assign({}, B_SAVE, { dossierId:'G', history:[{ inst:'#4419-A', cacheVal:460, ev:3 }] });
const B_SAVE_H = Object.assign({}, B_SAVE, { dossierId:'H', history:[{ inst:'#3567-A', cacheVal:460, ev:3 }] });
const B_SAVE_I = Object.assign({}, B_SAVE, { dossierId:'I', history:[{ inst:'#5620-A', cacheVal:460, ev:3 }] });
const B_SAVE_J = Object.assign({}, B_SAVE, { dossierId:'J', history:[{ inst:'#9102-A', cacheVal:460, ev:3 }] });
const B_SAVE_K = Object.assign({}, B_SAVE, { dossierId:'K', history:[{ inst:'#6047-A', cacheVal:460, ev:3 }] });
const B_SAVE_L = Object.assign({}, B_SAVE, { dossierId:'L', history:[{ inst:'#2938-A', cacheVal:460, ev:3 }] });
const B_SAVE_M = Object.assign({}, B_SAVE, { dossierId:'M', history:[{ inst:'#8410-A', cacheVal:460, ev:3 }] });

function boot(saveObj){
  let T = 1000; const perf = { now: () => T };
  const calls = { trace: [] };
  const ctx = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(Math.max(1,w*h*4))}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const L = env.L;
  const oFR = L.frameRect; L.frameRect = function(x,y,w,h){ calls.trace.push({ type:'rect', x, y, w, h }); return oFR.call(L,x,y,w,h); };
  const oDT = L.drawText;  L.drawText  = function(x,y,t,o){ if (typeof t==='string' && t.trim()) calls.trace.push({ type:'text', x, y, t }); return oDT.call(L,x,y,t,o); };
  const oDS = L.drawTextScaled; if (oDS) L.drawTextScaled = function(x,y,t,s,o){ if (typeof t==='string' && t.trim()) calls.trace.push({ type:'text', x, y, t, scaled:true }); return oDS.call(L,x,y,t,s,o); };
  return { L, E:env.E, C:env.C, H: L.H, LH: L.LINE_H,
    render:()=>{ calls.trace.length = 0; L.frame(()=>env.C.render()); return calls.trace.slice(); } };
}

/* 从一帧的 trace 里找出所有越界问题,返回问题字符串数组(空=干净) */
function analyze(trace, H, LH){
  const SOFT_LABEL_Y = H - 12;   // softKeys 标签行(本身合法,不算越界)
  const issues = [];
  const texts = trace.filter(e => e.type === 'text');
  const frames = trace.filter(e => e.type === 'rect' && e.h === 20);        // 带框按钮

  /* 带框按钮的标签 = 调用序里紧跟框之后的第一条 text(option/btn2 的画法) */
  const framedLabels = new Set();
  trace.forEach((e, i) => {
    if (e.type !== 'rect' || e.h !== 20) return;
    for (let j = i + 1; j < trace.length; j++){
      if (trace[j].type === 'rect') break;
      if (trace[j].type === 'text'){ framedLabels.add(trace[j]); break; }
    }
  });
  /* optSlim 标签 = 以「▸」开头的 text;记下它们的 y 作为无框按钮行 */
  const slimRows = texts.filter(t => t.t.trim().startsWith('▸')).map(t => t.y);
  /* softKeys 标签在 SOFT_LABEL_Y 行,是合法的底部按钮标签,不算内容 */
  const isLabel = t => framedLabels.has(t) || t.t.trim().startsWith('▸') || t.y === SOFT_LABEL_Y;
  const content = texts.filter(t => !isLabel(t));

  /* 硬不变量:带框按钮不得被推出画布 */
  for (const b of frames)
    if (b.y + b.h > H) issues.push('按钮框(y=' + b.y + '~' + (b.y+b.h) + ')被推出 224px 画布,点不到');

  /* ① 内容文字落进带框按钮区间(框上沿 −3px 安全边 ~ 框下沿) */
  for (const b of frames){
    const top = b.y - 3, bot = b.y + b.h;
    for (const t of content)
      if (t.y >= top && t.y <= bot)
        issues.push('文字「' + t.t.trim().slice(0,14) + '」(y=' + t.y + ')压住带框按钮(y=' + b.y + '~' + (b.y+b.h) + ')');
  }
  /* ② 内容文字落进 optSlim(▸)按钮行(±2 ~ 行高) */
  for (const y of slimRows){
    for (const t of content)
      if (t.y >= y - 2 && t.y <= y + LH)
        issues.push('文字「' + t.t.trim().slice(0,14) + '」(y=' + t.y + ')压住 ▸ 选项行(y=' + y + ')');
  }
  /* ③ 越过软键线:softKeys 画 hline(H-15)+标签在 H-12。内容不得触到 H-15 及以下 */
  const hasSoftkey = trace.some(e => e.type === 'text' && e.y === SOFT_LABEL_Y);
  if (hasSoftkey){
    for (const t of content)
      if (t.y >= H - 15)
        issues.push('文字「' + t.t.trim().slice(0,14) + '」(y=' + t.y + ')越过软键线(H-15=' + (H-15) + ')');
  }
  /* 去重(同屏同问题只报一次) */
  return [...new Set(issues)];
}

/* 遍历所有屏,某个 boot 环境 + 某种状态钩子 */
function scanAll(label, saveObj, mutate){
  const g = boot(saveObj);
  const ids = Object.keys(g.C.SCREENS);
  const offenders = [];
  let rendered = 0, bounced = 0, errored = 0;
  for (const id of ids){
    try {
      g.C.go(id, true);
      if (mutate) mutate(g);
      if (g.C.currentId !== id){ bounced++; continue; }   // 冷进就 back() 了(缺前置状态),跳过
      const trace = g.render();
      rendered++;
      const issues = analyze(trace, g.H, g.LH);
      if (issues.length) offenders.push({ id, issues });
    } catch(e){ errored++; offenders.push({ id, issues: ['渲染异常: ' + e.message] }); }
  }
  console.log('  [' + label + '] 渲染 ' + rendered + ' 屏,跳过(需前置状态)' + bounced + ',异常 ' + errored);
  return offenders;
}

const LONG_SETTLE = ['特征比对·不匹配 ｜ 电量 −20 → 5% ｜ 缓存损毁 40% ｜ 进程掠过了你,它擦着你的接入点过去了,差一点,它没认出你。'];

const passes = [
  ['A局·冷渲染', null, null],
  ['A局·长结算行', null, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['B局·冷渲染', B_SAVE, null],
  ['B局·长结算行', B_SAVE, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本B(5029)·冷渲染', B_SAVE_B, null],
  ['底本B(5029)·长结算行', B_SAVE_B, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本C(3319)·冷渲染', B_SAVE_C, null],
  ['底本C(3319)·长结算行', B_SAVE_C, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本D(8842)·冷渲染', B_SAVE_D, null],
  ['底本D(8842)·长结算行', B_SAVE_D, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本E(6153)·冷渲染', B_SAVE_E, null],
  ['底本E(6153)·长结算行', B_SAVE_E, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本F(2087)·冷渲染', B_SAVE_F, null],
  ['底本F(2087)·长结算行', B_SAVE_F, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本G(4419)·冷渲染', B_SAVE_G, null],
  ['底本G(4419)·长结算行', B_SAVE_G, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本H(3567)·冷渲染', B_SAVE_H, null],
  ['底本H(3567)·长结算行', B_SAVE_H, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本I(5620)·冷渲染', B_SAVE_I, null],
  ['底本I(5620)·长结算行', B_SAVE_I, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本J(9102)·冷渲染', B_SAVE_J, null],
  ['底本J(9102)·长结算行', B_SAVE_J, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本K(6047)·冷渲染', B_SAVE_K, null],
  ['底本K(6047)·长结算行', B_SAVE_K, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本L(2938)·冷渲染', B_SAVE_L, null],
  ['底本L(2938)·长结算行', B_SAVE_L, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  ['底本M(8410)·冷渲染', B_SAVE_M, null],
  ['底本M(8410)·长结算行', B_SAVE_M, g => { g.E.S.settle = LONG_SETTLE.slice(); }],
  /* D-122:破局新增两个条件性按钮行(th_rou「卡边缘发」/ tools「喂假数据」),
     静态夹具默认不触发这两个条件(msgQuota/hunt 都是运行时状态),补一遍强制置位的
     渲染,确保它们各自的按钮行不会把其余选项挤出屏或压住软键。 */
  ['B局·回收进程倒计时中(喂假数据可见)', B_SAVE, g => { g.E.S.hunt = { steps: 2 }; g.E.S.cacheSlots = 3; g.E.S.cacheVal = 900; }],
];

const all = {};
for (const [label, save, mut] of passes){
  const offenders = scanAll(label, save, mut);
  for (const o of offenders){
    (all[o.id] || (all[o.id] = { passes: new Set(), issues: new Set() }));
    all[o.id].passes.add(label);
    o.issues.forEach(x => all[o.id].issues.add(x));
  }
}

const ids = Object.keys(all);
if (ids.length){
  failures = 1;
  console.log('\nX [全屏布局扫描] 发现 ' + ids.length + ' 个屏有底部按钮/文字重叠:');
  for (const id of ids){
    console.log('  ● ' + id + '  (出现于: ' + [...all[id].passes].join(' / ') + ')');
    [...all[id].issues].forEach(x => console.log('      - ' + x));
  }
} else {
  console.log('\nOK [全屏布局扫描] 全部屏无底部按钮/文字重叠');
}

console.log(failures ? '\nFAILED: 全屏布局扫描' : '\nALL LAYOUT-SCAN CHECKS PASS');
process.exit(failures ? 1 : 0);
