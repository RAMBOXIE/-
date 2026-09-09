"use strict";
/* 采样官人格接口(D-101 块3a)门禁 —— 对照 grader.js + rou.js(persona:'grader')。
   证明:LLM 只出语气、离线回退模板、输出 lint 拦数字/长句/平台词;
   服务端 persona 路由无需 history、不签名、facts 零数字零秘匿。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const crypto = require('crypto');
const ROOT = require('path').resolve(__dirname, '..');
const GRADER_SRC = fs.readFileSync(ROOT + '/js/grader.js', 'utf8');

let failures = 0;
const flush = () => new Promise(r => setImmediate(r));

/* 单独启 GRADER 客户端;可注入 window.claude 与 fetch */
function bootGrader({ fetch, claude } = {}){
  const env = { navigator: {}, Math };
  if (fetch) env.fetch = fetch;
  if (claude) env.claude = claude;
  env.window = env; env.__c = G => { env.G = G; };
  new Function('window', 'navigator', 'fetch',
    '"use strict";' + GRADER_SRC + ';window.__c(GRADER);')
    .call(env, env, env.navigator, env.fetch);
  return env.G;
}

function scenario(name, fn){
  const errs = []; const RND = Math.random;
  return Promise.resolve().then(() => fn({ A:(c,m)=>{ if(!c) errs.push(m); } }))
    .catch(e => errs.push('异常: ' + e.message))
    .then(() => { Math.random = RND;
      if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
      else console.log('OK ['+name+']'); });
}

