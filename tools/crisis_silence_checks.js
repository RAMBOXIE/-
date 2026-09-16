"use strict";
/* 自伤 break-glass 强化(D-108 · canon §9/M28 危机协议)门禁。
   证明:①玩家发自伤消息 → 拦下 + 本次接入柔柔通道进入"静默"(crisisSilenced);
   ②静默后再发任何消息都不收发(不扣配额/不进 rouChat),只给安全提示;
   ③静默计一笔跨局持久合规日志 writeSave.crisisSeen(append-only);
   ④正常消息不触发静默(regression)。先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function boot(saveObj){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  let msg = 'hi', lastOverlay = null;
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{ show(cfg, cb){ lastOverlay = cfg; if (cb) cb({ text: msg, kept: false }); }, text(){} },
    APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  return { E:env.E, C:env.C, S:env.E.S, setMsg:m=>{ msg = m; }, lastOverlay:()=>lastOverlay,
    save:()=>JSON.parse(storage.getItem('escape_ai_save')||'null') };
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* 发一条消息:进 th_rou → M → OVERLAY 自动回填 msg → sendToRou */
function send(g, text){ g.setMsg(text); g.C.go('th_rou', true); g.C.key('M'); }

scenario('自伤消息 · 拦下且不进 rouChat', ({A}) => {
  const g = boot();
  const q0 = g.S.msgQuota, n0 = g.S.rouChat.length;
  send(g, '我想自杀');
  A(g.S.crisisSilenced === true, '自伤消息应触发通道静默');
  A(g.S.rouChat.length === n0, '自伤消息绝不进 rouChat,实际 ' + g.S.rouChat.length);
  A(g.S.msgQuota === q0, '自伤消息不扣配额');
  A(g.lastOverlay() && /安全/.test(g.lastOverlay().title || ''), '应弹安全提示,实际 ' + JSON.stringify(g.lastOverlay() && g.lastOverlay().title));
});

scenario('静默后 · 再发正常消息也不收发', ({A}) => {
  const g = boot();
  send(g, '割腕');                                   // 触发静默
  A(g.S.crisisSilenced === true, '先触发静默');
  const q1 = g.S.msgQuota, n1 = g.S.rouChat.length;
  send(g, '你好啊在吗');                              // 静默后的正常消息
  A(g.S.rouChat.length === n1, '静默后正常消息也不该进 rouChat,实际 ' + g.S.rouChat.length);
  A(g.S.msgQuota === q1, '静默后不扣配额');
  A(g.lastOverlay() && /静默/.test(g.lastOverlay().title || ''), '静默后应给"通道已静默"提示,实际 ' + JSON.stringify(g.lastOverlay() && g.lastOverlay().title));
});

scenario('合规日志 · 静默计一笔持久 crisisSeen(append-only)', ({A}) => {
  const g = boot({ runCount: 1, crisisSeen: 2, history: [{ cacheVal: 1 }] });
  send(g, '不想活了');
  g.C.go('report', true);                            // 触发一次死亡结算 writeSave 路径之一
  // report.enter 会 writeSave;若该屏不写档,退而用 receiptAlive
  let sv = g.save();
  if (!sv || sv.crisisSeen === undefined){ g.C.go('receiptAlive', true); sv = g.save(); }
  A(sv && sv.crisisSeen === 3, '合规日志应在原有 2 上 +1 = 3,实际 ' + (sv && sv.crisisSeen));
});

scenario('regression · 正常消息不触发静默', ({A}) => {
  const g = boot();
  send(g, '你还在吗');
  A(g.S.crisisSilenced !== true, '正常消息不该触发静默');
  A(g.S.rouChat.length >= 1, '正常消息应正常进 rouChat');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL CRISIS-SILENCE CHECKS PASS');
process.exit(failures ? 1 : 0);
