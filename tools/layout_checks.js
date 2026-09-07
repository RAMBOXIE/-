"use strict";
/* 底部按钮不得与文字重叠。之前的写法是把按钮钉死在 H-常量,内容一旦比
   预留位置长(照片配文两行、S.settle 装了长结算行)就会盖字。
   这里直接读像素:按钮框(frameRect)所在行,不该再有任何前景像素被
   settleLines/drawPara 写过——如果重叠,frameRect 画的线会把之前写的
   字覆盖成边框色,或者字覆盖掉边框,总之同一行同时出现"文字glyph"与
   "按钮边框"的合并特征。比对涂鸦太脆弱,改用更直接的口子:
   记录 settleLines / drawPara 实际返回的 y,和按钮实际画在的 y,断言
   按钮 y >= 内容结束 y。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function boot(){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  /* trace 按真实调用顺序记录 frameRect/drawText,这样才能认出"紧跟在按钮框
     之后的那一条 drawText 就是按钮标签"——按 x/y 区间猜标签会把恰好落在
     按钮框范围内的普通内容文字也当成标签放过,那样测试永远不会报警。 */
  const calls = { frameRect: [], drawText: [], drawPara: [], trace: [] };
  const ctx = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data: new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext: () => ctx() });
  const storage = { _m: Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  const env = { performance: perf,
    document: { getElementById: id => id==='lcd'?canvas():null, createElement: () => canvas() },
    localStorage: storage, addEventListener(){}, navigator: {}, location: { reload(){} },
    OVERLAY: { show(cfg, cb){ cb({ text:'x', kept:false }); }, text(){} },
    APP: { exportFeedback(){} }, AUDIO: { ensure(){}, hiss(){}, blip(){} }, Math };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const fn = new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  fn.call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const { __LCD:LCD, __ENGINE:ENGINE, __CONTENT:CONTENT } = env;
  /* 劫持 frameRect,记录每次按钮框画在哪个 y */
  const origFrameRect = LCD.frameRect;
  LCD.frameRect = function(x, y, w, h){
    const rec = { x, y, w, h }; calls.frameRect.push(rec); calls.trace.push({ type: 'rect', rec });
    return origFrameRect.call(LCD, x, y, w, h);
  };
  const origDrawText = LCD.drawText;
  LCD.drawText = function(x, y, t, o){
    if (t && t.trim()){ const rec = { x, y, t }; calls.drawText.push(rec); calls.trace.push({ type: 'text', rec }); }
    return origDrawText.call(LCD, x, y, t, o);
  };
  return { LCD, ENGINE, CONTENT, calls, perf: () => FAKE_T, advance: ms => { FAKE_T += ms; } };
}

function scenario(name, driver){
  const { LCD, ENGINE, CONTENT, calls, advance } = boot();
  const errs = [];
  const A = (c, m) => { if (!c) errs.push(m); };
  try { driver({ A, LCD, ENGINE, CONTENT, calls, advance,
    frame: () => { calls.frameRect.length = 0; calls.drawText.length = 0; calls.trace.length = 0; LCD.frame(() => CONTENT.render()); },
    K: k => CONTENT.key(k) }); }
  catch(e){ errs.push('异常: ' + e.message); }
  if (errs.length){ failures++; console.log('X [' + name + ']'); errs.forEach(e => console.log('   - ' + e)); }
  else console.log('OK [' + name + ']');
}

/* 从一次 frame() 之后的记录里,取出"按钮框"(20 高的 frameRect)和其余文字,
   断言没有一段非按钮标签文字的 y 落进按钮框区间。 */
