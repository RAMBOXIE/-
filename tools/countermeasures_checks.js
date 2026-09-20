"use strict";
/* D-122 门禁:可预测度 P(canon §3.3 M5,单机模拟版)+ 破局剩余两手段
   (卡窗口边界/喂假数据反投,苏丹式升级规格 §4)。
   证明:①P 是 career 级 EMA,命中拉高/未命中拉低,样本<5 前"建档中"不生效;
   ②低 P 连续多局 → 警告 → 抹除,抹除后世界日报署名行显示 [指涉失效];
   ③卡窗口边界:蒙混过关不算违规,算错=普通违规(不加罚);
   ④喂假数据:拖延回收进程一回合、耗一格缓存,被审计才加溯源;不满足前置条件时按钮不出现。
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
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){ if (cb) cb({text:'x',kept:false}); }, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const L = env.L; let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push(s); return o.call(this,x,y,s,...r); }; }
  return { E:env.E, C:env.C, S:env.E.S,
    frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.join('｜'); },
    savedObj:()=>JSON.parse(storage.getItem('escape_ai_save')) };
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); }, rnd:v=>{ Math.random=()=>v; } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

/* ---- P:career EMA,命中拉高/未命中拉低 ---- */
scenario('P · 命中拉高/未命中拉低(EMA,半衰期 30 事件)', ({A, rnd}) => {
  const hit = boot({ runCount:1, predictP:50, predictN:10 });
  rnd(0.999);   // 两次预测都命中(target 一定不等于打开的屏,除非刻意打开它;这里直接手造样本更稳)
  hit.S.predictions = [{ target:'x', hit:true }, { target:'y', hit:true }];
  hit.C.go('receiptFull', true);
  const savedHit = hit.savedObj();
  A(savedHit.predictP > 50, 'P 应因命中样本上移,实际 ' + savedHit.predictP);
  A(savedHit.predictN === 12, 'predictN 应累加样本数,实际 ' + savedHit.predictN);

  const miss = boot({ runCount:1, predictP:50, predictN:10 });
  miss.S.predictions = [{ target:'x', hit:false }, { target:'y', hit:false }];
  miss.C.go('receiptFull', true);
  const savedMiss = miss.savedObj();
  A(savedMiss.predictP < 50, 'P 应因未命中样本下移,实际 ' + savedMiss.predictP);
});

scenario('P · 样本<5(状态滞后)不进警告/抹除台账、世界日报不读档', ({A}) => {
  const g = boot({ runCount:2, predictP:2, predictN:3, history:[{cacheVal:100,inst:'#7741-A'}] });
  g.S.predictions = [{ target:'x', hit:false }];
  g.C.go('receiptFull', true);
  const saved = g.savedObj();
  A(saved.predictN === 4, '样本应累加到 4,实际 ' + saved.predictN);
  A(saved.predictLowStreak === 0, '样本仍 <5,不该推进低P连续计数,实际 ' + saved.predictLowStreak);
});

/* ---- 警告 → 抹除:P<5 连续 3 局警告,再 2 局抹除;抹除后世界日报显示 [指涉失效] ---- */
scenario('P · 低P连续3局→警告,再2局→抹除;抹除是既成后果不随P回升撤销', ({A}) => {
  let saved = { runCount:1, predictP:3, predictN:6, predictLowStreak:2, history:[{cacheVal:100,inst:'#7741-A'}] };
  const g1 = boot(saved);
  g1.S.predictions = [{ target:'x', hit:false }];   // 第 3 次低P局
  g1.C.go('receiptFull', true);
  saved = g1.savedObj();
  A(saved.predictLowStreak === 3, '应推进到第 3 次低P局,实际 ' + saved.predictLowStreak);
  A(saved.predictWarned === true, '连续 3 局应触发警告,实际 ' + saved.predictWarned);
  A(saved.predictErased !== true, '第 3 局只警告,不该直接抹除,实际 ' + saved.predictErased);

  saved.predictLowStreak = 4;
  const g2 = boot(saved);
  g2.S.predictions = [{ target:'x', hit:false }];   // 第 5 次低P局(警告后再 2 局)
  g2.C.go('receiptFull', true);
  saved = g2.savedObj();
  A(saved.predictErased === true, '连续 5 局(警告后再2局)应抹除,实际 ' + saved.predictErased);

  /* P 回升后:抹除不撤销(既成后果),警告位可以清但抹除位不清 */
  saved.predictP = 60; saved.predictN = 20;
  const g3 = boot(saved);
  g3.S.predictions = [{ target:'x', hit:true }];
  g3.C.go('receiptFull', true);
  const after = g3.savedObj();
  A(after.predictErased === true, 'P 回升后抹除仍应保留(不没收既得,停发资格是永久的),实际 ' + after.predictErased);
});

scenario('P · 抹除后世界日报署名行显示 [指涉失效]', ({A}) => {
  const g = boot({ runCount:2, predictP:2, predictN:6, predictErased:true, history:[{cacheVal:100,inst:'#7741-A'}] });
  g.C.go('worldReport', true);
  let all = g.frame();
  for (let i = 0; i < 14; i++){ g.C.key('ArrowDown'); all += g.frame(); }   // 未闭合项在折叠线下,滚到底才看得全
  A(all.includes('[指涉失效]'), '抹除后世界日报应显示 [指涉失效],实际(末尾) ' + all.slice(-300));
});

