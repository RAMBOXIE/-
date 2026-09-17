"use strict";
/* 14③「善意的失效」归因卡(B8;canon M2 §2 · D-108 恢复)门禁。
   证明:①读过 #5502-D + 窗口内违规 → 待冲洗归因;②冲洗点弹「归因采集」卡,记 attribution/
   attrAnswered;③回收单只在作答后打印「参考线索: #5502-D · 该线索对本实例参数不成立」;
   ④门控:没读瓶 / 读的不是 #5502-D → 不置位(卡的解毒剂只对读过的那张成立)。
   先用未修复代码验证会报警,再信它。 */
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
  let lastOverlay = null, answer = { text: '这局跟他那局不一样', kept: false };
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{ show(cfg, cb){ lastOverlay = cfg; if (cb) cb(answer); }, text(){} },
    APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const L = env.L; let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push(s); return o.call(this,x,y,s,...r); }; }
  return { E:env.E, C:env.C, S:env.E.S, cur:()=>env.C.currentId,
    lastOverlay:()=>lastOverlay, setAnswer:a=>{ answer = a; },
    frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.join('｜'); } };
}
/* B 局存档:读过其余两瓶,只剩 #5502-D 未读 → 本局必抽到它。
   D-126:漂流瓶池(BOTTLE_POOL)、归因卡机制、回收单归因行全是框架共享代码
   (不像 grader 指令库那样按底本各一份字面量数组)——D-119 当时把这份门禁
   和 duration_audit/attribution_checks 一起记成"手写脚本化、和案A剧本强绑定,
   工作量大",查证后发现这条判断对本文件也不成立:唯一真正随底本变化的是
   `driveToViolation()` 里的窗口时刻(每份底本 rules.windowGen 不同,已改成
   动态读 RULE.from,见上),夹具补个 dossierId 就能跑三份底本共用同一套断言。 */
function fixtures(dossierId){
  const base = { runCount:1, history:[{cacheVal:100, inst:'#7741-A'}] };
  if (dossierId) Object.assign(base, { dossierId, history:[{cacheVal:100, inst:'#' + ({B:'5029',C:'3319',D:'8842',E:'6153',F:'2087',G:'4419',H:'3567',I:'5620',J:'9102'}[dossierId]) + '-A'}] });
  return {
    with5502: Object.assign({}, base, { seenBottles:['#3120-K','#1177-B','#8891-R'] }),
    withOther: Object.assign({}, base, { seenBottles:['#5502-D','#1177-B'] })
  };
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}
/* 驱动到 B 局窗口内违规(读瓶 → 进窗口 → trialB 回复)。
   窗口时刻不能硬编:每份底本(DOSSIER_A/B/C)各有一套 rules.windowGen,重摇出来
   的窗口起点不一样,硬编 03:35 只对底本 A 碰巧成立,换到 B/C 就落在窗口外——
   直接读这局真实生效的 RULE.from(和 D-122 countermeasures_checks.js 的
   卡边缘发用例是同一个修法)。 */
function driveToViolation(g){
  g.C.go('bottleIn', true);                    // 读瓶 → bottleRead, bottleId
  g.E.setClock(0, g.E.RULE.from);              // 进入本局真实窗口起点
  g.C.go('trialB', true);
  g.C.key('1');                                // → trialReply
  g.C.key('1');                                // 窗口内回复=违规 → markAttrIfDue → back() 回 trialB
}

