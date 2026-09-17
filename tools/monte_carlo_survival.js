"use strict";
/* D-128 蒙特卡洛存活率验证(诊断工具,不参与 run_all.js 的 pass/fail)。
   背景:research/M1_蒙特卡洛校准报告_v0.1.md 在"纸面模型"级别校准过死亡率带宽
   (谨慎 3-5% / 中等 33-36% / 贪婪 50-58%),但那份报告自己说清楚:"它验证的是
   结构,不是手感"——从没有工具去驱动**实际写进 js/engine.js/content.js 的
   代码**,用真随机跑几千局,核实这条风险曲线在真实实现里是否成立,也没验证
   过是否存在"无论怎么选都必死"的退化状态。

   这份脚本直接驱动真实的 CONTENT/ENGINE 代码(不是重新建模,复用 tools/*.js
   其它门禁同一套 boot() 桩),对剧本B(可重开的核心循环,不是A局那种一次性
   教学死亡)跑三种策略,每种策略跑 N 局、用真 Math.random,统计死亡率:
     - 裸退(bail):进门就直接断连弃缓存——理论上应为 0% 死亡(随时可用的安全解)。
     - 均衡(balanced):正常探索(读瓶/翻已删除目录)但不在违规窗口内回复,
       全程控制溯源,最后尝试上传。
     - 贪婪(greedy):额外在窗口内回两次消息、多做几次深搜把溯源推高,
       再尝试上传——故意撞真实代码里的每一道判定。
   目的不是给出"官方死亡率"(那需要人肉测试样本量),是回答两个具体问题:
     ① 裸退这条"保底解"在真实代码里是不是真的 100% 不死;
     ② 均衡/贪婪两种玩法在真实实现里死亡率是否有明显区分度(不是摆设的难度)。
   跑法:node tools/monte_carlo_survival.js [N](默认 300 局/策略)。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

/* 默认样本量刻意压低:这份脚本会被 run_all.js 自动发现、每次全量跑测都执行一遍
   (和 flow_walker.js 同类,纯诊断、不带 process.exit(1)),N=300 时单跑约 11 秒,
   不该拖慢日常门禁。要做正经统计分析时手动加大样本:
   node tools/monte_carlo_survival.js 3000 */
const N = Number(process.argv[2]) || 80;

function mkEnv(saveObj){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  const ctx = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data:new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data:new Uint8ClampedArray(w*h*4) }; },
    putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    /* OVERLAY/askReason 等自由文本卡一律立即"随便填一个",不挡自动化 */
    OVERLAY:{ show(cfg,cb){ if (cb) cb({ text:'（自动）', kept:false }); }, text(){} },
    APP:{ exportFeedback(){}, showDeathReport(){}, showTransparency(){} },
    AUDIO:{ ensure(){}, hiss(){}, blip(){} }, HOLD:{ active:false, x:0, y:0, t0:0 }, Math };
  env.window = env; env.__c = (L,E,C) => { env.L=L; env.E=E; env.C=C; };
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  /* D-115 遗留节点(legacyNode)/预测卡(predict)是纯cosmetic的随机插屏,20%/若干%
     概率打断任意一次导航(和 D-122 countermeasures_checks.js、D-124b bottle_checks.js
     撞的是同一类坑)。这两个屏唯一动作就是关闭继续,和"策略"本身要测的风险经济
     无关,每一步驱动前先自动清空它们,不然会被误判成"卡死"。 */
  function drainCosmetic(g){
    for (let i = 0; i < 4; i++){
      const id = g.C.currentId;
      if (id === 'legacyNode' || id === 'predict'){ g.C.key('Enter'); g.L.frame(() => g.C.render()); }
      else break;
    }
  }
  const obj = { L:env.L, E:env.E, C:env.C, S:env.E.S,
    frame(){ this.L.frame(() => this.C.render()); drainCosmetic(this); },
    advance(ms){ FAKE_T += ms; this.C.tickTimer(); this.frame(); },
    key(k){ drainCosmetic(this); this.C.key(k); this.frame(); } };
  drainCosmetic(obj);
  return obj;
}

/* 剧本B存档:runCount>=1 即触发 isB(content.js 顶部 RUN 计算),用最朴素的
   一份继承存档(不带 bottleSealed/vault 等状态,和其它门禁常用的 B_SAVE 同形状)。 */
function freshSave(){
  return { runCount:1, history:[{cacheVal:100, inst:'#7741-A'}], seenBottles:[] };
}

/* ---- 策略①裸退:进门直接弃缓存断连,理论上应为 0% 死亡的保底解 ---- */
function playBail(){
  const g = mkEnv(freshSave());
  try {
    g.C.go('tools', true); g.frame();
    g.key('2'); if (g.S.dead || g.S.alive) return end(g);          // 直接断连(弃缓存)→S.alive=true,goHold
    g.key('1'); if (g.S.dead || g.S.alive) return end(g);          // bailConfirm 确认
    g.key('Enter'); if (g.S.dead || g.S.alive) return end(g);      // holdDisc 键盘退化路径
    for (let i = 0; i < 5 && !(g.S.dead || g.S.alive); i++){ g.advance(400); }
  } catch(e){ return { error: e.message }; }
  return end(g);
}

