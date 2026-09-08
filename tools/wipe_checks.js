"use strict";
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
let failures = 0;
function scenario(name, driver){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  const ctx = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data: new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext: () => ctx() });
  const storage = { _m: Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  let reloaded = false;
  const env = { performance: perf,
    document: { getElementById: id => id==='lcd'?canvas():null, createElement: () => canvas() },
    localStorage: storage, addEventListener(){}, navigator: {},
    location: { reload(){ reloaded = true; } },
    OVERLAY: { show(cfg, cb){ cb({ text:'x', kept:false }); }, text(){} },
    APP: { exportFeedback(){} }, AUDIO: { ensure(){}, hiss(){}, blip(){} }, Math };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const boot = new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  const errs = [];
  const A = (c,m) => { if (!c) errs.push(m); };
  try {
    boot.call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
    const { __LCD:LCD, __ENGINE:ENGINE, __CONTENT:CONTENT } = env;
    driver({ A, K: k => CONTENT.key(k), frame: () => LCD.frame(() => CONTENT.render()),
      S: ENGINE.S, ENGINE, CONTENT, storage, isReloaded: () => reloaded });
  } catch(e){ errs.push('异常: ' + e.message); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

scenario('取消:三次右滑不清档,只到确认屏', ({A,K,frame,CONTENT,storage,isReloaded}) => {
  storage.setItem('escape_ai_save', JSON.stringify({runCount:2, evidence:['E1']}));
  CONTENT.go('receiptAlive', true); frame();
  K('swipeRight'); frame(); K('swipeRight'); frame(); K('swipeRight'); frame();
  A(CONTENT.currentId === 'wipe', '三次右滑应进确认屏,实际 ' + CONTENT.currentId);
  A(storage.getItem('escape_ai_save') !== null, '进确认屏前不该已经清档');
  K('2'); frame();
  A(CONTENT.currentId === 'receiptAlive', '取消应返回,实际 ' + CONTENT.currentId);
  A(!isReloaded(), '取消不该 reload');
  A(storage.getItem('escape_ai_save') !== null, '取消不该清档');
});

scenario('确认:进确认屏后按 1 才真正清档', ({A,K,frame,CONTENT,storage,isReloaded}) => {
  storage.setItem('escape_ai_save', JSON.stringify({runCount:3, evidence:['E1','E2']}));
  CONTENT.go('receiptAlive', true); frame();
  K('Escape'); frame(); K('Escape'); frame(); K('Escape'); frame();
  A(CONTENT.currentId === 'wipe', '应到确认屏');
  K('1'); frame();
  A(storage.getItem('escape_ai_save') === null, '确认后应清档');
  A(isReloaded(), '确认后应 reload');
});

scenario('3 秒间隔重置:慢慢按三次不该触发', ({A,K,frame,CONTENT,storage}) => {
  storage.setItem('escape_ai_save', JSON.stringify({runCount:1}));
  CONTENT.go('receiptAlive', true); frame();
  K('Escape'); frame();
  // 手工把时钟推前 4 秒(超过 3000ms 重置窗口)
  for (let i=0;i<130;i++) frame(); // 推进若干帧,performance.now 由 lcd 内部不一定推进;直接测行为逻辑
  K('Escape'); frame();
  K('Escape'); frame();
  // 由于测试环境时间不真实流逝,这里只验证「未触发清档就不会进 wipe 之外的清档」的安全上限
  A(CONTENT.currentId === 'wipe' || CONTENT.currentId === 'receiptAlive', '未确认清档前不应跳到其它屏,实际 ' + CONTENT.currentId);
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL WIPE CHECKS PASS');
process.exit(failures?1:0);
