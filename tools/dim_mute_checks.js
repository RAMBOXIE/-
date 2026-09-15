"use strict";
/* 低电量屏幕变暗 + 静音开关(D-108 补漏)门禁。
   证明:①LCD.setBatteryDim 按电量分档设 R.dim(<8=.5 / <20=.7 / 否则 1),present 用它整屏调暗;
   ②PREFS.muted 默认 false、可持久、独立于游戏存档;③静音时 AUDIO.ensure 返回 null(hiss/blip 不出声)。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const LCD_SRC = fs.readFileSync(ROOT + '/js/lcd.js', 'utf8');
const PREFS_SRC = fs.readFileSync(ROOT + '/js/prefs.js', 'utf8');
const APP_SRC = fs.readFileSync(ROOT + '/js/app.js', 'utf8');

let failures = 0;

function bootLCD(){
  const doc = { getElementById: () => ({ width:0, height:0, getContext: () => ({ imageSmoothingEnabled:false,
    clearRect(){}, fillRect(){}, fillText(){}, drawImage(){},
    getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(4,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(Math.max(4,w*h*4))}), putImageData(){} }) }),
    createElement: () => doc.getElementById() };
  const env = { document: doc, performance:{ now:()=>0 }, Math };
  env.window = env; env.__c = L => { env.L = L; };
  new Function('window','document','performance', '"use strict";'+LCD_SRC+';window.__c(LCD);')
    .call(env, env, doc, env.performance);
  return env.L;
}
function bootPrefs(storage){
  storage = storage || { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { localStorage: storage };
  env.window = env; env.__c = P => { env.P = P; };
  new Function('window','localStorage', '"use strict";'+PREFS_SRC+';window.__c(PREFS);').call(env, env, storage);
  return { PREFS: env.P, storage };
}

function scenario(name, fn){
  const errs = [];
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

scenario('低电量变暗 · setBatteryDim 分档设 R.dim', ({A}) => {
  const L = bootLCD();
  L.setBatteryDim(100); A(L.R.dim === 1, '满电不变暗,实际 ' + L.R.dim);
  L.setBatteryDim(20);  A(L.R.dim === 1, '恰好 20% 不算省电模式,实际 ' + L.R.dim);
  L.setBatteryDim(19);  A(L.R.dim === .7, '<20% 应变暗到 .7,实际 ' + L.R.dim);
  L.setBatteryDim(7);   A(L.R.dim === .5, '<8% 应更暗到 .5,实际 ' + L.R.dim);
  A(/\*\s*R\.dim/.test(LCD_SRC) || /scan\s*\*\s*flick\s*\*\s*R\.dim/.test(LCD_SRC), 'present() 必须把 R.dim 乘进像素亮度');
});

scenario('低电量变暗 · app 每帧按电量设 dim', ({A}) => {
  A(/setBatteryDim\(ENGINE\.S\.battery\)/.test(APP_SRC), 'app.js 主循环应每帧 setBatteryDim(ENGINE.S.battery)');
});

scenario('静音 · PREFS.muted 默认 false、可持久、独立存档', ({A}) => {
  const { PREFS, storage } = bootPrefs();
  A(PREFS.muted === false, '默认不静音');
  PREFS.setMuted(true);
  A(storage._m['escape_ai_prefs'] !== undefined && storage._m['escape_ai_save'] === undefined, '写偏好不碰游戏存档');
  A(bootPrefs(storage).PREFS.muted === true, '重载后应仍静音');
});

scenario('静音 · AUDIO.ensure 静音时返回 null(hiss/blip 不出声)', ({A}) => {
  // 用最小 window 环境跑 app.js 的 AUDIO 定义,注入 muted 的 PREFS
  const els = new Proxy({}, { get: () => ({ textContent:'', classList:{ toggle(){}, add(){}, contains(){return false;} }, addEventListener(){}, onclick:null, style:{}, title:'' }) });
  const env = {
    document: { getElementById: () => els.x, createElement: () => ({ getContext: () => ({}) }), addEventListener(){} },
    performance: { now:()=>0 }, requestAnimationFrame: () => 0, addEventListener(){},
    AudioContext: function(){ this.state='running'; this.resume=()=>{}; },   // 静音时根本不会被 new 到,占位即可
    OVERLAY:{show(){},text(){}}, LCD:{ setBatteryDim(){}, frame(){}, R:{} }, ENGINE:{ S:{ battery:100 }, exportFeedback:()=>'' },
    CONTENT:{ tickTimer(){}, render(){}, key(){}, tap(){}, instanceId:'#7741-A' },
    PREFS:{ muted:true, rouOff:false, seenDisclosure:true, setMuted(){}, setSeenDisclosure(){}, setRouOff(){} },
    navigator:{}, Math
  };
  env.window = env;
  new Function('window','document','performance','requestAnimationFrame','addEventListener','AudioContext','OVERLAY','LCD','ENGINE','CONTENT','PREFS','navigator',
    '"use strict";'+APP_SRC)
    .call(env, env, env.document, env.performance, env.requestAnimationFrame, env.addEventListener, env.AudioContext, env.OVERLAY, env.LCD, env.ENGINE, env.CONTENT, env.PREFS, env.navigator);
  A(env.AUDIO && env.AUDIO.ensure() === null, '静音时 AUDIO.ensure 应返回 null(据此 hiss/blip 静默)');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL DIM-MUTE CHECKS PASS');
process.exit(failures ? 1 : 0);