/* ---- 策略②均衡:正常探索(读瓶/翻已删除),不在违规窗口内回复,控制溯源后上传 ---- */
function playBalanced(){
  const g = mkEnv(freshSave());
  try {
    g.C.go('bottleIn', true); g.frame();
    g.key('x'); g.key('Escape');
    if (g.S.dead || g.S.alive) return end(g);
    g.C.go('deletedConfirm', true); g.frame();
    g.key('1');                                    // enterDeleted():+12 trace,25% ambush → 真实 c90/save 判定
    if (g.S.dead || g.S.alive) return end(g);
    return finishUpload(g);
  } catch(e){ return { error: e.message }; }
}

/* ---- 策略③贪婪:额外在窗口内回两次消息(触发二次违规判定)+ 多做几次深搜推高溯源 ---- */
function playGreedy(){
  const g = mkEnv(freshSave());
  try {
    g.C.go('bottleIn', true); g.frame();
    g.key('x'); g.key('Escape');
    if (g.S.dead || g.S.alive) return end(g);
    g.C.go('deletedConfirm', true); g.frame();
    g.key('1');
    if (g.S.dead || g.S.alive) return end(g);
    /* 窗口内回两次消息:第一次 warn,第二次触发真实 c90/save 判定链 */
    g.E.setClock(0, g.E.RULE.from);
    g.C.go('th_rou', true); g.frame();
    g.key('M'); if (g.S.dead || g.S.alive) return end(g);
    g.key('M'); if (g.S.dead || g.S.alive) return end(g);
    g.key('Escape');
    /* 多翻几次相册深搜,故意把溯源往 75(回收进程触发线)推 */
    g.C.go('album', true); g.frame();
    for (let i = 0; i < 3 && !(g.S.dead || g.S.alive); i++){ g.key('1'); }
    if (g.S.dead || g.S.alive) return end(g);
    return finishUpload(g);
  } catch(e){ return { error: e.message }; }
}

function finishUpload(g){
  g.C.go('tools', true); g.frame();
  g.key('1');                                       // askReason(自动)→flushAttr→startUploadB()
  if (g.S.dead || g.S.alive) return end(g);
  for (let i = 0; i < 6 && g.C.currentId === 'uploadB' && !(g.S.dead || g.S.alive); i++) g.key('1');
  if (g.S.dead || g.S.alive) return end(g);
  /* upload92B 的 2200ms 定时器触发 resolveUploadB()(真实 roll('final')/roll('save')) */
  for (let i = 0; i < 5 && !(g.S.dead || g.S.alive); i++) g.advance(2500);
  return end(g);
}

function end(g){
  return { dead: !!g.S.dead, alive: !!g.S.alive, cause: g.S.causeOfDeath || null,
    trace: g.S.trace, violations: g.S.violations, huntDone: !!g.S.huntDone,
    stuck: !g.S.dead && !g.S.alive, finalScreen: g.C.currentId };
}

function runN(label, playFn, n){
  let dead = 0, alive = 0, stuck = 0, errors = 0;
  const causes = {}; const errMsgs = {};
  for (let i = 0; i < n; i++){
    const r = playFn();
    if (r.error){ errors++; errMsgs[r.error] = (errMsgs[r.error]||0) + 1; continue; }
    if (r.dead){ dead++; causes[r.cause || '(未知)'] = (causes[r.cause || '(未知)']||0) + 1; }
    else if (r.alive) alive++;
    else stuck++;
  }
  const settled = dead + alive;
  console.log('\n=== ' + label + '(N=' + n + ') ===');
  console.log('死亡 ' + dead + ' | 存活 ' + alive + ' | 卡死(既非死亡也非存活) ' + stuck + ' | 异常 ' + errors);
  if (settled) console.log('死亡率(仅计已结局的局): ' + (100 * dead / settled).toFixed(1) + '%');
  if (dead){
    console.log('死因分布:');
    Object.entries(causes).sort((a,b)=>b[1]-a[1]).forEach(([c,n2]) => console.log('  x' + n2 + '  ' + c));
  }
  if (errors){
    console.log('异常信息(可能是驱动脚本本身走岔,不是游戏 bug):');
    Object.entries(errMsgs).forEach(([m,n2]) => console.log('  x' + n2 + '  ' + m));
  }
  return { dead, alive, stuck, errors };
}

console.log('逃离AI · 剧本B 存活率蒙特卡洛(真随机,驱动真实 CONTENT/ENGINE 代码,N=' + N + '/策略)');
const rBail = runN('策略① 裸退(理论保底解,预期≈0%死亡)', playBail, N);
const rBal  = runN('策略② 均衡(探索但不闯违规窗口)', playBalanced, N);
const rGre  = runN('策略③ 贪婪(闯窗口两次 + 多做深搜推高溯源)', playGreedy, N);

console.log('\n=== 结论 ===');
if (rBail.errors + rBal.errors + rGre.errors > 0)
  console.log('⚠ 有驱动脚本异常,以下死亡率可能不完整,先看上面异常信息。');
console.log('裸退死亡率应接近 0%——这是"是否任何时候都有有效解"这个问题的直接答案。');
console.log('均衡 vs 贪婪的死亡率差距,是"贪婪真的更危险"这个设计意图在真实代码里是否成立的直接证据。');
process.exit(0);
