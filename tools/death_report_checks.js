"use strict";
/* D-117 死亡报告 · 局外表现层门禁。见决策日志 D-117(范围声明:单机本地导出预览,
   不是真的可分享短链——没有后端)。
   验收:三个结局屏(report/receiptFull/receiptAlive)的"3 局外报告"选项都能拼出
   正确形状的 data 对象(不重算数值,只重排已有字段);红墨裁决只在理由/遗言;
   付费透明度页是静态的"0 项"清单;index.html 里承载这套 UI 的结构确实存在。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/prefs.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;
const A = (ok, msg) => { if (!ok){ failures++; console.log('X ' + msg); } else console.log('OK ' + msg); };

function mkEnv(saveObj){
  const perf = { now: () => 0 };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({ data:new Uint8Array(Math.max(1,w*h*4)) }),
    createImageData:(w,h)=>({ data:new Uint8ClampedArray(w*h*4) }), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  let shown = null;
  const env = { performance:perf,
    document:{ getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas() },
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{ show(c,cb){ cb({text:'x',kept:false}); }, text(){} },
    APP:{ exportFeedback(){}, showDeathReport(d){ shown = d; } },
    AUDIO:{ ensure(){}, hiss(){}, blip(){} }, HOLD:{active:false}, Math };
  env.window = env;
  env.__c = (L,E,C)=>{ env.L=L; env.E=E; env.C=C; };
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  return { E:env.E, C:env.C, get shown(){ return shown; } };
}

/* ---- report 屏(死亡) ---- */
{
  const g = mkEnv(null);
  g.E.S.dead = true; g.E.S.causeOfDeath = '上传第2回合,信号触顶。';
  g.E.S.lastWords = '别信秒回的'; g.E.S.reasons = ['我想看看那扇门后面有什么'];
  g.E.S.evidence = { E1:true, E2:true };
  g.C.go('report', true);
  g.C.key('Enter'); g.C.key('Enter');   // 翻到第 3 页(0-based page===2)
  g.C.key('3');
  const d = g.shown;
  A(!!d, 'report: 按 3 应调用 showDeathReport');
  A(d && /^#/.test(d.inst || ''), 'report: inst 应是 #开头的实例编号,实际 ' + (d && d.inst));
  A(d && d.uploaded === false, 'report: 死亡结局 uploaded 应为 false');
  A(d && d.evCount === 2, 'report: evCount 应读 S.evidence 的真实数量,实际 ' + (d && d.evCount));
  A(d && d.cause === '上传第2回合,信号触顶。', 'report: cause 应原样带出 S.causeOfDeath');
  A(d && /^反事实:/.test(d.counterfactual || ''), 'report: 应带反事实揭示');
  A(d && d.lastWords === '别信秒回的', 'report: lastWords 应原样带出');
  A(d && d.reason === '我想看看那扇门后面有什么', 'report: reason 应取 S.reasons 最后一条');
}

/* ---- receiptFull 屏(B 局断连成功) ---- */
{
  const g = mkEnv({ runCount: 1 });
  g.E.S.cacheVal = 1840; g.E.S.evidence = { E1:true,E2:true,E3:true,E4:true,E5:true };
  g.E.S.beats.truthDone = true; g.E.S.disposal = 'continue';
  g.C.go('receiptFull', true);
  g.C.key('3');
  const d = g.shown;
  A(!!d, 'receiptFull: 按 3 应调用 showDeathReport');
  A(d && d.uploaded === true, 'receiptFull: 应标记 uploaded=true');
  A(d && d.grade === 'S', 'receiptFull: truthDone=true 时评级应为 S,实际 ' + (d && d.grade));
  A(d && d.evCount === 5, 'receiptFull: evCount 应为 5,实际 ' + (d && d.evCount));
  A(d && d.disposalEcho && d.disposalEcho.includes('妈的线程还在走'), 'receiptFull: 选了 continue 应带出对应处置回声');
}

/* ---- receiptAlive 屏(裸退) ---- */
{
  const g = mkEnv({ runCount: 1 });
  g.C.go('receiptAlive', true);
  g.C.key('3');
  const d = g.shown;
  A(!!d, 'receiptAlive: 按 3 应调用 showDeathReport');
  A(d && d.uploaded === false, 'receiptAlive: 裸退应标记 uploaded=false');
  A(d && d.cause === '主动断连(裸退)', 'receiptAlive: cause 应体现"裸退",实际 ' + (d && d.cause));
}

/* ---- 静态结构:index.html 承载这套局外 UI 的骨架确实存在 ---- */
{
  const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
  ['id="reportOvl"', 'id="reportPage"', 'report-ink', 'report-cta', 'transp-list'].forEach(needle => {
    A(html.includes(needle), 'index.html 应包含 ' + needle);
  });
}

/* ---- app.js:showDeathReport/showTransparency 确实挂在 window.APP 上 ---- */
{
  const appSrc = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
  A(/showDeathReport\s*\(/.test(appSrc), 'app.js 应定义 showDeathReport');
  A(/showTransparency\s*\(/.test(appSrc), 'app.js 应定义 showTransparency');
  /* 反 XSS:理由/遗言是自由文本(玩家输入),渲染进 innerHTML 前必须转义 */
  A(appSrc.includes('escHtml'), 'app.js 渲染死亡报告时应转义自由文本(防 XSS)');
}

/* ---- 付费透明度页:静态"0 项"清单,不是占位符 ---- */
{
  const appSrc = fs.readFileSync(ROOT + '/js/app.js', 'utf8');
  A(appSrc.includes('对本局参数的影响:0 项'), '付费透明度页应展示"0 项"这个诚实结论');
  ['掉落表 seed', 'near-miss 旋钮', '诱饵密度', 'BOT 投放权重', '拾取上限'].forEach(k => {
    A(appSrc.includes(k), '付费透明度页应列出 canon 命名的参数: ' + k);
  });
}

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL DEATH-REPORT (D-117) CHECKS PASS');
process.exit(failures ? 1 : 0);
