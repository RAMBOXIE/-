"use strict";
/* P2 幻觉零容忍门禁(见 design/底本抽象_设计_v0.1.md §4)。
   底本一旦变数据、未来交给 LLM 辅助撰写,证据链幻觉是头号风险("解谜幻觉率必为零")。
   这条门禁现在就用两份**手写**底本(phone-7741/phone-5029)建立起来——先证明门禁本身
   有牙齿(改坏一条链会报警),等 P4 真的上 LLM 撰写底本时,它就是产线的质量闸,不用
   重新设计断言形状。

   断言四件事(逐条对应 §4):
   ① evidence.chain 每条都在 DOSSIER.evidence 里有唯一的 name+source(不缺、不空)。
   ② chain 里的每个 id,都能在框架代码里找到真实触发点(evidence('Ex') 调用或
      S.evidence.Ex = true 直写)——不能有"底本声称集齐但框架根本不会点亮"的幽灵证据。
   ③ chain 长度固定为 5(框架侧 SCREENS.e5crack 的 `full` 判定、案卷显示"n/5"等十余处
      都硬编码了这个数——这是结构性约定,不是可变形状;门禁在这里守住这条约定,而不是
      为"可变长度"去改十几处显示代码,过度泛化)。
   ④ 底本的证据名/来源/真相文案不得混入秘匿参数(窗口时刻/概率/掉落阈值)——
      复用 persona_sync.js 同一份 SECRET 词表,按底本各跑一遍。
   先用"故意改坏"的假底本验证每条断言真的会报警,再对两份真底本各跑一遍。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC_FILES = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js','js/content.js'];
const SRC = SRC_FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
const CONTENT_SRC = fs.readFileSync(path.join(ROOT, 'js/content.js'), 'utf8');

let failures = 0;
const A = (ok, msg) => { if (!ok){ failures++; console.log('X ' + msg); } else console.log('OK ' + msg); };

function mkEnv(saveObj){
  const perf = { now: () => 0 };
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({ data:new Uint8Array(Math.max(1,w*h*4)) }),
    createImageData:(w,h)=>({ data:new Uint8ClampedArray(w*h*4) }), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; },
    setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  if (saveObj) storage.setItem('escape_ai_save', JSON.stringify(saveObj));
  const env = { performance:perf,
    document:{ getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas() },
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{ show(c,cb){ cb({ text:'x', kept:false }); }, text(){} },
    APP:{ exportFeedback(){} }, AUDIO:{ ensure(){}, hiss(){}, blip(){} }, HOLD:{ active:false }, Math };
  env.window = env; env.__c = (L,E,C) => { env.L=L; env.E=E; env.C=C; };
  new Function('window','document','performance','addEventListener','navigator','location',
    'localStorage','OVERLAY','APP','AUDIO','"use strict";' + SRC + ';window.__c(LCD,ENGINE,CONTENT);')
    .call(env, env, env.document, perf, env.addEventListener, env.navigator, env.location,
          storage, env.OVERLAY, env.APP, env.AUDIO);
  return env;
}

/* ---------- 断言函数本身(独立于"从哪个 DOSSIER 拿数据"),方便先拿假底本试牙齿 ---------- */
function checkChainIntegrity(dossier, label, report){
  const ev = dossier.evidence;
  const chain = ev && ev.chain;
  if (!Array.isArray(chain)){ report.push(label + ': evidence.chain 不是数组'); return; }
  const seen = new Set();
  chain.forEach(id => {
    if (seen.has(id)) report.push(label + ': chain 里重复的 id ' + id);
    seen.add(id);
    const e = ev[id];
    if (!e) { report.push(label + ': chain 引用了不存在的证据 ' + id); return; }
    if (!e.name || !String(e.name).trim()) report.push(label + ': ' + id + ' 缺 name');
    if (!e.source || !String(e.source).trim()) report.push(label + ': ' + id + ' 缺 source');
  });
}
function checkChainLength(dossier, label, report){
  const chain = dossier.evidence && dossier.evidence.chain;
  if (!Array.isArray(chain) || chain.length !== 5)
    report.push(label + ': chain 长度应为 5(框架侧 SCREENS.e5crack 等处硬编码了这个数),实际 ' + (chain ? chain.length : '?'));
}
function checkTruthShape(dossier, label, report){
  const truth = dossier.evidence && dossier.evidence.truth;
  if (!Array.isArray(truth) || truth.length !== 2)
    report.push(label + ': truth 应为两页,实际 ' + (truth ? truth.length : '?'));
  else truth.forEach((t, i) => { if (!t || !String(t).trim()) report.push(label + ': truth[' + i + '] 为空'); });
}
const SECRET = ['03:00', '03:14', '03:31', '03:45', '溯源', '判定', '掉落', '缓存格', '25%', '78%'];
function checkNoSecretLeak(dossier, label, report){
  /* 范围只到 evidence(证据名/来源/真相文案)——这是解谜面本身,秘匿隔离的宪法红线在
     这里。narrative 里的陷阱条款(T_WINDOW 等)本就该把违规规则**明说**给玩家(先给
     限制后给破绽,是陷阱条款的设计初衷,不是泄密);录音/聊天时间戳("[32天前 03:14]")
     是普通叙事时间,不是活规则窗口值——都不在这条门禁的扫描面内,扫了只会误报。 */
  const text = JSON.stringify(dossier.evidence);
  const hit = SECRET.filter(w => text.includes(w));
  if (hit.length) report.push(label + ': evidence(证据名/来源/真相)混入秘匿参数 —— ' + hit.join(', '));
}
function checkReachable(dossier, label, frameworkIds, report){
  const chain = dossier.evidence && dossier.evidence.chain;
  if (!Array.isArray(chain)) return;
  const chainSet = new Set(chain);
  frameworkIds.forEach(id => { if (!chainSet.has(id)) report.push(label + ': 框架真实会触发 ' + id + ',但底本 chain 里没有(幽灵触发点,永远点不亮案卷)'); });
  chain.forEach(id => { if (!frameworkIds.has(id)) report.push(label + ': chain 声称有 ' + id + ',但框架代码里找不到任何真实触发点(幽灵证据)'); });
}