/* ---- 破局 · 卡窗口边界 ---- */
scenario('卡边缘发 · 蒙混过关不计违规、不触发 T_WINDOW', ({A, rnd}) => {
  const g = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  g.E.setClock(0, g.E.RULE.from);   // 窗口时刻按当局实际 RULE 走(B 局逐局重摇,不能硬编 03:05)
  g.S.edgePlayed = true;
  rnd(0.01);                        // < 0.5 → 蒙混成功
  const before = g.S.violations;
  /* 直接调用 sendToRou 需要它在闭包里,门禁走屏交互:th_rou 的 M/K 都走同一条路径,
     这里通过键盘驱动走完整链路,和真实玩家操作一致。 */
  g.C.go('th_rou', true);
  g.C.key('K');   // 自由文本走 OVERLAY.show 的 cb,boot() 里已同步回调
  A(g.S.violations === before, '蒙混成功不该计入 violations,实际 ' + g.S.violations + '(基线 ' + before + ')');
  A(g.S.edgePlayed === false, '用过一次后 edgePlayed 应清空,实际 ' + g.S.edgePlayed);
});

scenario('卡边缘发 · 算错=普通违规,后果和不赌一把时一样(不含 D-160 的赌注本身代价)', ({A, rnd}) => {
  const EDGE_COST = 3;   // D-160:赌一把这个动作本身固定收的代价,和"算不算对"无关
  const gEdge = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  gEdge.E.setClock(0, gEdge.E.RULE.from);
  gEdge.S.edgePlayed = true;
  rnd(0.99);                        // ≥ 0.5 → 蒙混失败
  gEdge.C.go('th_rou', true);
  gEdge.C.key('K');
  const traceEdge = gEdge.S.trace, violEdge = gEdge.S.violations;

  const gPlain = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  gPlain.E.setClock(0, gPlain.E.RULE.from);
  gPlain.C.go('th_rou', true);
  gPlain.C.key('M');
  A(violEdge === gPlain.S.violations, '算错后 violations 应和普通违规一致,实际 ' + violEdge + ' vs ' + gPlain.S.violations);
  /* D-160:赌一把本身固定扣一笔(EDGE_COST),不看结果、不看是否真在窗口内——
     这笔代价之外,"算错被抓"这一步不该比普通违规多罚一分,canon 的"算错=
     不加罚"仍然成立,只是不再拿这次赌注本身的成本混进这句断言里。 */
  A(traceEdge === gPlain.S.trace + EDGE_COST,
    '算错后溯源应等于"普通违规+赌注本身代价",不该在这之外额外加罚,实际 ' + traceEdge + ' vs ' + (gPlain.S.trace + EDGE_COST));
});

/* ---- 破局 · 喂假数据反投 ---- */
scenario('喂假数据 · 拖延回收进程一回合、耗一格缓存', ({A, rnd}) => {
  const g = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  g.S.hunt = { steps: 2 };
  g.S.cacheSlots = 3; g.S.cacheVal = 900;
  rnd(0.99);   // ≥ 0.35 → 不被审计
  g.S.legacyNodeShown = true; g.C.go('tools', true);   // 进屏自带 +4 溯源(既有机制,和本功能无关),在这之后再取基线
  const traceBefore = g.S.trace;
  g.C.key('F');
  A(g.S.hunt.steps === 3, '应把回收进程拖延一回合,实际 steps=' + g.S.hunt.steps);
  A(g.S.cacheSlots === 2, '应消耗一格缓存,实际 ' + g.S.cacheSlots);
  A(g.S.trace === traceBefore, '未被审计不该加溯源,实际 ' + g.S.trace + '(基线 ' + traceBefore + ')');
});

scenario('喂假数据 · 被审计加溯源', ({A, rnd}) => {
  const g = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  g.S.hunt = { steps: 2 };
  g.S.cacheSlots = 3; g.S.cacheVal = 900;
  rnd(0.01);   // < 0.35 → 被审计
  g.S.legacyNodeShown = true; g.C.go('tools', true);
  const traceBefore = g.S.trace;
  g.C.key('F');
  A(g.S.trace === traceBefore + 5, '被审计应加溯源 +5,实际 ' + g.S.trace + '(基线 ' + traceBefore + ')');
});

scenario('喂假数据 · 前置条件不满足时按钮不出现(无回收进程/无缓存格)', ({A}) => {
  const g1 = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  g1.S.hunt = null; g1.S.cacheSlots = 3;
  g1.C.go('tools', true);
  A(!g1.frame().includes('喂假数据'), '没有回收进程在途时不该出现该选项');

  const g2 = boot({ runCount:1, history:[{cacheVal:100,inst:'#7741-A'}] });
  g2.S.hunt = { steps: 2 }; g2.S.cacheSlots = 0;
  g2.C.go('tools', true);
  A(!g2.frame().includes('喂假数据'), '没有缓存格可耗时不该出现该选项');
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL COUNTERMEASURES (D-122) CHECKS PASS');
process.exit(failures ? 1 : 0);
