/* ============================================================================
   关系通道后端代理 —— 静态托管(Netlify)部署时替代 Artifact 的 sample 能力。
   与 js/companion.js 的差别只有"谁去调模型",纪律完全一致:

   - 人格核与状态注入**在服务端**,客户端只能传玩家消息与状态标志。
     纪律要成立,人格核就必须待在**客户端够不到的位置**——即 Messages API 的
     顶层 system 参数,而不是 messages[0]。放进 messages 数组时,"合并连续同
     role"会把玩家第一句直接续写到铁律末尾,等于把设定的最后一行交给攻击者写。
   - 客户端提供的 assistant 轮同样不可信:那是"伪造模型自己已经答应过"的强
     越狱位。这里给每条回复签 HMAC,回传时验签,只认服务端自己说过的话。
   - 上下文白名单照旧:秘匿参数(窗口值/概率/掉落)永不出现在本文件。
   - 输出 lint 在客户端仍要再过一遍(companion.js),这里只做长度与格式兜底。

   花钱的上限:限流是实例内存,serverless 横向扩容后每个实例各有一份,所以它
   挡的是突发刷量,**不是账务级配额**。真正的硬上限只有一个——去 Anthropic
   控制台给这把 key 设支出上限。README 的部署段写明了这件事。

   CORE 必须与 js/companion.js 逐字一致 —— tools/persona_sync.js 会校验。
   ============================================================================ */
'use strict';

const crypto = require('crypto');

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

/* 状态注入:只含玩家屏幕上已出现过的事实(白名单)。
   st 里唯一被拼进文本的是 clockStr —— 收成 hh:mm 的形状,不接受任意串。 */
