"use strict";
/* D-123 门禁:底本 B/C(phone-5029/phone-3319)接上柔柔/妈的 LLM 人格核。
   证明:①D-110/D-116 时靠 isAltDossier() 把 B/C 强制摁在离线兜底池,这次删掉了——
   两条部署路径(平台 sample / Netlify 代理)现在对 B/C 都会真的尝试 LLM,不再一律
   跳过;②送去 LLM 的 system 提示词按 dossierId 换成 CORE_B/CORE_C(客户端和服务端
   各验一遍),不会把如愿/阿澄的话错发成柔柔,也不会把秘匿值带进请求体;③离线/
   降级链对 B/C 依然完整(平台不可用→代理→兜底池,和 A 局同一条链)。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const COMPANION_SRC = fs.readFileSync(path.join(ROOT, 'js/companion.js'), 'utf8');
const MOM_SRC = fs.readFileSync(path.join(ROOT, 'js/mom.js'), 'utf8');
const CONTENT_SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

let failures = 0;
const A = (ok, msg) => { if (!ok){ failures++; console.log('X ' + msg); } else console.log('OK ' + msg); };

function bootCompanion(dossierId, claudeSample){
  const env = { navigator:{}, Math, fetch: undefined };
  env.window = env; env.__c = C => { env.C = C; };
  env.CONTENT = { dossier: { meta: { id: dossierId || 'phone-7741' } } };
  if (claudeSample) env.claude = { use: async name => (name === 'sample' ? claudeSample : null) };
  new Function('window','navigator','CONTENT',
    '"use strict";' + COMPANION_SRC + ';window.__c(COMPANION);')
    .call(env, env, env.navigator, env.CONTENT);
  return env.C;
}
function bootMom(dossierId, claudeSample){
  const env = { navigator:{}, Math, fetch: undefined };
  env.window = env; env.__c = M => { env.M = M; };
  env.CONTENT = { dossier: { meta: { id: dossierId || 'phone-7741' } } };
  if (claudeSample) env.claude = { use: async name => (name === 'sample' ? claudeSample : null) };
  new Function('window','navigator','CONTENT',
    '"use strict";' + MOM_SRC + ';window.__c(MOMLLM);')
    .call(env, env, env.navigator, env.CONTENT);
  return env.M;
}
const resp = (status, obj) => Promise.resolve({ status, ok: status>=200&&status<300, json: ()=>Promise.resolve(obj) });

async function scenario(name, fn){
  const errs = []; const RND = Math.random;
  try { await fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  Math.random = RND;
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

(async () => {

  /* ---- 客户端·平台能力:B/C 现在真的会试 SAMPLE,不再一步到位跳去离线池 ---- */
  await scenario('柔柔(companion.js) · phone-5029/3319 也会走平台 sample,不再被 isAltDossier 短路', async ({A}) => {
    for (const [id, mustHave, mustNotHave] of [
      ['phone-5029', '如愿', '柔柔'],
      ['phone-3319', '阿澄', '柔柔'],
      ['phone-8842', '长忆', '柔柔'],
      ['phone-6153', '知遇', '柔柔'],
      ['phone-2087', '均分', '柔柔'],
      ['phone-4419', '留声', '柔柔'],
    ]){
      let sentSystem = null;
      const sample = async turns => { sentSystem = turns[0].content; return { text: '（占位回复）' }; };
      const C = bootCompanion(id, sample);
      const r = await C.reply([{ who:'me', text:'你好' }], { e4:false, truth:false, disposal:null, violations:0, night:false, clockStr:'02:00' });
      A(r.source === 'llm', 'B/C 现在应走 SAMPLE(source=llm),实际 ' + r.source);
      A(sentSystem !== null, '应实际调用了 SAMPLE,拿到送出去的 system 文本');
      A(sentSystem && sentSystem.includes(mustHave), 'system 提示词应含 ' + mustHave + ',实际未见');
      A(sentSystem && !sentSystem.includes(mustNotHave), 'system 提示词不该混进 ' + mustNotHave + '(错发别的底本人格核)');
    }
  });

  await scenario('妈告知态(mom.js) · phone-5029/3319 也会走平台 sample,不再被 isAltDossier 短路', async ({A}) => {
    for (const [id, mustHave] of [['phone-5029', '安子'], ['phone-3319', '屿屿'], ['phone-8842', '念念'], ['phone-6153', '阿舟'], ['phone-2087', '小宁'], ['phone-4419', '阿识']]){
      let sentSystem = null;
      const sample = async turns => { sentSystem = turns[0].content; return { text: '妈: 这个号码,是不是他的旧机。' }; };
      const M = bootMom(id, sample);
      const t = await M.told();
      A(typeof t === 'string' && t.length > 0, '应给一段');
      A(sentSystem !== null, '应实际调用了 SAMPLE');
      A(sentSystem && sentSystem.includes(mustHave), 'system 提示词应含 ' + mustHave + ',实际未见');
    }
  });

  /* ---- 客户端·代理路径:请求体带上正确的 dossierId,不夹带秘匿值 ---- */
  await scenario('柔柔代理请求 · body.st.dossierId 正确、不含秘匿值', async ({A}) => {
    let sentBody = null;
    const C = bootCompanion('phone-5029', null);
    // 注入一个假 fetch(平台能力不可用,走代理)
    const env = { navigator:{}, Math, fetch: (url, opts) => { sentBody = JSON.parse(opts.body); return resp(200, { text: '如愿: 你不是他。' }); } };
    env.window = env; env.__c = c => { env.C2 = c; };
    env.CONTENT = { dossier: { meta: { id: 'phone-5029' } } };
    new Function('window','navigator','fetch','CONTENT',
      '"use strict";' + COMPANION_SRC + ';window.__c(COMPANION);')
      .call(env, env, env.navigator, env.fetch, env.CONTENT);
    /* companion.js 自己不读 dossierId 塞 st——它原样转发 content.js 给的 st(D-123:
       content.js 的 sendToRou() 已经在 st 里带上 dossierId,这里照实拼一份模拟那个
       调用点,而不是测 companion.js 自己会不会凭空造出这个字段)。 */
    await env.C2.reply([{ who:'me', text:'你好' }], { e4:false, truth:false, disposal:null, violations:0, night:false, clockStr:'02:00', dossierId:'phone-5029' });
    A(!!sentBody, '应发出代理请求');
    A(sentBody && sentBody.st && sentBody.st.dossierId === 'phone-5029', 'companion.js 应把 st 原样转发(含 content.js 塞的 dossierId),实际 ' + JSON.stringify(sentBody && sentBody.st));
    const raw = JSON.stringify(sentBody);
    ['03:00','03:14','03:31','03:45','溯源','判定','掉落','缓存格'].forEach(w =>
      A(!raw.includes(w), '请求体不该含秘匿词 ' + w));
  });

  await scenario('妈代理请求 · body.dossierId 正确', async ({A}) => {
    let sentBody = null;
    const env = { navigator:{}, Math, fetch: (url, opts) => { sentBody = JSON.parse(opts.body); return resp(200, { text: '妈: 是谁在用它。' }); } };
    env.window = env; env.__c = m => { env.M2 = m; };
    env.CONTENT = { dossier: { meta: { id: 'phone-3319' } } };
    new Function('window','navigator','fetch','CONTENT',
      '"use strict";' + MOM_SRC + ';window.__c(MOMLLM);')
      .call(env, env, env.navigator, env.fetch, env.CONTENT);
    await env.M2.told();
    A(!!sentBody, '应发出代理请求');
    A(sentBody && sentBody.dossierId === 'phone-3319', '请求体 dossierId 应为 phone-3319,实际 ' + JSON.stringify(sentBody));
  });

  /* ---- 服务端:persona=rou/mom 按 dossierId 选 CORE_B/CORE_C,不再一律给 A 的人格核 ---- */
  await scenario('服务端 persona=rou · dossierId 挑对 CORE_B/CORE_C', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    const H = { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.20' };
    const realFetch = global.fetch;
    let upSystem = null;
    global.fetch = (url, opts) => {
      upSystem = JSON.parse(opts.body).system;
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ content:[{type:'text',text:'如愿: 你不是他。'}] }), text:()=>Promise.resolve('') });
    };
    for (const [dossierId, mustHave, mustNotHave] of [
      [undefined, '柔柔', '如愿'],
      ['phone-5029', '如愿', '柔柔'],
      ['phone-3319', '阿澄', '柔柔'],
      ['phone-8842', '长忆', '柔柔'],
      ['phone-6153', '知遇', '柔柔'],
      ['phone-2087', '均分', '柔柔'],
      ['phone-4419', '留声', '柔柔'],
    ]){
      upSystem = null;
      const r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({
        history: [{ who:'me', text:'你好' }], st: { dossierId }
      }) });
      A(r.statusCode === 200, 'rou 应 200,实际 ' + r.statusCode + '(' + JSON.stringify(dossierId) + ')');
      A(upSystem && upSystem.includes(mustHave), 'dossierId=' + dossierId + ' 上游 system 应含 ' + mustHave);
      A(upSystem && !upSystem.includes(mustNotHave), 'dossierId=' + dossierId + ' 上游 system 不该含 ' + mustNotHave);
    }
    global.fetch = realFetch;
    ['LLM_API_KEY','ANTHROPIC_API_KEY','LLM_PROVIDER'].forEach(k => { if (save[k]===undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  await scenario('服务端 persona=mom · dossierId 挑对 MOM_CORE_B/MOM_CORE_C', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    const H = { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.21' };
    const realFetch = global.fetch;
    let upSystem = null;
    global.fetch = (url, opts) => {
      upSystem = JSON.parse(opts.body).system;
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ content:[{type:'text',text:'妈: 是谁在用它。'}] }), text:()=>Promise.resolve('') });
    };
    for (const [dossierId, mustHave, mustNotHave] of [
      [undefined, '沈一帆', '陈屿'],
      ['phone-5029', '周随安', '沈一帆'],
      ['phone-3319', '陈屿', '沈一帆'],
      ['phone-8842', '苏晏', '沈一帆'],
      ['phone-6153', '顾行舟', '沈一帆'],
      ['phone-2087', '宁绎', '沈一帆'],
      ['phone-4419', '温识', '沈一帆'],
    ]){
      upSystem = null;
      const r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'mom', dossierId }) });
      A(r.statusCode === 200, 'mom 应 200,实际 ' + r.statusCode + '(' + JSON.stringify(dossierId) + ')');
      A(upSystem && upSystem.includes(mustHave), 'dossierId=' + dossierId + ' 上游 system 应含 ' + mustHave);
      A(upSystem && !upSystem.includes(mustNotHave), 'dossierId=' + dossierId + ' 上游 system 不该含 ' + mustNotHave);
    }
    global.fetch = realFetch;
    ['LLM_API_KEY','ANTHROPIC_API_KEY','LLM_PROVIDER'].forEach(k => { if (save[k]===undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  /* ---- 全栈联调:content.js 的 sendToRou() 真的在 st 里塞了 dossierId(不是只有
     companion.js 单元测试里手造的那个字段) ---- */
  await scenario('content.js 真实调用点 · st.dossierId 随 COMPANION.reply 一起送出', async ({A}) => {
    let capturedSt = null;
    let T = 1000; const perf = { now: () => T };
    const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
      getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
    const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
    const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
    storage.setItem('escape_ai_save', JSON.stringify({ runCount:1, dossierId:'B', history:[{cacheVal:100,inst:'#5029-A'}] }));
    const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
      localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
      OVERLAY:{show(c,cb){ if(cb) cb({text:'你好',kept:false}); }, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
    env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
    new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
      '"use strict";'+CONTENT_SRC+';window.__c(LCD,ENGINE,CONTENT);COMPANION.reply=(h,st)=>{window.__capturedSt=st;return Promise.resolve({text:null,source:"pool"});};')
      .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
    env.C.go('th_rou', true);
    env.C.key('M');   // 打开自由输入 → OVERLAY 的假 cb 立即回"你好" → sendToRou()
    await new Promise(r => setTimeout(r, 0));
    capturedSt = env.__capturedSt;
    A(!!capturedSt, 'sendToRou() 应真的调用到 COMPANION.reply');
    A(capturedSt && capturedSt.dossierId === 'phone-5029', 'content.js 传给 COMPANION.reply 的 st.dossierId 应为 phone-5029,实际 ' + JSON.stringify(capturedSt));
  });

  /* ---- 降级链完整性:B/C 平台不可用(refused/failed)时仍落回离线池,不会挂起或抛错 ---- */
  await scenario('柔柔(companion.js) · phone-5029 平台失败仍完整落回离线池', async ({A}) => {
    const failSample = async () => { throw Object.assign(new Error('x'), { code: 'refused' }); };
    const C = bootCompanion('phone-5029', failSample);
    const r = await C.reply([{ who:'me', text:'你好' }], { e4:false, truth:false, disposal:null, violations:0, night:false, clockStr:'02:00' });
    A(r.source === 'pool', '平台 refused 后应落回离线池,实际 ' + r.source);
    A(typeof r.text === 'string' && r.text.length > 0, '离线池应给一句真实文本');
  });

  console.log(failures ? ('\nFAILED: ' + failures) : '\nALL DOSSIER-LLM (D-123) CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
