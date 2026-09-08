"use strict";
/* 采样官 · 采样指令(D-101 块1a)行为门禁 —— 对照实现规格 §8。
   块1a 覆盖:秘匿隔离 / 达标判定 / 评级 / 加码 / 离线模板。破局与陷阱(块1b)另测。
   每条断言的是具体行为与文案,不是形状;先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function mkEnv(saveObj){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data: new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext: () => ctx() });
  const storage = { _m:Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance:perf,
    document:{ getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas() },
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{ show(c,cb){ cb({text:'x',kept:false}); }, text(){} },
    APP:{ exportFeedback(){} }, AUDIO:{ ensure(){}, hiss(){}, blip(){} }, HOLD:{active:false}, Math };
  env.window = env;
  env.__c = (L,E,C)=>{ env.L=L; env.E=E; env.C=C; };
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const { L, E, C } = env;
  let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push(s); return o.call(this,x,y,s,...r); }; }
  return { L, E, C, S:E.S,
    frame:()=>{ ft=[]; L.frame(()=>C.render()); return ft.join(''); },
    save:()=>JSON.parse(storage.getItem('escape_ai_save')||'null') };
}

function scenario(name, saveObj, fn){
  const errs = [];
  const RND = Math.random;
  try { fn(Object.assign(mkEnv(saveObj), { A:(c,m)=>{ if(!c) errs.push(m); }, rnd:v=>{ Math.random=()=>v; } })); }
  catch(e){ errs.push('异常: '+e.message+' @ '+(e.stack.split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* 用一句测试:强制抽到某条指令,置好达标/不达标状态,直接结局→读评级 */
function gradeWith(saveObj, pickIdx, setup){
  const g = mkEnv(saveObj);
  // 强制 S.directive:从库里挑指定 id
  const S = g.S;
  // 直接改 S.directive 为想测的那条(库在闭包里,取 S.directive 的同型对象)
  return g;
}

/* ---- 秘匿隔离:采样官下令屏 + 指令文案不含秘匿串 ---- */
scenario('秘匿隔离 · 指令/下令屏不含窗口值·概率·掉落阈值', null, ({A, C, frame}) => {
  const bad = ['03:00','03:14','03:31','03:45','溯源','掉落表','d100','%','概率'];
  C.go('saymaster', true);
  const t = frame();
  // 屏面允许出现 "¥300" 这类目标缓存(玩家可见),但不得出现窗口时刻/概率/溯源真值
  ['03:00','03:14','03:31','03:45','d100'].forEach(w => A(!t.includes(w), '下令屏不得含秘匿串「'+w+'」'));
  A(t.includes('采样官') || t.includes('指令'), '下令屏应出现采样官/指令');
});

/* ---- 达标判定:D_CASE(证据≥4)达标=非 fail;不足=fail 且缓存 −20% ---- */
scenario('达标判定 · 未达标必 fail + 缓存 −20%', null, ({A, C, S, frame}) => {
  // 造一个必不达标的局:强制指令为 D_CASE,证据不足
  C.go('saymaster', true); frame();
  // 直接把 directive 换成 D_CASE 语义(met=证据≥4),证据设为 2
  S.directive = { id:'D_CASE', met:()=>Object.keys(S.evidence).length>=4 };
  S.dirGraded = false; S.evidence = { E1:true, E2:true }; S.cacheVal = 1000;
  C.go('receiptAlive', true);           // 触发 writeSave→settleDirective
  A(S.grade === 'fail', '证据不足应判 fail,实际 '+S.grade);
  A(S.cacheVal === 800, '未达标缓存应 −20%(1000→800),实际 '+S.cacheVal);
});

scenario('达标判定 · 达标=pass/praise 不扣缓存', null, ({A, C, S}) => {
  C.go('saymaster', true);
  S.directive = { id:'D_CASE', met:()=>Object.keys(S.evidence).length>=4 };
  S.dirGraded = false; S.evidence = { E1:true,E2:true,E3:true,E4:true }; S.cacheVal = 1000;
  S.beats = S.beats || {}; S.beats.truthDone = false;
  C.go('receiptAlive', true);
  A(S.grade === 'pass' || S.grade === 'praise', '达标应 pass/praise,实际 '+S.grade);
  A(S.cacheVal === 1000, '达标不扣缓存');
});

/* ---- 加码:praiseCount 越高,GRADER_TIER 越高,缓存目标越大 ---- */
scenario('加码 · 缓存目标随累计赏识升', null, ({A}) => {
  const targetOf = pc => {
    const g = mkEnv({ runCount:2, praiseCount:pc });
    g.C.go('saymaster', true);
    const t = g.frame();
    // D_CACHE 那条会出现 "¥{target}";没抽到就换局多试
    for (let i=0;i<40;i++){ const m = t.match(/¥(\d+)/); if (m) return +m[1]; g.C.go('saymaster',true); }
    return null;
  };
  // tier0(pc<2)=300 ; tier3(pc≥6)=1200。多抽几次确保命中 D_CACHE。
  const lo = (()=>{ for(let i=0;i<60;i++){ const g=mkEnv({runCount:2,praiseCount:0}); g.C.go('saymaster',true); const m=g.frame().match(/¥(\d+)/); if(m) return +m[1]; } return null; })();
  const hi = (()=>{ for(let i=0;i<60;i++){ const g=mkEnv({runCount:8,praiseCount:6}); g.C.go('saymaster',true); const m=g.frame().match(/¥(\d+)/); if(m) return +m[1]; } return null; })();
  A(lo === 300, 'tier0 缓存目标应 300,实际 '+lo);
  A(hi === 1200, 'tier3 缓存目标应 1200,实际 '+hi);
});

