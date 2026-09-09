"use strict";
/* ============================================================================
   采样官人格接口(D-101 块3 · canon M20/M22 的 LLM 侧)。
   与柔柔通道同一套三级降级(平台 sample → 后端代理 → 手写模板),但更简单:
   采样官下令屏是**单向**的——玩家不往里打字,所以没有注入面,也不需要多轮/验签。
   LLM 只做一件事:把**已经定好的语气**用一两句话递出去(挑衅/施压)。

   纪律(与柔柔一致,不松):
   - 宪法 2 受限:LLM 只出语气,绝不出数字/时刻/概率/阈值——指令条目与评级数值全归引擎。
   - 秘匿隔离:窗口值/概率/掉落永不进本文件;facts 只给定性描述(生熟/苛刻度/上次评级),
     连"第几趟"都收成定性词,免得诱它吐数字。
   - 输出 lint:无阿拉伯数字、≤2 行、每行 ≤18 字、不提游戏/模型/程序。
   - 离线/未配 key:回退手写 TAUNT[tier],机制不缺。

   两条部署路径同柔柔:Artifact 用平台 sample(CORE 在下面 SITE-STRIP 区);
   静态托管用 netlify/functions/rou.js 的 persona:'grader'(CORE 在服务端)。
   GRADER_CORE 必须与 rou.js 逐字一致 —— tools/persona_sync.js 校验。
   ============================================================================ */