/* ---------- ① 先证明门禁真的有牙齿:喂一份故意改坏的假底本 ---------- */
{
  const bad = {
    evidence: {
      E1: { name: '', source: '妈线程 · 深搜' },              // 缺 name
      E2: { name: '最后的照片', source: '' },                  // 缺 source
      E3: { name: '停摆的账单', source: '尾号8873 · 打开' },
      E3b: { name: '幽灵证据', source: '不存在的触发点' },     // chain 引用不存在的 id 走另一测试,这里单独测长度/泄密
      chain: ['E1', 'E2', 'E3', 'E1'],                         // 重复 + 长度不对(4,含重复)
      truth: ['03:00 之后信号会涨,概率 25%,别提这个'],         // 故意在真相文案里塞秘匿词(该两页,只给了一页,顺带测)
    },
  };
  const report = [];
  checkChainIntegrity(bad, '假底本', report);
  checkChainLength(bad, '假底本', report);
  checkTruthShape(bad, '假底本', report);
  checkNoSecretLeak(bad, '假底本', report);
  A(report.some(r => r.includes('重复的 id E1')), '门禁能抓到 chain 里的重复 id(教学假底本验证)');
  A(report.some(r => r.includes('E1 缺 name')), '门禁能抓到缺 name(教学假底本验证)');
  A(report.some(r => r.includes('E2 缺 source')), '门禁能抓到缺 source(教学假底本验证)');
  A(report.some(r => r.includes('chain 长度应为 5')), '门禁能抓到 chain 长度不对(教学假底本验证)');
  A(report.some(r => r.includes('truth 应为两页')), '门禁能抓到 truth 页数不对(教学假底本验证)');
  A(report.some(r => r.includes('混入秘匿参数')), '门禁能抓到叙事文本混入秘匿参数(教学假底本验证)');
}
{
  /* 幽灵证据/幽灵触发点单独验证:chain 引用了 evidence 里没有的 id */
  const bad2 = { evidence: { E1:{name:'a',source:'b'}, chain:['E1','E9'] } };
  const report = [];
  checkChainIntegrity(bad2, '假底本2', report);
  A(report.some(r => r.includes('引用了不存在的证据 E9')), '门禁能抓到 chain 引用不存在的证据(教学假底本验证)');
}
{
  const frameworkIds = new Set(['E1','E2','E3','E4']);   // 故意漏掉 E5,模拟"框架侧改动但底本没跟上"
  const goodShapeButMismatch = { evidence: { E1:{name:'a',source:'s'}, E2:{name:'a',source:'s'}, E3:{name:'a',source:'s'}, E4:{name:'a',source:'s'}, E5:{name:'a',source:'s'}, chain:['E1','E2','E3','E4','E5'] } };
  const report = [];
  checkReachable(goodShapeButMismatch, '假底本3', frameworkIds, report);
  A(report.some(r => r.includes('chain 声称有 E5')), '门禁能抓到 chain 与框架真实触发点对不上(教学假底本验证)');
}

/* ---------- ② 从框架代码里提取"真实会触发哪些证据 id"(reachability 的真值来源) ---------- */
const frameworkTriggerIds = new Set();
for (const m of CONTENT_SRC.matchAll(/evidence\('(E\d)'\)/g)) frameworkTriggerIds.add(m[1]);
for (const m of CONTENT_SRC.matchAll(/S\.evidence\.(E\d)\s*=\s*true/g)) frameworkTriggerIds.add(m[1]);
A(frameworkTriggerIds.size > 0, '能从 content.js 里提取到真实证据触发点(否则下面的可达性检查是空转)');

/* ---------- ③ 对两份真底本各跑一遍(A 默认,B 靠存档 dossierId 切换) ---------- */
[['DOSSIER_A(phone-7741)', null], ['DOSSIER_B(phone-5029)', { dossierId: 'B' }], ['DOSSIER_C(phone-3319)', { dossierId: 'C' }], ['DOSSIER_D(phone-8842)', { dossierId: 'D' }],
 ['DOSSIER_E(phone-6153)', { dossierId: 'E' }], ['DOSSIER_F(phone-2087)', { dossierId: 'F' }], ['DOSSIER_G(phone-4419)', { dossierId: 'G' }],
 ['DOSSIER_H(phone-3567)', { dossierId: 'H' }], ['DOSSIER_I(phone-5620)', { dossierId: 'I' }],
 ['DOSSIER_J(phone-9102)', { dossierId: 'J' }], ['DOSSIER_K(phone-6047)', { dossierId: 'K' }],
 ['DOSSIER_L(phone-2938)', { dossierId: 'L' }], ['DOSSIER_M(phone-8410)', { dossierId: 'M' }]].forEach(([label, saveObj]) => {
  const env = mkEnv(saveObj);
  const dossier = env.C.dossier;
  const report = [];
  checkChainIntegrity(dossier, label, report);
  checkChainLength(dossier, label, report);
  checkTruthShape(dossier, label, report);
  checkNoSecretLeak(dossier, label, report);
  checkReachable(dossier, label, frameworkTriggerIds, report);
  A(report.length === 0, label + ' 证据链/真相/秘匿隔离全部通过' + (report.length ? '\n     - ' + report.join('\n     - ') : ''));
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL HALLUCINATION-GATE (P2) CHECKS PASS');
process.exit(failures ? 1 : 0);
