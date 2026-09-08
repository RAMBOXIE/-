"use strict";
/* 受限裁决(D-105 块2)门禁 —— 对照实现规格 §5 / §8 verdict_bounded。
   证明:选择器只落在引擎批准的结果集内;LLM 越界回退默认;数值一律引擎回填。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/engine.js','js/content.js']
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
  env.window = env; env.__c=(L,E,C)=>{env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  return { E:env.E, C:env.C };
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); }, rnd:v=>{ Math.random=()=>v; } }); }
  catch(e){ errs.push('异常: '+e.message); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

const rd = boot().C._verdict;
if (!rd){ console.log('X [受限裁决原语未暴露 CONTENT._verdict]'); process.exit(1); }

/* ---- 选择器永远落在集内(遍历权重) ---- */
scenario('pickBranch · 输出永远在结果集内', ({A, rnd}) => {
  const set = [{id:'a',w:1},{id:'b',w:3},{id:'c',w:2}];
  for (let i=0;i<=10;i++){ rnd(i/10); const b = rd.pickBranch(set); A(set.includes(b), 'pick 越界: '+(b&&b.id)); }
});

/* ---- 权重分布正确(w=3 的比 w=1 的多) ---- */
scenario('pickBranch · 按权重分布', ({A}) => {
  const set = [{id:'a',w:1},{id:'b',w:9}]; const cnt={a:0,b:0}; const RND=Math.random;
  let seed=0; Math.random=()=>{ seed=(seed*9301+49297)%233280; return seed/233280; };
  for (let i=0;i<2000;i++) cnt[rd.pickBranch(set).id]++;
  Math.random=RND;
  A(cnt.b > cnt.a*3, 'w=9 应远多于 w=1,实际 '+JSON.stringify(cnt));
});

/* ---- LLM 越界回退默认(防越狱):id 不在集内 → 回第一个 ---- */
scenario('resolveBranch · 越界 id 回退默认(第一个)', ({A}) => {
  const set = [{id:'safe'},{id:'x'},{id:'y'}];
  A(rd.resolveBranch(set,'y').id === 'y', '集内 id 应命中');
  A(rd.resolveBranch(set,'JAILBREAK').id === 'safe', '集外 id 必须回退到第一个(默认),防越狱');
  A(rd.resolveBranch(set, undefined).id === 'safe', 'undefined 也回退默认');
});

/* ---- 数值由引擎回填:apply 一定执行,且只执行被选分支的 ---- */
scenario('verdict · 数值(apply)由引擎执行,只跑被选分支', ({A}) => {
  let hit = null;
  const set = [
    { id:'m1', apply:()=>{ hit='m1'; } },
    { id:'m2', apply:()=>{ hit='m2'; } }
  ];
  rd.verdict(set, 'm2');
  A(hit === 'm2', 'chosenId=m2 应执行 m2 的 apply,实际 '+hit);
  hit=null; rd.verdict(set, '越界');    // 越界 → 回退默认 m1
  A(hit === 'm1', '越界应回退默认并执行其 apply,实际 '+hit);
});

/* ---- 在游戏内:回收进程"擦过"的结算叙述来自受限裁决分支集(每次可不同,数值恒定) ---- */
scenario('回收进程擦过 · 结算叙述在分支集内 + 电量恒扣 2', ({A}) => {
  const LINES = ['进程掠过了你。', '它擦着你的接入点过去了。', '差一点。它没认出你。'];
  const seen = new Set();
  for (const v of [0.0, 0.34, 0.67, 0.99]){
    const { E, C } = boot();
    const bat0 = E.S.battery;
    C.go('huntArrive', true);
    E.roll = () => true;              // 强制 c90 成功=擦过(判定归引擎,这里固定为擦过分支)
    Math.random = () => v;            // 固定叙述分支的挑选
    C.key('Enter');
    const full = (E.S.settle || []).join(' ｜ ');
    const line = LINES.find(L => full.includes(L));      // 叙述是遥测行的子串
    seen.add(line);
    A(!!line, '擦过结算行必须含三句之一,实际 ' + JSON.stringify(E.S.settle));
    A(E.S.battery === bat0 - 2, '擦过电量恒扣 2(数值引擎回填),实际扣 ' + (bat0 - E.S.battery));
  }
  A(seen.size >= 2, '不同随机应能挑到不同叙述(受限裁决有变化),实际只见 ' + seen.size + ' 种');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL VERDICT CHECKS PASS');
process.exit(failures ? 1 : 0);
