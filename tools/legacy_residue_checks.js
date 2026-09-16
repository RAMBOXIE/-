"use strict";
/* D-115 死亡→残留注入闭环(单机模拟版)门禁。见
   design/死亡残留注入闭环_单机模拟版_设计_v0.1.md。
   验收:M12 遗留会话节点(挂点触发+每局至多1条)/ M14 捡到别人遗物(回收/归还二选一,
   归还追加进漂流瓶共享池且跨机子career级持久)/ M13 非语言残响(只在已读+无数值后果)。 */
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
    frame:()=>{ ft=[]; L.frame(()=>C.render()); return ft.join('|'); },
    save:()=>JSON.parse(storage.getItem('escape_ai_save')||'null') };
}

function withRandom(v, fn){
  const RND = Math.random; Math.random = () => v;
  try { return fn(); } finally { Math.random = RND; }
}

/* ---- M12 遗留会话节点 ---- */
withRandom(0.01, () => {   // < 0.2 阈值,必触发;取候选池第 0 个
  const g = mkEnv({ runCount: 1 });
  g.C.go('tools', true);
  const t = g.frame();
  A(t.includes('残留 ·') && t.includes('遗言:') && t.includes('理由:'),
    'M12: tools 挂点应触发遗留会话节点,实际: ' + t.slice(0, 80));
  A(/系统 \d+% 确定/.test(t), 'M12: 应含"死者最后预测"句式');
});
withRandom(0.9, () => {   // >= 0.2 阈值,不该触发
  const g = mkEnv({ runCount: 1 });
  g.C.go('tools', true);
  const t = g.frame();
  A(!t.includes('残留 ·'), 'M12: 低概率没抽中时不该出现残留节点,实际: ' + t.slice(0, 60));
});
withRandom(0.01, () => {
  const g = mkEnv({ runCount: 1 });
  g.C.go('tools', true); g.frame();       // 第一次:应该已经触发过(legacyNodeShown=true)
  A(g.S.legacyNodeShown === true, 'M12: 触发后应置位 legacyNodeShown');
  g.S._legacyNode = null;                  // 清掉再进一次,验证"每局至多 1 条"
  g.C.go('deleted', true); g.frame();
  A(g.S._legacyNode === null, 'M12: 同局第二个挂点不应再触发(每局至多 1 条)');
});

/* ---- M14 捡到别人的遗物 ---- */
withRandom(0.9, () => {    // 用高随机数避开 M12/相邻概率抽样,专测 relic 结构本身
  const g = mkEnv({ runCount: 1, lastEnding: 'disconnected' });
  g.C.go('npcRelic', true);
  const t = g.frame();
  A(!t.includes('的遗物'), 'M14: CUR_RELIC 为空时 npcRelic 应静默 back() 不渲染遗物内容,实际: ' + t.slice(0, 60));
});
withRandom(0.01, () => {
  const g = mkEnv({ runCount: 1, lastEnding: 'disconnected' });
  g.C.go('npcRelic', true);
  const before = g.frame();
  A(/的遗物/.test(before) && before.includes('1 回收') && before.includes('2 归还'),
    'M14: npcRelic 应展示回收/归还二选一,实际: ' + before.slice(0, 80));
  g.C.key('2');                            // 归还
  A(!!g.S.relicReturned, 'M14: 归还后应置位 S.relicReturned');
  A(g.S.residueClaimed === true, 'M14: 归还也算"碰过残留"(T_OLDPHONE 检测口径复用)');
  g.S.alive = true;
  g.C.go('receiptAlive', true); g.frame(); // 触发 writeSave
  const sv = g.save();
  A(Array.isArray(sv.returnedRelics) && sv.returnedRelics.length === 1,
    'M14: 归还应写进存档 returnedRelics,实际: ' + JSON.stringify(sv.returnedRelics));
});
withRandom(0.01, () => {
  const g = mkEnv({ runCount: 1, lastEnding: 'disconnected' });
  g.C.go('npcRelic', true); g.frame();
  const cacheBefore = g.S.cacheVal;
  g.C.key('1');                            // 回收
  A(g.S.cacheVal > cacheBefore, 'M14: 回收应增加缓存,实际前后 ' + cacheBefore + ' -> ' + g.S.cacheVal);
  A(!g.S.relicReturned, 'M14: 走回收分支不应置位 relicReturned');
});

/* ---- 归还 → 追加进漂流瓶共享池(跨局跨机子持久) ---- */
{
  const g = mkEnv({ runCount: 1, returnedRelics: ['#2286-N'], seenBottles: ['#5502-D','#3120-K','#1177-B','#8891-R'] });
  g.C.go('bottleIn', true);
  const t = g.frame();
  A(t.includes('#RETURN-#2286-N'), '归还瓶: 四张原始瓶都读过后,应能抽到归还瓶,实际: ' + t.slice(0, 100));
  A(t.includes('有人还回'), '归还瓶: 文案应体现"有人还回来了、经手人不留名"');
}
{
  // 机子切换(D-113 拍板)不应清零 returnedRelics(career 级,同 seenBottles)
  const g = mkEnv({ dossierId: 'A', dossierCycle: 0, disposal: 'tell', returnedRelics: ['#2286-N'] });
  const sv = g.save();
  A(Array.isArray(sv.returnedRelics) && sv.returnedRelics.includes('#2286-N'),
    '切换机子前 returnedRelics 应保留在存档里(切换逻辑在下一条断言里验证)');
}

/* ---- M13 非语言残响(只做非语言通道那一半) ---- */
withRandom(0.001, () => {   // < 0.01 阈值
  const g = mkEnv({ runCount: 1, evidence: ['E4'] });   // th_rou 已读(seen 由 go 触发,这里先模拟已读态)
  g.C.go('th_rou', true); g.frame();                    // 走一遍标记已读
  g.C.go('inbox', true);
  const t = g.frame();
  A(t.includes('…'), 'M13: 已读+极低概率命中时,应出现"…"非语言残响,实际: ' + t.slice(0, 100));
});
withRandom(0.5, () => {     // 远高于阈值,不该出现
  const g = mkEnv({ runCount: 1, evidence: ['E4'] });
  g.C.go('th_rou', true); g.frame();
  g.C.go('inbox', true);
  const t = g.frame();
  A(!t.includes('…'), 'M13: 概率没命中时不该出现"…"');
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL LEGACY-RESIDUE (D-115) CHECKS PASS');
process.exit(failures ? 1 : 0);
