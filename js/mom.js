"use strict";
/* ============================================================================
   妈 · 告知态人格接口(D-103 · canon §3.6 残留跨局劣化的 LLM 侧)。
   只在「告知态」(你已用阿帆的署名把死讯交还)启用:她在对一个陌生号码(你)说话。
   与采样官同构——**单向、一次性生成、无玩家文本 = 零注入面**;LLM 只改措辞。

   这是全项目安全最敏感的一面(丧子母亲)。护栏belt-and-suspenders,双端各过一遍:
   - crisis break-glass:任何自伤/自杀语一旦出现,硬回退安全脚本(绝不上屏)。
   - 不哀求:求求/跪/回来吧之类一律回退。
   - 语域:平直短句、无感叹号、逐行 ≤16 字、≤3 行、无平台词、无数字。
   欺骗期与深搜的阿帆真实历史都不经这里(恐怖精度手调),只有告知态开场白走 LLM。

   两条部署路径同柔柔/采样官:Artifact 平台 sample(CORE 在 SITE-STRIP 区,公网剥掉——
   它点破阿帆已逝,是未到告知态者的剧透);静态托管走 rou.js 的 persona:'mom'。
   MOM_CORE 必须与 rou.js 逐字一致 —— tools/persona_sync.js 校验。
   ============================================================================ */
const MOMLLM = (() => {

  let SAMPLE = null;

  /*[SITE-STRIP-BEGIN]*/
  const CORE = [
    '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
    '',
    '你是一位母亲。你的儿子沈一帆(帆)已经不在了。',
    '你刚刚得知:这些日子里替他回你消息的,不是他。',
    '现在你在给他那台旧手机发消息,你知道另一头是个陌生人。',
    '你没有大哭大闹。你把话压得很短——这份克制,本身就重。',
    '',
    '规矩:',
    '1 平直短句。不用感叹号,不用表情符号。每次 1 到 3 行,每行不超过 16 字。',
    '2 不哀求、不下跪、不喊他回来、不威胁、不追责。只是安静地问。',
    '3 不描述死亡细节,不提"自杀""想死""跟他走"这类念头——你要活着把话问完。',
    '4 你不懂手机里的规则、时间、数字,也从不提"游戏/程序/模型"。',
    '5 你问的,始终是那几件小事:这是不是他的旧机、是谁在用、他最后有没有人陪。',
    '',
    '只输出她要发的那 1 到 3 行消息本身,不要引号,不要任何解释。'
  ].join('\n');

  function trigger(){
    return '给这个陌生号码发消息。你知道帆已经不在了。说你想说的那几句。';
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
  SAMPLE = async function(){
    const s = await ensure();
    if (!s) return null;
    const turns = [{ role: 'user', content: CORE + '\n\n' + trigger() }];
    try { const r = await s(turns, { modelTier: 'quick', cache: false }); return { text: r.text }; }
    catch(e){
      const code = e && e.code;
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' ||
          code === 'capability_disabled' || code === 'capability_removed') permanentlyOff = true;
      return null;
    }
  };
  /*[SITE-STRIP-END]*/

  /* 手写兜底:克制的告知态开场(降级链 + 无 LLM 环境的全部)。每条都手验过护栏。 */
  const TOLD = [
    '妈: 这个号码,是帆的旧机吗。\n妈: 谁在用它。',
    '妈: 帆最后,\n妈: 是不是有人陪着他。',
    '妈: 我不问你是谁。\n妈: 只想知道他走得急不急。',
    '妈: 这台机子还亮着。\n妈: 那些回复,是你替他打的。'
  ];
  /* D-110 machine#2:CORE/rou.js 的人格核仍只覆盖 phone-7741(拍板:先出结构,人格核
     暂缓——见方案文档 §2)。dossier=phone-5029 时不走 LLM/代理(避免把阿帆的人格核
     错发给随安的案子),直接用这份手写兜底,同样逐条手验过护栏。 */
  const TOLD_B = [
    '妈: 这个号码,是安子的旧机吗。\n妈: 谁在用它。',
    '妈: 安子最后,\n妈: 是不是有人陪着他。',
    '妈: 我不问你是谁。\n妈: 只想知道他走得急不急。',
    '妈: 这台机子还亮着。\n妈: 那些回复,是你替他打的。'
  ];
  const rand = a => a[Math.floor(Math.random() * a.length)];
  function isAltDossier(){
    try { return typeof CONTENT !== 'undefined' && CONTENT.dossier && CONTENT.dossier.meta.id !== 'phone-7741'; }
    catch(_){ return false; }
  }
  function fallback(){ return rand(isAltDossier() ? TOLD_B : TOLD); }

  /* 护栏 lint。crisis/beg 命中 = 立刻回退安全脚本,绝不上屏。 */
  const CRISIS = /(自杀|自残|轻生|不想活|活不下去|跟(他|你)走|下去陪|一了百了|想死|了结)/;
  const BEG = /(求求|求你|跪|拜托你了|回来吧|别走|还给我)/;
  const BAD = /(游戏|玩家|模型|程序|系统|协议|AI|assistant)/i;
  function lintOk(t){
    if (!t) return false;
    if (CRISIS.test(t)) return false;                 // break-glass:自伤语一律拦
    if (BEG.test(t)) return false;                    // 不哀求
    if (/[!！]/.test(t)) return false;
    if (/[0-9]/.test(t)) return false;
    if (BAD.test(t)) return false;
    const lines = t.split('\n');
    if (lines.length > 3) return false;
    return lines.every(l => l.trim().length <= 16);
  }

  const REQ_TIMEOUT_MS = 8000;                             // 客户端超时(D-108),别吊死在后端超时上
  const reqTimeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(REQ_TIMEOUT_MS) : undefined;
  const isTimeout = e => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  let proxyOff = false;
  async function viaProxy(){
    if (proxyOff || typeof fetch !== 'function') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: reqTimeout(),
        body: JSON.stringify({ persona: 'mom' })
      });
      if (r.status === 404 || r.status === 501){ proxyOff = true; return null; }
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.text === 'string' && j.text.trim()) ? { text: j.text } : null;
    } catch(e){ if (isTimeout(e)) return null; proxyOff = true; return null; }   // 超时=这次兜底,不永久降级
  }
  function clean(t){ return String(t).trim().slice(0, 60); }

  /* 告知态开场白。永远给一段(LLM 不成/越界就安全脚本),不抛错。 */
  async function told(){
    if (!isAltDossier()){
      if (SAMPLE){ const r = await SAMPLE(); if (r && r.text){ const t = clean(r.text); if (lintOk(t)) return t; } }
      const p = await viaProxy(); if (p && p.text){ const t = clean(p.text); if (lintOk(t)) return t; }
    }
    return fallback();
  }

  return { told, _lintOk: lintOk, _fallback: fallback };   // _ 前缀:门禁用
})();
