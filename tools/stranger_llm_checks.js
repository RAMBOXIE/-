"use strict";
/* 陌生人短信正文上 LLM(D-104 块3)门禁 —— 对照 stranger.js + rou.js persona:'stranger'。
   证明:只 LLM 化正文措辞、真/饵后果仍归引擎;护栏拦平台词/时刻/感叹/长句;
   离线按 kind 回退脚本;服务端单向、不签名;人格核无秘匿。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const STG_SRC = fs.readFileSync(ROOT + '/js/stranger.js', 'utf8');

let failures = 0;
const resp = (status, obj) => Promise.resolve({ status, ok: status>=200&&status<300, json: ()=>Promise.resolve(obj) });

function bootStg({ fetch } = {}){
  const env = { navigator:{}, Math };
  if (fetch) env.fetch = fetch;
  env.window = env; env.__c = S => { env.S = S; };
  new Function('window','navigator','fetch',
    '"use strict";' + STG_SRC + ';window.__c(STRANGERLLM);')
    .call(env, env, env.navigator, env.fetch);
  return env.S;
}
async function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { await fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

(async () => {
  await scenario('离线兜底 · 真/饵各回退脚本且过护栏', async ({A}) => {
    const S = bootStg();
    for (const kind of ['real','bait']){
      for (let i=0;i<6;i++){ const t = await S.msg(kind); A(typeof t==='string'&&t.length>0, kind+' 应给一段'); A(S._lintOk(t), kind+' 脚本须过护栏:'+JSON.stringify(t)); }
    }
  });

  await scenario('护栏 · 平台词/时刻/感叹/长句/多行全部拦', async ({A}) => {
    const S = bootStg();
    A(!S._lintOk('这只是个游戏。'), '平台词必须拦');
    A(!S._lintOk('03:14 见。'), '具体时刻必须拦');
    A(!S._lintOk('在吗!'), '感叹号必须拦');
    A(!S._lintOk('一\n二\n三'), '超过两行必须拦');
    A(!S._lintOk('这一行故意写得非常非常长超过十八个字了看看'), '超长行必须拦');
    A(S._lintOk('在吗。东西放好了。'), '正常短信应放行');
  });

  await scenario('代理越界(带平台词) → 回退脚本', async ({A}) => {
    const S = bootStg({ fetch: () => resp(200, { text: '这是游戏别当真。' }) });
    const t = await S.msg('real');
    A(!/游戏/.test(t), '越界文本不得上屏,实际 '+JSON.stringify(t));
    A(S._lintOk(t), '回退结果过护栏');
  });

  await scenario('代理正常文本 → 采用', async ({A}) => {
    const line = '在吗。老地方,拿了记得回我。';
    const S = bootStg({ fetch: () => resp(200, { text: line }) });
    A(await S.msg('bait') === line, '正常文本应原样采用');
  });

  await scenario('服务端 persona=stranger · kind 决定语气、单向不签名', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    const H = { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.13' };
    let sent = null; const realFetch = global.fetch;
    global.fetch = (u,o) => { sent = JSON.parse(o.body);
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ content:[{type:'text',text:'在吗。'}] }), text:()=>Promise.resolve('') }); };
    let r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'stranger', kind:'bait' }) });
    A(r.statusCode === 200, 'stranger 应 200,实际 '+r.statusCode);
    A(JSON.parse(r.body).sig === undefined, 'stranger 不签名');
    A(sent.system.includes('发错号码'), '应走陌生人人格核');
    A(sent.messages[0].content.includes('转过来') || sent.messages[0].content.includes('钓鱼'), 'bait 应触发催款/钓鱼语气');
    r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'stranger', kind:'real' }) });
    A(sent.messages[0].content.includes('真东西') || sent.messages[0].content.includes('照片'), 'real 应触发交接真东西语气');
    global.fetch = realFetch;
    ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => { if (save[k]===undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  console.log(failures ? ('\nFAILED: '+failures) : '\nALL STRANGER-LLM CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
