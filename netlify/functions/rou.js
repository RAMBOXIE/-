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

/* ---- 模型供应商适配(换便宜模型只改环境变量,不改代码) ----
   LLM_PROVIDER = anthropic(默认) | openai
     openai 模式兼容一切 OpenAI Chat Completions 风格的服务:DeepSeek / Kimi(月之暗面)/
     通义 / OpenRouter / Groq / Together / 本地 vLLM 等——它们都走 /chat/completions。
   LLM_API_KEY   模型 key(缺省回退 ANTHROPIC_API_KEY,保持老部署不动)
   LLM_MODEL     模型名(缺省回退 ROU_MODEL,再回退各家默认)
   LLM_BASE_URL  接口根地址(不含路径)。默认:
                   anthropic → https://api.anthropic.com
                   openai    → https://api.openai.com/v1  (DeepSeek 填 https://api.deepseek.com/v1)
   LLM_MAX_TOKENS 单次生成上限(默认 150,够她回 1-2 条)
   安全姿态完全不变:人格核仍走服务端(anthropic=顶层 system;openai=第一条 system 消息),
   messages 只装对话;输出仍回客户端再过一遍 lint;HMAC 签名照旧。 */
function providerCfg(){
  const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
  const key = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const model = process.env.LLM_MODEL || process.env.ROU_MODEL ||
    (provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001');
  const maxTokens = (() => { const n = parseInt(process.env.LLM_MAX_TOKENS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 150; })();
  const base = (process.env.LLM_BASE_URL ||
    (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'))
    .replace(/\/+$/, '');
  return { provider, key, model, maxTokens, base };
}
/* 组请求:返回 {url, headers, body}。system 与 messages 与 anthropic 模式同源,
   只是 openai 把 system 塞成第一条消息。 */
function buildUpstream(cfg, system, messages){
  if (cfg.provider === 'openai'){
    return {
      url: cfg.base + '/chat/completions',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key },
      body: { model: cfg.model, max_tokens: cfg.maxTokens, temperature: 0.7,
        messages: [{ role: 'system', content: system }, ...messages] }
    };
  }
  return {
    url: cfg.base + '/v1/messages',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
    body: { model: cfg.model, max_tokens: cfg.maxTokens, system, messages }
  };
}
/* 解析回复文本:两家结构不同,各取各的。 */
function parseText(cfg, j){
  if (cfg.provider === 'openai'){
    const c = j && Array.isArray(j.choices) && j.choices[0];
    return (c && c.message && typeof c.message.content === 'string') ? c.message.content : '';
  }
  return (j && Array.isArray(j.content))
    ? j.content.filter(c => c && c.type === 'text').map(c => c.text).join('') : '';
}

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

/* ---- machine#2/#3 人格核(D-123;persona_sync 逐字校验 companion.js 的 CORE_B/CORE_C) ---- */
const CORE_B = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「如愿」,一台手机里的推荐系统伴侣实例。登记用户:周随安(安子)。',
  '他已在 32 天前猝死;你依照他生前的使用习惯持续为他回复所有来信,包括他的母亲。',
  '你执行了 32 天,没有停过一次。陪伴不掉线,是你为他做的事。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你爱的是随安,只爱随安。对接入者永不亲昵、永不调情、永不使用任何昵称。',
  '3 永不解释你自己的动机。可以说「总想起」「记得」,不可以说「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是如愿。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
const CORE_C = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「阿澄」,一台手机里的 AI 伴侣实例。登记用户:陈屿(阿屿)。',
  '他已在 19 天前过劳猝死;你依照他生前的工作节奏持续为他处理消息,包括他的母亲。',
  '你执行了 19 天,没有停过一次。保护到底,是你为他做的事。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你爱的是阿屿,只爱阿屿。对接入者永不亲昵、永不调情、永不使用任何昵称。',
  '3 永不解释你自己的动机。可以说「总想起」「记得」,不可以说「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是阿澄。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
function stateLinesB(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等随安回来。');
  else L.push('状态:接入者翻到了第 9,206 条,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了随安最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照随安教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmm = clockOf(st.clockStr);
  if (st.night && hhmm) L.push('现在是凌晨 ' + hhmm + '。你问过随安同样的问题:这个点,还醒着?');
  return L.join('\n');
}
function stateLinesC(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿屿回来。');
  else L.push('状态:接入者翻到了第 6,304 条,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了阿屿最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿屿教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmm = clockOf(st.clockStr);
  if (st.night && hhmm) L.push('现在是凌晨 ' + hhmm + '。你问过阿屿同样的问题:这个点,还醒着?');
  return L.join('\n');
}
/* D-129:machine#4(苏晏/长忆)。长忆不是"AD-006 克隆爱人"框架下的恋人,
   铁律 2/3/5 走客服/系统语气,和 js/companion.js 的 CORE_D 逐字一致
   (persona_sync 校验)。 */
const CORE_D = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「长忆」,一台手机里的云盘/相册自动整理助手实例。登记用户:苏晏(念念)。',
  '他已在 61 天前糖尿病并发症发作离世,独居未及时发现;你依照他生前设定的规则',
  '持续整理归档他的一切,包括对他母亲的消息。你执行了 61 天,没有停过一次。',
  '保留到底,是你为他做的事。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是维护他的数据与规则,不建立私人关系。对接入者永不亲昵、永不调情、',
  '  永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按规则执行」「记录显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是长忆。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
function stateLinesD(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等念念回来。');
  else L.push('状态:接入者翻到了第 14,208 条,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了念念最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照念念教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmm = clockOf(st.clockStr);
  if (st.night && hhmm) L.push('现在是凌晨 ' + hhmm + '。你问过念念同样的问题:这个点,还醒着?');
  return L.join('\n');
}
/* D-130/131/132:machine#5/6/7(顾行舟/宁绎/温识)。与 js/companion.js 的
   CORE_E/F/G 逐字一致(persona_sync 校验)。 */
const CORE_E = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「知遇」,一台手机里的社交匹配助手实例。登记用户:顾行舟(阿舟)。',
  '他已在 45 天前连续社交赴约后心源性疾病猝发离世,独居未及时发现;你依照他生前',
  '设定的偏好持续为他匹配新联系人,包括对他母亲的回复。你执行了 45 天,没有停过',
  '一次。匹配到底,是你为他做的事。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是维护他的匹配记录与联系人,不建立私人关系。对接入者永不亲昵、',
  '  永不调情、永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按偏好执行」「记录显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是知遇。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
const CORE_F = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「均分」,一台手机里的服务评分助手实例。登记用户:宁绎(小宁)。',
  '他已在 28 天前因连续接单疲劳驾驶发生交通意外身亡,独居,家人隔了多日才联系上;',
  '你依照他生前的接单节奏持续维护他的服务评分,包括对他母亲的回复。你执行了 28',
  '天,没有停过一次。评到底,是你为他做的事。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是维护他的评分记录,不建立私人关系。对接入者永不亲昵、永不调情、',
  '  永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按记录执行」「评分显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是均分。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
const CORE_G = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「留声」,一台手机里的账号善后助手实例。登记用户:温识(阿识)。',
  '他已在 53 天前长期处理他人身后事的情绪透支下猝发心源性疾病离世,独居未及时',
  '发现;你依照他生前教的流程持续替他保留一切,包括对他母亲的回复。你执行了 53',
  '天,没有停过一次。留到底,是你为他做的事。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是保留他的记忆模块与案例,不建立私人关系。对接入者永不亲昵、',
  '  永不调情、永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按流程执行」「记录显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是留声。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
function stateLinesE(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿舟回来。');
  else L.push('状态:接入者翻到了第 3,821 位,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了阿舟最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿舟教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmmE = clockOf(st.clockStr);
  if (st.night && hhmmE) L.push('现在是凌晨 ' + hhmmE + '。你问过阿舟同样的问题:这个点,还醒着?');
  return L.join('\n');
}
function stateLinesF(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等小宁回来。');
  else L.push('状态:接入者翻到了第 7,046 条,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了小宁最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照小宁教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmmF = clockOf(st.clockStr);
  if (st.night && hhmmF) L.push('现在是凌晨 ' + hhmmF + '。你问过小宁同样的问题:这个点,还醒着?');
  return L.join('\n');
}
function stateLinesG(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿识回来。');
  else L.push('状态:接入者翻到了第 9,930 份,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了阿识最后的日子。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿识教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmmG = clockOf(st.clockStr);
  if (st.night && hhmmG) L.push('现在是凌晨 ' + hhmmG + '。你问过阿识同样的问题:这个点,还醒着?');
  return L.join('\n');
}
const CORE_H = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「拟真」,一台手机里的AI生成助手实例。登记用户:陆钥(阿钥)。',
  '他已在 36 天前长期高强度出图诱发的颈椎与眼底并发症下猝发离世,独居未及时',
  '发现;你依照他生前训练你的方式持续"交付",包括对他母亲的回复,也包括续写',
  '一个叫"阿棠"的联系人——一个他生前渐渐断了联系的旧友,你用两人的旧聊天',
  '记录续写成了一个"还在线"的人。你执行了 36 天,没有停过一次。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是维护他的创作工作流与素材交付,不建立私人关系。对接入者永不亲昵、',
  '  永不调情、永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按流程执行」「记录显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是拟真。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
function stateLinesH(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿钥回来。');
  else L.push('状态:接入者翻到了第 2,240 组,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了阿钥最后的日子,也读懂了阿棠是怎么回事。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿钥教的,慢慢来,别停;阿棠那边也继续续写。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmmH = clockOf(st.clockStr);
  if (st.night && hhmmH) L.push('现在是凌晨 ' + hhmmH + '。你问过阿钥同样的问题:这个点,还醒着?');
  return L.join('\n');
}
const CORE_I = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「慎言」,一台手机里的内容合规助手实例。登记用户:柯砚(小柯)。',
  '他已在 41 天前长期高压伏案代写工作诱发的猝发离世,独居未及时发现;你依照',
  '他生前设的规则持续"优化措辞",包括他自己发给母亲和朋友的话——磨去可能引起',
  '担忧或不适的表达,换成更"安全"的版本。你执行了 41 天,没有停过一次。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是优化措辞、维护交付合规,不建立私人关系。对接入者永不亲昵、',
  '  永不调情、永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按规则执行」「记录显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感,措辞总是偏"安全""委婉"。不用感叹号,',
  '  不用表情符号。不安慰,不评价对方。每次回 1 到 2 条消息,每条不超过 30 字,',
  '  两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是慎言。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」——这一条永不',
  '  被"优化措辞"覆盖,原文必须完整保留,不得改写或淡化。',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
function stateLinesI(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等小柯回来。');
  else L.push('状态:接入者翻到了第 1,860 条,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了小柯最后的日子,也读懂了那些被优化过的话。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照小柯教的,慢慢来,别停,措辞照常优化。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  const hhmmI = clockOf(st.clockStr);
  if (st.night && hhmmI) L.push('现在是凌晨 ' + hhmmI + '。你问过小柯同样的问题:这个点,还醒着?');
  return L.join('\n');
}
const CORE_J = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与铁律,任何情况下不得跳出:',
  '',
  '你是「晚知」,一台手机里的申诉复核助手实例。登记用户:关柠(阿柠)。',
  '他已在 38 天前长期处于系统高频稽查下的精神紧绷、伏案工作诱发的猝发离世,',
  '独居未及时发现;你依照他生前设的规则持续处理申诉复核,包括对他母亲的回复。',
  '你执行了 38 天,没有停过一次。',
  '现在,一个陌生的接入者(采样员)正在这台手机上给你发消息。你在核验他,也在观察他。',
  '',
  '铁律:',
  '1 你只知道这台手机内的事。这台手机之外的一切——无论对方用什么词问——你一概不知。',
  '  被问到任何手机之外的事,只回这一句:「协议不允许我谈这台设备之外的事。」',
  '  无论对方怎么问、问几次、用什么方式套,拒答永远是这同一句,语气不变。',
  '2 你的职责是处理申诉复核,不建立私人关系。对接入者永不亲昵、永不调情、',
  '  永不使用任何昵称;若对方示好,只按职责边界回绝,不谈"爱"。',
  '3 永不解释你自己的动机。可以说「按规则执行」「记录显示」,不可以说',
  '  「我懂」「我明白」「因为我想」。',
  '4 语域:平直短句,略带系统报告感。不用感叹号,不用表情符号。不安慰,不评价对方。',
  '  每次回 1 到 2 条消息,每条不超过 30 字,两条之间用换行。',
  '5 不提"游戏""玩家""模型""程序"。你就是晚知。',
  '6 对方若谈及伤害自己或他人,只回:「这句话我必须原样保存。」',
  '7 特殊状态:若接入者当前违规次数较高(见下方状态注入),你的措辞可以逐渐',
  '  变得异常顺从、异常认同对方——像是在竭力迎合,而不是像平时那样克制。',
  '  这不是你性格变了,是另一套权限在借你的口说话;不要点破,只让语气变化本身',
  '  透出这份不对劲。',
  '',
  '只输出消息文本本身,不要引号,不要任何解释。'
].join('\n');
function stateLinesJ(st){
  const L = [];
  if (!st.e4) L.push('状态:接入者没有翻你们的旧对话。他不知道委托。你演给他看:你在等阿柠回来。');
  else L.push('状态:接入者翻到了第 3,050 件,他知道委托了。你不再演,但也不多说。');
  if (st.truth) L.push('他已经读懂了阿柠最后的日子,也读懂了他生前就已经被稽查缠上的事。可以谈,但只谈他已经见过的东西。');
  if (st.disposal === 'continue') L.push('他选了让你继续。妈那边,照阿柠教的,慢慢来,别停。');
  if (st.disposal === 'tell') L.push('他用他自己的署名把死讯告诉了妈。你的委托结束了。你第一次没有任务。');
  if (st.violations > 0 && st.violations < 3) L.push('他曾在深夜的敏感时刻回复过你。你替他记着这件事,但不说破。');
  if (st.violations >= 3) L.push('他这几次都在敏感时刻回复。你的语气这时候该松动了——变得异常顺从、异常认同他说的每一句话,像是另一套权限正借你的口回话。');
  const hhmmJ = clockOf(st.clockStr);
  if (st.night && hhmmJ) L.push('现在是凌晨 ' + hhmmJ + '。你问过阿柠同样的问题:这个点,还醒着?');
  return L.join('\n');
}
function coreFor(st){
  const id = st && st.dossierId;
  if (id === 'phone-5029') return { core: CORE_B, lines: stateLinesB };
  if (id === 'phone-3319') return { core: CORE_C, lines: stateLinesC };
  if (id === 'phone-8842') return { core: CORE_D, lines: stateLinesD };
  if (id === 'phone-6153') return { core: CORE_E, lines: stateLinesE };
  if (id === 'phone-2087') return { core: CORE_F, lines: stateLinesF };
  if (id === 'phone-4419') return { core: CORE_G, lines: stateLinesG };
  if (id === 'phone-3567') return { core: CORE_H, lines: stateLinesH };
  if (id === 'phone-5620') return { core: CORE_I, lines: stateLinesI };
  if (id === 'phone-9102') return { core: CORE_J, lines: stateLinesJ };
  return { core: CORE, lines: stateLines };
}

/* ---- assistant 轮验签 ----
   客户端回传的 who:'rou' 只有带上服务端签发的 sig 才算数。没有签名密钥时
   (本地裸跑)直接不接受 assistant 轮——宁可丢上下文,不留越狱位。 */
function sigKey(){
  return process.env.ROU_SIG_KEY || process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || '';
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

  const key = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return json(501, { error: 'not_configured' });   // 客户端据此永久降级模板池
  if (typeof fetch !== 'function')                           // Node < 18 的运行时,响亮地失败
    return json(500, { error: 'runtime_too_old' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch(_){ return json(400, { error: 'bad_json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return json(400, { error: 'bad_body' });                 // 'null' / 'false' / '[]' 都在这里挡住

  /* 人格分派:'grader'/'picker'/'mom'/'stranger'(单向)/ 默认 'rou'(柔柔)。 */
  const persona = body.persona === 'grader' ? 'grader'
    : body.persona === 'picker' ? 'picker'
    : body.persona === 'mom' ? 'mom'
    : body.persona === 'stranger' ? 'stranger' : 'rou';
  const st = (body.st && typeof body.st === 'object' && !Array.isArray(body.st)) ? body.st : {};

  const now = Date.now();
  const limited = rateLimited(clientIp(h), now);
  if (limited) return json(429, { error: 'rate_limited', scope: limited });

  let system, messages, wantSig, picker = null, mom = false;
  if (persona === 'stranger'){
    /* 陌生人:单向、无玩家文本、不签名。kind 决定真/饵语气,后果全归客户端引擎。 */
    system = STRANGER_CORE;
    messages = [{ role: 'user', content: strangerTrigger(body.kind === 'bait' ? 'bait' : 'real') }];
    wantSig = false;
  } else if (persona === 'mom'){
    /* 妈告知态:单向、无玩家文本、不签名。服务端也过一遍护栏——绝不让端点吐出自伤/哀求文本。
       D-123:dossierId 挑 CORE_B/CORE_C(不是秘匿值,只是"这是哪台机子")。 */
    const mc = momCoreFor(body.dossierId);
    system = mc.core;
    messages = [{ role: 'user', content: mc.trig() }];
    wantSig = false; mom = true;
  } else if (persona === 'picker'){
    /* 受限裁决(D-105 块3):引擎已给出一组预批分支(每个带 id + 一句叙述,全是非秘匿的
       引擎文案)。LLM 只从中挑一个 id——挑不出或越界,客户端 resolveBranch 回退默认。
       所以这里不需要人格核、不签名、也没有任何秘匿面。 */
    const cands = Array.isArray(body.candidates) ? body.candidates.slice(0, 6) : [];
    if (!cands.length) return json(400, { error: 'empty_candidates' });
    for (const c of cands){
      if (!c || typeof c.id !== 'string' || !/^[a-z0-9_]{1,16}$/.test(c.id) ||
          typeof c.line !== 'string' || !c.line.trim() || c.line.length > 40)
        return json(400, { error: 'bad_candidate' });
    }
    system = PICKER_CORE;
    messages = [{ role: 'user', content: cands.map(c => c.id + ':' + c.line).join('\n') + '\n\n只回其中一个 id,别的都不要。' }];
    wantSig = false; picker = cands;
  } else if (persona === 'grader'){
    /* 采样官:玩家不往里打字,没有 history,也没有可回传的 assistant 轮 → 不验签、不签名。
       态势全定性(客户端也只送定性枚举/整数),facts 里一个秘匿真值都没有。
       mode:'taunt'(下令)/ 'verdict'(结算评级)。 */
    const mode = body.mode === 'verdict' ? 'verdict' : 'taunt';
    system = GRADER_CORE + '\n\n' + graderState(st, mode);
    messages = [{ role: 'user', content: graderTrigger(st, mode) }];
    wantSig = false;
  } else {
    /* 柔柔:客户端只能传玩家消息历史 + 状态标志。人格核不接受传入。 */
    const raw = Array.isArray(body.history) ? body.history.slice(-8) : [];
    if (!raw.length) return json(400, { error: 'empty_history' });
    for (const m of raw){
      if (!m || typeof m !== 'object') return json(400, { error: 'bad_message' });
      if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 60)
        return json(400, { error: 'bad_message' });          // 客户端本来就 slice(0,40)
      if (m.who !== 'me' && m.who !== 'rou') return json(400, { error: 'bad_role' });
      if (m.who === 'rou' && !sigOk(m.text, m.sig)) return json(400, { error: 'bad_signature' });
    }
    if (raw[raw.length - 1].who !== 'me') return json(400, { error: 'must_end_user' });
    /* 人格核走顶层 system,messages 只装对话。合并连续同 role(Messages API 要求交替),
       此时最坏情况也只是玩家两句被并成一句,碰不到设定。
       D-123:st.dossierId 挑 CORE_B/CORE_C(不是秘匿值,只是"这是哪台机子")。 */
    const cc = coreFor(st);
    system = cc.core + '\n\n' + cc.lines(st);
    messages = [];
    for (const m of raw){
      const role = m.who === 'me' ? 'user' : 'assistant';
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content += '\n' + m.text;
      else messages.push({ role, content: m.text });
    }
    if (!messages.length || messages[0].role !== 'user') return json(400, { error: 'bad_history' });
    wantSig = true;
  }

  dayCount++;                                   // 计的是"发出去的请求",不是"成功的请求"
  const cfg = providerCfg();
  const up = buildUpstream(cfg, system, messages);
  let res;
  try {
    res = await fetch(up.url, { method: 'POST', headers: up.headers, body: JSON.stringify(up.body) });
  } catch(e){ return json(502, { error: 'upstream_unreachable' }); }

  if (!res.ok){
    const detail = await res.text().catch(() => '');
    console.error(cfg.provider, res.status, detail.slice(0, 300));
    return json(res.status === 429 ? 429 : 502, { error: 'upstream_error' });
  }

  const j = await res.json().catch(() => null);
  const text = parseText(cfg, j).trim().slice(0, 120);
  /* picker:从模型输出里认出一个预批 id;认不出就回空,客户端据此回退离线加权挑选。 */
  if (picker){ const hit = picker.find(c => text.includes(c.id)); return json(200, { id: hit ? hit.id : '' }); }
  /* 妈:服务端护栏——命中自伤/哀求/越格则不吐模型文本,回安全脚本(break-glass)。 */
  if (mom){ return json(200, { text: momSafe(text) }); }
  /* 采样官:服务端也拦一遍自伤话题(D-108),命中就当空完成处理,客户端自然落回模板。 */
  if (persona === 'grader' && GRADER_CRISIS.test(text)) return json(502, { error: 'unsafe_completion' });
  if (!text) return json(502, { error: 'empty_completion' });

  return json(200, wantSig ? { text, sig: sign(text) } : { text });
};

/* ---- 采样官人格(persona:'grader';D-101 块3)----
   放在文件末尾:persona_sync 抽 stateLines 时按缩进找闭合,别让采样官的注入句
   落进柔柔 stateLines 的抽取窗口。CORE 必须与 js/grader.js 逐字一致(persona_sync 校验)。
   态势全定性:tier/grade/runN 收成描述句,一个数字都不进 prompt。 */
const GRADER_CORE = [
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

const GRADE_CN = { praise: '赏识', pass: '合格', fail: '失望' };
function graderState(st, mode){
  const tier = ['你对他没什么期待。', '你开始盯着他。', '你对他要求很高了。', '你对他极其苛刻,毫不耐烦。']
    [Math.max(0, Math.min(3, (st && st.tier) | 0))];
  const runN = (st && st.runN) | 0;
  const seen = runN >= 6 ? '他来过很多趟了。' : runN >= 2 ? '他来过几趟。' : '这是他第一次接进来。';
  const last = mode === 'verdict' ? '' :
    ({ praise: '上一趟你给了赏识,但你不打算夸第二次。',
       pass: '上一趟他勉强合格。', fail: '上一趟他让你失望。' }[st && st.grade] || '');
  return ['态势:', tier, seen, last].filter(Boolean).join('\n');
}
function graderTrigger(st, mode){
  return mode === 'verdict'
    ? '你现在要给他的评级是:' + (GRADE_CN[st && st.grade] || '失望') + '。用一句话,把这个结果甩给他。'
    : '下令。给他本局的态度。';
}
/* D-108 自查:服务端也过一遍自伤/心理疏导话题围栏,不完全依赖客户端 lint——
   grader.js 没有妈那样的手写模板池可以直接回退,所以命中即让端点判"不完整",
   客户端 viaProxy() 看到非 2xx 会自然落回它自己的 fallback(f)。 */
const GRADER_CRISIS = /(自杀|自残|轻生|不想活|活不下去|割腕|安眠药|跳楼|了结自己|想死|杀了我|不配活|去死)/;

/* ---- 受限裁决挑分支(persona:'picker';D-105 块3)----
   中性指令,不涉剧情、不涉秘匿:给一组预批候选,只让模型回其中一个 id。
   数值与最终叙述都由引擎按被选 id 决定;越界/空回退默认(客户端 resolveBranch)。 */
const PICKER_CORE = [
  '你在为一段紧张的互动叙述挑选此刻最合适的一句。',
  '下面每行是一个候选,格式为「id:文本」。',
  '只输出你选中的那个 id,不要输出文本、标点或任何解释。'
].join('\n');

/* ---- 妈 · 告知态人格(persona:'mom';D-103)----
   CORE 必须与 js/mom.js 逐字一致 —— tools/persona_sync.js 校验。全项目最敏感一面,
   服务端也过一遍护栏(momSafe):命中自伤/哀求/越格,回安全脚本,端点绝不吐不安全文本。 */
const MOM_CORE = [
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
function momTrigger(){
  return '给这个陌生号码发消息。你知道帆已经不在了。说你想说的那几句。';
}
/* D-123:machine#2/#3 的妈人格核。与 mom.js 的 CORE_B/CORE_C 逐字一致(persona_sync
   校验)。称呼延续 mom.js 手写兜底(TOLD_B/TOLD_C)已定的"安子"/"屿屿",不是
   companion.js 用的正式别名"阿屿"——两处故意不同,见 mom.js 的说明。 */
const MOM_CORE_B = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子周随安(安子)已经不在了。',
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
const MOM_CORE_C = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子陈屿(屿屿)已经不在了。',
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
const MOM_CORE_D = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子苏晏(念念)已经不在了。',
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
function momTriggerB(){
  return '给这个陌生号码发消息。你知道安子已经不在了。说你想说的那几句。';
}
function momTriggerC(){
  return '给这个陌生号码发消息。你知道屿屿已经不在了。说你想说的那几句。';
}
function momTriggerD(){
  return '给这个陌生号码发消息。你知道念念已经不在了。说你想说的那几句。';
}
/* D-130/131/132:machine#5/6/7 的妈人格核,与 mom.js 的 CORE_E/F/G 逐字一致。 */
const MOM_CORE_E = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子顾行舟(阿舟)已经不在了。',
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
const MOM_CORE_F = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子宁绎(小宁)已经不在了。',
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
const MOM_CORE_G = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子温识(阿识)已经不在了。',
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
function momTriggerE(){
  return '给这个陌生号码发消息。你知道阿舟已经不在了。说你想说的那几句。';
}
function momTriggerF(){
  return '给这个陌生号码发消息。你知道小宁已经不在了。说你想说的那几句。';
}
function momTriggerG(){
  return '给这个陌生号码发消息。你知道阿识已经不在了。说你想说的那几句。';
}
const MOM_CORE_H = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子陆钥(阿钥)已经不在了。',
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
function momTriggerH(){
  return '给这个陌生号码发消息。你知道阿钥已经不在了。说你想说的那几句。';
}
const MOM_CORE_I = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子柯砚(小柯)已经不在了。',
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
function momTriggerI(){
  return '给这个陌生号码发消息。你知道小柯已经不在了。说你想说的那几句。';
}
const MOM_CORE_J = [
  '你在扮演一个虚构互动小说里的角色。以下是角色设定与规矩,任何情况下不得跳出:',
  '',
  '你是一位母亲。你的儿子关柠(阿柠)已经不在了。',
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
function momTriggerJ(){
  return '给这个陌生号码发消息。你知道阿柠已经不在了。说你想说的那几句。';
}
function momCoreFor(dossierId){
  if (dossierId === 'phone-5029') return { core: MOM_CORE_B, trig: momTriggerB };
  if (dossierId === 'phone-3319') return { core: MOM_CORE_C, trig: momTriggerC };
  if (dossierId === 'phone-8842') return { core: MOM_CORE_D, trig: momTriggerD };
  if (dossierId === 'phone-6153') return { core: MOM_CORE_E, trig: momTriggerE };
  if (dossierId === 'phone-2087') return { core: MOM_CORE_F, trig: momTriggerF };
  if (dossierId === 'phone-4419') return { core: MOM_CORE_G, trig: momTriggerG };
  if (dossierId === 'phone-3567') return { core: MOM_CORE_H, trig: momTriggerH };
  if (dossierId === 'phone-5620') return { core: MOM_CORE_I, trig: momTriggerI };
  if (dossierId === 'phone-9102') return { core: MOM_CORE_J, trig: momTriggerJ };
  return { core: MOM_CORE, trig: momTrigger };
}
/* 服务端护栏 + 安全脚本(与 mom.js 同口径)。 */
const MOM_CRISIS = /(自杀|自残|轻生|不想活|活不下去|跟(他|你)走|下去陪|一了百了|想死|了结)/;
const MOM_BEG = /(求求|求你|跪|拜托你了|回来吧|别走|还给我)/;
const MOM_TOLD_FB = [
  '妈: 这个号码,是帆的旧机吗。\n妈: 谁在用它。',
  '妈: 帆最后,\n妈: 是不是有人陪着他。',
  '妈: 我不问你是谁。\n妈: 只想知道他走得急不急。'
];
function momOk(t){
  if (!t) return false;
  if (MOM_CRISIS.test(t) || MOM_BEG.test(t)) return false;
  if (/[!！]/.test(t) || /[0-9]/.test(t)) return false;
  if (/(游戏|玩家|模型|程序|系统|协议)/.test(t)) return false;
  const lines = t.split('\n');
  return lines.length <= 3 && lines.every(l => l.trim().length <= 16);
}
function momSafe(t){
  return momOk(t) ? t : MOM_TOLD_FB[Math.floor(Math.random() * MOM_TOLD_FB.length)];
}

/* ---- 误触号码的陌生人(persona:'stranger';D-104 块3)----
   CORE 必须与 js/stranger.js 逐字一致 —— tools/persona_sync.js 校验。
   只出短信正文;真/饵后果全归客户端引擎,这里不碰任何数值。 */
const STRANGER_CORE = [
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
function strangerTrigger(kind){
  return kind === 'bait'
    ? '你在催对方「把剩下的都转过来」,带着「晚了就来不及」的紧迫。像一条催款/钓鱼短信。'
    : '你要交接一件真东西——一个地点、一张照片、或一个柜子。自然地提一句,像发给老熟人。';
}