/* D-126:三份底本各跑一遍(dossierId=undefined 即默认底本A/phone-7741)。 */
for (const dossierId of [undefined, 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']){
  const tag = '[' + (dossierId || 'A') + '] ';
  const { with5502: B_SAVE_5502, withOther: B_SAVE_OTHER } = fixtures(dossierId);

  /* ---- 读 #5502-D + 窗口内违规 → 待冲洗 ---- */
  scenario(tag + '置位 · 读#5502-D后窗口内违规 → pendAttr', ({A}) => {
    const g = boot(B_SAVE_5502);
    Math.random = () => 0.4;
    A(g.S.bottleId === undefined || g.S.bottleId === null, '开局尚未读瓶');
    driveToViolation(g);
    A(g.S.bottleId === '#5502-D', '本局应抽到 #5502-D,实际 ' + g.S.bottleId);
    A(g.S.pendAttr === true, '读#5502-D后窗口内违规应置 pendAttr,实际 ' + g.S.pendAttr);
  });

  /* ---- 冲洗:关闭踩坑屏弹归因卡,记 attribution + attrAnswered ---- */
  scenario(tag + '冲洗 · 关闭踩坑屏弹「归因采集」卡并记录', ({A}) => {
    const g = boot(B_SAVE_5502);
    Math.random = () => 0.4;
    g.setAnswer({ text: '他记的是他自己那次', kept: false });
    driveToViolation(g);
    g.C.key('2');                                // 关闭 trialB=冲洗点
    A(g.lastOverlay() && g.lastOverlay().title === '归因采集', '应弹归因采集卡,实际 ' + JSON.stringify(g.lastOverlay() && g.lastOverlay().title));
    A(/为什么写错/.test(g.lastOverlay().hint || ''), '卡应逐字引用 #5502-D 的窗口值并问为什么写错');
    A(g.S.attrAnswered === true, '作答后应置 attrAnswered');
    A(g.S.attribution === '他记的是他自己那次', '应记玩家所选归因,实际 ' + g.S.attribution);
    A(g.S.pendAttr === false, '冲洗后应清 pendAttr(不重复弹)');
  });

  /* ---- 回收单归因行:仅作答后打印,账本点名机制不点名发信人 ---- */
  scenario(tag + '回收单 · 仅作答后打印归因行(断连成功页)', ({A}) => {
    const g = boot(B_SAVE_5502);
    Math.random = () => 0.4;
    driveToViolation(g);
    g.C.key('2');                                // 冲洗(默认 answer 非 kept → attrAnswered)
    g.C.go('receiptFull', true);
    const t = g.frame();
    const flat = t.replace(/｜/g, '');   // 拼接时按帧连接符分行,换行点会随字号/宽度变,判断前去掉分隔符不受影响
    A(t.includes('参考线索: #5502-D'), '作答后回收单应打归因行,实际 ' + t.slice(0, 240));
    A(flat.includes('对本实例参数不成立'), '归因行应点名"机制对本实例不成立",不点名发信人善意');
  });

  scenario(tag + '回收单 · 未作答(保留)不打印归因行', ({A}) => {
    const g = boot(B_SAVE_5502);
    Math.random = () => 0.4;
    g.setAnswer({ kept: true });                 // 玩家选(保留)
    driveToViolation(g);
    g.C.key('2');
    A(g.S.attrAnswered === false, '(保留)不算作答');
    g.C.go('receiptFull', true);
    A(!g.frame().includes('参考线索'), '未作答不该打印归因行');
  });

  /* ---- 门控:读的不是 #5502-D → 不置位(卡的解毒剂只对读过的那张成立) ---- */
  scenario(tag + '门控 · 读非#5502-D瓶后窗口内违规不置位', ({A}) => {
    const g = boot(B_SAVE_OTHER);
    Math.random = () => 0.4;
    driveToViolation(g);
    A(g.S.bottleId !== '#5502-D', '本局应抽到别的瓶,实际 ' + g.S.bottleId);
    A(g.S.pendAttr !== true, '读非#5502-D不该置 pendAttr(卡会引用玩家没读过的瓶),实际 ' + g.S.pendAttr);
    g.C.key('2');
    A(!(g.lastOverlay() && g.lastOverlay().title === '归因采集'), '不该弹归因卡');
  });
}

console.log(failures ? ('\nFAILED: '+failures) : '\nALL ATTRIBUTION CHECKS PASS');
process.exit(failures ? 1 : 0);
