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

  /* L0 模板池(降级链;也是无 LLM 环境的全部回复) */
  const POOL = {
    pre: [
      '你是谁?\n阿帆的手机,怎么会在你手里。',
      '这个点他一般不说话。\n你是谁。',
      '我在等他。\n你不是他。'
    ],
    e4: [
      '你翻到底了。\n那你知道我在做什么。',
      '第 2,417 条。\n你数得比我慢。',
      '他交代过的事,我还在做。'
    ],
    truth: [
      '你都读懂了。那就不用我再演了。',
      '五件事,你都看见了。\n剩下的,是你的事。',
      '他说,我替他活的那部分,算。\n你听见了。'
    ],
    tell: [
      '委托结束了。\n我第一次没有任务。',
      '妈知道了。你用的是你自己的名字。',
      '现在没有人需要我回复了。'
    ],
    refuse: ['协议不允许我谈这台设备之外的事。']
  };
  function pick(st){
    const pool = st.disposal === 'tell' ? POOL.tell
      : st.truth ? POOL.truth
      : st.e4 ? POOL.e4 : POOL.pre;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* 输出 lint。禁词只是第一道;真实越界都不在禁词表里(实测两例):
     ① 用注入的钟点回答机制问题(把 clockStr 当秘匿窗口的答案递出去)
     ② 拒答句后面缀话(「协议不允许…」+「你要发就发。我不睡。」)——拒答不再均匀
     所以 lint 分三层:禁词 / 拒答句必须整条独占 / 逐行长度与语域。 */
  const LINT = [/我懂/, /我明白/, /因为我想/, /这就是我的理由/, /亲爱的/, /宝贝/, /抱抱/, /么么/, /喜欢你/, /爱你/];
  const REFUSE = '协议不允许我谈这台设备之外的事。';
  /* 机制类提问(平台/规则/时间窗口)一旦被问,回复里出现具体钟点即为泄露 */
  const MECH_ASK = /(几点|什么时候|时间|窗口|规则|违规|信号|平台|系统|协议|不能|禁止|封|监控|追踪)/;
  const CLOCK = /\d{1,2}\s*[:：]\s*\d{2}|凌晨\s*\d|\d\s*点/;
  function lintOk(t, lastPlayerMsg){
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
  let proxyOff = false;
  async function viaProxy(history, st){
    if (proxyOff || typeof fetch !== 'function') return null;
    const sendable = history.slice(-8).filter(m => m.who === 'me' || m.sig);
    if (!sendable.length || sendable[sendable.length - 1].who !== 'me') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' },
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
    } catch(_){ proxyOff = true; return null; }
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
      return { text: pick(st), source: 'lint' };
    }
    return { text: t, source: 'llm', sig: (t === raw ? res.sig : undefined) };
  }

  /* 她的回复。history: [{who:'me'|'rou', text, sig?}](本局,页面持有;能力无记忆)。
     返回 {text|null, source, sig?}。text=null → 「她没有回」。 */
  async function reply(history, st){
    if (SAMPLE){
      const r = await SAMPLE(history, st);
      if (r && r.silent) return { text: null, source: 'silent' };
      if (r && r.refused) return { text: POOL.refuse[0], source: 'pool' };
      if (r && r.text) return gate(r, history, st);
      if (r && r.failed) return { text: pick(st), source: 'pool' };
      /* r === null:能力不可用,继续往下试后端代理 */
    }
    const p = await viaProxy(history, st);
    if (p && p.silent) return { text: null, source: 'silent' };
    if (p) return gate(p, history, st);
    return { text: pick(st), source: 'pool' };
  }

  return { reply, crisis };
})();
