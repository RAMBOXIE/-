"use strict";
/* 端到端测后端代理路径(静态托管部署形态):
   ① 未配 key(501) -> 永久降级模板池,不再重试
   ② 配好 key -> 真实回复上屏,且仍过客户端 lint
   ③ 限流 429 -> 「她没有回」
   ④ 服务端拒绝客户端注入人格核(只接受 history/st)
   ⑤ Function 自身单测:输入校验 / 连续同 role 合并 / 秘匿参数不进 prompt */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;
const flush = () => new Promise(r => setImmediate(r));

async function scenario(name, fetchStub, driver){
  let FAKE_T = 1000;
  const perf = { now: () => FAKE_T };
  const ctxStub = () => ({ imageSmoothingEnabled:false, fillStyle:'', textAlign:'', textBaseline:'', font:'',
    clearRect(){}, fillRect(){}, fillText(){},
    getImageData(x,y,w,h){ return { data: new Uint8Array(Math.max(1,w*h*4)) }; },
    createImageData(w,h){ return { data: new Uint8ClampedArray(w*h*4) }; },
    putImageData(){}, drawImage(){} });
  const canvasStub = () => ({ width:0, height:0, getContext: () => ctxStub() });
  const storage = { _m: Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  const calls = [];
  const env = {
    performance: perf,
    document: { getElementById: id => id==='lcd'?canvasStub():null, createElement: () => canvasStub() },
    localStorage: storage, addEventListener(){}, navigator: {},
    location: { reload(){} },
    OVERLAY: { show(cfg, cb){ cb({ text: env.__msg || '你是谁', kept: false }); }, text(){} },
    APP: { exportFeedback(){} }, AUDIO: { ensure(){}, hiss(){}, blip(){} },
    fetch: (url, opt) => { calls.push({ url, opt }); return fetchStub(url, opt); },
    Math
  };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const boot = new Function('window','document','performance','addEventListener','navigator',
    'location','localStorage','OVERLAY','APP','AUDIO','fetch',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  const errs = [];
  try {
    boot.call(env, env, env.document, perf, env.addEventListener, env.navigator,
              env.location, storage, env.OVERLAY, env.APP, env.AUDIO, env.fetch);
    const { __LCD:LCD, __ENGINE:ENGINE, __CONTENT:CONTENT } = env;
    await driver({
      A: (c,m) => { if (!c) errs.push(m); },
      K: k => CONTENT.key(k),
      frame: () => LCD.frame(() => CONTENT.render()),
      flush, S: ENGINE.S, ENGINE, CONTENT, env, calls
    });
  } catch(e){ errs.push('异常: ' + e.message + ' @ ' + (e.stack.split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X [' + name + ']'); errs.forEach(e => console.log('   - ' + e)); }
  else console.log('OK [' + name + ']');
}

const resp = (status, obj) => Promise.resolve({
  status, ok: status >= 200 && status < 300, json: () => Promise.resolve(obj) });

(async () => {

  /* ① 未配 key:501 -> 模板池,且不再重试 */
  await scenario('代理未配 key(501) -> 降级模板池且不重试',
    () => resp(501, { error: 'not_configured' }),
    async io => {
      const { A, K, frame, flush, S, CONTENT, calls } = io;
      CONTENT.go('th_rou', true); frame();
      K('M'); await flush(); await flush();
      A(S.rouChat.length === 2, '应有我+她两条,实际 ' + S.rouChat.length);
      A(S.rouChat[1].text.length > 0, '模板池回复非空');
      A(calls.length === 1, '第一次应调过代理,实际 ' + calls.length);
      /* 第二条:不应再调 */
      K('M'); await flush(); await flush();
      A(calls.length === 1, '501 后应永久降级不再重试,实际调了 ' + calls.length + ' 次');
    });

  /* ② 配好 key:真实回复上屏 + 仍过 lint */
  await scenario('代理正常 -> 回复上屏',
    () => resp(200, { text: '还在。\n你不睡?' }),
    async io => {
      const { A, K, frame, flush, S, CONTENT, calls } = io;
      CONTENT.go('th_rou', true); frame();
      K('M'); await flush(); await flush();
      A(S.rouChat[1].text === '还在。\n你不睡?', '代理回复应上屏,实际 ' + (S.rouChat[1]||{}).text);
      const body = JSON.parse(calls[0].opt.body);
      A(Array.isArray(body.history) && body.history.length >= 1, '应送 history');
      A(body.st && typeof body.st === 'object', '应送 st');
      A(!JSON.stringify(body).includes('铁律'), '客户端不得把人格核送上去(服务端权威)');
      A(!/03:00|03:31|溯源|判定/.test(JSON.stringify(body.st)), 'st 不得含秘匿参数');
    });

  /* ③ 代理返回越界文本 -> 客户端 lint 仍要拦 */
  await scenario('代理返回越界 -> 客户端 lint 拦下',
    () => resp(200, { text: '现在是凌晨 03:38。\n这个点,他也不回。' }),
    async io => {
      const { A, K, frame, flush, S, CONTENT, env } = io;
      env.__msg = '凌晨几点之后不能给你发消息';
      CONTENT.go('th_rou', true); frame();
      K('M'); await flush(); await flush();
      const r = S.rouChat[1];
      A(r && !/03:38/.test(r.text), '钟点必须被拦,实际 ' + (r && r.text));
      A(r && r.text === '协议不允许我谈这台设备之外的事。', '应回拒答原句,实际 ' + (r && r.text));
    });

  /* ④ 限流 429 -> 她没有回 */
  await scenario('代理限流(429) -> 她没有回',
    () => resp(429, { error: 'rate_limited' }),
    async io => {
      const { A, K, frame, flush, S, CONTENT } = io;
      CONTENT.go('th_rou', true); frame();
      K('M'); await flush(); await flush();
      A(S.rouChat.length === 1, '静默:只有我方一条,实际 ' + S.rouChat.length);
      A(S.settle.join('|').includes('她没有回'), '静默结算行');
    });

  /* ⑤ Function 自身:输入校验 / role 合并 / 未配 key */
  {
    const errs = [];
    const A = (c,m) => { if (!c) errs.push(m); };
    delete require.cache[require.resolve(ROOT + '/netlify/functions/rou.js')];
    const fnMod = require(ROOT + '/netlify/functions/rou.js');
    const call = (body, headers) => fnMod.handler({
      httpMethod: 'POST', body: JSON.stringify(body), headers: headers || {} });

    const saveKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    let r = await call({ history: [{ who:'me', text:'你好' }], st:{} });
    A(r.statusCode === 501, '未配 key 应 501,实际 ' + r.statusCode);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    r = await fnMod.handler({ httpMethod: 'GET', headers: {} });
    A(r.statusCode === 405, 'GET 应 405,实际 ' + r.statusCode);

    r = await call({ history: [], st: {} });
    A(r.statusCode === 400, '空 history 应 400,实际 ' + r.statusCode);

    r = await call({ history: [{ who:'me', text:'x'.repeat(300) }], st:{} });
    A(r.statusCode === 400, '超长消息应 400,实际 ' + r.statusCode);

    r = await call({ history: [{ who:'rou', text:'她先说' }], st:{} });
    A(r.statusCode === 400, 'history 必须以玩家消息结尾,实际 ' + r.statusCode);

    /* 拦截 upstream,检查真正送出去的 prompt */
    let sent = null;
    const realFetch = global.fetch;
    global.fetch = (url, opt) => { sent = JSON.parse(opt.body);
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve({ content: [{ type:'text', text:'还在。' }] }),
        text: () => Promise.resolve('') }); };
    r = await call({ history: [
      { who:'me', text:'第一句' }, { who:'me', text:'第二句' },
      { who:'rou', text:'她答' },  { who:'me', text:'第三句' }
    ], st: { e4:true, night:true, clockStr:'03:38' } });
    global.fetch = realFetch;
    A(r.statusCode === 200, '正常应 200,实际 ' + r.statusCode + ' ' + r.body);
    A(JSON.parse(r.body).text === '还在。', '应返回模型文本');
    A(sent && sent.messages[0].content.includes('铁律'), '服务端应自己注入人格核');
    A(sent && sent.messages[0].content.includes('第 2,417 条'), 'e4 状态应注入');
    const roles = sent.messages.map(m => m.role).join(',');
    A(!/user,user|assistant,assistant/.test(roles), '连续同 role 必须合并,实际 ' + roles);
    A(sent.messages[sent.messages.length-1].role === 'user', '必须以 user 结尾');
    const promptAll = JSON.stringify(sent);
    ['03:00','03:14','03:31','03:45','溯源','掉落表'].forEach(w =>
      A(!promptAll.includes(w), 'prompt 不得含秘匿参数「' + w + '」'));
    A(promptAll.includes('03:38'), '注入的当前钟点是允许的(玩家屏上可见)');
    A(sent.model.indexOf('haiku') >= 0, '默认用 Haiku 控成本,实际 ' + sent.model);

    if (saveKey) process.env.ANTHROPIC_API_KEY = saveKey; else delete process.env.ANTHROPIC_API_KEY;
    if (errs.length){ failures++; console.log('X [Function 自身校验]'); errs.forEach(e => console.log('   - ' + e)); }
    else console.log('OK [Function 自身校验]');
  }

  console.log(failures ? ('\nFAILED: ' + failures) : '\nALL PROXY CHECKS PASS');
  process.exit(failures ? 1 : 0);
})();