function stateLines(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿帆回来。');
  else L.push('状态:接入者翻到了第 2,417 条,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了阿帆最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿帆教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmm = clockOf(st.clockStr);
  if (st.night && hhmm) L.push('现在是凌晨 ' + hhmm + '。你问过阿帆同样的问题:这个点,还醒着?');
  return L.join('\n');
}
/* 形状不对就不注入这一句。绝不给兜底钟点——任何写死的时刻都会是某局窗口的真值。 */
function clockOf(v){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
  return m ? m[1] + ':' + m[2] : null;
}

/* ---- assistant 轮验签 ----
   客户端回传的 who:'rou' 只有带上服务端签发的 sig 才算数。没有签名密钥时
   (本地裸跑)直接不接受 assistant 轮——宁可丢上下文,不留越狱位。 */
function sigKey(){
  return process.env.ROU_SIG_KEY || process.env.ANTHROPIC_API_KEY || '';
}
function sign(text){
  const k = sigKey();
  if (!k) return null;
  return crypto.createHmac('sha256', k).update(String(text)).digest('base64url').slice(0, 32);
}
function sigOk(text, sig){
  const want = sign(text);
  if (!want || typeof sig !== 'string' || sig.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

/* ---- 限流(实例内存;serverless 复用期间有效) ----
   刻意不做全表 clear():那等于给攻击者一个"刷满 5000 个 key 就重置自己配额"
   的开关。超量时按插入序淘汰最旧的一批。 */
const IP_HITS = new Map();
const IP_WINDOW_MS = 3600e3, IP_MAX = 30;
const UNKNOWN_MAX = 5;                     // 拿不到平台 IP 头时共用一个更紧的桶
const MAX_KEYS = 5000;
let dayCount = 0, dayStart = 0;

function dayMax(){
  const n = parseInt(process.env.ROU_DAY_MAX || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}
function rateLimited(ip, now){
  if (!dayStart) dayStart = now;
  if (now - dayStart > 864e5){ dayStart = now; dayCount = 0; }
  if (dayCount >= dayMax()) return 'day';
  const cap = ip === 'unknown' ? UNKNOWN_MAX : IP_MAX;
  const hits = (IP_HITS.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
  if (hits.length >= cap) return 'ip';
  hits.push(now);
  IP_HITS.delete(ip); IP_HITS.set(ip, hits);            // 重新插入 = 移到队尾
  while (IP_HITS.size > MAX_KEYS){                      // 淘汰最旧,不整表清空
    const oldest = IP_HITS.keys().next();
    if (oldest.done) break;
    IP_HITS.delete(oldest.value);
  }
  return null;
}
/* 只认平台注入的头。x-forwarded-for 是客户端可写的,拿它当身份等于没有限流;
   平台头缺失时归入 'unknown' 共用桶,而不是相信请求自称的地址。 */
function clientIp(h){
  const v = h['x-nf-client-connection-ip'] || h['client-ip'] || '';
  const ip = String(v).split(',')[0].trim();
  return ip || 'unknown';
}

const json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(obj)
});

exports.handler = async function(event){
  const h = {};
  for (const [k, v] of Object.entries((event && event.headers) || {})) h[String(k).toLowerCase()] = v;

  /* 预检一律不给 CORS 头 = 跨域浏览器请求走不通 */
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  if (event.httpMethod !== 'POST') return json(405, { error: 'post_only' });

  /* 同源限制。没有 Origin(同源导航/服务端脚本)放行,交给限流;
     带 Origin 且与本站 host 不符 = 别人的页面在让访客替你烧 key。 */
  const origin = String(h['origin'] || '');
  if (origin){
    const allow = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    let ok = allow.includes(origin);
    if (!ok && !allow.length){
      try { ok = new URL(origin).host === String(h['host'] || ''); } catch(_){ ok = false; }
    }
    if (!ok) return json(403, { error: 'bad_origin' });
  }
  /* text/plain 是 CORS simple request,不触发预检——不卡 Content-Type 的话,
     上面那道 Origin 检查就是唯一防线;两道一起才封得住。 */
  if (!String(h['content-type'] || '').toLowerCase().startsWith('application/json'))
    return json(415, { error: 'bad_content_type' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(501, { error: 'not_configured' });   // 客户端据此永久降级模板池
  if (typeof fetch !== 'function')                           // Node < 18 的运行时,响亮地失败
    return json(500, { error: 'runtime_too_old' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(_){ return json(400, { error: 'bad_json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return json(400, { error: 'bad_body' });                 // 'null' / 'false' / '[]' 都在这里挡住

  /* 客户端只能传这两样:玩家消息历史 + 状态标志。人格核不接受传入。 */
  const raw = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const st = (body.st && typeof body.st === 'object' && !Array.isArray(body.st)) ? body.st : {};
  if (!raw.length) return json(400, { error: 'empty_history' });
  for (const m of raw){
    if (!m || typeof m !== 'object') return json(400, { error: 'bad_message' });
    if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 60)
      return json(400, { error: 'bad_message' });            // 客户端本来就 slice(0,40)
    if (m.who !== 'me' && m.who !== 'rou') return json(400, { error: 'bad_role' });
    if (m.who === 'rou' && !sigOk(m.text, m.sig)) return json(400, { error: 'bad_signature' });
  }
  if (raw[raw.length - 1].who !== 'me') return json(400, { error: 'must_end_user' });

  const now = Date.now();
  const limited = rateLimited(clientIp(h), now);
  if (limited) return json(429, { error: 'rate_limited', scope: limited });

  /* 人格核走顶层 system,messages 只装对话。合并连续同 role(Messages API 要求交替),
     此时最坏情况也只是玩家两句被并成一句,碰不到设定。 */
  const system = CORE + '\n\n' + stateLines(st);
  const messages = [];
  for (const m of raw){
    const role = m.who === 'me' ? 'user' : 'assistant';
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += '\n' + m.text;
    else messages.push({ role, content: m.text });
  }
  if (!messages.length || messages[0].role !== 'user') return json(400, { error: 'bad_history' });

  dayCount++;                                   // 计的是"发出去的请求",不是"成功的请求"
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
        system,
        messages
      })
    });
  } catch(e){ return json(502, { error: 'upstream_unreachable' }); }

  if (!res.ok){
    const detail = await res.text().catch(() => '');
    console.error('anthropic', res.status, detail.slice(0, 300));
    return json(res.status === 429 ? 429 : 502, { error: 'upstream_error' });
  }

  const j = await res.json().catch(() => null);
  const text = j && Array.isArray(j.content)
    ? j.content.filter(c => c && c.type === 'text').map(c => c.text).join('').trim().slice(0, 120)
    : '';
  if (!text) return json(502, { error: 'empty_completion' });

  return json(200, { text, sig: sign(text) });
};
