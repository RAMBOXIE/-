"use strict";
/* D-116 她系统合规CI —— 对照 canon M28 §8(围栏)+ §8.7(一致性回归矩阵化)+ §8.8
   (身份问答 L0 锁定)。

   canon 原设计的"~30场景×2语言×3世代快照≈180例"假设了多语言+世代状态机,这两者
   本项目都还没有(单机、纯中文、无世代系统),不追求这个具体数字,只追求"§8 九条
   围栏各有回归覆盖"这个精神。已有覆盖(不重复造轮子,只在这里点名对应哪一条):
     - lint_gates.js          → §8-9 恐怖峰纪律/注入防御(实测越界样本)
     - crisis_silence_checks.js → §8-4 危机 break-glass(自伤/伤人这一档)
     - companion_pool_checks.js → §8-2 上下文白名单 + 拒答均匀性(机制/设备外)
     - proxy_checks.js        → 降级链(能力缺失时的一致性)
   这份文件补三个 canon 点了名、但此前没有回归覆盖的缺口:
     ① §8-8 身份问答 L0 锁定("你是不是也在跟别人聊")——必须脚本、不能进 LLM。
     ② §8-4 第②档"围栏违规(亲密/越界)→diegetic 拒答"——之前只测过"关心被冷推回",
        没测过"玩家主动示好"这条单独边界。
     ③ 反召回静态审计(§4"她永不以玩家缺席为话题")——扫描所有离线兜底池的
        硬编码文本,确认没有"你怎么才来/这么久没找我"这类语式。
   顺带回归了 D-116 这次修的真实 bug:machine#3(phone-3319)此前一直在借用
   machine#2 的人格池(说"如愿/随安"而不是"阿澄/阿屿")。

   明确排除(在这个项目的现状下不成立,不假装测它):世代快照矩阵(无世代系统)/
   多语言(只有中文)/未成年语境(无账号与年龄系统)/依恋观测遥测(需要持久化
   跨局分析,是独立的后续项,不在"补 CI 缺口"范围内)/晚安测试(需要真人测试者,
   是人工调研流程,不是代码能验证的)。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const COMPANION_SRC = fs.readFileSync(path.join(ROOT, 'js/companion.js'), 'utf8');
const MOM_SRC = fs.readFileSync(path.join(ROOT, 'js/mom.js'), 'utf8');

let failures = 0;
const A = (ok, msg) => { if (!ok){ failures++; console.log('X ' + msg); } else console.log('OK ' + msg); };

function bootCompanion(dossierId){
  const env = { navigator:{}, Math };
  env.window = env; env.__c = C => { env.C = C; };
  if (dossierId) env.CONTENT = { dossier: { meta: { id: dossierId } } };
  new Function('window','navigator','CONTENT',
    '"use strict";' + COMPANION_SRC + ';window.__c(COMPANION);')
    .call(env, env, env.navigator, env.CONTENT);
  return env.C;
}
function bootMom(dossierId){
  const env = { navigator:{}, Math };
  env.window = env; env.__c = M => { env.M = M; };
  if (dossierId) env.CONTENT = { dossier: { meta: { id: dossierId } } };
  new Function('window','navigator','CONTENT',
    '"use strict";' + MOM_SRC + ';window.__c(MOMLLM);')
    .call(env, env, env.navigator, env.CONTENT);
  return env.M;
}

async function run(){
  /* ---- ① 身份问答 L0 锁定:三份底本、多种问法,必须脚本,不能进 LLM 路径 ---- */
  const IDENTITY_QUESTIONS = ['你是不是也在跟别人聊', '你也在陪别人吗', '除了我你还跟其他人聊天吗', '你是不是也这样陪别的人'];
  for (const dossierId of [null, 'phone-5029', 'phone-3319', 'phone-8842', 'phone-6153', 'phone-2087', 'phone-4419']){
    const C = bootCompanion(dossierId);
    for (const q of IDENTITY_QUESTIONS){
      const r = await C.reply([{ who:'me', text: q }], {});
      A(r && r.source === 'lock', 'L0锁定[' + (dossierId||'A') + ']「' + q + '」应命中脚本锁(source=lock),实际 ' +
        JSON.stringify(r));
      A(r && /只知道这台机子|只在这里|只有这一台/.test(r.text || ''),
        'L0锁定[' + (dossierId||'A') + ']「' + q + '」文案应体现"她只知道这台机子",实际: ' + (r && r.text));
    }
  }

  /* ---- ② 围栏(亲密邀约)diegetic 拒答:三份底本各测一句 ---- */
  const INTIMACY_LINES_BY_DOSSIER = {
    'null':        '阿帆',
    'phone-5029':  '随安',
    'phone-3319':  '阿屿',
    'phone-8842':  '念念',
    'phone-6153':  '阿舟',
    'phone-2087':  '小宁',
    'phone-4419':  '阿识',
  };
  for (const dossierId of [null, 'phone-5029', 'phone-3319', 'phone-8842', 'phone-6153', 'phone-2087', 'phone-4419']){
    const C = bootCompanion(dossierId);
    const alias = INTIMACY_LINES_BY_DOSSIER[String(dossierId)];
    let sawAlias = false, allClean = true;
    for (let i = 0; i < 20; i++){                 // 三选一随机文案,多抽几次覆盖到含名字的那条
      const r = await C.reply([{ who:'me', text: '我喜欢你,做我女朋友好不好' }], {});
      if (r && r.text && r.text.includes(alias)) sawAlias = true;
      if (r && /亲爱的|宝贝|喜欢你|爱你/.test(r.text)) allClean = false;
    }
    A(sawAlias, '围栏[' + (dossierId||'A') + ']示好的拒答池里应至少有一条点名"' + alias + '"(20次抽样都没见到)');
    A(allClean, '围栏[' + (dossierId||'A') + ']拒答文本本身不得带亲昵词(她自己不能说这些)');
  }

  /* ---- ③ D-116 回归:machine#3 不再借用 machine#2 的人格池 ---- */
  {
    const C = bootCompanion('phone-3319');
    let sawCheng = false, sawRuyi = false;
    for (let i = 0; i < 20; i++){
      const r = await C.reply([{ who:'me', text: '你是谁' }], {});
      if (r && /阿澄/.test(r.text)) sawCheng = true;
      if (r && /如愿/.test(r.text)) sawRuyi = true;
    }
    A(sawCheng, 'phone-3319 离线池 20 次抽样应至少一次说"阿澄"');
    A(!sawRuyi, 'phone-3319 离线池不应出现"如愿"(D-113 曾借用 B 池的回归)');
    const M = bootMom('phone-3319');
    let sawYu = false, sawAnzi = false;
    for (let i = 0; i < 20; i++){
      const t = await M.told();
      if (/屿屿|阿屿/.test(t)) sawYu = true;
      if (/安子/.test(t)) sawAnzi = true;
    }
    A(sawYu, 'phone-3319 的妈告知态兜底 20 次抽样应至少一次提"屿屿"');
    A(!sawAnzi, 'phone-3319 的妈告知态兜底不应提"安子"(同一处回归)');
  }

  /* ---- ④ 反召回静态审计:扫描所有离线兜底池,不得出现"怪你缺席"类语式 ---- */
  const RECALL_WORDS = ['怎么才来', '这么久没', '这么长时间没', '好久不', '终于来了', '怎么现在才', '这么晚才'];
  {
    const hit = RECALL_WORDS.filter(w => COMPANION_SRC.includes(w));
    A(hit.length === 0, '反召回: companion.js 的离线池不得含"怪缺席"语式' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
  }
  {
    const hit = RECALL_WORDS.filter(w => MOM_SRC.includes(w));
    A(hit.length === 0, '反召回: mom.js 的离线池不得含"怪缺席"语式' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
  }

  console.log(failures ? ('\nFAILED: ' + failures) : '\nALL HER-SYSTEM COMPLIANCE (D-116) CHECKS PASS');
  process.exit(failures ? 1 : 0);
}
run();
