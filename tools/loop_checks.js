"use strict";
/* 恐怖游轮化 · (b) 跨局不可逆 行为门禁(设计定稿 v0.3 §3)
   妈线程三态 / 处置上锁后隐藏 / 世界日报代价行 / 结局回声 / 抹除屏加句。
   注:每条都用"未修复代码会报警"的思路设计——断言的是具体文案与门,不是形状。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function mkEnv(saveObj){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  const ctxStub = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data: new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(){}, drawImage(){} });
  const canvasStub = () => ({ width:0, height:0, getContext: () => ctxStub() });
  const storage = { _m: Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k] = String(v); }, removeItem(k){ delete this._m[k]; } };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance: perf,
    document: { getElementById: id => id==='lcd'?canvasStub():null, createElement: () => canvasStub() },
    localStorage: storage, addEventListener(){}, navigator: {}, location: { reload(){} },
    OVERLAY: { show(cfg,cb){ cb({ text:'测试', kept:false }); }, text(){} },
    APP: { exportFeedback(){} }, AUDIO: { ensure(){}, hiss(){}, blip(){} }, HOLD:{active:false}, Math };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const boot = new Function('window','document','performance','addEventListener','navigator',
    'location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  boot.call(env, env, env.document, perf, env.addEventListener, env.navigator,
            env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const { __LCD:LCD, __ENGINE:ENGINE, __CONTENT:CONTENT } = env;
  let ft = [];
  for (const fn of ['drawText','drawPara','drawTextScaled']){
    const o = LCD[fn];
    LCD[fn] = function(x,y,str,...r){ if (typeof str === 'string') ft.push(str); return o.call(this,x,y,str,...r); };
  }
  const frame = () => { ft = []; LCD.frame(() => CONTENT.render()); return ft.join(''); };
  /* 滚动屏(scrollView)只画可见部分——把整屏内容按行翻一遍拼起来,便于整句 includes */
  const fullScroll = () => { let all = frame(); for (let i = 0; i < 14; i++){ CONTENT.key('ArrowDown'); all += frame(); } return all; };
  return { LCD, ENGINE, CONTENT, env, frame, fullScroll };
}

