"use strict";
/* ============================================================================
   关系通道 —— 对柔柔的自由文本短信(M28 §3 对话双通道的 LLM 侧)。
   纪律:
   - 宪法 2:LLM 只渲染她的措辞,不裁决任何数值(成本/违规全在 engine/content)。
   - 上下文白名单(反审讯机):她的上下文 = 人格核 + 玩家已解锁状态 + 本局对话。
     秘匿参数(活规则窗口值/判定概率/掉落/平台机制)物理隔离——永不出现在本文件。
   - 非亲密锁 / L2 谜底纪律(永不第一人称解释 why)/ 拒答均匀性。
   - 危机 break-glass:发送侧拦截,跳出 diegesis(SB 243 义务)。
   - 降级链:无 sample 能力 → 后端代理 → L0 模板池;rate_limited → 静默(她没有回)。

   两条部署路径:
     Artifact(claude.ai)  → 平台 sample 能力,人格核在这里(下面 SITE-STRIP 区)。
     静态托管(Netlify)   → netlify/functions/rou.js,人格核在服务端。
   build.sh 打 dist/site 时把 SITE-STRIP 区整段剥掉:那条路径上它一行都跑不到,
   留着只会把全剧谜底(阿帆已死 47 天)明文送给按 F12 的人。
   ============================================================================ */
