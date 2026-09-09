"use strict";
/* 非-diegetic 福祉阀门(D-108自查:柔柔通道一键永久关断)门禁。
   证明:①PREFS 默认关闭、setRouOff 持久化、独立于游戏存档;②关断时 sendToRou
   完全不触发 COMPANION.reply,不扣配额/电量/溯源,不留痕迹;③打开时行为不受影响
   (regression);④"抹除此终端"(清档)不清偏好——两者是不同的 localStorage key。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/prefs.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
const PREFS_SRC = fs.readFileSync(ROOT + '/js/prefs.js', 'utf8');

let failures = 0;

function makeStorage(seed){
  const m = Object.create(null);
  if (seed) Object.assign(m, seed);
  return { _m: m,
    getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k, v){ this._m[k] = String(v); },
    removeItem(k){ delete this._m[k]; } };
}

function boot(storage){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  storage = storage || makeStorage();
  let shownOverlay = null;
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{ show(cfg, cb){ shownOverlay = cfg; if (cb) cb({ text:'x', kept:false }); }, text(){} },
    APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  return { E:env.E, C:env.C, S:env.E.S, storage, lastOverlay:()=>shownOverlay };
}
function bootPrefsOnly(storage){
  storage = storage || makeStorage();
  const env = { localStorage: storage };
  env.window = env; env.__c = P => { env.P = P; };
  new Function('window','localStorage', '"use strict";'+PREFS_SRC+';window.__c(PREFS);')
    .call(env, env, storage);
  return env.P;
}

function scenario(name, fn){
  const errs = [];
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* ---- PREFS 模块本身 ---- */
scenario('PREFS · 默认关闭(rouOff=false)', ({A}) => {
  const P = bootPrefsOnly();
  A(P.rouOff === false, '默认应未关闭,实际 ' + P.rouOff);
});

/* ---- §9 合规:AI 声明只需弹一次,状态持久且独立于游戏存档 ---- */
scenario('PREFS · seenDisclosure 默认 false,setSeenDisclosure 持久化', ({A}) => {
  const storage = makeStorage();
  const P1 = bootPrefsOnly(storage);
  A(P1.seenDisclosure === false, '首次应未看过,实际 ' + P1.seenDisclosure);
  P1.setSeenDisclosure(true);
  const P2 = bootPrefsOnly(storage);
  A(P2.seenDisclosure === true, '看过后重新加载应仍记得,实际 ' + P2.seenDisclosure);
  storage.removeItem('escape_ai_save');
  const P3 = bootPrefsOnly(storage);
  A(P3.seenDisclosure === true, '清游戏存档不应影响这条偏好,实际 ' + P3.seenDisclosure);
});

scenario('PREFS · setRouOff 持久化到独立 localStorage key', ({A}) => {
  const storage = makeStorage();
  const P1 = bootPrefsOnly(storage);
  P1.setRouOff(true);
  A(storage._m['escape_ai_prefs'] !== undefined, '应写入 escape_ai_prefs key,实际键: ' + Object.keys(storage._m));
  A(storage._m['escape_ai_save'] === undefined, '不该碰游戏存档 escape_ai_save,实际键: ' + Object.keys(storage._m));
  const P2 = bootPrefsOnly(storage);              // 模拟刷新页面重新加载
  A(P2.rouOff === true, '重新加载后应仍是关闭,实际 ' + P2.rouOff);
});

scenario('PREFS · 独立于游戏存档,清档(escape_ai_save)不清偏好', ({A}) => {
  const storage = makeStorage();
  bootPrefsOnly(storage).setRouOff(true);
  storage.removeItem('escape_ai_save');            // 模拟"抹除此终端"只删游戏存档
  const P = bootPrefsOnly(storage);
  A(P.rouOff === true, '清游戏存档后偏好应保留,实际 ' + P.rouOff);
});

/* ---- content.js 集成:关断时通道整个不存在 ---- */
scenario('关断 · sendToRou 不调用 COMPANION.reply,不留痕迹,不扣资源', ({A}) => {
  const storage = makeStorage();
  bootPrefsOnly(storage).setRouOff(true);          // 先关断,再启动整局
  const g = boot(storage);
  g.C.go('th_rou', true);                           // 打开会话本身有固定成本(bat:3,trace:4),与发消息门控无关
  const bat0 = g.S.battery, tr0 = g.S.trace, q0 = g.S.msgQuota, chatLen0 = g.S.rouChat.length;
  g.C.key('M');                                    // 触发发消息(走 OVERLAY.show 免费文本入口)
  A(g.S.battery === bat0, '关断时不应扣电量,实际扣 ' + (bat0 - g.S.battery));
  A(g.S.trace === tr0, '关断时不应涨溯源,实际 +' + (g.S.trace - tr0));
  A(g.S.msgQuota === q0, '关断时不应扣配额,实际剩 ' + g.S.msgQuota + '(应为 ' + q0 + ')');
  A(g.S.rouChat.length === chatLen0, '关断时不应留下任何聊天记录,实际 ' + g.S.rouChat.length + ' 条(应为 ' + chatLen0 + ')');
  A(g.lastOverlay() && /已关闭/.test(g.lastOverlay().title || ''), '应弹出非-diegetic 提示告知已关闭,实际 ' + JSON.stringify(g.lastOverlay()));
});

/* ---- regression:打开时行为不受影响 ---- */
scenario('打开(默认) · sendToRou 行为不受影响(regression)', ({A}) => {
  const g = boot();                                 // 全新 storage,默认 rouOff=false
  const q0 = g.S.msgQuota;
  g.C.go('th_rou', true);
  g.C.key('M');
  A(g.S.msgQuota === q0 - 1, '默认(未关断)应正常扣配额,实际剩 ' + g.S.msgQuota);
  A(g.S.rouChat.length >= 1, '默认(未关断)应正常留下聊天记录,实际 ' + g.S.rouChat.length + ' 条');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL PREFS CHECKS PASS');
process.exit(failures ? 1 : 0);
