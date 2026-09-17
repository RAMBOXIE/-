"use strict";
/* 玩家动线遍历:断头路 / 不可达屏 / 卡死检测 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

const KEYS = ['Enter','Escape','softL','softR','1','2','3','4','5','6','7',
              'ArrowUp','ArrowDown','swipeUp','swipeDown','swipeLeft','swipeRight',
              'item:0','item:1','item:2','item:3','item:4',
              't','x','d','m','b','D','M','A','c','callA','callR'];
const TERMINAL = new Set(['report','receiptAlive','receiptFull']);

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
    location: { reload(){ LOG.push('RELOAD'); } },
    OVERLAY: { show(cfg,cb){ LOG.push('OVL'); cb({ text:'测试', kept:false }); }, text(){} },
    /* D-125:APP 桩此前只有 exportFeedback,D-117 死亡报告局外页上线后
       receiptFull/receiptAlive 一直在报 "showDeathReport is not a func"——
       不是游戏真的坏了,是这份工具的桩没跟上,遇事故都当真异常报出来,
       噪音盖住了真信号。补齐 D-117 加的两个方法(空实现,这里只探路不看渲染)。 */
    APP: { exportFeedback(){}, showDeathReport(){}, showTransparency(){} },
    AUDIO: { ensure(){}, hiss(){}, blip(){} },
    HOLD: { active:false, x:0, y:0, t0:0 }, Math
  };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const boot = new Function('window','document','performance','addEventListener','navigator',
    'location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  boot.call(env, env, env.document, perf, env.addEventListener, env.navigator,
            env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const { __LCD:LCD, __ENGINE:ENGINE, __CONTENT:CONTENT } = env;
  return { LCD, ENGINE, CONTENT, env, LOG,
    frame: () => LCD.frame(() => CONTENT.render()),
    tick: ms => { FAKE_T += ms; CONTENT.tickTimer(); },
    now: () => FAKE_T };
}

function probeExits(saveObj, label){
  const base = mkEnv(saveObj);
  const all = Object.keys(base.CONTENT.SCREENS);
  const rows = [];
  for (const id of all){
    let exits = [], err = null;
    for (const k of KEYS){
      try {
        const g = mkEnv(saveObj);
        g.CONTENT.go(id, true);
        for (let i = 0; i < 6; i++) g.frame();          // 先渲染几帧(帧驱动屏)
        g.tick(2500);                                    // 先等一会(有最短停留的屏)
        for (let i = 0; i < 3; i++){                     // 同一键连按 3 次(需两次确认的屏)
          g.CONTENT.key(k);
          g.tick(2000); g.frame();
          if (g.CONTENT.currentId !== id) break;
        }
        if (g.CONTENT.currentId !== id) exits.push(k + '=>' + g.CONTENT.currentId);
      } catch(e){ err = (err||'') + k + ':' + e.message.slice(0,40) + ' '; }
    }
    try {
      const g = mkEnv(saveObj); g.CONTENT.go(id, true); g.frame();
      for (let i = 0; i < 200; i++){ g.tick(2000); g.frame(); }
      if (g.CONTENT.currentId !== id) exits.push('(timer)=>' + g.CONTENT.currentId);
    } catch(e){ err = (err||'') + 'timer:' + e.message.slice(0,40); }
    rows.push({ id, n: exits.length, exits: exits.slice(0,3), err });
  }
  const dead = rows.filter(r => r.n === 0 && !TERMINAL.has(r.id));
  const errs = rows.filter(r => r.err);
  console.log('');
  console.log('=== (1) 出路探测 [' + label + '] 共 ' + rows.length + ' 屏 ===');
  console.log('无出路(断头路): ' + dead.length + (dead.length ? ' -> ' + dead.map(d=>d.id).join(', ') : ' OK'));
  if (errs.length) errs.forEach(e => console.log('  异常 ' + e.id + ': ' + e.err.trim().slice(0,140)));
  dead.forEach(d => console.log('    [' + d.id + '] 32 键 x3 次 + 200 帧计时器 均无出路'));
  rows.filter(r => r.n > 0 && r.n <= 2).forEach(r =>
    console.log('    [窄出口] ' + r.id + ' 仅 ' + r.n + ' 条: ' + r.exits.join(' , ')));
  return { rows, dead, errs };
}

function randomWalk(saveObj, label, runs, steps){
  const visited = new Map(), stuck = [], endings = new Map();
  for (let r = 0; r < runs; r++){
    let g;
    try { g = mkEnv(saveObj); } catch(e){ stuck.push({id:'BOOT', err:e.message.slice(0,50)}); continue; }
    let same = 0, last = null, trail = [];
    for (let s = 0; s < steps; s++){
      const id = g.CONTENT.currentId;
      visited.set(id, (visited.get(id)||0)+1);
      trail.push(id);
      if (id === last) same++; else same = 0;
      last = id;
      if (same >= 120 && !TERMINAL.has(id)){ stuck.push({ id, trail: trail.slice(-6).join('>') }); break; }
      if (TERMINAL.has(id)){ endings.set(id,(endings.get(id)||0)+1); break; }
      const k = KEYS[Math.floor(Math.random()*KEYS.length)];
      try {
        g.CONTENT.key(k);
        if (Math.random() < .35) g.tick(3000 + Math.random()*30000);
        g.CONTENT.tickTimer(); g.frame(); g.frame();
      } catch(e){ stuck.push({ id, err: e.message.slice(0,60), trail: trail.slice(-5).join('>') }); break; }
    }
  }
  console.log('');
  console.log('=== (2) 随机游走 [' + label + '] ' + runs + ' 局 x ' + steps + ' 步 ===');
  console.log('触达屏数: ' + visited.size + ' | 结局: ' + ([...endings].map(e=>e[0]+'x'+e[1]).join(', ') || '无'));
  const uniq = {};
  stuck.forEach(c => { const key = c.id + (c.err ? ' ! ' + c.err : ' (卡住)'); uniq[key]=(uniq[key]||0)+1; });
  const list = Object.entries(uniq).sort((a,b)=>b[1]-a[1]);
  console.log('卡住/异常: ' + (list.length ? list.length + ' 类' : '无 OK'));
  list.slice(0,10).forEach(e => console.log('   x' + e[1] + '  ' + e[0]));
  return { visited, stuck, endings };
}

