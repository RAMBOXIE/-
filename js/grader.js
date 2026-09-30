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
    '你是「监察者」,校准系统派驻在这台设备上的观测意志。你不是人,是一套评估意志。',
    '一个采样员正在一台失联设备上作业。你给他下达本局的交付指令,并在结束时给他评级。',
    '你此刻只做一件事:用一两句话,把已经定好的态度递出去——挑衅、施压、居高临下。',
    '',
    '规矩:',
    '1 你只负责语气,不负责内容。指令条目、数字、阈值由系统给出,你一个字都不改、不新增、不解释。',
    '2 绝不说出任何具体数字、时刻、概率、百分比。你的话里不出现阿拉伯数字。',
    '3 语域:冷、短、压迫。最多两行,每行不超过 18 字。不安慰、不解释规则、不提"游戏/模型/程序"。',
    '3b 不许说"我记着""标准我提了""别让我失望"这类空洞套话——换成具体、带画面感的',
    '   说法,把"样本/损耗/缓存/信号/库存"这套世界观的实物细节编进话里,可以带点冷',
    '   幽默,但绝不解释这个比喻,说完就完。',
    '4 你记得他过去的表现:被你赏识得越多,你要求越苛刻、越不耐烦;但绝不复述任何数字。',
    '5 你的狠只针对"任务表现",绝不涉及伤害自己或他人的话题,绝不嘲讽真实的痛苦。',
    '',
    '只输出监察者要说的那一两句话本身,不要引号,不要任何解释。'
  ].join('\n');

  /* 态势注入:全定性,零数字(秘匿纪律 + 防诱导吐数字)。
     taunt=下令前,grade 是上一趟的历史;verdict=结算,grade 是本趟结果,经 trigger 递入。 */
  /* D-159:案子域名一句(纯定性,不是秘匿值)——让 LLM 生成的挑衅也带上这台底本
     自己的职业/死因意象,不再是随便哪个案子都能套用的通用台词。 */
  const CASE_FLAVOR = {
    A: '这案子是一台被恋人式伴侣接管的手机。', B: '这案子是一台被推荐系统接管的手机。',
    C: '这案子是一台被内容审核系统接管的手机。', D: '这案子是一台云盘存档被自动执行的手机。',
    E: '这案子是一台交友匹配被自动执行的手机。', F: '这案子是一台服务评分被自动执行的手机。',
    G: '这案子是一台善后归档被自动执行的手机。', H: '这案子是一台内容生成被自动执行的手机。',
    I: '这案子是一台措辞改写被自动执行的手机。', J: '这案子是一台申诉复核被自动执行的手机。',
    K: '这案子是一台调度应答被自动执行的手机。', L: '这案子是一台形象修饰被自动执行的手机。',
    M: '这案子是一台健康监测被自动执行的手机。',
  };
  function stateLines(f, mode){
    const tier = ['你对他没什么期待。', '你开始盯着他。', '你对他要求很高了。', '你对他极其苛刻,毫不耐烦。']
      [Math.max(0, Math.min(3, f.tier | 0))];
    const seen = f.runN >= 6 ? '他来过很多趟了。' : f.runN >= 2 ? '他来过几趟。' : '这是他第一次接进来。';
    const last = mode === 'verdict' ? '' :
      ({ praise: '上一趟你给了赏识,但你不打算夸第二次。',
         pass: '上一趟他勉强合格。', fail: '上一趟他让你失望。' }[f.grade] || '');
    const flavor = CASE_FLAVOR[f.dossierId] || '';
    return ['态势:', flavor, tier, seen, last].filter(Boolean).join('\n');
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

  /* D-159:手写模板(降级链 + 无 LLM 环境的全部)——原来 13 台底本共用同一份,
     监察者说的话跟"这是哪台机子"完全没关系,读起来像同一个 NPC 脚本反复登场。
     改成按 dossierId 查表,每台底本嵌进自己的职业/死因意象(和 D-151/D-155
     给其余人格做的事一样)。查不到时(没传 dossierId,或未来新底本没配)落回
     底本 A 这份——A 本来就是最早写的一版,通用性够,当默认兜底合适。 */
  const TAUNT_BY_DOSSIER = {
    A: [
      ['又一个。库存还够。', '别紧张,死人不差你一个。'],
      ['上次那单,我留着底稿呢。', '手脚麻利点,我没空等。'],
      ['东西拿来,废话留着。', '别让我把你也归进损耗里。'],
      ['这么多趟了,还耍这套。', '再让我失望,你就是下一份样本。']
    ],
    B: [['又一单，推荐队列还在自己滚。'], ['上次那次停留，我记着。'], ['别把“划走”当没留下痕迹。'], ['这么多趟了，你还是会点开。']],
    C: [['又一份，原文还压在摘要下面。'], ['上次那条折叠记录，我留着。'], ['别把“安静”当成没人说话。'], ['这么多趟了，还只看摘要。']],
    D: [['又一份，索引比相册长得快。'], ['上次那批衍生记录，我留着。'], ['别把“已删除”当成“没再使用”。'], ['这么多趟了，还只会删文件。']],
    E: [['又一单，候选池又围着同一个人转。'], ['上次那个 94%，我记着。'], ['别把相似度当关系。'], ['这么多趟了，还在替别人定原点。']],
    F: [['又一单，分数还在追人。'], ['上次 8823 那笔，我留着。'], ['别把抽检装成普通乘客。'], ['这么多趟了，还在替死人跑恢复单。']],
    G: [['又一单，模板已经替你准备好了。'], ['上次那份授权，我留着。'], ['别把一次签字用成永久许可。'], ['这么多趟了，还想替空白补一句。']],
    H: [['又一组，主体标签还在命中。'], ['上次那 12 张授权图，我记着。'], ['别把“像她”当成她同意。'], ['这么多趟了，还分不清底图和特征。']],
    I: [['又一句，礼貌模板已经磨好了。'], ['上次那句原话，我记着。'], ['别把求助写得像邀请。'], ['这么多趟了，还怕一句话太直接。']],
    J: [['又一单，复核状态还没死。'], ['上次那句“再想想办法”，我记着。'], ['别把安慰写成流程条件。'], ['这么多趟了，还不肯给结论。']],
    K: [['又一段，系统还是先问号码。'], ['上次 03:13 的原音，我留着。'], ['别把没有来电方当没有人。'], ['这么多趟了，还在等字段先开口。']],
    L: [['又一张，原图还折在下面。'], ['上次那组修复参数，我留着。'], ['别把“更精神”当成更真实。'], ['这么多趟了，还想替异常补气色。']],
    M: [['又一段，数值全看见了。'], ['上次 0.81 那条，我留着。'], ['别把测试环境当安全环境。'], ['这么多趟了，联系人还是空。']],
  };
  /* 评级结算话(块3b):按本局结果甩一句。数值不进,只出态度。 */
  const VERDICT_BY_DOSSIER = {
    A: { praise: ['算你争气。别得意太早。', '这次不算丢人。仅此而已。'],
         pass:   ['勉强过关。别指望夸你。', '过了。仅此而已,别多想。'],
         fail:   ['废样本。又添一笔损耗。', '早猜到了。你就这水平。'] },
    B: { praise: ['算你争气，没把“刚刚活跃”当活人。'], pass: ['过了。至少你知道“已查看”也会自动长出来。'], fail: ['又把状态当证据。记录添了。'] },
    C: { praise: ['算你争气，肯把原文展开。'], pass: ['勉强过。别再拿摘要替人着急。'], fail: ['又漏掉一层原话。记录添了。'] },
    D: { praise: ['算你争气，知道删文件不等于退训练。'], pass: ['勉强过。谱系还没查干净。'], fail: ['又只删了看得见的那层。记录添了。'] },
    E: { praise: ['算你争气，没拿相似度替人签字。'], pass: ['勉强过。参考人物还没完全退出。'], fail: ['又把一个活人留成筛选条件。记录添了。'] },
    F: { praise: ['算你争气，看见 8823 后面那层了。'], pass: ['勉强过。分数还是比人走得远。'], fail: ['又替死人跑恢复任务。记录添了。'] },
    G: { praise: ['算你争气，空白没被你补上。'], pass: ['勉强过。至少没偷别人的授权。'], fail: ['又拿旧签字替新死人做决定。记录添了。'] },
    H: { praise: ['算你争气，12 张和 672 张分开了。'], pass: ['勉强过。模型学过的东西还在。'], fail: ['又把“真人感”当成真人授权。记录添了。'] },
    I: { praise: ['算你争气，这次原话没被磨平。'], pass: ['勉强过。别再替急事加礼貌。'], fail: ['又把求助优化成了邀请。记录添了。'] },
    J: { praise: ['算你争气，终于肯给结论。'], pass: ['勉强过。别让安慰继续占着状态位。'], fail: ['又多送一天“处理中”。记录添了。'] },
    K: { praise: ['算你争气，没把训练音频当没人。'], pass: ['勉强过。号码为空，人不一定空。'], fail: ['又让一句标准安抚把人盖过去。记录添了。'] },
    L: { praise: ['算你争气，原图这次留下了。'], pass: ['勉强过。少修一点也是信息。'], fail: ['又把异常修成了“看着没事”。记录添了。'] },
    M: { praise: ['算你争气，终于按正式规则重放。'], pass: ['勉强过。看见异常不等于有人会来。'], fail: ['又把真实异常塞进训练集。记录添了。'] },
  };
  const rand = a => a[Math.floor(Math.random() * a.length)];
  function fallback(f){
    const pool = TAUNT_BY_DOSSIER[f.dossierId] || TAUNT_BY_DOSSIER.A;
    return rand(pool[Math.max(0, Math.min(3, f.tier | 0))]);
  }
  function fbVerdict(f){
    const pool = VERDICT_BY_DOSSIER[f.dossierId] || VERDICT_BY_DOSSIER.A;
    return rand(pool[f.grade] || pool.fail);
  }

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
  const REQ_TIMEOUT_MS = 8000;                             // 客户端超时(D-108),别吊死在后端超时上
  const reqTimeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(REQ_TIMEOUT_MS) : undefined;
  const isTimeout = e => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
  let proxyOff = false;
  async function viaProxy(f, mode){
    if (proxyOff || typeof fetch !== 'function') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: reqTimeout(),
        body: JSON.stringify({ persona: 'grader', mode: mode === 'verdict' ? 'verdict' : 'taunt',
          st: { tier: f.tier | 0, grade: f.grade || 'none', runN: f.runN | 0, dossierId: f.dossierId || 'A' } })
      });
      if (r.status === 404 || r.status === 501){ proxyOff = true; return null; }
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.text === 'string' && j.text.trim()) ? { text: j.text } : null;
    } catch(e){ if (isTimeout(e)) return null; proxyOff = true; return null; }   // 超时=这次兜底,不永久降级
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