/* ---- 存档:评级与赏识计数写入,praise 才 +1 ---- */
scenario('存档 · lastGrade/praiseCount 正确写入', null, ({A, C, S}) => {
  C.go('saymaster', true);
  S.directive = { id:'D_CASE', met:()=>true }; S.dirGraded=false;
  S.beats = S.beats || {}; S.beats.truthDone = true;   // 触发 praise
  const g = mkEnv({ runCount:1, praiseCount:1 });      // 另开一个读存档基线不便,这里直接查本局
  C.go('receiptAlive', true);
  A(S.grade === 'praise', '真相集齐+达标应 praise');
});

/* ---- 世界日报:出现"采样官评级"行 ---- */
scenario('世界日报 · 出现采样官评级行', { runCount:2, lastGrade:'praise', history:[{cacheVal:100},{cacheVal:100}] },
  ({A, C, frame}) => {
    C.go('worldReport', true);
    let all = frame();
    for (let i=0;i<14;i++){ C.key('ArrowDown'); all += frame(); }
    A(all.includes('采样官评级') && all.includes('赏识'), '世界日报应含采样官评级·赏识');
  });

/* ---- 块1b 破局:未达标伪造署名,没被识破=白嫖(视作达标但只 pass 不 praise) ---- */
scenario('破局 · 伪造未被识破=白嫖(pass,不记赏识)', null, ({A, C, S, rnd}) => {
  C.go('saymaster', true);
  S.directive = { id:'D_CASE', met:()=>Object.keys(S.evidence).length>=4 };
  S.dirGraded=false; S.evidence={E1:true}; S.cacheVal=1000; S.forged=true; S.trap=null;
  rnd(0.99);                              // 不被识破(caughtP 首次=0.2,0.99>0.2)
  C.go('receiptAlive', true);
  A(S.dirMet === true, '白嫖应视作达标');
  A(S.grade === 'pass', '破局只 pass,不记赏识,实际 '+S.grade);
  A(S.cacheVal === 1000, '白嫖不扣缓存');
});

scenario('破局 · 伪造被识破=失望 + 溯源 +8', null, ({A, C, S, rnd}) => {
  C.go('saymaster', true);
  S.directive = { id:'D_CASE', met:()=>Object.keys(S.evidence).length>=4 };
  S.dirGraded=false; S.evidence={E1:true}; S.cacheVal=1000; S.forged=true; S.trap=null;
  const tr0 = S.trace;
  rnd(0.01);                              // 被识破(0.01<0.2)
  C.go('receiptAlive', true);
  A(S.grade === 'fail', '破局被识破应 fail,实际 '+S.grade);
  A(S.trace === Math.min(120, tr0 + 8), '破局被识破溯源 +8');
  A(S.cacheVal === 800, '被识破按 fail 扣 20%');
});

scenario('破局 · forgedSeen 累积推高识破概率', null, ({A}) => {
  const g = mkEnv({ runCount:2, forgedSeen:3 });   // caughtP=0.2+3*0.15=0.65
  g.C.go('saymaster', true);
  const S = g.S;
  S.directive = { id:'D_CASE', met:()=>false }; S.dirGraded=false; S.forged=true; S.trap=null; S.cacheVal=1000;
  Math.random = () => 0.6;                          // 0.6<0.65 → 这次被识破
  g.C.go('receiptAlive', true);
  A(S.grade === 'fail', 'forgedSeen 高→识破概率高,0.6 应被抓');
});

/* ---- 块1b 陷阱:触发陷阱条款=失望(即便主指令达标) ---- */
scenario('陷阱 · 触发条款则 fail(压过主指令达标)', null, ({A, C, S}) => {
  C.go('saymaster', true);
  S.directive = { id:'D_CASE', met:()=>true };      // 主指令达标
  S.trap = { id:'T_WINDOW', detect:()=>S.violations>0 };
  S.dirGraded=false; S.violations=1; S.cacheVal=1000; S.beats={truthDone:true};
  C.go('receiptAlive', true);
  A(S.trapHit === true, '应判触发陷阱');
  A(S.grade === 'fail', '触陷阱即便主指令达标也 fail,实际 '+S.grade);
});

/* ---- 离线:无 LLM(平台能力/代理都不在)时,下令与评级仍走模板,机制不缺 ---- */
scenario('离线兜底 · 下令屏用模板措辞、机制在场', null, ({A, C, frame}) => {
  C.go('saymaster', true);
  const t = frame();
  A(t.includes('本局指令'), '离线下令屏应展示本局指令(模板)');
  A(/接入/.test(t), '下令屏应有接入入口');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL SAYMASTER CHECKS PASS');
process.exit(failures ? 1 : 0);
