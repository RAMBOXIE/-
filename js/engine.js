"use strict";
/* ============================================================================
   运行时状态机 —— 宪法 2:一切判定由引擎裁决。
   数值出处:开发规格 v3.1 §4 + design/数值体系_v1.0.xlsx(可调参数的唯一数据源)。
   ============================================================================ */
const ENGINE = (() => {
  const _d = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const S = {
    battery: 100,
    trace: 0,             // 溯源,数字永远秘匿,玩家只见信号格
    clock: 2 * 60 + 12,   // 02:12,分钟
    dateStr: _d.getFullYear() + '-' + pad2(_d.getMonth() + 1) + '-' + pad2(_d.getDate()),
    cacheSlots: 0, cacheVal: 0,
    // UI 阶梯
    signalVisible: false, riskLabels: false,
    // 演出模式(上传收束起):信号格由剧本置位
    showtime: false, showtimeBars: 3,
    // 证据与线索
    evidence: {}, caseOpen: false, clues: {},
    violations: 0,
    actionCount: 0,        // D-112:每次 act() 记一次,给"N 步内完成上传"这类指令当计数底座
    deepInWindowHit: false,// D-112:窗口内做过一次"深搜"类动作(T_DEEP 陷阱的检测口径)
    // 节拍
    beats: { anomaly:false, midEnc:false, trial:false, trial2:false, exposure:false, dilemma:false },
    predictions: [],          // {target, hit}
    pendingPrediction: null,
    calib: [],                // {tension, control}(反应校准两问;canon M1 格8 验证项1/3 采集点)
    crisisSilenced: false,    // 自伤 break-glass:触发后本次接入柔柔通道静默(canon §9/M28 危机协议)
    pendAttr: false, attribution: null, attrAnswered: false,   // 14③ 归因卡(B8;canon M2 §2)
    reasons: [], lastWords: null, disposal: null,
    deletedVisited: false,
    dead: false, alive: false, exhausted: false, powerOut: false, causeOfDeath: '',
    // 反馈遥测
    log: [], t0: performance.now(), firstTelemetry: null,
    settle: []                // 最近结算行(叠加显示)
  };

  const now = () => Math.round(performance.now() - S.t0);
  function logEv(type, data){ S.log.push({ t: now(), type, ...data }); }

  const fmtClock = m => String(Math.floor(m / 60) % 24).padStart(2,'0') + ':' + String(m % 60).padStart(2,'0');
  const batSegs = () => Math.max(0, Math.min(4, Math.ceil(S.battery / 25)));
  const sigBars = () => {
    if (S.showtime) return S.showtimeBars;
    const t = S.trace;
    return t >= 90 ? 4 : t >= 70 ? 3 : t >= 40 ? 2 : 1;
  };
  const sigGlyph = b => '▂▄▆█'.slice(0, Math.max(1, b));

  /* 结算行:每次有后果的选择后打;首条时延=验证项 2 子项 */
  function telemetry(parts){
    const line = parts.join(' ｜ ');
    S.settle = [line];
    if (S.firstTelemetry === null){ S.firstTelemetry = now(); }
    logEv('telemetry', { line });
  }

  /* 动作结算。cost:{bat,trace,slots,val,mins}
     电量扣除必须可见:结算行永远带「−X → 余量%」。 */
  function act(name, cost, extraParts){
    S.actionCount++;
    if (name.indexOf('深搜') === 0 && inWindow()) S.deepInWindowHit = true;   // T_DEEP 检测口径
    const parts = [name];
    const barsBefore = sigBars();
    if (cost.bat){
      const before = S.battery;
      S.battery = Math.max(0, S.battery - cost.bat);
      parts.push('电量 −' + cost.bat + ' → ' + S.battery + '%');
      /* 扣电量=一下轻微抖屏,让"预算在流失"有体感;扣得多晃得略大 */
      LCD.shake(Math.min(2, .7 + cost.bat * .18), 130);
      if (before >= 20 && S.battery < 20){ parts.push('省电模式。判定 −15'); LCD.shake(2.6, 320); }  // 跌破 20% 一记重的
      if (S.battery === 0) S.powerOut = true;   // 力竭:content 在 afterAction 收束
    }
    if (cost.slots){ S.cacheSlots += cost.slots; S.cacheVal += cost.val || 0;
      parts.splice(1, 0, '缓存 +' + (cost.val || 0) + '(' + cost.slots + '格)'); }
    if (cost.trace){ S.trace = Math.min(120, S.trace + cost.trace);
      if (S.signalVisible) parts.push('信号 ▲'); }
    S.clock += (cost.mins ?? 4);
    const barsAfter = sigBars();
    if (S.signalVisible && barsAfter !== barsBefore)
      parts.push('信号 ' + sigGlyph(barsAfter) + ' ' + barsAfter + '格');
    if (extraParts) parts.push(...extraParts);
    telemetry(parts);
    LCD.applyTier(S.showtime ? (S.showtimeBars >= 4 ? 95 : 80) : S.trace);
    logEv('act', { name, bat: S.battery, trace: S.trace, cache: S.cacheVal, clock: fmtClock(S.clock) });
  }

  /* 判定:d100 ≤ 成功率。教学局总则:90 档失败降档执行 70 档表 */
  const CHECK = { c70: 78, c90: 55, final: 60, save: 50 };
  function roll(kind){
    let p = CHECK[kind];
    if (S.battery < 20) p -= 15;                 // 省电模式:判定劣化
    const d = Math.floor(Math.random() * 100) + 1;
    const ok = d <= p;
    logEv('roll', { kind, d, p, ok });
    return ok;
  }
  /* 教学局 90 档失败 → 降档(70 档表):电量−20,缓存损毁10–20%,信号+10 */
  function downgradeFail(){
    const lossPct = 10 + Math.floor(Math.random() * 11);
    const lost = Math.round(S.cacheVal * lossPct / 100);
    S.battery = Math.max(0, S.battery - 20);
    if (S.battery === 0) S.powerOut = true;
    S.cacheVal = Math.max(0, S.cacheVal - lost);
    S.trace = Math.min(120, S.trace + 10);
    return { lossPct, lost };
  }

  /* 活规则(秘匿):窗口内回复任何消息=违规(拨打电话不算回复)。
     A 局 03:00–03:14;B 局由 content 按 runCount 重摇(setRule)。 */
  const RULE = { from: 3 * 60, to: 3 * 60 + 14 };
  function setRule(from, to){ RULE.from = from; RULE.to = to; }
  const inWindow = () => S.clock >= RULE.from && S.clock <= RULE.to;
  function violate(){
    S.violations++;
    if (S.violations === 1){ S.trace = Math.min(120, S.trace + 8); return 'warn'; }
    S.trace = Math.min(120, S.trace + 15);
    return 'second';
  }

  /* 拨表:事件自带时间戳 */
  function setClock(h, m){ S.clock = h * 60 + m; }

  /* 反馈导出(跑测记录表的自动化);extra = content 注入的场景层字段 */
  function exportFeedback(extra){
    return JSON.stringify({
      version: 'M2-slice-0.3',
      ...(extra || {}),
      firstTelemetryMs: S.firstTelemetry,
      predictions: S.predictions,
      violations: S.violations,
      evidence: Object.keys(S.evidence),
      reasons: S.reasons, lastWords: S.lastWords,
      ending: S.alive ? 'disconnected' : S.dead ? (S.exhausted ? 'exhausted' : 'captured') : 'incomplete',
      causeOfDeath: S.causeOfDeath,
      cacheVal: S.cacheVal, battery: S.battery, clock: fmtClock(S.clock),
      log: S.log
    }, null, 1);
  }

  return { S, fmtClock, batSegs, sigBars, sigGlyph, telemetry, act, roll, downgradeFail,
           inWindow, violate, setClock, setRule, logEv, exportFeedback, RULE };
})();