const SAVE_CAPTURED = {
  runCount:1, lastEnding:'captured', evidence:['E1','E2','E3','E4'], caseOpen:true,
  clues:{ruleShape:true,ruleParam:true}, deletedVisitedA:true, recsA:['rec047','rec012'],
  lastCacheVal:2270, lastReason:'我想看看那扇门后面有什么', lastWords:'别信秒回的',
  bottleSealed:null, vault:null, residueClaimed:false, disposal:null, memGiven:false,
  predsA:[], predsB:[], history:[{inst:'#7741-A',kind:'captured',cacheVal:2270,ev:4}]
};
/* D-125:这份夹具从建立起就没设过 dossierId——标着"B局"探路,实际渲染的一直是
   DOSSIER_A(和 D-119 之前 layout_scan_checks.js 的 B_SAVE 撞的是同一个坑)。
   底本 B(phone-5029)/C(phone-3319)从没被这个断头路/随机游走探测器真正照过。
   补两份同形状、真设了 dossierId 的夹具,同一套探测逻辑复用。 */
const SAVE_CAPTURED_B = Object.assign({}, SAVE_CAPTURED, { dossierId:'B', history:[{inst:'#5029-A',kind:'captured',cacheVal:2270,ev:4}] });
const SAVE_CAPTURED_C = Object.assign({}, SAVE_CAPTURED, { dossierId:'C', history:[{inst:'#3319-A',kind:'captured',cacheVal:2270,ev:4}] });
/* D-129:machine#4(phone-8842)追加,同一套夹具形状。 */
const SAVE_CAPTURED_D = Object.assign({}, SAVE_CAPTURED, { dossierId:'D', history:[{inst:'#8842-A',kind:'captured',cacheVal:2270,ev:4}] });
/* D-130/131/132:machine#5/6/7(phone-6153/2087/4419)追加,同一套夹具形状。 */
const SAVE_CAPTURED_E = Object.assign({}, SAVE_CAPTURED, { dossierId:'E', history:[{inst:'#6153-A',kind:'captured',cacheVal:2270,ev:4}] });
const SAVE_CAPTURED_F = Object.assign({}, SAVE_CAPTURED, { dossierId:'F', history:[{inst:'#2087-A',kind:'captured',cacheVal:2270,ev:4}] });
const SAVE_CAPTURED_G = Object.assign({}, SAVE_CAPTURED, { dossierId:'G', history:[{inst:'#4419-A',kind:'captured',cacheVal:2270,ev:4}] });
/* D-133:machine#8(phone-3567)追加,同一套夹具形状。 */
const SAVE_CAPTURED_H = Object.assign({}, SAVE_CAPTURED, { dossierId:'H', history:[{inst:'#3567-A',kind:'captured',cacheVal:2270,ev:4}] });

const rA = probeExits(null, 'A局(底本A首局)');
const rB = probeExits(SAVE_CAPTURED, 'B局(底本A二周目,原有夹具,一直没设dossierId,本就该落DOSSIER_A)');
const rBB = probeExits(SAVE_CAPTURED_B, 'B局(底本B/phone-5029二周目)');
const rBC = probeExits(SAVE_CAPTURED_C, 'B局(底本C/phone-3319二周目)');
const rBD = probeExits(SAVE_CAPTURED_D, 'B局(底本D/phone-8842二周目)');
const rBE = probeExits(SAVE_CAPTURED_E, 'B局(底本E/phone-6153二周目)');
const rBF = probeExits(SAVE_CAPTURED_F, 'B局(底本F/phone-2087二周目)');
const rBG = probeExits(SAVE_CAPTURED_G, 'B局(底本G/phone-4419二周目)');
const rBH = probeExits(SAVE_CAPTURED_H, 'B局(底本H/phone-3567二周目)');
const wA = { visited: new Map() };
const wB = { visited: new Map() };
const allA = Object.keys(mkEnv(null).CONTENT.SCREENS);
const allB = Object.keys(mkEnv(SAVE_CAPTURED).CONTENT.SCREENS);
console.log('');

console.log('');
console.log('结论: 断头路 ' + (rA.dead.length+rB.dead.length+rBB.dead.length+rBC.dead.length+rBD.dead.length+rBE.dead.length+rBF.dead.length+rBG.dead.length+rBH.dead.length) +
  ' 处 | 异常 ' + (rA.errs.length+rB.errs.length+rBB.errs.length+rBC.errs.length+rBD.errs.length+rBE.errs.length+rBF.errs.length+rBG.errs.length+rBH.errs.length) + ' 处');
