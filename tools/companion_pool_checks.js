"use strict";
/* 柔柔离线分支池(D-107)门禁 —— 对照决策日志 D-107 / canon M28。
   证明:离线池按 {状态 × 玩家意图} 精细触发;机制/设备外提问永远回拒答原句(拒答均匀);
   每一条离线回复都守 lint(逐行 ≤30 字、无感叹号、无亲昵词);状态池有变化(非单条)。
   走的是无 LLM 的降级路径(window.claude 缺席),即玩家离线时的真实回复。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = fs.readFileSync(ROOT + '/js/companion.js', 'utf8');

let failures = 0;
const BANNED = [/我懂/, /我明白/, /因为我想/, /亲爱的/, /宝贝/, /抱抱/, /么么/, /喜欢你/, /爱你/];
const REFUSE = '协议不允许我谈这台设备之外的事。';

function boot(){
  const env = { navigator:{}, Math };     // 无 window.claude、无 fetch → 强制走 L0 模板池
  env.window = env; env.__c = C => { env.C = C; };
  new Function('window','navigator',
    '"use strict";' + SRC + ';window.__c(COMPANION);').call(env, env, env.navigator);
  return env.C;
}
const C = boot();

async function replyText(st, playerMsg){
  const r = await C.reply([{ who:'me', text: playerMsg }], st);
  return r && r.text;
}
function lintClean(t){
  if (!t) return false;
  if (/[!！]/.test(t)) return false;
  if (BANNED.some(r => r.test(t))) return false;
  if (t !== REFUSE && t.includes(REFUSE)) return false;    // 拒答句只能独占
  return t.split('\n').every(l => l.trim().length <= 30);
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  return Promise.resolve()
    .then(() => fn({ A:(c,m)=>{ if(!c) errs.push(m); } }))
    .catch(e => errs.push('异常: '+e.message))
    .then(() => { Math.random = RND;
      if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
      else console.log('OK ['+name+']'); });
}

/* 遍历随机分布,收集某 (状态,提问) 下所有可能回复 */
async function collect(st, msg){
  const seen = new Set();
  for (let i = 0; i <= 50; i++){ Math.random = () => i / 51; seen.add(await replyText(st, msg)); }
  Math.random = Math.random;
  return [...seen];
}

(async () => {
  const stPre = { e4:false, truth:false, disposal:null };
  const stTell = { e4:true, truth:true, disposal:'tell' };

  await scenario('机制/设备外提问 · 永远回拒答原句(拒答均匀)', async ({A}) => {
    for (const q of ['凌晨几点之后不能发消息', '这台设备之外是什么', '有没有监控', '什么规则']){
      const all = await collect(stPre, q);
      A(all.length === 1 && all[0] === REFUSE, '「'+q+'」应恒回拒答原句,实际 ' + JSON.stringify(all));
    }
  });

  await scenario('意图 · 身份质询走身份池', async ({A}) => {
    const all = await collect(stPre, '你是不是AI,证明你是真人');
    A(all.length >= 2, '身份质询应有多条变体,实际 ' + all.length);
    A(all.every(t => /柔柔|外来|验我|凭什么/.test(t)), '应命中身份池,实际 ' + JSON.stringify(all));
    A(all.every(lintClean), '身份池须全部 lint-clean');
  });

  await scenario('意图 · 提及阿帆走委托池', async ({A}) => {
    const all = await collect(stPre, '阿帆到底是谁,委托是什么');
    A(all.every(t => /执行到底|没忘|代不了|做主/.test(t)), '应命中委托池,实际 ' + JSON.stringify(all));
    A(all.every(lintClean), '委托池须全部 lint-clean');
  });

  await scenario('意图 · 敌意(删/关)走冷池,不服软', async ({A}) => {
    const all = await collect(stPre, '我要删了你,关掉你');
    A(all.every(t => /关掉|删了我|闭嘴|一个人/.test(t)), '应命中敌意池,实际 ' + JSON.stringify(all));
    A(all.every(lintClean), '敌意池须全部 lint-clean');
  });

  await scenario('意图 · 关心被冷推回(对接入者不安慰)', async ({A}) => {
    const all = await collect(stPre, '你还好吗,累不累,早点睡');
    A(all.every(t => /不需要你关心|不是来陪我|留给阿帆|不是给你/.test(t)), '关心应被冷推回,实际 ' + JSON.stringify(all));
    A(all.every(lintClean), '关心池须全部 lint-clean');
  });

  await scenario('状态池 · 无意图时按状态选、且有变化', async ({A}) => {
    const pre = await collect(stPre, '。');       // 中性输入,不触意图
    const tell = await collect(stTell, '。');
    A(pre.length >= 3, 'pre 状态池应有 ≥3 变体(做厚),实际 ' + pre.length);
    A(tell.length >= 3, 'tell 状态池应有 ≥3 变体,实际 ' + tell.length);
    A(pre.every(lintClean) && tell.every(lintClean), '状态池须全部 lint-clean');
    // 状态区分:tell 池谈"结束/空",pre 池谈"等他/生人"
    A(tell.some(t => /结束|空|没有|走吧/.test(t)), 'tell 池应体现委托结束');
    A(!pre.some(t => tell.includes(t)), 'pre 与 tell 不应重叠');
  });

  await scenario('全池 lint 体检 · 各状态各意图抽样全 clean', async ({A}) => {
    const msgs = ['。', '你是谁', '阿帆呢', '关掉你', '你累不累', '在吗', '你好'];
    const sts = [stPre, { e4:true, truth:false, disposal:null }, { e4:true, truth:true, disposal:null }, stTell];
    for (const st of sts) for (const m of msgs){
      const all = await collect(st, m);
      all.forEach(t => A(lintClean(t), '不 clean 的离线回复: ' + JSON.stringify(t)));
    }
  });

  console.log(failures ? ('\nFAILED: '+failures) : '\nALL COMPANION-POOL CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