function scenario(name, saveObj, fn){
  const errs = [];
  try { fn(Object.assign(mkEnv(saveObj), { A: (c,m) => { if (!c) errs.push(m); } })); }
  catch(e){ errs.push('异常: ' + e.message + ' @ ' + (e.stack.split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X [' + name + ']'); errs.forEach(e => console.log('   - ' + e)); }
  else console.log('OK [' + name + ']');
}

const HIST2 = [{ inst:'#7741-A', ending:'captured', cacheVal:400, ev:2 },
               { inst:'#7741-B', ending:'disconnected', cacheVal:500, ev:3 }];
const bMom = (extra) => Object.assign({ runCount:3, evidence:['E1','E2'], caseOpen:true, history:HIST2 }, extra);

/* ---- 妈线程 · 弱察觉四档 ---- */
[ [0,'吃过了,睡吧',       null],
  [1,'不冷。睡吧',       null],
  [2,'嗯。睡吧',         '越来越快'],
  [3,'嗯。',             '你还是你吗']
].forEach(([cont, reply, aware]) => {
  scenario('妈线程 decay·继续×' + cont + ' → 回复降档' + (aware?' + 察觉':''),
    bMom({ disposalHistory: Array(cont).fill('continue'), momLocked:null }),
    ({A, CONTENT, frame}) => {
      CONTENT.go('th_mom', true); const t = frame();
      A(t.includes(reply), '继续×' + cont + ' 的最近回复应为「' + reply + '」');
      if (aware) A(t.includes(aware), '应出现妈的察觉「' + aware + '」');
      if (cont >= 3) A(t.includes('未发送'), '≥3 档那句必须是 [未发送] 草稿');
      A(!/[!！]/.test(t), '妈线程全程无感叹号');
      A(!/你是谁/.test(t), '不得出现直接质问「你是谁」');
    });
});

/* ---- 妈线程 · told(阿帆名义已交还) ---- */
scenario('妈线程 told·对陌生号码说话', bMom({ disposalHistory:['continue','tell'], momLocked:'told', evidence:['E1','E2','E3','E4'] }),
  ({A, CONTENT, frame}) => {
    CONTENT.go('th_mom', true); const t = frame();
    A(t.includes('谁在用它'), 'told 后走「对陌生号码」文案');
    A(t.includes('是帆的旧机吗'), 'told 首句应问旧机');
  });

/* ---- 妈线程 · deleted(停摆,不可读) + inbox 标签 ---- */
scenario('妈线程 deleted·停摆屏不可读 + inbox 标签', bMom({ disposalHistory:['delete'], momLocked:'deleted' }),
  ({A, CONTENT, frame}) => {
    CONTENT.go('inbox', true); const inbox = frame();
    A(inbox.includes('已停摆'), 'inbox 里妈应标 [已停摆]');
    CONTENT.go('th_mom', true); const t = frame();
    A(t.includes('线程已停摆'), '停摆屏应显示');
    A(t.includes('没有人会再回'), '停摆屏文案在场');
    A(!t.includes('上滑读旧消息'), '停摆态不给深搜');
  });

/* ---- 处置上锁后:th_rou 不再出现处置入口 ---- */
scenario('处置上锁·th_rou 不再提供处置入口', bMom({ disposalHistory:['tell'], momLocked:'told', evidence:['E1','E2','E3','E4'] }),
  ({A, CONTENT, ENGINE, frame}) => {
    ENGINE.S.beats.truthDone = true;                 // 即便真相已集齐
    CONTENT.go('th_rou', true); const t = frame();
    A(!t.includes('处置'), 'momLocked 后处置入口必须消失');
  });

/* ---- 世界日报 · 代价署名行 + 回收记录随局数 ---- */
function worldText(save){
  const g = mkEnv(save);
  g.CONTENT.go('worldReport', true);
  return g.fullScroll();                              // 代价行在折叠线下,要滚到底才捕获
}
scenario('世界日报·代价行(继续)', null, ({A}) => {
  A(worldText(bMom({ disposalHistory:['continue','continue'], momLocked:null }))
    .includes('谎言维持中 · 由你 第 2 次'), '继续×2 应显示"由你 第 2 次"');
});
scenario('世界日报·代价行(告知/删除)', null, ({A}) => {
  A(worldText(bMom({ disposalHistory:['tell'], momLocked:'told' })).includes('不可撤回'), 'told → 不可撤回');
  A(worldText(bMom({ disposalHistory:['delete'], momLocked:'deleted' })).includes('不可恢复'), 'deleted → 不可恢复');
});
scenario('世界日报·回收记录随局数(第一次不显示)', null, ({A}) => {
  A(!worldText({ runCount:1 }).includes('回收记录'), '第 1 次不显示回收记录');
  A(worldText({ runCount:5, history:[1,2,3,4,5].map(i=>({inst:'#x',cacheVal:100})) })
    .includes('每次都是你'), '≥4 次应点出"每次都是你"');
});

/* ---- 结局回声在场(三个结局) ---- */
scenario('结局回声·receiptAlive / receiptFull', bMom({ momLocked:null, evidence:['E1'] }),
  ({A, CONTENT, fullScroll}) => {
    CONTENT.go('receiptAlive', true);
    A(fullScroll().includes('下一个编号,还是你'), 'receiptAlive 应含结局回声');
    CONTENT.go('receiptFull', true);
    A(fullScroll().includes('下一个编号,还是你'), 'receiptFull 应含结局回声');
  });

/* ---- 抹除屏加句 ---- */
scenario('抹除屏·加句在场', bMom({}), ({A, CONTENT, frame}) => {
  CONTENT.go('wipe', true);
  A(frame().includes('不再有编号回到这里'), '抹除确认屏应含加句');
});

/* ---- 你自己的信:runCount≥2 可被选中,读过即焚 ---- */
scenario('你自己的信·runCount≥2 可出、读过进 seenBottles', null, ({A}) => {
  // 反复选,直到抽到自己的信(概率性);验证它能出现且带"你自己"
  let hit = false;
  for (let i = 0; i < 200 && !hit; i++){
    const g = mkEnv(bMom({ runCount:2, seenBottles:['#5502-D','#3120-K','#1177-B'] }));  // NPC 都读过 → 只剩自己的信
    g.CONTENT.go('bottleIn', true);
    const t = g.frame();
    if (t.includes('你自己') || t.includes('下一个编号,还会读一遍')){ hit = true;
      A(g.ENGINE.S.bottleId === '#SELF', '选中的应是自己的信'); }
  }
  A(hit, 'NPC 瓶读全后,runCount≥2 应能抽到你自己的信');
  // runCount<2 绝不出
  const g2 = mkEnv({ runCount:1, seenBottles:['#5502-D','#3120-K','#1177-B'] });
  g2.CONTENT.go('bottleIn', true); g2.frame();
  A(g2.ENGINE.S.bottleId !== '#SELF', 'runCount<2 绝不出自己的信');
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL LOOP CHECKS PASS');
process.exit(failures ? 1 : 0);
