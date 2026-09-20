"use strict";
/* ============================================================================
   误触号码的陌生人 · 短信正文人格接口(D-104 块3 · canon §3.5/§3.7 的 LLM 侧)。
   只 LLM 化"发错号码"那条短信的**正文措辞**(每局不同);真/饵的**动作后果全归引擎**
   (真=相册线索不掉资源 / 饵=踩饵掉缓存涨溯源),LLM 一个数值都不碰。
   单向:玩家不往陌生人里打字(只有读/顺着查/放着)= 零注入面。

   kind:'real'(真人,想交接一件真东西)/ 'bait'(催你"把剩下的转过来"的钓鱼短信)。
   真/饵措辞刻意难分——这份不确定本身就是风险;差别只在你"顺着查"之后。
   护栏:无平台词、无具体时刻、无感叹号、≤2 行/行≤18 字、不吐自伤语;越界回退脚本。
   STRANGER_CORE 必须与 rou.js 逐字一致 —— tools/persona_sync.js 校验。
   ============================================================================ */
const STRANGERLLM = (() => {

  let SAMPLE = null;

  /*[SITE-STRIP-BEGIN]*/
  const CORE = [
    '你在扮演一条「发错号码」的短信正文。你以为在给熟人发消息,其实发到了一台失联的旧设备上。',
    '你不知道对面是谁。你的话没头没尾,像接着某个只有你们俩懂的上下文。',
    '',
    '规矩:',
    '1 平直口语,像真人随手发的短信。最多两行,每行不超过 18 字。',
    '2 不提"游戏/程序/模型/AI";不写具体时刻(几点几分)。',
    '3 你不认识对面,不要叫对方的名字,也不解释你是谁。',
    '',
    '只输出这条短信正文本身,不要引号,不要任何解释。'
  ].join('\n');

  function trigger(kind){
    return kind === 'bait'
      ? '你在催对方「把剩下的都转过来」,带着「晚了就来不及」的紧迫。像一条催款/钓鱼短信。'
      : '你要交接一件真东西——一个地点、一张照片、或一个柜子。自然地提一句,像发给老熟人。';
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
  SAMPLE = async function(kind){
    const s = await ensure();
    if (!s) return null;
    const turns = [{ role: 'user', content: CORE + '\n\n' + trigger(kind) }];
    try { const r = await s(turns, { modelTier: 'quick', cache: false }); return { text: r.text }; }
    catch(e){
      const code = e && e.code;
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' ||
          code === 'capability_disabled' || code === 'capability_removed') permanentlyOff = true;
      return null;
    }
  };
  /*[SITE-STRIP-END]*/

  /* 手写兜底(D-165 之前 = 原离线正文,与底本无关的通用两句)。
     离线/无采样权限是常态(演示站没有后端),这份兜底几乎总是真正显示的文案——
     必须按 dossier 走,不能再是套全 13 台机子的通用两句。 */
  function fallback(kind, dossierBody){ return dossierBody || (kind === 'bait' ? '在吗。就现在,把余下的\n都转过来,晚了就来不及了。' : '在吗。东西照说的放了,\n第 3 张背面,你懂的。'); }

  const BAD = /(游戏|玩家|模型|程序|AI|assistant)/i;
  const CRISIS = /(自杀|自残|轻生|不想活|想死|了结)/;
  const CLOCK = /\d{1,2}\s*[:：]\s*\d{2}/;
  function lintOk(t){
    if (!t) return false;
    if (BAD.test(t) || CRISIS.test(t)) return false;
    if (CLOCK.test(t)) return false;                   // 具体时刻可能是某局窗口真值
    if (/[!！]/.test(t)) return false;
    const lines = t.split('\n');
    if (lines.length > 2) return false;
    return lines.every(l => l.trim().length <= 18);
  }

  const REQ_TIMEOUT_MS = 8000;                             // 客户端超时(D-108),别吊死在后端超时上
  const reqTimeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(REQ_TIMEOUT_MS) : undefined;
  const isTimeout = e => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  let proxyOff = false;
  async function viaProxy(kind){
    if (proxyOff || typeof fetch !== 'function') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: reqTimeout(),
        body: JSON.stringify({ persona: 'stranger', kind: kind === 'bait' ? 'bait' : 'real' })
      });
      if (r.status === 404 || r.status === 501){ proxyOff = true; return null; }
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.text === 'string' && j.text.trim()) ? { text: j.text } : null;
    } catch(e){ if (isTimeout(e)) return null; proxyOff = true; return null; }   // 超时=这次兜底,不永久降级
  }
  function clean(t){ return String(t).trim().slice(0, 60); }

  async function msg(kind, dossierBody){
    if (SAMPLE){ const r = await SAMPLE(kind); if (r && r.text){ const t = clean(r.text); if (lintOk(t)) return t; } }
    const p = await viaProxy(kind); if (p && p.text){ const t = clean(p.text); if (lintOk(t)) return t; }
    return fallback(kind, dossierBody);
  }

  return { msg, _lintOk: lintOk, _fallback: fallback };
})();
