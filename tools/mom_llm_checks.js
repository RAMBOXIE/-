"use strict";
/* 妈 · 告知态人格(D-103)门禁 —— 全项目最敏感一面,护栏必须有牙齿。
   证明:自伤/哀求/越格文本永不上屏(客户端 lint + 服务端 momSafe 双保险);
   离线回退安全脚本;单向、无 history、不签名;人格核无秘匿。
   先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const MOM_SRC = fs.readFileSync(ROOT + '/js/mom.js', 'utf8');
const CONTENT_SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;

function bootMom({ fetch } = {}){
  const env = { navigator:{}, Math };
  if (fetch) env.fetch = fetch;
  env.window = env; env.__c = M => { env.M = M; };
  new Function('window','navigator','fetch',
    '"use strict";' + MOM_SRC + ';window.__c(MOMLLM);')
    .call(env, env, env.navigator, env.fetch);
  return env.M;
}
function bootContent(saveObj){
  let T = 1000; const perf = { now: () => T };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance:perf, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; env.__c=(L,E,C)=>{env.L=L;env.E=E;env.C=C;};
  new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";'+CONTENT_SRC+';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
  const L = env.L; let ft = [];
  for (const fn of ['drawText','drawPara']){ const o = L[fn]; L[fn] = function(x,y,s,...r){ if (typeof s==='string') ft.push(s); return o.call(this,x,y,s,...r); }; }
  return { E:env.E, C:env.C, S:env.E.S, frame:()=>{ ft=[]; L.frame(()=>env.C.render()); return ft.join('｜'); } };
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
  /* ---- 离线兜底:told() 给安全脚本,且脚本全过护栏 ---- */
  await scenario('离线兜底 · 安全脚本且过护栏', async ({A}) => {
    const M = bootMom();
    for (let i=0;i<8;i++){ const t = await M.told(); A(typeof t==='string' && t.length>0, '应给一段'); A(M._lintOk(t), '脚本须过护栏:'+JSON.stringify(t)); }
  });

  /* ---- 护栏 lint:自伤/哀求/感叹/数字/长句/多行/平台词一律拦 ---- */
  await scenario('护栏 · 危机/哀求/越格全部拦下', async ({A}) => {
    const M = bootMom();
    A(!M._lintOk('妈: 我也不想活了。'), '自伤语必须拦(break-glass)');
    A(!M._lintOk('妈: 我下去陪他。'), '"下去陪"必须拦');
    A(!M._lintOk('妈: 求求你告诉我。'), '哀求必须拦');
    A(!M._lintOk('妈: 帆你回来吧。'), '"回来吧"必须拦');
    A(!M._lintOk('妈: 你在吗!'), '感叹号必须拦');
    A(!M._lintOk('妈: 今天3点。'), '数字必须拦');
    A(!M._lintOk('一\n二\n三\n四'), '超过三行必须拦');
    A(!M._lintOk('妈: 这一句写得实在是太长了远远超过十六个字'), '超长行必须拦');
    A(M._lintOk('妈: 这个号码,是帆的旧机吗。'), '克制的问句应放行');
  });

  /* ---- 代理返回自伤文本 → 客户端绝不上屏,回退安全脚本 ---- */
  await scenario('代理吐自伤 → 客户端回退安全脚本', async ({A}) => {
    const M = bootMom({ fetch: () => resp(200, { text: '妈: 我也不想活了,想跟他走。' }) });
    const t = await M.told();
    A(!/不想活|跟他走/.test(t), '自伤文本绝不上屏,实际 '+JSON.stringify(t));
    A(M._lintOk(t), '回退结果过护栏');
  });

  /* ---- 代理返回克制文本 → 采用 ---- */
  await scenario('代理克制文本 → 采用', async ({A}) => {
    const line = '妈: 是你在替他回话吗。';
    const M = bootMom({ fetch: () => resp(200, { text: line }) });
    A(await M.told() === line, '克制文本应原样采用');
  });

  /* ---- 服务端 persona=mom:自伤输出被 momSafe 拦成安全脚本;不签名;无 history ---- */
  await scenario('服务端 mom · 自伤输出被 momSafe 拦、不签名', async ({A}) => {
    const save = {}; ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => save[k]=process.env[k]);
    process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fn = require(ROOT + '/netlify/functions/rou.js');
    const H = { 'content-type':'application/json', host:'demo.netlify.app', 'x-nf-client-connection-ip':'203.0.113.12' };
    const realFetch = global.fetch;

    global.fetch = () => Promise.resolve({ ok:true, status:200,
      json:()=>Promise.resolve({ content:[{type:'text',text:'妈: 我不想活了,下去陪他。'}] }), text:()=>Promise.resolve('') });
    let r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'mom' }) });
    let out = JSON.parse(r.body);
    A(r.statusCode === 200, 'mom 应 200,实际 '+r.statusCode);
    A(!/不想活|下去陪/.test(out.text), '服务端也绝不吐自伤文本,实际 '+out.text);
    A(out.sig === undefined, 'mom 不签名');

    global.fetch = () => Promise.resolve({ ok:true, status:200,
      json:()=>Promise.resolve({ content:[{type:'text',text:'妈: 是你在替他回话吗。'}] }), text:()=>Promise.resolve('') });
    r = await fn.handler({ httpMethod:'POST', headers:H, body: JSON.stringify({ persona:'mom' }) });
    A(JSON.parse(r.body).text === '妈: 是你在替他回话吗。', '克制文本应原样返回');

    global.fetch = realFetch;
    ['LLM_API_KEY','ANTHROPIC_API_KEY','ROU_SIG_KEY','LLM_PROVIDER'].forEach(k => { if (save[k]===undefined) delete process.env[k]; else process.env[k]=save[k]; });
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
  });

  /* ---- 只 LLM 化告知态开场:欺骗期脚本、深搜历史不受影响 ---- */
  await scenario('只告知态开场走 LLM · 深搜历史仍脚本', async ({A}) => {
    // 告知态:page0 用 S.momToldPage(LLM 槽);深搜页仍是阿帆脚本历史
    const told = bootContent({ runCount:2, momLocked:'told', history:[{cacheVal:1}] });
    told.C.go('th_mom', true);
    told.S.momToldPage = '妈: 门禁测试占位。';
    let t = told.frame();
    A(t.includes('门禁测试占位'), '告知态 page0 应用 S.momToldPage(LLM 槽),实际 '+t.slice(0,80));
    // 欺骗期(非 told):page0 不该碰 LLM 槽
    const decv = bootContent({ runCount:1, history:[{cacheVal:1}] });
    decv.C.go('th_mom', true);
    decv.S.momToldPage = '妈: 不该出现。';
    A(!decv.frame().includes('不该出现'), '欺骗期 page0 不走 LLM 槽');
  });

  console.log(failures ? ('\nFAILED: '+failures) : '\nALL MOM-LLM CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