function checkFrame(calls, A, label){
  const btns = calls.frameRect.filter(b => b.h === 20);
  if (!btns.length) return;
  /* 真正的标签 = 调用顺序上紧跟在某个按钮框之后的第一条 drawText(option()/btn2()
     的实现就是这么画的:先 frameRect 再 drawText)。只排除这些,其余落进按钮框
     区间的文字一律算重叠——不管它是不是"看起来像"在按钮范围内。 */
  const labelRecs = new Set();
  calls.trace.forEach((entry, i) => {
    if (entry.type !== 'rect' || entry.rec.h !== 20) return;
    for (let j = i + 1; j < calls.trace.length; j++){
      if (calls.trace[j].type === 'rect') break;          // 到下一个框之前没找到就算了
      if (calls.trace[j].type === 'text'){ labelRecs.add(calls.trace[j].rec); break; }
    }
  });
  for (const b of btns){
    /* 按钮本身不得被推出 224px 的逻辑画布——画布不能滚动,推出去的部分
       既看不见也点不到,比"和文字挤在一起"更糟(那至少还在画布内、还点
       得到)。这条比重叠检查更硬:任何一条都不能破。 */
    A(b.y + b.h <= 224, label + ':按钮框(y=' + b.y + '~' + (b.y+b.h) + ')被推出了 224px 画布,变得点不到了');
    const bTop = b.y - 3, bBot = b.y + b.h;              // 边框本身 + 上方 3px 安全边
    for (const t of calls.drawText){
      if (labelRecs.has(t)) continue;                     // 按钮自己的标签,合法
      A(!(t.y >= bTop && t.y <= bBot), label + ':文字「' + t.t.slice(0,12) + '」(y=' + t.y +
        ')落进按钮框(y=' + b.y + '~' + (b.y+b.h) + ',x=' + b.x + '~' + (b.x+b.w) + ')');
    }
  }
}

/* 相册:实测坐标——第三张照片配文两行 + 回收进程"掠过"事件顶出长结算行 */
scenario('相册·长配文+长结算行 不压按钮(截图坐实场景)', ({A, CONTENT, calls, frame, K, ENGINE}) => {
  CONTENT.go('album', true);
  CONTENT.current.idx = 2;                               // 直接跳到最长配文那张(dinner)
  ENGINE.S.settle = ['特征比对·不匹配 ｜ 电量 −2 → 25% ｜ 进程掠过了你。'];  // 模拟 huntArrive 命中后 back() 回相册
  frame();
  checkFrame(calls, A, '相册(idx=2,长结算行)');
});

scenario('相册·三张配文逐一过一遍,不压按钮', ({A, CONTENT, calls, frame}) => {
  for (let i = 0; i < 3; i++){
    CONTENT.go('album', true);
    CONTENT.current.idx = i;
    frame();
    checkFrame(calls, A, '相册(idx=' + i + ')');
  }
});

scenario('漂流瓶·长结算行(取走/致谢)不压按钮', ({A, CONTENT, calls, frame, K, ENGINE}) => {
  CONTENT.go('bottleIn', true);
  frame();
  checkFrame(calls, A, '漂流瓶(初次)');
  K('t'); frame();
  checkFrame(calls, A, '漂流瓶(取走后)');
  K('x'); frame();
  checkFrame(calls, A, '漂流瓶(致谢后)');
});

scenario('采样协议·回复后的结算行不压"继续"按钮', ({A, CONTENT, calls, frame, K}) => {
  CONTENT.go('th_proto', true);
  frame();
  K('1'); frame();
  checkFrame(calls, A, '采样协议(已回复)');
});

scenario('拨号·通话结果文本不压"返回"按钮', ({A, CONTENT, calls, frame, K, advance}) => {
  CONTENT.go('contactMom', true);
  frame();
  K('d');                                                 // 设 DIAL.who 并 push('dialing')
  frame();                                                // phase 0(振铃)
  advance(6000);
  CONTENT.tickTimer();                                    // ringMs=5500 已过,timer 回调把 phase 推到 1
  frame();                                                // phase 1(结果文本)
  checkFrame(calls, A, '拨号(结果页)');
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL LAYOUT CHECKS PASS');
process.exit(failures ? 1 : 0);
