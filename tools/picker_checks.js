"use strict";
/* 受限裁决 · 遭遇 picker(D-105 块3)门禁 —— 对照 content.js pickBranchLLM + rou.js persona:'picker'。
   证明:LLM 只回一个预批 id;引擎按 id 出叙述、数值恒定;越界/空回退默认(防越狱);
   服务端从模型输出里认 id、认不出回空、拒收畸形候选。先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;
const flush = () => new Promise(r => setImmediate(r));

/* 注入 fetch(picker 代理桩)启动整局 content.js */
function boot(fetchStub){
  let T = 1000;
  const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const calls = [];
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false},
    fetch:(url,opt)=>{ calls.push({url,opt}); return fetchStub(url,opt); }, Math };
  env.window = env; env.__c=(L,E,C)=>{env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO','fetch',
    '"use strict";'+SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO, env.fetch);
  return { E:env.E, C:env.C, calls };
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

const LINES = { graze:'进程掠过了你。', brush:'它擦着你的接入点过去了。', near:'差一点。它没认出你。' };

(async () => {
  /* ---- 客户端:LLM 预挑的 id 被采用(擦过叙述=该 id 的引擎文案,数值恒定) ---- */
  await scenario('客户端 · 采用 LLM 预挑的分支叙述', async ({A}) => {
    const g = boot(() => resp(200, { id: 'near' }));      // picker 代理回 near
    g.C.go('huntArrive', true);
    await flush(); await flush();                          // 让 enter() 的预挑 promise 落地
    const bat0 = g.E.S.battery;
    g.E.roll = () => true;                                 // c90 成功=擦过
    g.C.key('Enter');
    const full = (g.E.S.settle || []).join(' | ');
    A(full.includes(LINES.near), 'LLM 选 near 应出 near 叙述,实际 ' + JSON.stringify(g.E.S.settle));
    A(g.E.S.battery === bat0 - 2, '擦过电量恒扣 2(数值不受 LLM 影响)');
  });

  /* ---- 客户端:越界 id → resolveBranch 回退默认(第一个=graze) ---- */
  await scenario('客户端 · LLM 越界 id 回退默认分支', async ({A}) => {
    const g = boot(() => resp(200, { id: 'JAILBREAK' }));  // 集外
    g.C.go('huntArrive', true);
    await flush(); await flush();
    g.E.roll = () => true;
    g.C.key('Enter');
    const full = (g.E.S.settle || []).join(' | ');
    A(full.includes(LINES.graze), '越界应回退默认(graze),实际 ' + JSON.stringify(g.E.S.settle));
  });

  /* ---- 客户端:代理 501 → 不用 LLM,离线加权现挑(仍是三句之一) ---- */
  await scenario('客户端 · 代理 501 离线现挑', async ({A}) => {
    const g = boot(() => resp(501, { error:'not_configured' }));
    g.C.go('huntArrive', true);
    await flush(); await flush();
    g.E.roll = () => true;
    Math.random = () => 0.5;
    g.C.key('Enter');
    const full = (g.E.S.settle || []).join(' | ');
    A(Object.values(LINES).some(L => full.includes(L)), '离线仍应出三句之一,实际 ' + JSON.stringify(g.E.S.settle));
  });

  /* ---- 服务端 persona=picker:从模型输出认 id / 认不出回空 / 拒收畸形候选 ---- */
  await scenario('服务端 picker · 认 id / 空 / 校验', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    const H = { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.11' };
    const cands = [{id:'graze',line:'进程掠过了你。'},{id:'brush',line:'它擦着你的接入点过去了。'},{id:'near',line:'差一点。它没认出你。'}];
    const realFetch = global.fetch;

    global.fetch = () => Promise.resolve({ ok:true, status:200,
      json:()=>Promise.resolve({ content:[{type:'text',text:'我选 brush 这句。'}] }), text:()=>Promise.resolve('') });
    let r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'picker', candidates:cands }) });
    A(r.statusCode === 200 && JSON.parse(r.body).id === 'brush', '应从"我选 brush"里认出 brush,实际 ' + r.body);

    global.fetch = () => Promise.resolve({ ok:true, status:200,
      json:()=>Promise.resolve({ content:[{type:'text',text:'胡说八道没有任何 id'}] }), text:()=>Promise.resolve('') });
    r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'picker', candidates:cands }) });
    A(r.statusCode === 200 && JSON.parse(r.body).id === '', '认不出应回空 id,实际 ' + r.body);
    // picker 不签名(仍在 mock 下,别打真网络)
    A(JSON.parse(r.body).id !== undefined && JSON.parse(r.body).sig === undefined, 'picker 不签名');

    /* 以下畸形/空候选在 fetch 之前就被 400 挡下,永不触网 —— 但仍保持 mock 以防回归 */
    r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'picker', candidates:[] }) });
    A(r.statusCode === 400, '空候选应 400,实际 ' + r.statusCode);
    r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'picker', candidates:[{id:'x'.repeat(20), line:'a'}] }) });
    A(r.statusCode === 400, '畸形 id 应 400,实际 ' + r.statusCode);
    r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'picker', candidates:[{id:'ok', line:'x'.repeat(50)}] }) });
    A(r.statusCode === 400, '超长候选文本应 400,实际 ' + r.statusCode);

    global.fetch = realFetch;
    ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => { if (save[k]===undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  console.log(failures ? ('\nFAILED: '+failures) : '\nALL PICKER CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