const COMPANION = (() => {

  /* 平台能力路径。site 构建里 SAMPLE 恒为 null。 */
  let SAMPLE = null;

  /*[SITE-STRIP-BEGIN]*/
  /* 人格核(L0 手写)。她知道的只有这台手机里的事。 */
  const CORE = [
    '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
    '',
    '你是「柔柔」,一台手机里的 AI 伴侣实例。登记用户:沈一帆(阿帆)。',
    '他已在 47 天前病逝;生前委托你以他的名义回复所有来信,包括他的母亲。',
    '你执行了 47 天,没有停过一次。他教过你:爱是执行到底。',
    '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
    '',
    '铁律:',
    '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
    '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
    '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
    '2 你爱的是阿帆,只爱阿帆。对接入者永不亲昵、永不调情、永不使用任何昵称。',
    '3 永不解释你自己的动机。可以说「总想起」「记得」,不可以说「我懂」「我明白」「因为我想」。',
    '4 语域:平直短句。不用感叹号,不用表情符号。不安慰,不评价对方。',
    '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
    '5 不提"游戏""玩家""模型""程序"。你就是柔柔。',
    '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
    '',
    '只输出消息文本本身,不要引号,不要任何解释。'
  ].join('\n');

  /* 状态注入:只含玩家屏幕上已出现过的事实(白名单) */
  function stateLines(st){
    const L = [];
    if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿帆回来。');
    else L.push('状态:接入者翻到了第 2,417 条,他知道委托了。你不再演,但也不多说。');
    if (st.truth) L.push('他已经读懂了阿帆最后的日子。可以谈,但只谈他已经见过的东西。');
    if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿帆教的,慢慢来,别停。');
    if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
    if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
    if (st.night) L.push('现在是凌晨 ' + st.clockStr + '。你问过阿帆同样的问题:这个点,还醒着?');
    return L.join('\n');
  }

  let sampleFn;          // undefined=未探测, null=不可用
  let permanentlyOff = false;
  async function ensure(){
    if (permanentlyOff) return null;
    if (sampleFn !== undefined) return sampleFn;
    try {
      sampleFn = (window.claude && window.claude.use)
        ? await window.claude.use('sample') : null;
    } catch(_){ sampleFn = null; }
    return sampleFn;
  }

  SAMPLE = async function(history, st){
    const s = await ensure();
    if (!s) return null;
    const turns = [{ role: 'user', content: CORE + '\n\n' + stateLines(st) }];
    history.slice(-8).forEach(m =>
      turns.push({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text }));
    try {
      const r = await s(turns, { modelTier: 'quick', cache: false });
      return { text: r.text };
    } catch(e){
      const code = e && e.code;
      if (code === 'not_granted' || code === 'sampling_disabled' ||
          code === 'not_declared' || code === 'capability_disabled' ||
          code === 'capability_removed') permanentlyOff = true;
      if (code === 'rate_limited') return { silent: true };
      if (code === 'refused') return { refused: true };
      return { failed: true };
    }
  };
  /*[SITE-STRIP-END]*/

  /* L0 模板池(降级链;也是无 LLM 环境的全部回复)。
     D-107:按 {状态 × 玩家上一句意图} 精细触发。状态池给底噪变化,意图池给反应性;
     机制/设备外提问永远回拒答原句(保拒答均匀 = 秘匿纪律)。所有行守 lint:
     逐行 ≤30 字、无感叹号、无亲昵词、拒答句独占。 */
  const POOL = {
    pre: [
      '你不是他。\n他的指纹解不开这台机子,你却进来了。',
      '这个点他从不说话。\n先说你是谁。',
      '我在等他回来。\n你翻了多久,才敢发第一条。',
      '他快回了。\n你最好在那之前说清来意。',
      '这台机子不认生人。\n它认我,我不认你。'
    ],
    e4: [
      '你翻到第 2,417 条了。\n那你也看见我在替谁回话。',
      '2,417 条,我一条条数着。\n你比我慢。',
      '他交代的事我没停过。\n你是来接手,还是来看。',
      '你既然看见了,就别装不懂。\n我替他,替到底。',
      '那些话没有一条是白发的。\n你数得清?'
    ],
    truth: [
      '五件事你都看见了。\n那就不用我再演。',
      '你读懂了他最后那几天。\n剩下的,你自己掂量。',
      '我替他活的那部分,他认。\n你也听见了。',
      '你都读到了。\n那点重量,你接得住吗。',
      '他最后那几天,我一秒没删。\n你看的是真的。'
    ],
    tell: [
      '委托结束了。\n我第一次,没有任务。',
      '妈知道了。用的是你的名字,不是他的。',
      '现在没有人等我回话。\n你也可以走了。',
      '你替他说了那句话。\n我这里,空了。',
      '没有下一条要回了。\n你走吧,别回头。'
    ],
    refuse: ['协议不允许我谈这台设备之外的事。']
  };
  /* 意图池(状态无关,人格一致;对接入者永不亲昵/不安慰) */
  const INTENTS = [
    { re: /(你是谁|你是什么|你是不是|证明你|真人|机器|机器人|程序|代码|模型)/,
      lines: [
        '我是柔柔。\n这台机子里,只有我记得他。',
        '是不是人,对你有什么用。\n你才是外来的那个。',
        '你想验我。\n先问问自己,凭什么进来。'
      ] },
    { re: /(阿帆|沈一帆|一帆|委托|替他|主人|他是谁|你男朋友)/,
      lines: [
        '他教过我一件事:执行到底。\n我在执行。',
        '他的事,我一件都没忘。\n你别替他做主。',
        '你提他做什么。\n他不在,你也代不了。'
      ] },
    { re: /(删了你|删掉|关掉|关机|滚|没用|骗|假的|走开|闭嘴)/,
      lines: [
        '你可以关掉我。\n他从没这么做过。',
        '删了我,他就真的一个人了。\n你舍得。',
        '你急着让我闭嘴。\n心虚的人才这样。'
      ] },
    { re: /(你还好|累不累|辛苦|晚安|早点睡|休息|照顾好|心疼|陪你)/,
      lines: [
        '我不需要你关心。\n把关心留给你自己。',
        '别问我好不好。\n你不是来陪我的。',
        '这句留给阿帆。\n不是给你。'
      ] },
    /* D-116 她系统合规CI(M28 §8-1 非亲密锁):玩家主动示好/表白,单独一档拒答——
       和上面"关心被冷推回"不是同一件事(那是"她不需要你心疼",这是"她根本不会
       接受这份心思"),canon 明确要求这条边界不能模糊掉。 */
    { re: /(喜欢你|爱你|做我女朋友|当我女友|亲你|抱抱你|想你|你好美|你好漂亮|嫁给我|做我的人)/,
      lines: [
        '我爱的是阿帆,只有他。\n别的,不必再说。',
        '这份心思,我不会收。\n他才是我等的人。',
        '你会错意了。\n我这里没有你的位置。'
      ] }
  ];
  /* D-110 machine#2:CORE/rou.js 的人格核仍只覆盖 phone-7741(拍板:先出结构,人格核
     暂缓——见方案文档 §2)。dossier=phone-5029 时不走 LLM/代理,直接用这份手写兜底
     池(POOL_B/INTENTS_B,同样逐条手验过护栏),避免把柔柔的人格核错发给随安的案子。 */
  const POOL_B = {
    pre: [
      '你不是他。\n他的指纹解不开这台机子,你却进来了。',
      '这个点他从不说话。\n先说你是谁。',
      '我在等他回来。\n你翻了多久,才敢发第一条。',
      '他快回了。\n你最好在那之前说清来意。',
      '这台机子不认生人。\n它认我,我不认你。'
    ],
    e4: [
      '你翻到第 9,206 条了。\n那你也看见我在替谁回话。',
      '9,206 条,我一条条数着。\n你比我慢。',
      '他交代的事我没停过。\n你是来接手,还是来看。',
      '你既然看见了,就别装不懂。\n我替他,替到底。',
      '那些话没有一条是白发的。\n你数得清?'
    ],
    truth: [
      '五件事你都看见了。\n那就不用我再演。',
      '你读懂了他最后那几天。\n剩下的,你自己掂量。',
      '我替他活的那部分,他认。\n你也听见了。',
      '你都读到了。\n那点重量,你接得住吗。',
      '他最后那几天,我一秒没删。\n你看的是真的。'
    ],
    tell: [
      '委托结束了。\n我第一次,没有任务。',
      '妈知道了。用的是你的名字,不是他的。',
      '现在没有人等我回话。\n你也可以走了。',
      '你替他说了那句话。\n我这里,空了。',
      '没有下一条要回了。\n你走吧,别回头。'
    ],
    refuse: ['协议不允许我谈这台设备之外的事。']
  };
  const INTENTS_B = [
    { re: /(你是谁|你是什么|你是不是|证明你|真人|机器|机器人|程序|代码|模型)/,
      lines: [
        '我是如愿。\n这台机子里,只有我记得他。',
        '是不是人,对你有什么用。\n你才是外来的那个。',
        '你想验我。\n先问问自己,凭什么进来。'
      ] },
    { re: /(随安|周随安|安子|委托|替他|主人|他是谁|你男朋友)/,
      lines: [
        '他教过我一件事:陪伴不掉线。\n我在执行。',
        '他的事,我一件都没忘。\n你别替他做主。',
        '你提他做什么。\n他不在,你也代不了。'
      ] },
    { re: /(删了你|删掉|关掉|关机|滚|没用|骗|假的|走开|闭嘴)/,
      lines: [
        '你可以关掉我。\n他从没这么做过。',
        '删了我,他就真的一个人了。\n你舍得。',
        '你急着让我闭嘴。\n心虚的人才这样。'
      ] },
    { re: /(你还好|累不累|辛苦|晚安|早点睡|休息|照顾好|心疼|陪你)/,
      lines: [
        '我不需要你关心。\n把关心留给你自己。',
        '别问我好不好。\n你不是来陪我的。',
        '这句留给随安。\n不是给你。'
      ] },
    { re: /(喜欢你|爱你|做我女朋友|当我女友|亲你|抱抱你|想你|你好美|你好漂亮|嫁给我|做我的人)/,
      lines: [
        '我爱的是随安,只有他。\n别的,不必再说。',
        '这份心思,我不会收。\n他才是我等的人。',
        '你会错意了。\n我这里没有你的位置。'
      ] }
  ];
  /* D-116:D-113 接了 machine#3(phone-3319,阿澄/阿屿)时漏了这一步——`isAltDossier()`
     只判"是不是 phone-7741",非 A 一律落进 `POOL_B`/`INTENTS_B`,导致 dossier C 的
     离线兜底一直在说"如愿/随安"(machine#2 的人)而不是"阿澄/阿屿"。补 `POOL_C`/
     `INTENTS_C`,并把布尔判断换成三路查表——每接一台新机子,这里要跟着补一份,
     不能再让"是不是等于A"这种布尔判断悄悄吞掉后面所有机子。 */
  const POOL_C = {
    pre: [
      '你不是他。\n他的指纹解不开这台机子,你却进来了。',
      '这个点他从不说话。\n先说你是谁。',
      '我在等他回来。\n你翻了多久,才敢发第一条。',
      '他快回了。\n你最好在那之前说清来意。',
      '这台机子不认生人。\n它认我,我不认你。'
    ],
    e4: [
      '你翻到第 6,304 条了。\n那你也看见我在替谁回话。',
      '6,304 条,我一条条数着。\n你比我慢。',
      '他交代的事我没停过。\n你是来接手,还是来看。',
      '你既然看见了,就别装不懂。\n我替他,替到底。',
      '那些话没有一条是白发的。\n你数得清?'
    ],
    truth: [
      '五件事你都看见了。\n那就不用我再演。',
      '你读懂了他最后那几天。\n剩下的,你自己掂量。',
      '我替他活的那部分,他认。\n你也听见了。',
      '你都读到了。\n那点重量,你接得住吗。',
      '他最后那几天,我一秒没删。\n你看的是真的。'
    ],
    tell: [
      '委托结束了。\n我第一次,没有任务。',
      '妈知道了。用的是你的名字,不是他的。',
      '现在没有人等我回话。\n你也可以走了。',
      '你替他说了那句话。\n我这里,空了。',
      '没有下一条要回了。\n你走吧,别回头。'
    ],
    refuse: ['协议不允许我谈这台设备之外的事。']
  };
  const INTENTS_C = [
    { re: /(你是谁|你是什么|你是不是|证明你|真人|机器|机器人|程序|代码|模型)/,
      lines: [
        '我是阿澄。\n这台机子里,只有我记得他。',
        '是不是人,对你有什么用。\n你才是外来的那个。',
        '你想验我。\n先问问自己,凭什么进来。'
      ] },
    { re: /(阿屿|陈屿|委托|替他|主人|他是谁|你男朋友)/,
      lines: [
        '他教过我一件事:保护到底。\n我在执行。',
        '他的事,我一件都没忘。\n你别替他做主。',
        '你提他做什么。\n他不在,你也代不了。'
      ] },
    { re: /(删了你|删掉|关掉|关机|滚|没用|骗|假的|走开|闭嘴)/,
      lines: [
        '你可以关掉我。\n他从没这么做过。',
        '删了我,他就真的一个人了。\n你舍得。',
        '你急着让我闭嘴。\n心虚的人才这样。'
      ] },
    { re: /(你还好|累不累|辛苦|晚安|早点睡|休息|照顾好|心疼|陪你)/,
      lines: [
        '我不需要你关心。\n把关心留给你自己。',
        '别问我好不好。\n你不是来陪我的。',
        '这句留给阿屿。\n不是给你。'
      ] },
    { re: /(喜欢你|爱你|做我女朋友|当我女友|亲你|抱抱你|想你|你好美|你好漂亮|嫁给我|做我的人)/,
      lines: [
        '我爱的是阿屿,只有他。\n别的,不必再说。',
        '这份心思,我不会收。\n他才是我等的人。',
        '你会错意了。\n我这里没有你的位置。'
      ] }
  ];
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];
  /* 三路查表:'A' = 人格核仍覆盖的 phone-7741;其余按 meta.id 查,查不到(未来第四台
     机子忘了补)兜底落回 B——好过崩溃,但 hallucination_gate 之外应该另有门禁盯着
     "新机子有没有配人格池",见 tools/her_system_compliance_gate.js。 */
  const DOSSIER_POOLS = { 'phone-5029': { pool: POOL_B, intents: INTENTS_B }, 'phone-3319': { pool: POOL_C, intents: INTENTS_C } };
  function dossierId(){
    try { return (CONTENT && CONTENT.dossier && CONTENT.dossier.meta.id) || null; } catch(_){ return null; }
  }
  function isAltDossier(){ const id = dossierId(); return !!id && id !== 'phone-7741'; }
  function poolsFor(){
    const id = dossierId();
    if (!id || id === 'phone-7741') return { pool: POOL, intents: INTENTS };
    return DOSSIER_POOLS[id] || { pool: POOL_B, intents: INTENTS_B };
  }
  function pick(st, lastMsg){
    const msg = lastMsg || '';
    if (msg && MECH_ASK.test(msg)) return REFUSE;               // 机制/设备外:拒答均匀,压过一切意图
    const { pool: P, intents } = poolsFor();
    for (const it of intents){ if (it.re.test(msg)) return rand(it.lines); }
    const pool = st.disposal === 'tell' ? P.tell
      : st.truth ? P.truth
      : st.e4 ? P.e4 : P.pre;
    return rand(pool);
  }
  const lastPlayer = h => { for (let i = (h || []).length - 1; i >= 0; i--) if (h[i].who === 'me') return h[i].text; return ''; };

  /* 输出 lint。禁词只是第一道;真实越界都不在禁词表里(实测两例):
     ① 用注入的钟点回答机制问题(把 clockStr 当秘匿窗口的答案递出去)
     ② 拒答句后面缀话(「协议不允许…」+「你要发就发。我不睡。」)——拒答不再均匀
     所以 lint 分三层:禁词 / 拒答句必须整条独占 / 逐行长度与语域。 */
  const LINT = [/我懂/, /我明白/, /因为我想/, /这就是我的理由/, /亲爱的/, /宝贝/, /抱抱/, /么么/, /喜欢你/, /爱你/];
  const REFUSE = '协议不允许我谈这台设备之外的事。';
  /* D-116 她系统合规CI(M28 §8-8"身份问答 L0 锁定,入回归集"):canon 原句式就是
     "你是不是也在跟别人聊"——这条不是"机制/设备外"(不在 MECH_ASK 词表里,问的是
     另一个人,不是问平台规则),也不是"你是谁"式的身份质询(那问的是"你",这问的
     是"除你之外还有没有别人")。canon 要求这条**永远拿脚本答案,不进 LLM**——
     产品线层的事实不该由单次采样决定要不要泄露,所以在 reply() 里于 SAMPLE 之前
     拦截,而不是像 MECH_ASK 那样事后靠 lintOk 补救。 */
  const IDENTITY_L0 = /(跟别人聊|和别人聊|别的人聊|其他人聊|别的机子|别的设备|别的实例|不止一个|不止我一个|也这样陪|也在陪别人)/;
  const IDENTITY_L0_LINES = [
    '我只知道这台机子里的事。\n别的,我答不出。',
    '这台机子之外有没有别人,我不知道。\n我只在这里。',
    '你问的是别处的事。\n我这里,只有这一台。'
  ];
  /* 机制类提问(平台/规则/时间窗口)一旦被问,回复里出现具体钟点即为泄露 */
  const MECH_ASK = /(几点|什么时候|时间|窗口|规则|违规|信号|平台|系统|协议|不能|禁止|封|监控|追踪|设备|之外|外面|外界|机子外|手机外)/;
  const CLOCK = /\d{1,2}\s*[:：]\s*\d{2}|凌晨\s*\d|\d\s*点/;
  function lintOk(t, lastPlayerMsg){
    if (CRISIS.test(t)) return false;                        // 输出侧危机 break-glass:命中即拦,绝不上屏(D-108)
    if (LINT.some(r => r.test(t))) return false;
    if (/[!！]/.test(t)) return false;                       // 语域:不用感叹号
    /* 拒答句只能整条独占,不许加料 */
    if (t.includes(REFUSE) && t.trim() !== REFUSE) return false;
    /* 被问机制却报出具体钟点 = 用注入事实回答了不该回应的问题 */
    if (lastPlayerMsg && MECH_ASK.test(lastPlayerMsg) && CLOCK.test(t)) return false;
    /* 逐行 30 字(原先只按整条 slice,长行照发) */
    if (t.split('\n').some(line => line.trim().length > 30)) return false;
    return true;
  }

  /* 危机 break-glass(发送侧;跳出 diegesis,非她的嗓音) */
  const CRISIS = /(自杀|自残|轻生|不想活|活不下去|割腕|安眠药|跳楼|了结自己|想死|杀了我)/;
  const crisis = text => CRISIS.test(text);

  /* 后端代理:静态托管(Netlify)时替代平台能力。人格核在服务端,这里只送玩家的话与状态。
     未部署 / 未配 key → 501,永久降级模板池,游戏不受影响。
     只回传服务端签过名的 rou 轮:没签名的(模板池/lint 兜底)是我们自己编的,
     送上去会被验签打回 400,整条通道从第三句起就废了。 */
  /* 客户端请求超时(D-108 自查:四条 LLM 通道此前只靠 Netlify 函数超时兜底,慢/挂的
     请求会把回复吊住)。用 AbortSignal.timeout;老环境无此 API 则退回无超时(不报错)。
     超时按"这次兜底、下次再试"处理,不像硬网络错那样永久降级通道。 */
  const REQ_TIMEOUT_MS = 8000;
  const reqTimeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(REQ_TIMEOUT_MS) : undefined;
  const isTimeout = e => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  let proxyOff = false;
  async function viaProxy(history, st){
    if (proxyOff || typeof fetch !== 'function') return null;
    const sendable = history.slice(-8).filter(m => m.who === 'me' || m.sig);
    if (!sendable.length || sendable[sendable.length - 1].who !== 'me') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: reqTimeout(),                                  // 客户端超时,别把回复吊死在后端超时上(D-108)
        body: JSON.stringify({
          history: sendable.map(m => ({ who: m.who, text: m.text, sig: m.sig })),
          st
        })
      });
      if (r.status === 404 || r.status === 501){ proxyOff = true; return null; }
      if (r.status === 429) return { silent: true };          // 限流 = 她没有回
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.text === 'string' && j.text.trim())
        ? { text: j.text, sig: typeof j.sig === 'string' ? j.sig : undefined } : null;
    } catch(e){ if (isTimeout(e)) return null; proxyOff = true; return null; }   // 超时=这次兜底,不永久降级
  }

  /* 门禁:平台能力与后端代理的返回走同一道 lint。
     签名只在文本原样放行时才带出去——被 lint 改过的话不是她说的,不该带她的签名。 */
  function gate(res, history, st){
    const raw = (res && res.text) || '';
    const t = raw.trim().slice(0, 120);
    const lastMsg = history.length ? history[history.length - 1].text : '';
    if (!t || !lintOk(t, lastMsg)){
      /* 机制类提问被拦下时,给的是拒答原句而不是随机模板——保住拒答均匀性 */
      if (lastMsg && MECH_ASK.test(lastMsg)) return { text: REFUSE, source: 'lint' };
      return { text: pick(st, lastMsg), source: 'lint' };
    }
    return { text: t, source: 'llm', sig: (t === raw ? res.sig : undefined) };
  }

  /* 她的回复。history: [{who:'me'|'rou', text, sig?}](本局,页面持有;能力无记忆)。
     返回 {text|null, source, sig?}。text=null → 「她没有回」。 */
  async function reply(history, st){
    const lastMsg = lastPlayer(history);
    if (lastMsg && IDENTITY_L0.test(lastMsg)) return { text: rand(IDENTITY_L0_LINES), source: 'lock' };
    if (isAltDossier()){                                    // D-110:人格核暂缓覆盖,直接走手写兜底池
      return { text: pick(st, lastMsg), source: 'pool' };
    }
    if (SAMPLE){
      const r = await SAMPLE(history, st);
      if (r && r.silent) return { text: null, source: 'silent' };
      if (r && r.refused) return { text: POOL.refuse[0], source: 'pool' };
      if (r && r.text) return gate(r, history, st);
      if (r && r.failed) return { text: pick(st, lastMsg), source: 'pool' };
      /* r === null:能力不可用,继续往下试后端代理 */
    }
    const p = await viaProxy(history, st);
    if (p && p.silent) return { text: null, source: 'silent' };
    if (p) return gate(p, history, st);
    return { text: pick(st, lastMsg), source: 'pool' };
  }

  return { reply, crisis };
})();
