"use strict";
/* D-127 门禁:电量数字"错值→真值"故障效果(D-108 Low 清单最后一条)。
   证明:①低失真档(tsScramble=false)电量数字永不闪烁;②高失真档偶尔闪烁,但
   只逐帧临时糊数字位,真实 S.battery 从不被这个效果改动(纯视觉噪声,不是
   悄悄偷电量);③闪烁只落在数字位,不会把百分号本身糊掉。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;
const A = (ok, msg) => { if (!ok){ failures++; console.log('X ' + msg); } else console.log('OK ' + msg); };

function boot(){
  let T = 1000; const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){if(cb)cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const L = env.L; let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push({x,y,t:s}); return o.call(this,x,y,s,...r); }; }
  return { L, E:env.E, C:env.C, S:env.E.S,
    frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.slice(); } };
}
function pctOf(trace){
  const g = boot();
  g.S.battery = 62; g.S.trace = trace; g.L.applyTier(trace);
  g.C.go('menu', true);   // handshake(默认开机屏)不画状态栏,换一个真的调 statusBar() 的屏
  return g;
}

/* ---- 低失真档:tsScramble=false,电量数字永不闪烁 ---- */
{
  const g = pctOf(10);
  A(g.L.R.tsScramble === false, '低失真档 tsScramble 应为 false(测试前提)');
  const RND = Math.random; Math.random = () => 0;   // 拉满概率,若门没关住也会闪
  let sawScrambled = false;
  for (let i = 0; i < 40; i++){
    const trace = g.frame();
    const pctText = trace.find(t => /%$/.test(t.t));
    if (pctText && pctText.t !== '62%') sawScrambled = true;
  }
  Math.random = RND;
  A(!sawScrambled, '低失真档电量数字不该闪(即使 Math.random 拉满),实际出现过闪烁');
}

/* ---- 高失真档:会闪,但 S.battery 真值从不被改动;只糊数字位,不糊% ---- */
{
  const g = pctOf(90);
  A(g.L.R.tsScramble === true, '高失真档 tsScramble 应为 true(测试前提)');
  const RND = Math.random; Math.random = () => 0;   // 每帧都命中闪烁分支
  let sawScrambled = false, sawPercentCorrupted = false, batteryEverChanged = false;
  for (let i = 0; i < 40; i++){
    const trace = g.frame();
    const pctText = trace.find(t => /%$/.test(t.t));
    if (pctText){
      if (pctText.t !== '62%') sawScrambled = true;
      if (!pctText.t.endsWith('%')) sawPercentCorrupted = true;
    }
    if (g.S.battery !== 62) batteryEverChanged = true;
  }
  Math.random = RND;
  A(sawScrambled, '高失真档、Math.random 拉满时应看到电量数字闪烁,实际全程未闪');
  A(!sawPercentCorrupted, '闪烁只该糊数字位,百分号本身不该被换掉');
  A(!batteryEverChanged, '闪烁效果不该改动真实 S.battery,应始终 62');
}

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL BATTERY-GLITCH (D-127) CHECKS PASS');
process.exit(failures ? 1 : 0);
