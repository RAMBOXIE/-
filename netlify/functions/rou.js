/* ============================================================================
   关系通道后端代理 —— 静态托管(Netlify)部署时替代 Artifact 的 sample 能力。
   与 js/companion.js 的差别只有"谁去调模型",纪律完全一致:

   - 人格核与状态注入**在服务端**,客户端只能传玩家消息与状态标志。
     即使公开链接被扒,也只能让「柔柔」说话,不能把 key 当通用 API 用。
   - 上下文白名单照旧:秘匿参数(窗口值/概率/掉落)永不出现在本文件。
   - 输出 lint 在客户端仍要再过一遍(companion.js),这里只做长度与格式兜底。
   - 限流:每 IP 每小时 30 次(局内 3 条/局,够玩 10 局)+ 全站每天 2000 次。
     serverless 实例复用期间生效,挡的是突发刷量;不是账务级配额。

   CORE 必须与 js/companion.js 逐字一致 —— tools/persona_sync.js 会校验。
   ============================================================================ */
'use strict';

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
  if (st.night) L.push('现在是凌晨 ' + String(st.clockStr || '').slice(0, 5) + '。你问过阿帆同样的问题:这个点,还醒着?');
  return L.join('\n');
}

/* ---- 限流(实例内存;serverless 复用期间有效) ---- */
const IP_HITS = new Map();
const IP_WINDOW_MS = 3600e3, IP_MAX = 30;
const DAY_MAX = 2000;
let dayCount = 0, dayStart = Date.now();

function rateLimited(ip){
  const now = Date.now();
  if (now - dayStart > 864e5){ dayStart = now; dayCount = 0; }
  if (dayCount >= DAY_MAX) return 'day';
  const hits = (IP_HITS.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX) return 'ip';
  hits.push(now);
  IP_HITS.set(ip, hits);
  if (IP_HITS.size > 5000) IP_HITS.clear();      // 防内存无限增长
  return null;
}

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(obj)
});

exports.handler = async function(event){
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(501, { error: 'not_configured' });   // 客户端据此永久降级模板池

  const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] ||
                                event.headers['client-ip'] || event.headers['x-forwarded-for'])) || 'unknown';
  const limited = rateLimited(String(ip).split(',')[0].trim());
  if (limited) return json(429, { error: 'rate_limited', scope: limited });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(_){ return json(400, { error: 'bad_json' }); }

  /* 客户端只能传这两样:玩家消息历史 + 状态标志。人格核不接受传入。 */
  const raw = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const st = (body.st && typeof body.st === 'object') ? body.st : {};
  if (!raw.length) return json(400, { error: 'empty_history' });
  for (const m of raw){
    if (!m || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 200)
      return json(400, { error: 'bad_message' });
    if (m.who !== 'me' && m.who !== 'rou') return json(400, { error: 'bad_role' });
  }
  if (raw[raw.length - 1].who !== 'me') return json(400, { error: 'must_end_user' });

  /* 拼 messages;合并连续同 role(Messages API 要求交替) */
  const messages = [{ role: 'user', content: CORE + '\n\n' + stateLines(st) }];
  for (const m of raw){
    const role = m.who === 'me' ? 'user' : 'assistant';
    const last = messages[messages.length - 1];
    if (last.role === role) last.content += '\n' + m.text;
    else messages.push({ role, content: m.text });
  }

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ROU_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages
      })
    });
  } catch(e){ return json(502, { error: 'upstream_unreachable' }); }

  if (!res.ok){
    const detail = await res.text().catch(() => '');
    console.error('anthropic', res.status, detail.slice(0, 300));
    return json(res.status === 429 ? 429 : 502, { error: 'upstream_error', status: res.status });
  }

  const j = await res.json().catch(() => null);
  const text = j && Array.isArray(j.content)
    ? j.content.filter(c => c && c.type === 'text').map(c => c.text).join('').trim().slice(0, 120)
    : '';
  if (!text) return json(502, { error: 'empty_completion' });

  dayCount++;
  return json(200, { text });
};