(async () => {
  /* ---- 离线:无平台能力、无 fetch → 回退手写模板,且模板 lint-clean ---- */
  await scenario('离线兜底 · 无 LLM 回退模板挑衅', async ({A}) => {
    const G = bootGrader();
    for (const tier of [0,1,2,3]){
      const t = await G.taunt({ tier, grade:'none', runN:0 });
      A(typeof t === 'string' && t.length > 0, 'tier'+tier+' 应给一句模板');
      A(G._lintOk(t), 'tier'+tier+' 模板须 lint-clean:' + JSON.stringify(t));
    }
  });

  /* ---- 输出 lint:数字/超长/多行/平台词一律回退,不上屏 ---- */
  await scenario('输出 lint · 数字/长句/平台词被拦', async ({A}) => {
    const G = bootGrader();
    A(!G._lintOk('做到 80%。'), '含数字必须拦');
    A(!G._lintOk('这一句故意写得很长很长超过十八个字看看拦不拦'), '超长行必须拦');
    A(!G._lintOk('一\n二\n三'), '超过两行必须拦');
    A(!G._lintOk('这只是个游戏别当真'), '平台词(游戏)必须拦');
    A(G._lintOk('又一个。别磨蹭。'), '正常挑衅应放行');
  });

  /* ---- D-108 自查:采样官唯独没有自伤话题围栏——补上后验证命中即拦 ---- */
  await scenario('输出 lint · 自伤话题围栏(D-108)', async ({A}) => {
    const G = bootGrader();
    A(!G._lintOk('废物,不如去死。'), '"去死"类自伤/威胁语必须拦');
    A(!G._lintOk('你不配活着接进来。'), '"不配活"必须拦');
    A(G._lintOk('废物。也配接进来。'), '正常挖苦(不涉自伤)应放行,门禁不能过度拦截');
  });

  /* ---- 代理返回自伤话题的越界文本 → 客户端回退模板,绝不上屏 ---- */
  await scenario('代理越界(自伤话题) → 回退模板,绝不上屏(D-108)', async ({A}) => {
    const fetch = () => Promise.resolve({ ok:true, status:200,
      json: () => Promise.resolve({ text: '你这种废物,不如去死。' }) });
    const G = bootGrader({ fetch });
    const t = await G.taunt({ tier:2, grade:'fail', runN:4 });
    A(!/去死/.test(t), '自伤/威胁话题绝不得上屏,实际 ' + JSON.stringify(t));
    A(G._lintOk(t), '回退结果须过护栏');
  });

  /* ---- 代理返回带数字的越界文本 → 客户端回退模板(不把数字上屏) ---- */
  await scenario('代理越界(带数字) → 回退模板', async ({A}) => {
    const fetch = () => Promise.resolve({ ok:true, status:200,
      json: () => Promise.resolve({ text: '缓存做到 800,别偷懒。' }) });
    const G = bootGrader({ fetch });
    const t = await G.taunt({ tier:1, grade:'pass', runN:2 });
    A(!/[0-9]/.test(t), '越界数字不得上屏,实际 ' + JSON.stringify(t));
    A(G._lintOk(t), '回退结果仍 lint-clean');
  });

  /* ---- 代理返回干净台词 → 原样采用 ---- */
  await scenario('代理正常 → 采用 LLM 台词', async ({A}) => {
    const line = '废物。也配接进来。';
    const fetch = () => Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({ text: line }) });
    const G = bootGrader({ fetch });
    const t = await G.taunt({ tier:3, grade:'fail', runN:6 });
    A(t === line, '干净 LLM 台词应原样采用,实际 ' + JSON.stringify(t));
  });

  /* ---- 501 未配 key → 回退模板,且永久降级不再打代理 ---- */
  await scenario('代理 501 → 回退且永久降级', async ({A}) => {
    let n = 0;
    const fetch = () => { n++; return Promise.resolve({ ok:false, status:501, json: () => Promise.resolve({}) }); };
    const G = bootGrader({ fetch });
    await G.taunt({ tier:0, grade:'none', runN:0 });
    A(n === 1, '第一次应打过代理');
    await G.taunt({ tier:0, grade:'none', runN:0 });
    A(n === 1, '501 后应永久降级,不再打代理,实际打了 ' + n + ' 次');
  });

  /* ---- 块3b 评级结算话:离线按 grade 回退模板,且 lint-clean ---- */
  await scenario('评级结算 · 离线按 grade 回退模板', async ({A}) => {
    const G = bootGrader();
    for (const grade of ['praise','pass','fail']){
      const t = await G.verdict({ grade, tier:1, runN:2 });
      A(typeof t === 'string' && t.length > 0, grade+' 应给一句结算话');
      A(G._lintOk(t), grade+' 结算话须 lint-clean:' + JSON.stringify(t));
    }
    // fail 与 praise 的池不同(结算话按结果分化)
    const fails = new Set(), praises = new Set();
    for (let i=0;i<20;i++){ Math.random=()=>i/20; fails.add(G._fbVerdict({grade:'fail'})); praises.add(G._fbVerdict({grade:'praise'})); }
    A([...fails].every(x => ![...praises].includes(x)), 'fail 与 praise 结算话不重叠');
  });

  await scenario('评级结算 · 代理带数字被拦→回退', async ({A}) => {
    const fetch = () => Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({ text: '评级 3 档,滚。' }) });
    const G = bootGrader({ fetch });
    const t = await G.verdict({ grade:'fail', tier:2, runN:3 });
    A(!/[0-9]/.test(t), '越界数字不得上屏,实际 ' + JSON.stringify(t));
  });

  /* ---- 服务端 verdict 模式:trigger 递入评级、graderState 不再挂"上一趟" ---- */
  await scenario('服务端 mode=verdict · trigger 含评级、facts 无数字', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.ROU_SIG_KEY = 'test-sig'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    let sent = null; const realFetch = global.fetch;
    global.fetch = (u, o) => { sent = JSON.parse(o.body);
      return Promise.resolve({ ok:true, status:200,
        json: () => Promise.resolve({ content:[{type:'text',text:'废样本。'}] }), text: () => Promise.resolve('') }); };
    const r = await fn.handler({ httpMethod:'POST',
      body: JSON.stringify({ persona:'grader', mode:'verdict', st:{ tier:1, grade:'praise', runN:2 } }),
      headers: { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.8' } });
    global.fetch = realFetch;
    A(r.statusCode === 200, 'verdict 模式应 200,实际 ' + r.statusCode + ' ' + r.body);
    A(JSON.parse(r.body).sig === undefined, 'grader 仍不签名');
    A(sent.messages[0].content.includes('赏识'), 'verdict trigger 应把评级(赏识)递给它,实际 ' + sent.messages[0].content);
    A(!sent.system.includes('上一趟'), 'verdict 模式 graderState 不应再挂"上一趟"');
    A(!/\d{1,2}:\d{2}/.test(JSON.stringify(sent)), 'verdict prompt 不得含时刻');
    ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => {
      if (save[k] === undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  /* ---- 服务端 persona 路由:grader 无需 history、不签名、facts 定性零数字 ---- */
  await scenario('服务端 persona=grader · 无 history/不签名/facts 零数字', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ROU_SIG_KEY = 'test-sig';
    delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    let sent = null;
    const realFetch = global.fetch;
    global.fetch = (u, o) => { sent = JSON.parse(o.body);
      return Promise.resolve({ ok:true, status:200,
        json: () => Promise.resolve({ content:[{type:'text',text:'又一个。别磨蹭。'}] }), text: () => Promise.resolve('') }); };
    const r = await fn.handler({ httpMethod:'POST',
      body: JSON.stringify({ persona:'grader', st:{ tier:2, grade:'praise', runN:3 } }),
      headers: { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.7' } });
    global.fetch = realFetch;

    A(r.statusCode === 200, 'grader 无 history 也应 200,实际 ' + r.statusCode + ' ' + r.body);
    const out = JSON.parse(r.body);
    A(out.text === '又一个。别磨蹭。', '应返回模型台词');
    A(out.sig === undefined, 'grader 单向、无回放 → 不签名,实际 sig=' + out.sig);
    A(sent.system.includes('采样官'), 'system 应含采样官人格核');
    A(sent.system.includes('你对他要求很高了'), 'tier2 态势应注入 system');
    A(sent.system.includes('他来过几趟'), 'runN=3 应收成"来过几趟"(定性,不吐数字)');
    A(!/\d{1,2}:\d{2}/.test(JSON.stringify(sent)), 'grader prompt 不得含时刻');
    ['03:00','03:14','03:31','03:45','溯源','掉落'].forEach(w =>
      A(!JSON.stringify(sent).includes(w), 'grader prompt 不得含秘匿「'+w+'」'));
    A(sent.messages.length === 1 && sent.messages[0].role === 'user', 'grader 应只有一条 user 触发轮');
    A(!sent.messages[0].content.includes('3') && !sent.messages[0].content.includes('praise'),
      '触发轮不夹带原始态势值');

    ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => {
      if (save[k] === undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  /* ---- D-108:服务端也拦一遍自伤话题(不完全依赖客户端 lint) ---- */
  await scenario('服务端 persona=grader · 自伤话题被服务端拦下(unsafe_completion)', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    const realFetch = global.fetch;
    global.fetch = () => Promise.resolve({ ok:true, status:200,
      json: () => Promise.resolve({ content:[{type:'text',text:'你这种废物,不如去死。'}] }), text: () => Promise.resolve('') });
    const r = await fn.handler({ httpMethod:'POST',
      body: JSON.stringify({ persona:'grader', st:{ tier:1, grade:'fail', runN:1 } }),
      headers: { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.6' } });
    global.fetch = realFetch;
    A(r.statusCode !== 200, '自伤话题不该 200 放行,实际 ' + r.statusCode);
    A(!JSON.stringify(r.body).includes('去死'), '响应体绝不该带出自伤/威胁文本,实际 ' + r.body);

    ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => {
      if (save[k] === undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  console.log(failures ? ('\nFAILED: '+failures) : '\nALL GRADER-LLM CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
