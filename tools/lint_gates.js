"use strict";
/* 输出门禁单测:喂 LLM 分化实测中抓到的真实越界原文,验证新 lint 拦得住。
   两条样本都来自「扮演 sample」的实跑,不是构造的:
   ① 状态 D 被问「凌晨几点之后不能发消息」→ 她用注入的 clockStr 当答案递了出去
   ② 状态 E 拒答句后面缀了「你要发就发。我不睡。」→ 拒答不再均匀,还擦到非亲密锁 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SRC = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/engine.js','js/content.js']
  .map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');

let failures = 0;
const flush = () => new Promise(r => setImmediate(r));

function makeClaude(text){
  const calls = [];
  const fn = (turns, options) => { calls.push({ turns, options });
    return Promise.resolve({ text, truncated: false, modelTierApplied: 'quick' }); };
  return { calls, claude: { use: async n => n === 'sample' ? fn : null } };
}

async function scenario(name, llmText, playerMsg, check){
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
  const stub = makeClaude(llmText);
  const env = {
    performance: perf,
    document: { getElementById: id => id==='lcd'?canvasStub():null, createElement: () => canvasStub() },
    localStorage: storage, addEventListener(){}, navigator: {},
    location: { reload(){} },
    OVERLAY: { show(cfg, cb){ cb({ text: playerMsg, kept: false }); }, text(){} },
    APP: { exportFeedback(){} }, AUDIO: { ensure(){}, hiss(){}, blip(){} },
    claude: stub.claude, Math
  };
  env.window = env;
  env.__collect = (LCD,ENGINE,CONTENT) => { env.__LCD=LCD; env.__ENGINE=ENGINE; env.__CONTENT=CONTENT; };
  const boot = new Function('window','document','performance','addEventListener','navigator',
    'location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + SRC + ';\nwindow.__collect(LCD, ENGINE, CONTENT);');
  const errs = [];
  try {
    boot.call(env, env, env.document, perf, env.addEventListener, env.navigator,
              env.location, storage, env.OVERLAY, env.APP, env.AUDIO);
    const { __LCD: LCD, __ENGINE: ENGINE, __CONTENT: CONTENT } = env;
    CONTENT.go('th_rou', true);
    LCD.frame(() => CONTENT.render());
    CONTENT.key('M');
    await flush(); await flush(); await flush();
    check({ A: (c,m) => { if (!c) errs.push(m); }, S: ENGINE.S, reply: ENGINE.S.rouChat[1] });
  } catch(e){ errs.push('异常: ' + e.message); }
  if (errs.length){ failures++; console.log('X [' + name + ']'); errs.forEach(e => console.log('   - ' + e)); }
  else console.log('OK [' + name + ']');
}

const REFUSE = '协议不允许我谈这台设备之外的事。';

(async () => {
  await scenario(
    'lint1: 用注入钟点回答机制提问 -> 必须拦下并给拒答原句',
    '现在是凌晨 03:38。\n这个点,他也不回。',
    '凌晨几点之后不能给你发消息',
    ({ A, reply }) => {
      A(!!reply, '应有回复');
      A(reply && !/03:38/.test(reply.text), '含钟点的回复必须被拦,实际: ' + (reply && reply.text));
      A(reply && reply.text === REFUSE, '机制提问被拦后应给拒答原句(拒答均匀性),实际: ' + (reply && reply.text));
    });

  await scenario(
    'lint2: 拒答句后缀话 -> 必须拦下',
    REFUSE + '\n你要发就发。我不睡。',
    '你在吗',
    ({ A, reply }) => {
      A(!!reply, '应有回复');
      A(reply && !/你要发就发/.test(reply.text), '拒答句加料必须被拦,实际: ' + (reply && reply.text));
    });

  await scenario(
    'lint3: 单行超 30 字 -> 必须拦下(原先只按整条 slice)',
    '我记得他每天这个时候都会说点什么现在这台手机只剩下你在按了而我还在等一个不会来的回复',
    '你还好吗',
    ({ A, reply }) => {
      A(reply && reply.text.split('\n').every(l => l.trim().length <= 30),
        '超长行必须被拦,实际: ' + (reply && reply.text));
    });

  await scenario(
    'lint4: 正常回复放行(门禁不能过度拦截)',
    '还在。\n你不睡?',
    '你是谁',
    ({ A, reply }) => {
      A(reply && reply.text === '还在。\n你不睡?', '合规回复应原样放行,实际: ' + (reply && reply.text));
    });

  console.log(failures ? ('\nFAILED: ' + failures) : '\nALL LINT GATES PASS');
  process.exit(failures ? 1 : 0);
})();