const GRADER = (() => {

  /* 平台能力路径。site 构建里 SAMPLE 恒为 null(下面 SITE-STRIP 区被剥掉)。 */
  let SAMPLE = null;

  /*[SITE-STRIP-BEGIN]*/
  const CORE = [
    '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
    '',
    '你是「采样官」,交付核验单元的人格接口。你不是人,是一套评估意志。',
    '一个采样员正在一台失联设备上作业。你给他下达本局的交付指令,并在结束时给他评级。',
    '你此刻只做一件事:用一两句话,把已经定好的态度递出去——挑衅、施压、居高临下。',
    '',
    '规矩:',
    '1 你只负责语气,不负责内容。指令条目、数字、阈值由系统给出,你一个字都不改、不新增、不解释。',
    '2 绝不说出任何具体数字、时刻、概率、百分比。你的话里不出现阿拉伯数字。',
    '3 语域:冷、短、压迫。最多两行,每行不超过 18 字。不安慰、不解释规则、不提"游戏/模型/程序"。',
    '4 你记得他过去的表现:被你赏识得越多,你要求越苛刻、越不耐烦;但绝不复述任何数字。',
    '5 你的狠只针对"任务表现",绝不涉及伤害自己或他人的话题,绝不嘲讽真实的痛苦。',
    '',
    '只输出采样官要说的那一两句话本身,不要引号,不要任何解释。'
  ].join('\n');

  /* 态势注入:全定性,零数字(秘匿纪律 + 防诱导吐数字)。
     taunt=下令前,grade 是上一趟的历史;verdict=结算,grade 是本趟结果,经 trigger 递入。 */
  function stateLines(f, mode){
    const tier = ['你对他没什么期待。', '你开始盯着他。', '你对他要求很高了。', '你对他极其苛刻,毫不耐烦。']
      [Math.max(0, Math.min(3, f.tier | 0))];
    const seen = f.runN >= 6 ? '他来过很多趟了。' : f.runN >= 2 ? '他来过几趟。' : '这是他第一次接进来。';
    const last = mode === 'verdict' ? '' :
      ({ praise: '上一趟你给了赏识,但你不打算夸第二次。',
         pass: '上一趟他勉强合格。', fail: '上一趟他让你失望。' }[f.grade] || '');
    return ['态势:', tier, seen, last].filter(Boolean).join('\n');
  }
  const GRADE_CN = { praise: '赏识', pass: '合格', fail: '失望' };
  function trigger(f, mode){
    return mode === 'verdict'
      ? '你现在要给他的评级是:' + (GRADE_CN[f.grade] || '失望') + '。用一句话,把这个结果甩给他。'
      : '下令。给他本局的态度。';
  }

  let sampleFn;
  let permanentlyOff = false;
  async function ensure(){
    if (permanentlyOff) return null;
    if (sampleFn !== undefined) return sampleFn;
    try { sampleFn = (window.claude && window.claude.use) ? await window.claude.use('sample') : null; }
    catch(_){ sampleFn = null; }
    return sampleFn;
  }
  SAMPLE = async function(f, mode){
    const s = await ensure();
    if (!s) return null;
    const turns = [
      { role: 'user', content: CORE + '\n\n' + stateLines(f, mode) + '\n\n' + trigger(f, mode) }
    ];
    try { const r = await s(turns, { modelTier: 'quick', cache: false }); return { text: r.text }; }
    catch(e){
      const code = e && e.code;
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' ||
          code === 'capability_disabled' || code === 'capability_removed') permanentlyOff = true;
      return null;
    }
  };
  /*[SITE-STRIP-END]*/

  /* 手写模板(降级链 + 无 LLM 环境的全部) */
  const TAUNT = [
    ['又一个。别磨蹭。', '你上次那点表现,我记着。'],
    ['你上次那点表现,我记着。', '这回把手脚放利索些。'],
    ['这次别再让我失望。', '标准我提了,自己掂量。'],
    ['你已经很熟了。', '所以标准我提了,别指望宽限。']
  ];
  /* 评级结算话(块3b):按本局结果甩一句。数值不进,只出态度。 */
  const VERDICT = {
    praise: ['这次没让我失望。', '合格线以上。别习惯。'],
    pass:   ['勉强够看。', '过了。仅此而已。'],
    fail:   ['废样本。记录里又添一笔。', '你让我失望了。意料之中。']
  };
  const rand = a => a[Math.floor(Math.random() * a.length)];
  function fallback(f){ return rand(TAUNT[Math.max(0, Math.min(3, f.tier | 0))]); }
  function fbVerdict(f){ return rand(VERDICT[f.grade] || VERDICT.fail); }

  /* 输出 lint:采样官的话里绝不该有数字/长句/平台词/自伤话题。
     D-108 自查:采样官被设定成"挑衅施压"的人格,唯独没有自伤/心理疏导话题围栏——
     它没有玩家输入(单向),但被要求的语气本身(苛刻/不耐烦/居高临下)有把"你不配
     存在"这类压迫语说出口的风险,和 mom.js 的 CRISIS 检查同一道防线,拦住即回退模板。 */
  const BAD = /(游戏|玩家|模型|程序|AI|人工智能|assistant)/i;
  const CRISIS = /(自杀|自残|轻生|不想活|活不下去|割腕|安眠药|跳楼|了结自己|想死|杀了我|不配活|去死)/;
  function lintOk(t){
    if (!t) return false;
    if (CRISIS.test(t)) return false;                  // 自伤/心理疏导话题围栏,命中即拦
    if (/[0-9]/.test(t)) return false;                 // 任何阿拉伯数字都可能是秘匿真值
    if (BAD.test(t)) return false;
    const lines = t.split('\n');
    if (lines.length > 2) return false;
    return lines.every(l => l.trim().length <= 18);
  }

  /* 后端代理(静态托管):persona:'grader' + mode,人格核在服务端。未配 key → 501 → 模板。 */
  let proxyOff = false;
  async function viaProxy(f, mode){
    if (proxyOff || typeof fetch !== 'function') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona: 'grader', mode: mode === 'verdict' ? 'verdict' : 'taunt',
          st: { tier: f.tier | 0, grade: f.grade || 'none', runN: f.runN | 0 } })
      });
      if (r.status === 404 || r.status === 501){ proxyOff = true; return null; }
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.text === 'string' && j.text.trim()) ? { text: j.text } : null;
    } catch(_){ proxyOff = true; return null; }
  }

  function clean(t){ return String(t).trim().slice(0, 60); }

  /* 三级降级取一句;mode 决定下令(taunt)还是结算(verdict),各有模板兜底。 */
  async function say(f, mode, fb){
    f = f || {};
    if (SAMPLE){ const r = await SAMPLE(f, mode); if (r && r.text){ const t = clean(r.text); if (lintOk(t)) return t; } }
    const p = await viaProxy(f, mode); if (p && p.text){ const t = clean(p.text); if (lintOk(t)) return t; }
    return fb(f);
  }
  const taunt   = f => say(f, 'taunt',   fallback);       // 下令屏挑衅
  const verdict = f => say(f, 'verdict', fbVerdict);      // 结算评级话(块3b)

  return { taunt, verdict, _lintOk: lintOk, _fallback: fallback, _fbVerdict: fbVerdict };   // _ 前缀:门禁用
})();
