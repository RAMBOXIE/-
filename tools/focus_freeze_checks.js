"use strict";
/* 失焦冻结仲裁(D-108 自查:附录A「现实打断致死」)门禁。
   证明:CONTENT.freezeAdjust(hiddenMs) 把当前 timer 的 deadline 整体后移同样的量——
   玩家切走标签页再回来,不会因为真实倒计时(终局来电等)在背后偷跑而暴毙。
   同时验证「没背景切走时,timer 该触发照样触发」(regression,机制没被削弱)。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function boot(){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  return { E:env.E, C:env.C, S:env.E.S, setT:v=>{T=v;}, getT:()=>T };
}

function scenario(name, fn){
  const errs = [];
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* ---- 未背景切走:30 秒真实倒计时到点照常自动应答(regression,机制没被削弱) ---- */
scenario('未失焦 · 终局来电 30s 倒计时到点仍会自动应答', ({A}) => {
  const g = boot();
  g.C.go('finalCall', true);
  A(g.C.SCREENS.finalCall.round === 0, '刚进屏应还没应答');
  g.setT(g.getT() + 30500);                          // 真实经过 30.5s,超过 30s 阈值
  g.C.tickTimer();
  A(g.C.SCREENS.finalCall.round === 1, '30s 到点应自动应答(auto),实际 round=' + g.C.SCREENS.finalCall.round);
});

/* ---- 失焦冻结:切走期间的时长喂给 freezeAdjust,原本会超时的不再超时 ---- */
scenario('失焦冻结 · 切走 60s 不该让 30s 倒计时偷跑到期', ({A}) => {
  const g = boot();
  g.C.go('finalCall', true);
  g.setT(g.getT() + 29000);                          // 还没到 30s
  g.C.tickTimer();
  A(g.C.SCREENS.finalCall.round === 0, '29s 时不该已经应答');

  g.C.freezeAdjust(60000);                            // 模拟切走标签页 60s 后回来
  g.setT(g.getT() + 2000);                            // 真实又过了 2s(总耗时 31s,原阈值早过了)
  g.C.tickTimer();
  A(g.C.SCREENS.finalCall.round === 0,
    '冻结后即便总真实耗时已超过原 30s 阈值,也不该被判超时,实际 round=' + g.C.SCREENS.finalCall.round);
});

/* ---- 冻结之后倒计时仍然有效(不是被冻结成永远不触发) ---- */
scenario('失焦冻结 · 冻结后倒计时仍会在新的到期点触发', ({A}) => {
  const g = boot();
  g.C.go('finalCall', true);                          // deadline = t0+30000
  g.C.freezeAdjust(60000);                             // deadline 推到 t0+90000
  g.setT(g.getT() + 89000);
  g.C.tickTimer();
  A(g.C.SCREENS.finalCall.round === 0, '89s 时(新 deadline 前)不该已应答');
  g.setT(g.getT() + 1500);
  g.C.tickTimer();
  A(g.C.SCREENS.finalCall.round === 1, '过了新 deadline(90s)应正常自动应答,实际 round=' + g.C.SCREENS.finalCall.round);
});

/* ---- 没有活跃 timer 时 freezeAdjust 是安全的空操作 ---- */
scenario('无活跃 timer 时 freezeAdjust 不抛错', ({A}) => {
  const g = boot();
  let threw = false;
  try { g.C.freezeAdjust(5000); } catch(_){ threw = true; }
  A(!threw, 'freezeAdjust 在没有活跃 timer 时不应抛错');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL FOCUS-FREEZE CHECKS PASS');
process.exit(failures ? 1 : 0);
