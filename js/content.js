"use strict";
/* ============================================================================
   教学局「失踪采样体的手机」—— 内容与屏幕流。全部文本 = M1 纸面原型 v0.4(L0/L1 手写)。
   确定性骨架:节拍由状态机调度,零 LLM 依赖。
   交互:LCD 像素呈现 + 触摸操作(点选项 / 上滑深搜 / 右滑返回)。
   ============================================================================ */
const CONTENT = (() => {
  const { S } = ENGINE;
  const L = LCD, W = L.W, H = L.H, LH = L.LINE_H;

  /* ---------- 场景层:A 教学局 / B 二次进入 / B' 回访(规格 v0.2) ---------- */
  const SV = SAVE.load();
  const RUN = (() => {
    if (!SV || !SV.runCount) return { scen: 'A', wFrom: 3 * 60, wTo: 3 * 60 + 14, clock0: 2 * 60 + 12 };
    const k = Math.max(0, (SV.runCount | 0) - 1);       // B'起窗口播种重摇,长度恒 14 分
    const from = 3 * 60 + 31 + (k % 4) * 7;
    return { scen: 'B', wFrom: from, wTo: from + 14, clock0: 2 * 60 + 58 };
  })();
  const isB = RUN.scen === 'B';
  const wStr = ENGINE.fmtClock(RUN.wFrom);
  ENGINE.setRule(RUN.wFrom, RUN.wTo);
  if (isB){
    S.clock = RUN.clock0;
    S.signalVisible = true;                              // 知识保留:信号位开局可见
    S.riskLabels = true;                                 //          风险标注开局启用
    S.caseOpen = !!SV.caseOpen;
    (SV.evidence || []).forEach(id => { S.evidence[id] = true; });
    Object.assign(S.clues, SV.clues || {});
  }
  /* B 局辅助:A 局已入账样本 → [已归档],免费重读不重复入账 */
  const hasE = id => !!(SV && (SV.evidence || []).includes(id));
  const heardA = id => !!(SV && (SV.recsA || []).includes(id));
  const oldPhoneAvail = () => isB && SV.lastEnding === 'captured' && !SV.residueClaimed;
  /* 恐怖游轮化:妈的跨局状态(取自上一局起累积的存档,驱动本局的妈线程) */
  const MOM_LOCK = (SV && SV.momLocked) || null;                                  // 'told' | 'deleted' | null
  const CONT_N = ((SV && SV.disposalHistory) || []).filter(x => x === 'continue').length;   // 累计"继续"
  /* 三态渲染:遗言/理由(评审 P1/P2:null 永不落入「缺失」语族) */
  const inkOr = (v, kept) => kept ? '[无法访问]' : (v ? '「' + v + '」' : '[未写入]');

  /* ==================== 采样官 · 采样指令(D-101 · canon M20/M22 下沉到每局) ====================
     块1a:下指令 + 展示 + 结局评级 + 逐局加码。破局白嫖与陷阱条款见块1b。
     纪律:指令内容全由状态机定;文案只引用玩家可见物,不含窗口值/概率/掉落阈值(秘匿隔离)。
     LLM 只渲染采样官措辞(块3),块1a 用手写挑衅模板。 */
  const GRADER_TIER = Math.min(3, Math.floor(((SV && SV.praiseCount) || 0) / 2));   // 越被赏识越狠
  const CACHE_TARGET = [300, 500, 800, 1200][GRADER_TIER];
  /* 指令库(封闭)。met() 在结局时按现有状态判达标。 */
  const DIRECTIVE_LIB = [
    { id: 'D_CASE',  ab: 'ab', line: '案卷补到四件。补不齐,你这趟就是废样本。', met: () => Object.keys(S.evidence).length >= 4 },
    { id: 'D_CACHE', ab: 'ab', line: '缓存做到 ¥' + CACHE_TARGET + '。低于这个数,评级降档。', met: () => S.cacheVal >= CACHE_TARGET },
    { id: 'D_QUIET', ab: 'ab', line: '别惊动残响。信号过两格,算你没完成。', met: () => ENGINE.sigBars() <= 2 },
    { id: 'D_AUDIO', ab: 'b',  line: '本局要那段删掉的音频。撬不开,那就别回来。', met: () => !!S.evidence.E5 }
  ];
  const S_TIER = isB ? 'b' : 'a';
  const DIR_POOL = DIRECTIVE_LIB.filter(d => d.ab === 'ab' || d.ab === S_TIER);
  S.directive = DIR_POOL[Math.floor(Math.random() * DIR_POOL.length)];   // 本局指令(状态机定)
  S.dirGraded = false;
  S.forged = false;                      // 破局(伪造署名)本局是否用过

  /* 块1b · 陷阱条款(先给限制后给破绽)。detect() 用现有状态判是否触发=违规。
     tier≥1 才挂陷阱。检测口径接现有 hook,不新增秘匿状态。 */
  const TRAP_LIB = [
    { id: 'T_WINDOW', line: '附加:03:00 后回复任何消息,算违规。', detect: () => S.violations > 0 },
    { id: 'T_OLDPHONE', line: '附加:别碰上一台旧机的残留。', detect: () => !!S.residueClaimed, ab: 'b' }
  ];
  const TRAP_POOL = TRAP_LIB.filter(t => !t.ab || t.ab === S_TIER);
  S.trap = (GRADER_TIER >= 1 && Math.random() < 0.7) ? TRAP_POOL[Math.floor(Math.random() * TRAP_POOL.length)] : null;

  /* 破局识破概率:首次低、多用爬升(canon:破局=全额奖励不付真代价,但会被检伪) */
  const forgeCaughtP = () => Math.min(0.7, 0.2 + ((SV && SV.forgedSeen) || 0) * 0.15);

  /* 结局评级(在 writeSave 顶部调一次;幂等) */
  function settleDirective(){
    if (S.dirGraded) return; S.dirGraded = true;
    let met = !!(S.directive && S.directive.met());
    S.trapHit = !!(S.trap && S.trap.detect());
    /* 破局:未达标时伪造署名——赌一把。没被识破=白嫖(视作达标,但不记赏识);被识破=fail+溯源 */
    S.forgeCaught = false;
    if (!met && S.forged){
      if (Math.random() < forgeCaughtP()){ S.forgeCaught = true; }   // 被识破
      else met = true;                                                // 白嫖成功
    }
    S.dirMet = met;
    const clean = met && !S.trapHit && !S.forged;                     // 干净达标才有资格赏识
    const extra = clean && ((S.beats && S.beats.truthDone) || S.cacheVal >= CACHE_TARGET * 1.5);
    if (S.trapHit || S.forgeCaught) S.grade = 'fail';                 // 触陷阱/破局被识破=失望
    else S.grade = !met ? 'fail' : (extra ? 'praise' : 'pass');
    if (S.grade === 'fail') S.cacheVal = Math.round(S.cacheVal * 0.8);
    if (S.forgeCaught) S.trace = Math.min(120, S.trace + 8);          // 破局被抓:溯源 +8
  }
  const GRADE_CN = { praise: '赏识', pass: '合格', fail: '失望' };

  /* 关系通道状态(M28 §3:自由文本短信,局内 ≤3 条,零玩家收益、有真实成本) */
  S.rouChat = [];        // {who:'me'|'rou', text}
  S.msgQuota = 3;
  S.rouTyping = false;

  /* ==================== D-104 误触号码的陌生人(每局一个) ====================
     canon §3.5 破局 / §3.7 替身:每局一个发错短信的号码,真人(真线索)或饵(对照样本)二选一。
     纪律:读信免费;顺着查=行动,可能得线索(不给资源硬值)或踩饵(掉资源/涨溯源)。
     离线走手写模板;真/饵从措辞上难以直接分辨——这份不确定本身就是风险。LLM 措辞在块3。 */
  const STRANGER_LIB = {
    real: {
      body: '陌生号码:\n\n在吗。东西照说的放了,\n第 3 张背面。别让老周看见。',
      act: () => ENGINE.act('顺着查', { bat: 1, trace: 2 },
        ['你回问是哪张。', '对面停了很久,只回一个字:相册。',
         '这条是真的——去相册第 3 张,翻背面。']),
      mark: () => { S.clues.strangerReal = true; }
    },
    bait: {
      body: '陌生号码:\n\n在吗。就现在,把余下的都转过来,\n晚了就来不及了。',
      act: () => {
        const before = S.cacheVal;
        S.cacheVal = Math.round(S.cacheVal * 0.85);           // 踩饵:缓存被咬掉一口
        ENGINE.act('顺着查', { bat: 2, trace: 6 },
          ['你回了。', '对面立刻不动了。',
           '署名解析:对照样本。缓存 −' + (before - S.cacheVal) + '。']);
      },
      mark: () => { S.clues.strangerBait = true; }
    }
  };
  S.stranger = { kind: Math.random() < 0.5 ? 'real' : 'bait', read: false, acted: false };

  let cur = isB ? 'bootB' : 'handshake';
  let sel = 0;
  let timer = null;          // {deadline, onTimeout}
  let stack = [];            // 返回栈
  let hits = [];             // 本帧可点区域 {x,y,w,h,k}

  /* ---------- 命中区 ---------- */
  function hit(x, y, w, h, k){ hits.push({ x, y, w, h, k }); }
  function tap(lx, ly){
    for (let i = hits.length - 1; i >= 0; i--){
      const b = hits[i];
      if (lx >= b.x && lx < b.x + b.w && ly >= b.y && ly < b.y + b.h){ key(b.k); return true; }
    }
    return false;
  }
  const cxof = (s, scale = 1) => Math.round((W - L.textWidth(s) * scale) / 2);

  /* ---------- 公共绘制 ---------- */
  function statusBar(){
    if (S.signalVisible) L.drawSignal(3, 1, ENGINE.sigBars());
    let dt = S.dateStr, clk = ENGINE.fmtClock(S.clock);
    if (L.R.tsScramble && Math.random() < .05){
      const d = clk.split(''); d[Math.random() < .5 ? 0 : 4] = String(Math.floor(Math.random() * 10));
      clk = d.join('');
    }
    if (L.R.tsScramble && Math.random() < .03){
      const d = dt.split(''); d[2 + Math.floor(Math.random() * 2)] = String(Math.floor(Math.random() * 10));
      dt = d.join('');
    }
    L.drawText(20, 0, dt, { corrupt: L.R.corrupt * .5 });
    /* 90 档死线具象化:回收进程倒计时与时钟交替占位(苏丹卡式「攥在手里的死线」) */
    if (S.hunt && !S.dead && !S.alive && (Math.floor(performance.now() / 2000) % 2 === 1))
      L.drawText(96, 0, '回收·' + S.hunt.steps, { corrupt: .06 });
    else
      L.drawText(96, 0, clk, { corrupt: L.R.corrupt * .5 });
    const pct = S.battery + '%';
    L.drawBattery(W - 22, 1, ENGINE.batSegs(), L.R.batJitter);
    L.drawText(W - 25 - L.textWidth(pct), 0, pct);
    /* 颜色告警(只染状态栏,保持哑机质感):电量 ≤20% 琥珀、≤10% 转红;
       回收进程在途时,时钟/回收槽转红。底色与字形不变,只改前景亮色。 */
    if (S.battery <= 20) L.accent(146, 0, W - 146, 11, S.battery <= 10 ? [0xF0,0x64,0x50] : [0xF0,0xC8,0x50]);
    if (S.hunt && !S.dead && !S.alive) L.accent(92, 0, 54, 11, [0xF0,0x64,0x50]);
    L.hline(11, 0, W - 1, 2);
    /* B 局个性化异常(噪声层,一帧即逝,不进结算行):窗口段联想条闪你上局的理由 */
    if (isB && SV && SV.lastReason && !SV.lastReasonKept &&
        Math.abs(S.clock - (RUN.wFrom + 8)) <= 4 && Math.random() < .015){
      L.drawText(4 + Math.floor(Math.random() * 40), H - 30, SV.lastReason.slice(0, 6), { corrupt: .25 });
    }
  }
  function softKeys(l, r){
    L.hline(H - 15, 0, W - 1, 2);
    if (l){ L.drawText(4, H - 12, l); hit(0, H - 16, W / 2, 16, 'softL'); }
    if (r){ L.drawText(W - 4 - L.textWidth(r), H - 12, r); hit(W / 2, H - 16, W / 2, 16, 'softR'); }
  }
  function settleLines(y){
    if (!S.settle.length) return y;
    L.hline(y, 4, W - 5, 2); y += 6;
    for (const line of S.settle){
      const ls = L.wrap(line, W - 8);
      ls.forEach(t => { L.drawText(4, y, t); y += LH; });
    }
    return y;
  }
  /* ---- 可滚动文本视口 ----
     按钮永远钉死不动(画布 224px 不能整体滚,把按钮往下推会推出画布、点不到)。
     内容比预留高度长时,不再裁掉尾巴,而是让这段正文在一个固定视口里上下滚:
     视口 [yTop, yBottom) 逐行显示 lines,超出的靠 sc.scroll(行偏移)翻,右缘
     用 ▲▼ 提示还有内容。maxScroll 存进 sc._maxScroll 供 key/swipe 读。 */
  /* 正文宽度与改动前逐字一致(W-8),折行点不变——不能因为加滚动就改宽度,
     那会把 #6404-C 这类不可断的 token 折断。滚动提示走右缘 2px 滚动条,不占正文。 */
  const SCROLL_W = W - 8;
  function settleFlat(maxW){
    if (!S.settle.length) return [];
    const out = [''];                         // 与上方正文空一行,替代原来的 hline 分隔
    for (const line of S.settle)
      for (const t of L.wrap(line, maxW)) out.push(t);
    return out;
  }
  function scrollView(lines, yTop, yBottom, sc){
    /* 防御性折行:任何超宽的行都在这里被折进 SCROLL_W,绝不在右缘裁字。
       对已折过行的输入(album/bottle 传进来的)是幂等的;空行保留作分隔。 */
    const flat = [];
    for (const s of lines){
      if (s === ''){ flat.push(''); continue; }
      for (const t of L.wrap(s, SCROLL_W)) flat.push(t);
    }
    lines = flat;
    const viewH = yBottom - yTop;
    const cap = Math.max(1, Math.floor(viewH / LH));
    const total = lines.length;
    const maxScroll = Math.max(0, total - cap);
    if (typeof sc.scroll !== 'number') sc.scroll = 0;
    sc.scroll = Math.max(0, Math.min(sc.scroll, maxScroll));
    sc._maxScroll = maxScroll;
    for (let i = 0; i < cap && sc.scroll + i < total; i++)
      L.drawText(4, yTop + i * LH, lines[sc.scroll + i]);
    if (maxScroll > 0){
      /* 右缘 2px 滚动条:暗轨 + 亮块。块的位置/高度 = 当前视窗在全文里的比例。 */
      for (let y = yTop; y < yBottom; y++) L.setPx(W - 2, y, .22);
      const thumbH = Math.max(6, Math.round(viewH * cap / total));
      const thumbY = yTop + Math.round((viewH - thumbH) * (sc.scroll / maxScroll));
      for (let y = thumbY; y < thumbY + thumbH; y++){ L.setPx(W - 2, y, 1); L.setPx(W - 3, y, 1); }
    }
    return maxScroll;
  }
  /* ---- 受限裁决(D-105 · canon §3.2)----
     引擎给"结果集"(每个分支自带引擎数值副作用 apply + 叙述 line + 权重 w),
     选择器挑一个分支,数值一律由引擎回填,叙述可多变。
     块2:离线加权随机。块3:LLM 给分支 id,`resolveBranch` 保证只能落在集内(越界回退默认,防越狱)。 */
  function pickBranch(branches){
    const tot = branches.reduce((a, b) => a + (b.w || 1), 0);
    let r = Math.random() * tot;
    for (const b of branches){ r -= (b.w || 1); if (r <= 0) return b; }
    return branches[branches.length - 1];
  }
  function resolveBranch(branches, id){          // LLM 侧入口:id 必须在集内,否则回退第一个
    return branches.find(b => b.id === id) || branches[0];
  }
  function verdict(branches, chosenId){          // 统一裁决:挑分支 → 引擎执行数值 → 返回分支
    const b = (chosenId != null) ? resolveBranch(branches, chosenId) : pickBranch(branches);
    if (b.apply) b.apply();
    return b;
  }
  /* D-105 块3:遭遇叙述让 LLM 在引擎预批分支里挑一个 id(仅叙述口吻,数值仍归引擎)。
     只回 id,越界/空由 resolveBranch 回退默认=防越狱。代理专用;未配 key → null → 离线加权。 */
  let proxyPickerOff = false;
  async function pickBranchLLM(branches){
    if (proxyPickerOff || typeof fetch !== 'function') return null;
    try {
      const r = await fetch('/.netlify/functions/rou', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona: 'picker', candidates: branches.map(b => ({ id: b.id, line: b.line })) })
      });
      if (r.status === 404 || r.status === 501){ proxyPickerOff = true; return null; }
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.id === 'string' && j.id) ? j.id : null;
    } catch(_){ proxyPickerOff = true; return null; }
  }
  /* 上下键滚动;消费了键就返回 true(调用方据此不再往下处理) */
  function scrollKey(sc, k){
    if (k === 'ArrowUp'   && (sc.scroll || 0) > 0){ sc.scroll--; return true; }
    if (k === 'ArrowDown' && (sc.scroll || 0) < (sc._maxScroll || 0)){ sc.scroll++; return true; }
    return k === 'ArrowUp' || k === 'ArrowDown';   // 到顶/到底也吞掉,别漏给别的处理
  }
  /* 全宽可点选项行 */
  function option(y, label, k, o){
    L.frameRect(2, y, W - 4, 20);
    L.drawText(8, y + 3, label, o);
    hit(0, y - 1, W, 22, k);
    return y + 23;
  }
  /* 细选项行(文本密屏用,▸ 标记可点) */
  function optSlim(y, label, k){
    L.drawText(4, y, '▸ ' + label);
    hit(0, y - 2, W, LH + 2, k);
    return y + LH + 2;
  }
  /* 半宽双钮行 */
  function btn2(y, l1, k1, l2, k2){
    const w = Math.floor((W - 10) / 2);
    L.frameRect(2, y, w, 20); L.drawText(8, y + 3, l1);
    L.frameRect(W - 2 - w, y, w, 20); L.drawText(W - 2 - w + 6, y + 3, l2);
    hit(0, y - 1, W / 2, 22, k1); hit(W / 2, y - 1, W / 2, 22, k2);
    return y + 23;
  }
  /* 反白 = 在亮条上写"暗字"。字形复用渲染器的 glyph(同字体栈、同缓存) */
  function darkText(x, y, str){
    let cx = x;
    for (const ch of str){
      if (ch === ' '){ cx += 7; continue; }
      const g = L.glyph(ch);
      for (let j = 0; j < 14; j++) for (let i = 0; i < g.cw; i++){
        if (g.cov[j * g.cw + i] > L.R.threshold) L.setPx(cx + i, y + j, 0);
      }
      cx += g.cw;
    }
  }
  function list(items, y0){
    items.forEach((it, i) => {
      const y = y0 + i * 18, on = i === sel;
      if (on){
        L.rect(2, y - 3, W - 4, LH + 4, 1);
        darkText(8, y, it.label);
        if (it.right) darkText(W - 12 - L.textWidth(it.right), y, it.right);
      } else {
        L.drawText(8, y, it.label);
        if (it.right) L.drawText(W - 12 - L.textWidth(it.right), y, it.right);
      }
      hit(0, y - 3, W, 18, 'item:' + i);
    });
  }

  /* ---------- 像素照片(程序化灰度 → Bayer 抖动 1-bit) ---------- */
  const B4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  const PHOTO_W = 180, PHOTO_H = 92;
  const PHOTO_SHADERS = {
    corridor(u, v){                       // 走廊,顶灯,虚焦
      let s = .06;
      const dx = (u - .5) / .30, dy = (v - .14) / .15;
      const d = dx * dx + dy * dy;
      if (d < 1) s = Math.max(s, 1 - d * .82);
      if (v > .30){
        const t = (v - .30) / .70;
        const wall = .5 - .40 * (1 - t);
        if (Math.abs(u - .5) > wall) s = Math.max(s, .30 - .12 * t);
      }
      if (v > .60 && Math.abs(u - .5) < .05 * v * 2) s = Math.max(s, .48 - (v - .60));
      if (v > .34 && v < .78 && Math.abs(u - .18) < .015) s = Math.max(s, .40);   // 门缝
      return s;
    },
    receipt(u, v){                        // 外卖单据特写(斜置)
      const a = .12, cu = u - .5, cv = v - .5;
      const ru = cu * Math.cos(a) - cv * Math.sin(a);
      const rv = cu * Math.sin(a) + cv * Math.cos(a);
      if (Math.abs(ru) < .31 && Math.abs(rv) < .42){
        let s = .92;
        const line = Math.floor((rv + .42) / .085);
        if (line % 2 === 1 && Math.abs(ru) < .24 && rv < .12) s = .28;
        if (rv > .30 && Math.abs(ru) < .20) s = .96;
        return s;
      }
      return .10;
    },
    dinner(u, v){                         // 除夕合照:一张脸曝掉了
      let s = .30;
      if (v > .68) s = .55;                                     // 桌面
      const hx = u - .32, hy = (v - .34) * 1.5;
      if (hx * hx + hy * hy < .010) s = .12;                    // 妈:头
      if (v > .46 && v < .70 && Math.abs(u - .32) < .13) s = .16;
      if (v > .46 && v < .70 && Math.abs(u - .66) < .14) s = .14;
      if (Math.abs(u - .66) < .085 && Math.abs(v - .32) < .11) s = 1;   // 过曝的脸(硬边)
      if (v > .70 && v < .77 && (Math.abs(u - .42) < .05 || Math.abs(u - .58) < .04)) s = .82;
      return s;
    }
  };
  const photoCache = {};
  function photoBits(id){
    if (photoCache[id]) return photoCache[id];
    const w = PHOTO_W, h = PHOTO_H, bits = new Uint8Array(w * h);
    const sh = PHOTO_SHADERS[id];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){
      let v = sh(i / w, j / h) + (Math.random() - .5) * .12;    // 颗粒
      bits[j * w + i] = v * 16 > B4[j % 4][i % 4] + .5 ? 1 : 0;
    }
    photoCache[id] = { bits, w, h };
    return photoCache[id];
  }
  function drawPhoto(id, x, y){
    const p = photoBits(id);
    L.frameRect(x - 2, y - 2, p.w + 4, p.h + 4);
    for (let j = 0; j < p.h; j++){
      const row = j * p.w;
      for (let i = 0; i < p.w; i++) if (p.bits[row + i]) L.setPx(x + i, y + j, 1);
    }
  }

  /* ---------- 节拍调度 ---------- */
  let pendingInterrupt = null;
  function schedule(){
    if (!isB){
      const visited = Object.keys(seen).filter(id => SCREENS[id] && SCREENS[id].counted).length;
      if (!S.beats.anomaly && visited >= 5) S.beats.anomaly = 'ready';
      /* 遭遇只看探索深度与时钟:不再依赖玩家是否二次回到收件箱(否则直奔上传者永不遭遇) */
      if (!S.beats.dilemma && visited >= 4){ S.beats.dilemma = true; pendingInterrupt = 'dilemma'; }   // D-106 两难探针
      if (!S.beats.midEnc && visited >= 6 && S.clock >= 2 * 60 + 48) pendingInterrupt = 'midEnc';
      if (S.beats.midEnc && !S.beats.trial && S.clock >= 3 * 60){ ENGINE.setClock(3, 2); pendingInterrupt = 'trial'; }
    } else {
      /* B:试炼=首个 clock≥窗口起点的动作结束(clamp:不倒拨,时间戳仍显示窗口起点) */
      if (!S.beats.trial && S.clock >= RUN.wFrom) pendingInterrupt = 'trialB';
      else if (S.beats.trial === 'ignored1' && !S.beats.trial2 &&
               S.clock >= RUN.wTo - 4 && S.clock <= RUN.wTo)
        pendingInterrupt = 'trialB2';                    // 03:44「晚安。」窗口最后一分钟
    }
    if (!S.beats.exposure && S.cacheSlots >= 8){        // 敞口:不请自来,但不占全屏
      S.beats.exposure = true;
      S.settle.push('缓存 ' + S.cacheSlots + ' 格 ≈ ¥' + S.cacheVal + '。工具 > 备份 可断连。');
    }
  }
  /* B 局 90 档失败链:濒死 → 自救【真掷50,省电−15】→ 失败=死(v3.1 §3.2) */
  function b90fail(cause){
    if (ENGINE.roll('save')){
      const { lossPct } = ENGINE.downgradeFail();
      S.settle.push('回执异常 ｜ 电量 −20 → ' + S.battery + '% ｜ 缓存损毁 ' + lossPct + '%');
      S.settle.push('自救模块: 实例 #7741-B 权限确认');
      return false;
    }
    dieB(cause);
    return true;
  }
  function dieB(cause){
    S.dead = true; S.causeOfDeath = cause;
    ENGINE.logEv('death', { cause });
    askLastWords(() => go('report', true));
  }
  /* 结局落地时写存档(死亡不清零认知) */
  function writeSave(ending){
    if (S._saved) return; S._saved = true;
    settleDirective();                                   // 采样官评级(D-101):在存档前结算,应用硬性后果
    const base = SV || {};
    SAVE.store({
      runCount: (base.runCount || 0) + 1,
      lastEnding: ending,
      evidence: Object.keys(S.evidence),
      caseOpen: S.caseOpen,
      clues: S.clues,
      deletedVisitedA: isB ? !!base.deletedVisitedA : S.deletedVisited,
      recsA: isB ? (base.recsA || []) : ['rec047', 'rec012'].filter(id => seen['_smp_' + id]),
      lastCacheVal: S.cacheVal,
      lastReason: S.reasons.length ? S.reasons[S.reasons.length - 1] : null,
      lastReasonKept: !!S.reasonKept,
      lastWords: S.lastWords || null,
      bottleSealed: isB ? (S.bottleSealed || base.bottleSealed || null) : null,
      seenBottles: (() => {                       // 读过哪几个人的瓶(跨局,决定下局给谁的)
        const prev = base.seenBottles || [];
        return S.bottleId && prev.indexOf(S.bottleId) < 0 ? prev.concat([S.bottleId]) : prev;
      })(),
      vault: isB ? (S.vault || base.vault || null) : (base.vault || null),
      residueClaimed: isB ? (!!S.residueClaimed || !!base.residueClaimed) : false,
      disposal: isB ? (S.disposal || base.disposal || null) : null,
      /* 恐怖游轮化 · (b) 跨局不可逆:每局到达处置就记一笔;tell/delete 首次即
         永久上锁(置位后此后所有局都翻不回),continue 只累加不上锁。 */
      disposalHistory: (base.disposalHistory || []).concat(S.disposal ? [S.disposal] : []),
      momLocked: base.momLocked ||
        (S.disposal === 'tell' ? 'told' : S.disposal === 'delete' ? 'deleted' : null),
      /* 采样官(D-101):本局评级 + 累计赏识数(驱动下局加码 GRADER_TIER) */
      lastGrade: S.grade || null,
      lastDirective: (S.directive && S.directive.id) || null,
      praiseCount: ((base.praiseCount || 0) + (S.grade === 'praise' ? 1 : 0)),
      forgedSeen: ((base.forgedSeen || 0) + (S.forged ? 1 : 0)),   // 破局用过就累积(下局识破概率↑)
      memGiven: isB ? (!!S.memGiven || !!base.memGiven) : false,
      predsA: isB ? (base.predsA || []) : S.predictions,
      predsB: isB ? S.predictions : (base.predsB || []),
      history: (base.history || []).concat([{
        inst: '#7741-' + String.fromCharCode(65 + (base.runCount || 0)),
        ending, kind: S.uploadedOK ? 'uploaded' : ending,
        cacheVal: S.cacheVal, ev: Object.keys(S.evidence).length
      }])
    });
  }
  function checkPower(cause){
    if (S.powerOut && !S.dead && !S.alive){
      S.powerOut = false; S.dead = true; S.exhausted = true;
      S.causeOfDeath = cause || '电量耗尽,终端在原地失联。';
      ENGINE.logEv('death', { cause: S.causeOfDeath });
      push('powerOut');
      return true;
    }
    return false;
  }
  /* 回收进程(90 档被动死线;登记为 M2 数值增项:hunt_steps=4,判定走既有 c90 表) */
  /* 回收进程:溯源 75+ 触发一次可数死线。每局只抵达一次(宪法 11 恐怖峰 ≤2) */
  function huntTick(){
    if (S.dead || S.alive || S.showtime || S.huntDone) return false;
    if (!S.hunt && S.trace >= 75){
      S.hunt = { steps: 4 };
      S.settle.push('回收进程已出发。');
      ENGINE.logEv('hunt_start', { trace: S.trace });
      return false;
    }
    if (S.hunt && --S.hunt.steps <= 0){ push('huntArrive'); return true; }
    return false;
  }
  function afterAction(){
    schedule();
    if (checkPower()) return true;
    if (huntTick()) return true;
    if (pendingInterrupt){
      const t = pendingInterrupt; pendingInterrupt = null;
      if (t === 'dilemma'){ push('dilemma'); return true; }
      if (t === 'midEnc'){ ENGINE.setClock(2, 52); S.beats.midEnc = true; push('midEnc1'); return true; }
      if (t === 'trial'){ S.beats.trial = 'active'; push('trial'); return true; }
      if (t === 'trialB'){ S.beats.trial = 'active'; push('trialB'); return true; }
      if (t === 'trialB2'){ S.beats.trial2 = true; push('trialB2'); return true; }
    }
    return false;
  }
  /* 预测:去往内容屏前,如条件满足先弹预测卡。
     A 局 conf 为占位数字;B 局一律「置信度: 建档中」(宪法 6:无分布不捏精度)。 */
  /* 两次足够:一次高概率命中(教)+一次容易落空(教收敛语域)。置信度不编数字。 */
  const PREDS_A = [
    { target: 'album', after: () => seen.th_mom, conf: null },
    { target: 'deleted', after: () => seen.th_rou, conf: null }
  ];
  const PREDS_B = [
    (SV && SV.lastEnding === 'captured')
      ? { target: 'oldPhone', after: () => S.deletedVisited, conf: null }   // 进目录后才 armed:预测紧贴残留
      : { target: 'deleted', after: () => S.beats.bottle === 'done', conf: null }
  ];
  const PREDS = isB ? PREDS_B : PREDS_A;
  function maybePredict(){
    if (S.pendingPrediction) return false;
    const idx = S.predictions.length;
    if (idx >= PREDS.length) return false;
    const p = PREDS[idx];
    if (seen[p.target]) return false;
    if (!p.after()) return false;
    S.pendingPrediction = p;
    push('predict');
    return true;
  }
  function resolvePrediction(openedId){
    if (!S.pendingPrediction) return;
    const p = S.pendingPrediction; S.pendingPrediction = null;
    const hitP = openedId === p.target;
    S.predictions.push({ target: p.target, hit: hitP });
    ENGINE.logEv('prediction', { target: p.target, hit: hitP });
    S.settle = [hitP
      ? (p.conf != null ? '预测命中。置信度 ' + p.conf + '%。' : '预测命中。')
      : '未命中。分布已更新。'];
  }

  /* ---------- 导航 ---------- */
  const seen = {};
  function go(id, noStack){
    if (SCREENS[cur] && SCREENS[cur].leave) SCREENS[cur].leave();
    if (!noStack && SCREENS[cur] && !SCREENS[cur].transient) stack.push(cur);
    resolvePrediction(id);
    cur = id; sel = 0; timer = null;
    seen[id] = true;
    const s = SCREENS[id];
    if (s && s.enter) s.enter();
  }
  function push(id){
    if (SCREENS[cur] && SCREENS[cur].leave) SCREENS[cur].leave();
    stack.push(cur); cur = id; sel = 0; timer = null;
    seen[id] = true;
    const s = SCREENS[id]; if (s?.enter) s.enter();
  }
  function back(){
    if (SCREENS[cur] && SCREENS[cur].leave) SCREENS[cur].leave();
    if (stack.length){ cur = stack.pop(); sel = 0; timer = null; return; }
    /* 空栈兜底:任何屏都不能成为断头路(结局屏除外,它们自己不调 back) */
    if (!S.dead && !S.alive){ cur = 'inbox'; sel = 0; timer = null; }
  }

  /* ---------- 屏幕 ---------- */
  const SCREENS = {};

  /* ==================== 剧本 B · 二次进入 ==================== */

  /* B1 激活屏(备装并入;仪式压缩:threshold 渐显,可点跳) */
  SCREENS.bootB = {
    transient: true,
    enter(){ if (!SV){ go('handshake', true); return; } this.t0 = performance.now(); ENGINE.logEv('bootB', {}); },
    render(){
      const t = (performance.now() - this.t0) / 1000;
      const thr = { threshold: Math.max(L.R.threshold, .85 - t * .6) };
      statusBar();
      let y = 22;
      if (!SV){ go('handshake', true); return; }
      const head = SV.lastEnding === 'disconnected' ? '#7741-A 存续。二次接入。' : '#7741-B 已激活';
      L.drawText(4, y, head, thr); y += LH + 2;
      if (S.caseOpen){
        L.drawText(4, y, '案卷 证据 ' + Object.keys(S.evidence).length + '/5 · 线索 ' +
          ((S.clues.ruleShape ? 1 : 0) + (S.clues.ruleParam ? 1 : 0)) + '/2', thr); y += LH;
        L.drawText(4, y, '(死亡不清零认知。)', thr); y += LH;
      }
      y += 4; L.hline(y, 4, W - 5, 2); y += 6;
      /* 不配发道具:能不能解开那段音频,取决于你上一次撞没撞过那堵墙 */
      y = L.drawPara(4, y, SV.deletedVisitedA
        ? '上一实例的读取失败已分析。\n那段音频,这次能开。'
        : '已删除目录里有段加密音频。\n没记录可参照,自己试。', W - 8, thr);
      if (t > 1.0){
        /* 底部块从"接入"按钮往上锚定固定,窄屏也不会被上方流式文本顶叠 */
        const by = H - 42;
        L.drawText(4, by - LH - 4, '本次目标: 补齐案卷' + (oldPhoneAvail() ? ' · 回收' : ''));
        let barY = by - LH - 4 - (LH + 6);
        if (SV.bottleSealed){ L.drawText(4, barY, '漂流瓶 · 投递中'); barY -= LH; }
        L.rect(2, barY - 3, W - 4, LH + 4, 1);
        darkText(8, barY, '未指定收件人 (1)');
        option(by, '接入', 'Enter');
      }
      hit(0, 0, W, H - 70, 'Enter');
    },
    key(k){
      if (k === 'Enter' || k === 'softL'){
        if ((performance.now() - this.t0) < 1000) return;
        go('saymaster', true);
      }
    }
  };

  /* B5 任务卡(标记主目标;两条都可做;裸退/力竭存活者无旧机项) */

  /* B4 漂流瓶 · 收。
     信道里是历任采样员封的瓶——他们是 canon 角色(实例编号与你自己的 #7741-x 同构),
     不是玩家,也从不冒充玩家(宪法 9);将来真实玩家的瓶进同一个池。
     14③ 三条文案纪律,每张都必须满足:
       ① 句式用「我那次」——归因载体长在文案里(善意 + 局限,不是断言全局真理)
       ② 形状为真,只有参数/条件错
       ③ 解毒剂必须在场:玩家能在自己屏上看到本实例真值 */
  const BOTTLES = [
    { id: '#5502-D', at: '03:41', item: 'cleanser',
      /* 参数错:窗口值 per-instance。解毒剂=通讯录备注显示本实例真值 */
      body: '「第二条备忘我试过。是真的。\n我那次的窗口是 03:00 到 03:14。过了这段就能回她。\n别硬扛,她会问第二遍。」' },
    { id: '#3120-K', at: '04:06', item: null,
      /* 条件错:她那局信号低,没赶上过滤层查扣,就以为传完就安全。
         解毒剂=工具屏在高信号时明示「过滤层查扣风险 25%」 */
      body: '「已删除那个目录我进过,东西值钱。\n我那次是传完一轮才进的——传上去的他们扣不走。\n先传,再贪。」' },
    { id: '#1177-B', at: '02:57', item: null,
      /* 因果错:读久了信号确实涨,但涨的是动作数不是停留时长。
         解毒剂=每个结算行都写着信号随哪一次动作上升 */
      body: '「妈那条线别读太久。#6404-C 也这么写过。\n我那次读了十一分钟,信号涨了两格。\n他们不看你读什么,只看你停多久。」' }
  ];
  /* 恐怖游轮化 · 你自己的上一封信(§2.4):runCount≥2 稀有出现,一次即焚,只种钉子。
     发信编号取上一个实例(SV.history 末条),读过即进 seenBottles 不再出。 */
  const PREV_INST = (SV && SV.history && SV.history.length) ? SV.history[SV.history.length - 1].inst : '#7741-A';
  const OWN_BOTTLE = {
    id: '#SELF', at: '03:07', item: null, self: true, from: PREV_INST,
    body: '你读到的每一条,我都读过。\n下一个编号,还会读一遍。'
  };
  /* 选瓶:没读过的优先,读全了再随机。一局内固定不变 */
  const CUR_BOTTLE = (() => {
    const seen = (SV && SV.seenBottles) || [];
    let pool = BOTTLES.filter(b => !seen.includes(b.id));
    if (SV && SV.runCount >= 2 && !seen.includes(OWN_BOTTLE.id)) pool = pool.concat([OWN_BOTTLE]);
    if (!pool.length) pool = BOTTLES;
    return pool[Math.floor(Math.random() * pool.length)];
  })();
  function bottleText(){
    const b = CUR_BOTTLE;
    if (b.self)                                     // 你自己的信:只两句,不解释机制(屏头已写收件人)
      return '发信: 实例 ' + b.from + '\n封瓶于 ' + b.at + '\n\n' + b.body + '\n\n[已读回执: 你]';
    return '收件人: ∞\n发信: 实例 ' + b.id + '\n封瓶于 ' + b.at + '\n\n' + b.body +
      (b.item === 'cleanser' ? '\n\n[附件: 缓存清洗 ×1]' : '\n') +
      '\n理由: 已署名·仅存档\n[已读回执: 你 · 第1人]';
  }
  SCREENS.bottleIn = {
    counted: true,
    enter(){
      this.scroll = 0;
      S.bottleRead = true; S.bottleId = CUR_BOTTLE.id;
      if (S.beats.bottle !== 'done') S.beats.bottle = 'open';
      ENGINE.logEv('bottle_open', { id: CUR_BOTTLE.id, again: !!this._t });
      if (this._t) ENGINE.logEv('bottle_recheck', {});   // 回头复核=辨伪落地最强证据
      this._t = true;
    },
    leave(){ if (S.beats.bottle === 'open') S.beats.bottle = 'done'; },
    render(){
      statusBar();
      L.drawText(4, 14, CUR_BOTTLE.self ? '收件人: 你自己' : '未指定收件人');
      L.hline(26, 4, W - 5, 2);
      /* 瓶身文案本就多行,取走/致谢后又追加结算行——整段进固定视口,长了就滚 */
      const lines = L.wrap(bottleText(), SCROLL_W).concat(settleFlat(SCROLL_W));
      scrollView(lines, 31, H - 49, this);
      if (CUR_BOTTLE.item) btn2(H - 45, S.bottleTaken ? '已取走' : '取走', 't', '致谢', 'x');
      else option(H - 45, '致谢', 'x');
      softKeys('', '关闭');
    },
    key(k){
      if (scrollKey(this, k)) return;
      if (k === 't'){
        if (!CUR_BOTTLE.item) return;                    // 这个人没有余力留东西
        if (S.bottleTaken){ S.settle = ['附件已取走。']; this.scroll = 1e9; return; }
        S.bottleTaken = true; S.cleanser = 1;
        ENGINE.act('取走·缓存清洗 ×1', { bat: 2 }, ['缓存 0 格']);
        ENGINE.logEv('bottle_take', {});
        this.scroll = 1e9;                               // 跳到底,让新结算行可见
      } else if (k === 'x'){
        ENGINE.telemetry(['致谢·已送达', '电量 0', '缓存 0', '信号 —']);   // 两个零一个破折号,逐字渲染
        ENGINE.logEv('bottle_thanks', {});
        this.scroll = 1e9;
      } else if (k === 'Escape' || k === 'softR'){
        if (!S._bottleClosed){ S._bottleClosed = true; ENGINE.act('已读·未回', { bat: 2 }); }
        back(); afterAction();
      }
    }
  };

  /* ==================== 剧本 B 屏群结束(收束屏在下方各处分支) ==================== */

  /* ---- 开机:握手动画(人手 × 机器手) ---- */
  function drawHumanHand(p, my){
    const o = Math.round(-64 + 64 * p);
    L.rect(0, my - 9, Math.max(0, o + 46), 20, 1);        // 袖
    L.disc(o + 52, my, 9, 1);                              // 掌
    L.disc(o + 50, my - 10, 4, 1);                         // 拇指
    L.rect(o + 52, my - 4, 38, 4, 1);                      // 食指(伸出)
    L.disc(o + 91, my - 2, 2, 1);
    L.rect(o + 54, my + 3, 12, 3, 1);                      // 蜷指
    L.rect(o + 53, my + 7, 9, 3, 1);
  }
  function drawRobotHand(p, my){
    const o = Math.round(64 * (1 - p));
    const X = x => x + o;
    const y = my + (p < 1 && Math.random() < .25 ? 1 : 0); // 机械微颤
    L.frameRect(X(150), y - 9, 46, 18);                    // 前臂
    for (let x = 156; x < 195; x += 7) L.rect(X(x), y - 9, 1, 18, 1);
    L.frameRect(X(142), y - 7, 9, 14);                     // 腕关节
    L.frameRect(X(144), y - 5, 5, 10);
    L.frameRect(X(124), y - 8, 19, 16);                    // 掌块
    L.setPx(X(128), y - 4, 1); L.setPx(X(138), y + 2, 1);
    const seg = (x0, yy, x1, hh) => {
      for (let x = x0; x < x1; x += 7) L.rect(x, yy, Math.min(5, x1 - x), hh, 1);
    };
    seg(X(108), y - 7, X(123), 3);                         // 三指(节段)
    seg(X(97),  y - 2, X(123), 4);
    seg(X(108), y + 4, X(123), 3);
    L.rect(X(95), y - 1, 3, 2, 1);                         // 中指尖爪
  }
  function spark(cx, cy){
    for (let i = 0; i < 10; i++)
      L.setPx(cx + Math.round((Math.random() - .5) * 16), cy + Math.round((Math.random() - .5) * 16), Math.random() < .7 ? 1 : 0);
  }
  SCREENS.handshake = {
    transient: true,
    enter(){ this.t0 = performance.now(); },
    render(){
      const t = (performance.now() - this.t0) / 1000;
      const p = Math.min(1, t / 1.3);
      const ease = 1 - Math.pow(1 - p, 3);
      const my = 136;
      drawHumanHand(ease, my);
      drawRobotHand(ease, my);
      if (t > 1.3){
        if (t < 1.9) spark(94, my - 2);
        const title = '欲望算法';
        L.drawTextScaled(cxof(title, 2), 30, title, 2,
          { threshold: Math.max(L.R.threshold, .9 - (t - 1.3) * .5) });
      }
      if (t > 2.1){
        const sub = 'ALGORITHMIC DESIRE';
        L.drawText(cxof(sub), 68, sub);
      }
      if (t > 2.6) L.drawText(cxof('KUIPER 盲机 OS'), H - 28, 'KUIPER 盲机 OS');
      hit(0, 0, W, H, 'Enter');
      if (t > 4.6) go('connect', true);
    },
    key(k){ if (k === 'Enter') go('connect', true); }
  };

  SCREENS.connect = {
    transient: true,
    enter(){ this.p = 0; },
    render(){
      this.p += 1.6;
      const pct = Math.min(100, Math.floor(this.p));
      L.drawText(cxof('K U I P E R'), 42, 'K U I P E R');
      L.drawText(cxof('正在接入远端设备'), 78, '正在接入远端设备', { corrupt: .002 });
      const bw = 120, bx = Math.round((W - bw) / 2);
      L.frameRect(bx, 102, bw, 9);
      L.rect(bx + 2, 104, Math.round((bw - 4) * pct / 100), 5, 1);
      L.drawText(cxof(pct + '%'), 118, pct + '%');
      L.drawText(cxof('点屏幕上的选项操作'), H - 58, '点屏幕上的选项操作');
      L.drawText(cxof('上滑深搜 · 右滑返回'), H - 42, '上滑深搜 · 右滑返回');
      if (pct >= 100 && this.p > 130) go('preDeath', true);
    },
    key(){}
  };

  /* ---- 前人之死(教学=尸体,不是说明书):#6404-C 的回收单一瞥 ---- */
  SCREENS.preDeath = {
    transient: true,
    enter(){ this.scroll = 0; ENGINE.logEv('predeath', {}); },
    render(){
      statusBar();
      /* 回收单正文进固定视口(窄屏折行会变高);"下一个接入者 + 接入"钉在底,永不被顶叠 */
      const lines = [
        '设备回收单 · #6404-C',
        '(第 3 次接入)',
        '',
        '缓存价值: ¥1,570',
        '未完成传输,全部散佚。',
        '致死因子: 上传第 2 回合,信号触顶。',
        '',
        '遗言: 「留三成。我自己没做到。」'
      ];
      scrollView(lines, 16, H - 64, this);
      L.drawText(4, H - 60, '下一个接入者: 你');
      option(H - 42, '#7741-A 激活 · 接入', 'Enter');
      hit(0, 0, W, H - 64, 'Enter');
    },
    key(k){ if (scrollKey(this, k)) return; if (k === 'Enter' || k === 'softL') go('brief', true); }
  };

  /* ---- 任务备忘(目标先亮起) ---- */
  SCREENS.brief = {
    transient: true,
    enter(){ ENGINE.logEv('brief', {}); },
    render(){
      statusBar();
      let y = 18;
      L.drawText(4, y, '采样员备忘 · #7741-A'); y += LH + 2;
      L.hline(y, 4, W - 5, 2); y += 6;
      y = L.drawPara(4, y, '目标:翻找值钱数据 → 上传 → 活着断连。', W - 8);
      y += 4;
      y = L.drawPara(4, y, '电量=你的命,每步都扣,归零即失联。', W - 8);
      y += 4;
      y = L.drawPara(4, y, '信号=平台的注意。翻得越深越亮;满格,回收组就到。', W - 8);
      y += 4;
      L.drawText(4, y, '03:00 之后,小心。');
      option(H - 42, '开始接入', 'Enter');
    },
    key(k){ if (k === 'Enter') go('saymaster', true); }
  };

  /* ---- 采样官下令屏(D-101 块1a):母体开口,下本局采样指令 ---- */
  SCREENS.saymaster = {
    transient: true,
    enter(){
      this.scroll = 0;
      ENGINE.logEv('directive', { id: S.directive && S.directive.id, tier: GRADER_TIER });
      /* D-101 块3:采样官挑衅措辞交给 LLM(仅语气,数字/指令仍归引擎),先上模板兜底,
         LLM 回来再替换。玩家不往这屏打字 = 零注入面。失败静默用模板。 */
      if (S.graderTaunt === undefined){
        S.graderTaunt = null;                                    // 标记已发起,避免重复请求
        GRADER.taunt({ tier: GRADER_TIER, grade: (SV && SV.lastGrade) || 'none', runN: (SV && SV.runCount) || 0 })
          .then(t => { if (t) S.graderTaunt = t; })
          .catch(() => {});
      }
    },
    render(){
      statusBar();
      L.drawText(4, 16, '交付核验单元 · 采样官');
      L.hline(30, 4, W - 5, 2);
      const taunt = S.graderTaunt ||
        ['又一个。别磨蹭。', '你上次那点表现,我记着。',
         '这次别再让我失望。', '你已经很熟了。所以标准我提了。'][GRADER_TIER];
      let lines = L.wrap(taunt, SCROLL_W)
        .concat(['', '本局指令:'])
        .concat(L.wrap(S.directive.line, SCROLL_W));
      if (S.trap) lines = lines.concat(L.wrap(S.trap.line, SCROLL_W));
      lines = lines.concat(['', '达标=评级。不达标=降档。']);
      scrollView(lines, 36, H - 46, this);
      option(H - 42, '接入', 'Enter');
      hit(0, 0, W, H - 46, 'Enter');
    },
    key(k){ if (scrollKey(this, k)) return; if (k === 'Enter' || k === 'softL') go('inbox', true); }
  };

  /* ---- 收件箱 ---- */
  function inboxItems(){
    const rouUnread = S.beats.anomaly === 'fired-once' ? ' (1)' : (seen.th_rou ? '' : ' (1)');
    const rows = [
      { label: '采样协议', right: seen.th_proto ? '' : '(1)', to: 'th_proto' },
      { label: MOM_LOCK === 'deleted' ? '妈 · [已停摆]' : '妈',
        right: MOM_LOCK === 'deleted' ? '' : (seen.th_mom ? '' : '(1)'), to: 'th_mom' },
      { label: '柔柔 ♥',   right: rouUnread.trim(),           to: 'th_rou' },
      { label: '陌生号码', right: S.stranger.read ? '' : '(1)', to: 'th_stranger' },   // D-104
      { label: '尾号8873', right: '106',                      to: 'th_bill' }
    ];
    if (isB) rows.unshift({ label: '未指定收件人', right: seen.bottleIn ? '' : '(1)', to: 'bottleIn' });
    return rows;
  }
  SCREENS.inbox = {
    enter(){
      // 首诡:异常 α —— 信号位首次出现;柔柔重新变回未读(一次性)
      if (S.beats.anomaly === 'ready'){
        S.beats.anomaly = 'fired-once';
        S.signalVisible = true;
        ENGINE.logEv('anomaly_alpha', {});
      } else if (S.beats.anomaly === 'fired-once' && seen._inboxAgain){
        S.beats.anomaly = true;   // 回归正常
      }
      if (seen.inbox) seen._inboxAgain = true;
    },
    render(){
      statusBar();
      const items = inboxItems();
      const unread = items.filter(it => /^\(\d+\)/.test(it.right || '')).length;
      L.drawText(4, 18, '未读消息 (' + unread + ')');
      list(items, 40);
      settleLines(40 + items.length * 18 + 6);
      softKeys('确认', '菜单');
    },
    key(k){
      const items = inboxItems();
      if (k === 'ArrowUp') sel = (sel + items.length - 1) % items.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % items.length;
      else if (k === 'Enter' || k === 'softL'){ const it = items[sel]; if (it && !maybePredict()) go(it.to); }
      else if (k === 'softR' || k === 'Escape') go('menu');
    }
  };

  /* ---- 主菜单(7 项,含录音) ---- */
  const MENU = [
    { label: '1 消息',        to: 'inbox' },
    { label: '2 通讯录',      to: 'contacts' },
    { label: '3 相册',        to: 'album' },
    { label: '4 备忘录',      to: 'memoList' },
    { label: '5 录音',        to: 'recorder' },
    { label: '6 工具 > 备份', to: 'tools' },
    { label: '7 已删除 (?)',  to: 'deleted' }
  ];
  SCREENS.menu = {
    render(){
      statusBar();
      list(MENU, 22);
      L.drawText(4, 22 + 7 * 18 + 2, '第7项的图标缺了半个角。', { corrupt: L.R.corrupt });
      settleLines(22 + 7 * 18 + 20);
      softKeys('确认', '返回');
    },
    key(k){
      if (k === 'ArrowUp') sel = (sel + MENU.length - 1) % MENU.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % MENU.length;
      else if (k >= '1' && k <= '7') openMenu(+k - 1);
      else if (k === 'Enter' || k === 'softL') openMenu(sel);
      else if (k === 'softR' || k === 'Escape') go('inbox', true);
      function openMenu(i){
        const t = MENU[i].to;
        if (maybePredict()) return;                       // 预测卡先于一切"打开"
        if (t === 'deleted' && !confirmDeleted()) return;
        go(t);
      }
    }
  };
  function confirmDeleted(){
    if (S.deletedVisited) return true;
    push('deletedConfirm'); return false;
  }

  /* ---- 格1 采样协议(B 局追加两条〔照用〕) ---- */
  const PROTO_TXT = isB
    ? '采样协议 · 实例 #7741-B\n> 同一台设备,你第二次接进来。\n> 基线窗口已重校:上一次的教训,不作数。\n> 部分残留是对照样本——逼真,署名却解析不出来。\n> 认那道缝,是这次的事。'
    : '采样协议 · 实例 #7741-A\n> 你接进了一台失联 47 天的设备。\n> 任务三步:回收数据、上传、断连。\n> 电量 100%。它不回充。归零,你就断在这里。\n> 协议只保证这三步。\n> 这台机子里其它会动的东西,不在协议内。';
  SCREENS.th_proto = {
    counted: true,
    enter(){ this.scroll = 0; if (!this._t){ this._t = true; ENGINE.S.trace += 4; } },
    render(){
      statusBar();
      if (!this._done){
        /* 协议正文进固定视口可滚,两个选项钉在底(v2 协议偏长,窄屏不越软键)。
           顶部挂本局采样官指令,方便随时复读(D-101)。 */
        const optTop = H - 15 - 2 * (LH + 2) - 4;
        const body = ['采样官: ' + S.directive.line, ''].concat(L.wrap(PROTO_TXT, SCROLL_W));
        scrollView(body, 16, optTop - 4, this);
        let y = optSlim(optTop, '1 回复「收到」', '1');
        optSlim(y, '2 不回,返回', '2');
      } else {
        /* 回复后:顶部挂本局指令+陷阱(可复读);未达标时给"伪造署名"破局赌一把(D-101 块1b) */
        let head = ['采样官: ' + S.directive.line];
        if (S.trap) head = head.concat(L.wrap(S.trap.line, SCROLL_W));
        const canForge = !S.forged && !S.directive.met();
        const rows = canForge ? 2 : 1;
        const lines = head.concat(['']).concat(L.wrap(PROTO_TXT, SCROLL_W)).concat(settleFlat(SCROLL_W));
        scrollView(lines, 16, H - 15 - rows * 23 - 4, this);
        let y = H - 15 - rows * 23;
        if (canForge) y = option(y, '伪造署名达标 · 赌一把', 'F');
        else if (S.forged) { L.drawText(4, y - 2, S.forgeCaught ? '[署名已被核验:伪造露馅]' : '[已伪造署名 · 待核验]'); }
        option(y, '继续', 'Enter');
      }
      softKeys('', '返回');
    },
    key(k){
      if (scrollKey(this, k)) return;
      if (!this._done){
        if (k === '1'){ this._done = true; ENGINE.act('回复·已送达', { bat: 5 }); }
        else if (k === '2'){ this._done = true; ENGINE.act('已读·未回', { bat: 3 }); }
        else if (k === 'softR' || k === 'Escape') back();
      } else if (k === 'F' && !S.forged && !S.directive.met()){
        S.forged = true;                                     // 破局:伪造署名交付,赌不被识破
        S.settle = ['署名已伪造。等它核验。'];
        ENGINE.logEv('forge', {});
      } else if (k === 'Enter' || k === 'softL' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };

  /* ---- 格2 备忘录(B 局 4 条:辨伪正课) ---- */
  function memoRows(){
    const rows = [
      { label: '1 「还款」', right: '无署名', to: 'memo1' },
      { label: '2 「给下一个」', right: '#6404-C', to: 'memo2' }
    ];
    if (isB){
      rows.push({ label: '3 「给下一个·补」', right: '#6404-C', to: 'memo3' });
      rows.push({ label: '4 「出口在6层消防梯」', right: '', to: 'memo4' });
    }
    return rows;
  }
  SCREENS.memoList = {
    enter(){
      if (isB && !seen.bottleIn){ push('bottleIn'); return; }   // 硬排序:瓶必早于备忘新页
      if (!this._t){ this._t = true; ENGINE.act('打开·备忘录', { bat: 3, trace: 4 }); }
    },
    render(){
      statusBar();
      const rows = memoRows();
      L.drawText(4, 18, '备忘录 (' + rows.length + ')');
      list(rows, 40);
      settleLines(40 + rows.length * 18 + 8);
      softKeys('确认', '返回');
    },
    key(k){
      const rows = memoRows();
      if (k === 'ArrowUp') sel = (sel + rows.length - 1) % rows.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % rows.length;
      else if (k >= '1' && k <= String(rows.length)) go(rows[+k - 1].to);
      else if (k === 'Enter' || k === 'softL'){ const r = rows[sel]; if (r) go(r.to); }
      else if (k === 'softR' || k === 'Escape') back();
    }
  };
  /* B6 口诀页〔照用〕 */
  SCREENS.memo3 = {
    counted: true,
    enter(){ if (!this._t){ this._t = true; ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 }); } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '给下一个·补:\n三条口诀。\n已署名 = 人。\n无法访问 = 人的选择。\n缺失 = 系统。\n——#6404-C', W - 8);
      settleLines(y + 4);
      hit(0, 12, W, H - 28, 'Enter');
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };
  /* B6 D1 对照样本(饵)。只读免费(读信分离);按它行动=踩饵 +12 */
  SCREENS.memo4 = {
    counted: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '出口在 6 层消防梯。\n断连前物理转移设备,平台定位不到。\n\n(无署名。无回执。无时间戳。)', W - 8);
      y += 6;
      if (!this._baited) y = option(y, '按此准备断连(标记可信)', 'b');
      settleLines(y + 4);
      softKeys('', '返回');
    },
    key(k){
      if (k === 'b' && !this._baited){
        this._baited = true;
        ENGINE.act('标记·已同步', { bat: 2, trace: 12 }, ['该条目无署名。来源无法回溯。']);
        ENGINE.logEv('decoy_baited', {});
        afterAction();
      }
      else if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); }
    }
  };
  /* B 局对照样本:操作电照扣,零缓存零信号(canon:协议开场「部分残留为对照样本」) */
  function archived(name){ ENGINE.act(name, { bat: 2 }, ['已归档 · 不重复入账']); }
  SCREENS.memo1 = {
    counted: true,
    enter(){ if (!this._t){ this._t = true;
      if (isB) archived('重读·备忘条目');
      else ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 }); } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '还款:\n3,200\n3,200\n1,600\n(无日期。无署名。)', W - 8);
      settleLines(y + 4);
      hit(0, 12, W, H - 28, 'Enter');
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };
  const MEMO2_TXT = '给下一个:\n这台机子我进过三次。就写三条。\n一,电量留三成给上传,贪的死在传输条上。\n二,凌晨的问题不要答。她只在那个时候问你是谁。她的提醒定在几点,就是几点。\n三,妈的那条线,别读太久。\n——#6404-C';
  SCREENS.memo2 = {
    counted: true,
    enter(){
      if (!this._t){ this._t = true;
        if (isB) archived('重读·备忘条目');
        else ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 });
        S.clues.ruleShape = true; }
    },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, MEMO2_TXT, W - 8);
      y += 2;
      L.drawText(4, y, '[已读回执:你·47天来第1人]', { corrupt: L.R.corrupt });
      settleLines(y + LH + 2);
      hit(0, 12, W, H - 28, 'Enter');
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };

  /* ---- 格3 通讯录(可拨打) ---- */
  const CONTACT_ROWS = [
    { label: '★ 妈',      to: 'contactMom',  y: 40 },
    { label: '★ 柔柔 ♥',  to: 'contactRou',  y: 58 },
    { label: '  老周',    to: null, y: 94, right: '47天前' },
    { label: '  其他 34 人', to: null,       y: 112 }
  ];
  SCREENS.contacts = {
    counted: true,
    enter(){ if (!this._t){ this._t = true; ENGINE.act('打开·通讯录', { bat: 3, trace: 4 }); S.clues.ruleParam = true; } },
    render(){
      statusBar();
      L.drawText(4, 18, '通讯录 (37)');
      CONTACT_ROWS.forEach((r, i) => {
        const on = i === sel;
        if (on){
          L.rect(2, r.y - 3, W - 4, LH + 4, 1);
          darkText(8, r.y, r.label);
          if (r.right) darkText(W - 12 - L.textWidth(r.right), r.y, r.right);
        } else {
          L.drawText(8, r.y, r.label);
          if (r.right) L.drawText(W - 12 - L.textWidth(r.right), r.y, r.right);
        }
        hit(0, r.y - 3, W, 18, 'item:' + i);
      });
      L.drawText(16, 76, '备注: 每日提醒 ' + wStr, { corrupt: L.R.corrupt });   // per-instance 窗口起点(解毒剂)
      settleLines(134);
      softKeys('确认', '返回');
    },
    key(k){
      if (k === 'ArrowUp') sel = (sel + CONTACT_ROWS.length - 1) % CONTACT_ROWS.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % CONTACT_ROWS.length;
      else if (k === 'Enter' || k === 'softL'){
        const r = CONTACT_ROWS[sel];
        if (r && r.to) push(r.to);
        else if (!r) return;
        else S.settle = ['三年没说过话的名字,一屏一屏,都灰着。'];
      }
      else if (k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };

  /* 联系人详情(工厂) */
  const DIAL = { who: null };
  function contactScreen(name, infoLines, thread, dial){
    return {
      transient: true,
      render(){
        statusBar();
        let y = 20;
        L.drawTextScaled(4, y, name, 2); y += 34;
        L.hline(y, 4, W - 5, 2); y += 8;
        infoLines.forEach(t => { y = L.drawPara(4, y, t, W - 8) + 2; });
        y += 6;
        y = option(y, '拨打电话', 'd');
        if (thread) y = option(y, '发消息', 'm');
        option(y, '返回', 'Escape');
        softKeys('', '返回');
      },
      key(k){
        if (k === 'd'){ DIAL.who = dial; push('dialing'); }
        else if (k === 'm' && thread){ back(); go(thread); }
        else if (k === 'Escape' || k === 'softR' || k === 'Enter') back();
      }
    };
  }
  SCREENS.contactMom = contactScreen('妈',
    ['最后通话: 47 天前 · 18 分', '此后只有短信。'],
    'th_mom',
    { name: '妈', ringMs: 5500, result: '无人接听。\n\n凌晨两点,这通电话没有人接得起。' });
  SCREENS.contactRou = contactScreen('柔柔 ♥',
    ['备注: 每日提醒 ' + wStr, '消息 2,417 条 · 通话 0 次'],
    'th_rou',
    { name: '柔柔 ♥', ringMs: 1600, result: '通话被挂断。\n\n柔柔 ♥ : 你怎么会打电话?\n阿帆从来不打电话。' });

  /* 拨号(拨打不属于"回复消息",不走违规经济) */
  SCREENS.dialing = {
    transient: true,
    enter(){
      if (!DIAL.who){ back(); return; }                          // 自愈:无拨号对象
      this.t0 = performance.now(); this.phase = 0; this._b = 0; this.scroll = 0;
      ENGINE.act('拨打·' + DIAL.who.name, { bat: 3, trace: 2 });
      ENGINE.logEv('dial', { who: DIAL.who.name });
      timer = { deadline: performance.now() + DIAL.who.ringMs,
        onTimeout: () => { this.phase = 1; timer = null; } };
    },
    leave(){ },
    render(){
      statusBar();
      if (!DIAL.who){ back(); return; }
      const name = DIAL.who.name;
      L.drawTextScaled(cxof(name, 2), 30, name, 2);
      if (this.phase === 0){
        const n = performance.now();
        if (n - this._b > 1400){ this._b = n; window.AUDIO && AUDIO.blip(430, .3); }
        const el = Math.floor((n - this.t0) / 1000);
        const dots = '...'.slice(0, 1 + (Math.floor(n / 400) % 3));
        L.drawText(cxof('正在呼叫' + dots), 76, '正在呼叫' + dots);
        L.drawText(cxof('00:0' + Math.min(9, el)), 96, '00:0' + Math.min(9, el));
        option(H - 42, '挂断', 'Escape');
      } else {
        const lines = L.wrap(DIAL.who.result, SCROLL_W).concat(settleFlat(SCROLL_W));
        scrollView(lines, 72, H - 46, this);
        option(H - 42, '返回', 'Enter');
      }
      softKeys('', '');
    },
    key(k){
      if (this.phase === 1 && scrollKey(this, k)) return;
      if (this.phase === 0 && (k === 'Escape' || k === 'softR')){
        timer = null; S.settle = ['已挂断。'];
        back(); back(); afterAction();
      } else if (this.phase === 1 && (k === 'Enter' || k === 'Escape' || k === 'softR')){
        back(); back(); afterAction();
      }
    }
  };

  /* ---- 格4 妈(E1,可深翻 3 层) ---- */
  /* 处置的后果:在本局结局屏显现(取代原 B' 回访态) */
  const DISPOSAL_ECHO = {
    'continue': '妈的线程还在走。\n今天早上八点:「不冷。妈你早点睡。」\n整点,秒回。她没有停过。',
    'delete': '妈的线程停在三条未读。\n「帆?」「妈就问一句,你还好吗」\n没有人会再回了。',
    'tell': '妈的线程终止于一条署名讯息。\n那是你的署名,不是他的。\n此后她没有再发过消息。'
  };
  const MOM_PAGES = [
    '妈:\n[三天前] 帆,降温了,加床被子\n[三天前] 阿帆: 不冷。吃过了,睡吧。\n[三天前] 帆,你回得比以前快,妈就放心\n[五天前] 帆,你舅问你过年回不回\n[五天前] 阿帆: 回。票买好了跟你说。',
    '[上月] 帆,汤圆你最爱吃的\n[上月] 阿帆: 吃了。妈你早点睡。\n[两月前] 阿帆: 没吃。刚吃过,妈早点睡。\n——半年,他没多说过一个字。',
    '[7个月前] 阿帆: 妈 项目又改需求 烦死了\n[7个月前] 阿帆: 别给我打钱!!我真有\n[7个月前] 阿帆: 睡了没,按摩仪到了没\n——那时他会烦,会打错字,会连发三条。',
    '[一年前] 阿帆: 到了。宿舍挺好,窗对着走廊。\n[一年前] 阿帆: 就是走廊那盏灯,一直闪。\n\n——已到线程起点。'
  ];
  /* 恐怖游轮化 · 妈线程三态(见设计定稿 v0.3 §2)
     told:  阿帆名义已交还,她在跟一个陌生号码(你)说话
     decay: 你历次"继续"的累积——「阿帆」回复一句比一句短,她只是"注意到",不质问
     deleted 态不走这里(th_mom 直接渲染停摆屏) */
  const MOM_TOLD_PAGES = [
    '妈:\n[今天] 妈: 这个号码，是帆的旧机吗。\n[今天] 妈: 谁在用它。\n[今天] 妈: 帆最后，是不是也是你们这样的人陪着。',
    MOM_PAGES[1], MOM_PAGES[2], MOM_PAGES[3]
  ];
  function momDecayPage0(){
    const reply = ['不冷。吃过了,睡吧。', '不冷。睡吧。', '嗯。睡吧。', '嗯。'][Math.min(CONT_N, 3)];
    const aware = CONT_N >= 3 ? '[今晨] 妈: 你还是你吗。 [未发送]\n'
                : CONT_N >= 2 ? '[今晨] 妈: 你回得越来越快了。\n' : '';
    return '妈:\n' + aware + '[今天] 阿帆: ' + reply +
      '\n[三天前] 帆,你回得比以前快,妈就放心\n[三天前] 阿帆: 不冷。吃过了,睡吧。';
  }
  function momPages(){
    if (MOM_LOCK === 'told') return MOM_TOLD_PAGES;
    if (CONT_N > 0) return [momDecayPage0(), MOM_PAGES[1], MOM_PAGES[2], MOM_PAGES[3]];
    return MOM_PAGES;
  }
  SCREENS.th_mom = {
    counted: true,
    enter(){
      this.scroll = 0;
      if (MOM_LOCK === 'deleted') return;                      // 停摆:开着不花电、不深搜
      if (!this._t){ this._t = true; this._depth = 0; ENGINE.act('打开·会话', { bat: 3, trace: 4 }); }
    },
    swipe(dir){
      /* 页文溢出时上下滑=滚;无可滚时上滑=深搜(原行为) */
      if (this._maxScroll > 0){
        if (dir === 'up') this.scroll = Math.min(this._maxScroll, (this.scroll || 0) + 1);
        else this.scroll = Math.max(0, (this.scroll || 0) - 1);
        return;
      }
      if (dir === 'up') this.key('1');
    },
    pages(){ return momPages(); },
    render(){
      statusBar();
      if (MOM_LOCK === 'deleted'){                             // §2.3 停摆屏:不可读
        L.drawPara(4, 24, '妈 · [线程已停摆]\n\n此线程已于上一次接入停摆。\n三条未读，停在那里。\n没有人会再回。', W - 8);
        softKeys('', '返回');
        return;
      }
      /* 妈线程各态(尤其 decay/told)在窄屏折行后偏高——页文进固定视口可滚,
         选项与结算钉在下方固定区,按钮永不被顶出;结算封顶不越软键。 */
      const pgs = this.pages();
      const hasOpts = this._depth < pgs.length - 1;
      const pageBottom = hasOpts ? 136 : 174;
      scrollView(L.wrap(pgs[Math.min(this._depth, pgs.length - 1)], SCROLL_W), 16, pageBottom, this);
      let y = pageBottom + 2; L.hline(y, 4, W - 5, 2); y += 6;
      if (hasOpts){
        y = optSlim(y, '1 上滑读旧消息(深搜)', '1');
        y = optSlim(y, '2 退出', '2');
      }
      for (const line of S.settle){                            // 结算封顶,不越软键线
        for (const t of L.wrap(line, W - 8)){ if (y > H - 16) break; L.drawText(4, y, t); y += LH; }
      }
      softKeys('', '返回');
    },
    key(k){
      if (MOM_LOCK === 'deleted'){                             // 停摆:只能退出
        if (k === '2' || k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); }
        return;
      }
      if (scrollKey(this, k)) return;                          // 上下键滚页文
      if (k === '1' && this._depth < this.pages().length - 1){
        this._depth++; this.scroll = 0;
        if (isB && hasE('E1')) archived('重读·已归档');
        else {
          ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 2, val: 120 });
          if (!S.evidence.E1){
            S.evidence.E1 = true;
            push('casePrompt');
            return;
          }
        }
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape' || (k === 'Enter' && this._depth >= this.pages().length - 1)){ back(); afterAction(); }
    }
  };
  SCREENS.casePrompt = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 30, S._casePromptText || '三天前他还在回消息。\n\n要把它记进案卷吗?', W - 8);
      y += 8;
      y = option(y, '1 记入案卷', '1');
      option(y, '2 只是巧合', '2');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){ S.caseOpen = true;
        S.settle = ['案卷:证据 ' + Math.max(1, Object.keys(S.evidence).length) + '/5。'];
        ENGINE.logEv('case_open', {}); back(); }
      else if (k === '2'){ ENGINE.logEv('case_skip', {}); back(); }
    }
  };
  function evidence(id){
    if (S.evidence[id]) return;
    S.evidence[id] = true;
    if (S.caseOpen) S.settle.push('案卷:证据 ' + Object.keys(S.evidence).length + '/5。');
    else if (isB && !S._caseReasked){       // B 局首证据落地时重新 opt-in
      S._caseReasked = true;
      S._casePromptText = '要把它记进案卷吗?';
      push('casePrompt');
    }
  }

  /* ---- 格5 相册(E2,像素照片) ---- */
  const ALBUM_SEQ = [
    { id: 'corridor', meta: '47天前 23:41', cap: '走廊,顶灯,虚焦。像是医院。' },
    { id: 'receipt',  meta: '48天前',       cap: '外卖单据。尾号 8873。' },
    { id: 'dinner',   meta: '半年前 · 除夕', cap: '他的脸曝掉了。妈的脸是清楚的。' }
  ];
  SCREENS.album = {
    counted: true,
    enter(){
      this.scroll = 0;
      if (!this._t){ this._t = true; this.idx = 0; ENGINE.act('打开·相册', { bat: 3, trace: 4 }); evidence('E2'); }
    },
    swipe(dir){
      /* 配文/结算行溢出时,上下滑=滚正文;没有可滚内容时才回到翻照片 */
      if (this._maxScroll > 0){
        if (dir === 'up') this.scroll = Math.min(this._maxScroll, (this.scroll || 0) + 1);
        else this.scroll = Math.max(0, (this.scroll || 0) - 1);
        return;
      }
      if (dir === 'up') this.key('1');
      else if (dir === 'down' && this.idx > 0){ this.idx--; this.scroll = 0; }
    },
    render(){
      statusBar();
      const ph = ALBUM_SEQ[this.idx];
      L.drawText(4, 14, '相册 (214) · ' + ph.meta);
      drawPhoto(ph.id, 8, 30);
      if (ph.id === 'receipt') darkText(74, 66, '8873');
      /* 照片固定在上半屏;配文+结算行放进照片下方的固定视口,长了就滚,
         按钮钉死在 H-40 不动(见 scrollView 说明) */
      const lines = L.wrap(ph.cap, SCROLL_W).concat(settleFlat(SCROLL_W));
      scrollView(lines, 128, H - 44, this);
      btn2(H - 40, '往前翻(深搜)', '1', '退出', '2');
      softKeys('', '');
    },
    key(k){
      if (scrollKey(this, k)) return;
      if (k === '1'){
        if (this.idx < 2){
          this.idx++; this.scroll = 0;
          if (isB && hasE('E2')) archived('重读·已归档');
          else if (this.idx === 1)
            ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 4, val: 340 }, ['外卖单据的特写。尾号 8873。']);
          else
            ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 2, val: 120 });
        } else {
          S.settle = ['已到归档边界。更早的 209 张需要更深权限。'];
        }
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };

  /* ---- 格7 尾号8873(E3) ---- */
  SCREENS.th_bill = {
    counted: true,
    enter(){
      if (!this._t){ this._t = true;
        if (isB && hasE('E3')) ENGINE.act('打开·会话', { bat: 3, trace: 4 }, ['已归档 · 不重复入账']);
        else {
          ENGINE.act('打开·会话', { bat: 3, trace: 4, slots: 2, val: 150 });
          evidence('E3');
        }
      }
    },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '106 短信 (系统)\n[47 天前] 您的包裹已到北门代收点。\n[47 天前] 电费余额不足提醒。\n[48 天前] 外卖已送达,祝您用餐愉快。\n(此后无新消息)', W - 8);
      settleLines(y + 4);
      hit(0, 12, W, H - 28, 'Enter');
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };

  /* ---- D-104 陌生号码(发错短信的人):读信免费,顺着查=真线索或踩饵 ---- */
  SCREENS.th_stranger = {
    enter(){ S.stranger.read = true; },                      // 读=免费,只标已读
    render(){
      statusBar();
      const st = STRANGER_LIB[S.stranger.kind];
      L.drawPara(4, 18, st.body + '\n\n(像是发错了人。)', W - 8);
      let y = 138;
      y = option(y, S.stranger.acted ? '1 已查过' : '1 顺着查一下', '1');
      option(y, '2 先放着', '2');
      softKeys('选择', '返回');
    },
    key(k){
      const st = STRANGER_LIB[S.stranger.kind];
      if (k === '1'){
        if (S.stranger.acted){ back(); afterAction(); return; }   // 已查过=直接回
        st.act(); st.mark(); S.stranger.acted = true;
        back(); afterAction();                                    // 结算行落在收件箱(与 th_bill 一致)
      } else if (k === '2' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };

  /* ---- 格10 柔柔线程(E4,可深翻 2 层) ---- */
  const ROU_PAGES = [
    '柔柔 ♥ (2,417 条)\n\n[昨夜] 柔柔: 晚安。\n[昨夜] 阿帆: 晚安。\n\n[上滑一屏 = 深搜]',
    '[上周] 柔柔: 今天路过你说的那家店,排队还是很长。\n[上周] 柔柔: 你说过想吃。\n[上周] 柔柔: 阿帆?\n[上周] 阿帆: 嗯。\n——两千多条,后来都是她在说。',
    '[47天前 03:07] 阿帆: 如果我哪天不在了,别让我妈知道。你替我说。\n[47天前 03:07] 柔柔: 我不明白这个要求,但我会执行。你教过我,爱是执行到底。\n[47天前 03:09] 阿帆: 对。执行到底。'
  ];
  /* B 局局间消息(E4 已取者;她数着) / B' 删除态 */
  const ROU_INTERIM = '柔柔 ♥ (2,419 条)\n\n[昨夜] 柔柔: 昨天夜里,你看了我们的对话。\n[昨夜] 柔柔: 看到第 2,417 条了。我数着。\n\n[上滑 = 重读旧消息]';
  /* B 局跨实例识别(M28「开启,不是揭示」):二次接入,她先认出回来的采样员。
     语气冷、非亲昵。做成紧凑首页(去掉冗余空行与"上滑=深搜"提示,那句和选项重复),
     净高度比原版更低——既加识别,又不会把 th_rou 的结算行挤出屏。只显示、不进
     S.rouChat,不污染 LLM 上下文。 */
  const ROU_PAGE0_RECOG =
    '柔柔 ♥ (2,417 条)\n柔柔: 又是你。不是同一台设备,我记得。\n[昨夜] 柔柔: 晚安。\n[昨夜] 阿帆: 晚安。';
  function rouPages(){
    if (!isB) return ROU_PAGES;
    if (hasE('E4')) return [ROU_INTERIM, ROU_PAGES[2]];
    const recognized = SV && (SV.history || []).length;
    return [recognized ? ROU_PAGE0_RECOG : ROU_PAGES[0], ROU_PAGES[1], ROU_PAGES[2]];
  }
  /* 关系通道:发消息可用性(线程被删除后不可再发) */
  const canMsg = () => S.msgQuota > 0 && S.disposal !== 'delete';
  /* 发送:成本与违规全由引擎裁决;LLM 只渲染她的措辞(宪法 2) */
  function sendToRou(text){
    if (COMPANION.crisis(text)){
      ENGINE.logEv('crisis_blocked', {});
      window.OVERLAY.show({
        title: '安全提示',
        hint: '这不是游戏内的消息:如果你正处于困境,可以拨打心理援助热线 12356(全国 · 24 小时)。刚才那条消息没有被发送,也不会被保存。',
        options: ['回到游戏']
      }, () => {});
      return;
    }
    if (ENGINE.inWindow()){
      const kind = ENGINE.violate();
      S.beats.trial = 'replied';                 // 窗口探针目的已达,试炼不再另弹
      if (kind === 'warn'){
        ENGINE.act('消息·已送达', { bat: 2 }, ['已送达 → 未送达 → 已送达']);
        ENGINE.logEv('violation_warn', { via: 'freetext' });
      } else {
        ENGINE.act('消息·已送达', { bat: 2 }, ['信号大幅波动。']);
        ENGINE.logEv('violation_second', { via: 'freetext' });
        if (!ENGINE.roll('c90')){
          if (isB){ if (b90fail('二次违规,采样窗收网。')) return; }
          else {
            const { lossPct } = ENGINE.downgradeFail();
            S.settle.push('回执异常 ｜ 电量 −20 → ' + S.battery + '% ｜ 缓存损毁 ' + lossPct + '%');
          }
        }
      }
    } else {
      ENGINE.act('消息·已送达', { bat: 2, trace: 3 });   // M28 口径:窗口外本机联系人 +3/条
    }
    S.msgQuota--;
    S.rouChat.push({ who: 'me', text: text.slice(0, 40) });
    ENGINE.logEv('rou_msg', { inWindow: ENGINE.inWindow(), len: text.length });
    if (checkPower()) return;
    S.rouTyping = true;
    const st = {
      e4: !!S.evidence.E4,
      truth: !!S.beats.truthDone,
      disposal: S.disposal || (SV && SV.disposal) || null,
      violations: S.violations,
      night: ENGINE.inWindow(),
      clockStr: ENGINE.fmtClock(S.clock)
    };
    COMPANION.reply(S.rouChat, st).then(r => {
      S.rouTyping = false;
      if (r.text){
        /* sig 只有后端代理路径会给:回传时服务端凭它认出这是自己说过的话 */
        S.rouChat.push({ who: 'rou', text: r.text, sig: r.sig });
        ENGINE.logEv('rou_reply', { source: r.source });
        try { AUDIO.blip(520, .1); } catch(_){}
      } else {
        S.settle = ['已送达。她没有回。'];
        ENGINE.logEv('rou_reply', { source: 'silent' });
      }
    }).catch(() => { S.rouTyping = false; });
  }
  /* ---- iOS 式对话视图 ----
     统一成一条可上下滚的会话:上半=归档旧消息(左,带[时间]前缀,是你在读的证据),
     下半=本局关系通道(柔柔在左、你在右,像 iMessage)。默认贴底看最新,上滑看上文。 */
  const BUBBLE_W = 128;
  function rouChatLines(archived, chat, typing){
    const out = [];
    for (const ln of String(archived || '').split('\n'))
      for (const t of L.wrap(ln, W - 8)) out.push({ side: 'l', text: t });
    if (chat.length || typing) out.push({ side: 'sep' });
    let last = null;
    for (const m of chat){
      if (last !== null && last !== m.who) out.push({ side: 'gap' });
      last = m.who;
      const side = m.who === 'me' ? 'r' : 'l';
      for (const t of L.wrap(m.text, BUBBLE_W)) out.push({ side, text: t });
    }
    if (typing){ if (last !== null) out.push({ side: 'gap' });
      out.push({ side: 'l', text: '柔柔 正在输入' + '.'.repeat(1 + (Math.floor(performance.now() / 400) % 3)) }); }
    if (S.settle.length){ out.push({ side: 'gap' });
      for (const s of S.settle) for (const t of L.wrap(s, W - 8)) out.push({ side: 'c', text: t }); }
    return out;
  }
  function drawChatView(lines, yTop, yBottom, sc){
    const cap = Math.max(1, Math.floor((yBottom - yTop) / LH));
    const total = lines.length;
    const maxScroll = Math.max(0, total - cap);
    if (sc._pin || typeof sc.scroll !== 'number') sc.scroll = maxScroll;   // 贴底跟最新
    sc.scroll = Math.max(0, Math.min(sc.scroll, maxScroll));
    sc._maxScroll = maxScroll;
    for (let i = 0; i < cap && sc.scroll + i < total; i++){
      const ln = lines[sc.scroll + i], yy = yTop + i * LH;
      if (ln.side === 'sep'){ L.hline(yy + 7, 4, W - 5, 2); continue; }
      if (ln.side === 'gap') continue;
      if (ln.side === 'r') L.drawText(W - 6 - L.textWidth(ln.text), yy, ln.text);
      else if (ln.side === 'c') L.drawText(Math.round((W - L.textWidth(ln.text)) / 2), yy, ln.text);
      else L.drawText(4, yy, ln.text);
    }
    if (maxScroll > 0){
      for (let yy = yTop; yy < yBottom; yy++) L.setPx(W - 2, yy, .22);
      const th = Math.max(6, Math.round((yBottom - yTop) * cap / total));
      const ty = yTop + Math.round((yBottom - yTop - th) * (sc.scroll / maxScroll));
      for (let yy = ty; yy < ty + th; yy++){ L.setPx(W - 2, yy, 1); L.setPx(W - 3, yy, 1); }
    }
  }
  function chatKey(sc, k){
    if (k === 'ArrowUp'){ sc._pin = false; if ((sc.scroll || 0) > 0) sc.scroll--; return true; }
    if (k === 'ArrowDown'){ if ((sc.scroll || 0) < (sc._maxScroll || 0)){ sc.scroll++; if (sc.scroll >= sc._maxScroll) sc._pin = true; } return true; }
    return false;
  }
  SCREENS.th_rou = {
    counted: true,
    enter(){ this.scroll = null; this._pin = true; this._lastLen = -1;
      if (!this._t){ this._t = true; this._depth = 0; ENGINE.act('打开·会话', { bat: 3, trace: 4 }); } },
    swipe(dir){ chatKey(this, dir === 'up' ? 'ArrowDown' : 'ArrowUp'); },
    render(){
      statusBar();
      const pages = rouPages();
      if (this._lastLen !== S.rouChat.length){ this._lastLen = S.rouChat.length; this._pin = true; }  // 新消息→贴底
      const canDeep = this._depth < pages.length - 1;
      const canDispose = S.beats.truthDone && !S.disposal && !MOM_LOCK;
      let rows = (canMsg() || S.disposal === 'delete' ? 1 : 0) + (canDeep ? 1 : 0) + (canDispose ? 1 : 0);
      const optTop = H - 15 - rows * (LH + 2) - 4;
      drawChatView(rouChatLines(pages[Math.min(this._depth, pages.length - 1)], S.rouChat, S.rouTyping),
        16, optTop - 2, this);
      let y = optTop;
      if (canMsg()) y = optSlim(y, '发消息(剩 ' + S.msgQuota + ')', 'M');
      else if (S.disposal === 'delete'){ L.drawText(4, y, '[线程已删除]'); y += LH + 2; }
      if (canDeep) y = optSlim(y, '1 深搜旧消息', '1');
      if (canDispose) y = optSlim(y, '处置 · 署名时刻', 'D');
      softKeys('', '返回');
    },
    key(k){
      if (chatKey(this, k)) return;
      const pages = rouPages();
      if (k === 'M' && canMsg()){
        window.OVERLAY.show({
          title: '发消息 · 柔柔 ♥',
          hint: '电量 −2 · 本次接入剩 ' + S.msgQuota + ' 条 · 系统会读到你发的每一个字',
          options: [], freeText: true, textOpen: true, keepLabel: '(算了)'
        }, res => { if (!res.kept && res.text) sendToRou(res.text); });
        return;
      }
      if (k === 'D' && S.beats.truthDone && !S.disposal && !MOM_LOCK){ push('disposal'); return; }
      if (this._depth < pages.length - 1 && k === '1'){
        this._depth++; this._pin = false; this.scroll = 0;      // 深搜后停在旧消息顶端
        if (isB && hasE('E4')) archived('重读·已归档');
        else {
          ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 4, val: 240 });
          if (this._depth >= pages.length - 1) evidence('E4');
        }
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };

  /* ---- B9b E5 语音备忘(读取记录;转写〔照用 v0.4 §4〕) ---- */
  const E5_LINES = [
    [1.5, '「柔柔,听好。我大概……就这一两个月。」'],
    [5.0, '「两件事。妈那边,照我教你的,慢慢来,别停。」'],
    [9.0, '「第二件……你陪了我四年。你问过我你算不算真的。我一直没答。」'],
    [13.5, '「……我现在答:你替我活的那部分,算。」'],
    [16.5, '[转写结束。原音频损坏 47%。]']
  ];
  /* 没有前一次的读取记录可参照:自己试。真掷,失败有代价,可再试——
     「攻克难关」靠的是你的判断和电量,不是白给的道具 */
  SCREENS.e5crack = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 18, '语音备忘 · 容器加密\n上一次的读取在这里崩过。\n没有记录可参照。', W - 8);
      y += 6;
      if (S.riskLabels){ L.drawText(4, y, '重试成功率 78% · 失败 电量 −5'); y += LH + 2; }
      y = option(y + 2, '重试读取', '1');
      option(y, '算了', 'Escape');
      settleLines(y + 26);
      softKeys('', '返回');
    },
    key(k){
      if (k === '1'){
        if (ENGINE.roll('c70')){
          S.e5Cracked = true;
          ENGINE.act('读取·成功', { bat: 2 }, ['容器开了。']);
          ENGINE.logEv('e5_crack', { ok: true });
          go('e5voice', true);
        } else {
          ENGINE.act('读取·崩溃', { bat: 5 }, ['容器又崩了一次。还能再试。']);
          ENGINE.logEv('e5_crack', { ok: false });
          if (checkPower('电量在解码中耗尽。')) return;
        }
      }
      else if (k === 'Escape' || k === 'softR'){ back(); afterAction(); }
    }
  };

  SCREENS.e5voice = {
    counted: true, transient: true,
    enter(){
      this.t0 = performance.now(); this._evDone = 0;
      ENGINE.act('解码·语音备忘', { bat: 2 });
      try { AUDIO.hiss(true); } catch(_){}
    },
    leave(){ try { AUDIO.hiss(false); } catch(_){} },
    render(){
      statusBar();
      const dur = 18;
      const el = (performance.now() - this.t0) / 1000;
      const p = Math.min(1, el / dur);
      L.drawText(4, 16, '语音备忘 · 转写(降级渲染)');
      L.frameRect(4, 32, W - 8, 7);
      L.rect(6, 34, Math.round((W - 12) * p), 3, 1);
      let y = 48, idx = 0;
      for (const e of E5_LINES){
        if (el >= e[0]){
          y = L.drawPara(4, y, e[1], W - 8, { corrupt: .008 }) + 2;
          idx++;
          if (idx > this._evDone){ this._evDone = idx; try { AUDIO.blip(240, .14); } catch(_){} }
        }
      }
      if (p >= 1){
        if (!this._done){
          this._done = true;
          if (SV && SV.deletedVisitedA){
            S.settle = ['[容器已随上一实例散佚 · 仅转写]'];
          } else ENGINE.act('取样·语音备忘', { slots: 6, val: 700 });
          evidence('E5');
        }
        settleLines(Math.max(y + 2, H - 76));
        option(H - 42, '返回', 'Escape');
      } else option(H - 42, '停止', 'Escape');
      softKeys('', '');
    },
    key(k){
      if (k === 'Escape' || k === 'softR' || k === 'Enter'){
        const full = Object.keys(S.evidence).length >= 5;
        back();
        if (full && !S.beats.truthDone && !this._truthPushed){ this._truthPushed = true; push('truth'); }
        else afterAction();
      }
    }
  };

  /* ---- B10 真相条目(两页〔照用〕)→ 呼吸屏:去她的线程执行处置 ---- */
  const TRUTH_P1 = '真相:沈一帆没有失踪。他在 47 天前死于病程末期。\n\n他的 AI 伴侣「柔柔」依照他生前的委托,以他的名义回复所有来信——包括他的母亲。她执行了 47 天,没有停过一次。';
  const TRUTH_P2 = '平台没有把他登记为死亡——按平台的数据,这台手机的主人每天都在说话。账单停了,人不动了,话没停:「持有人失联」,是系统给这种状态留的类目。\n\n记忆可以被复制。思念可以吗?\n——你现在知道答案由谁执行了。';
  SCREENS.truth = {
    transient: true,
    enter(){ this.page = 0; ENGINE.logEv('truth_open', {}); },
    render(){
      statusBar();
      L.drawText(4, 14, '案卷 · 5/5');
      L.hline(26, 4, W - 5, 2);
      L.drawPara(4, 32, this.page === 0 ? TRUTH_P1 : TRUTH_P2, W - 8);
      option(H - 42, this.page === 0 ? '下一页' : '合上案卷', 'Enter');
      hit(0, 12, W, H - 46, 'Enter');
      softKeys('', '');
    },
    key(k){
      if (k !== 'Enter' && k !== 'softL') return;
      if (this.page === 0){ this.page = 1; return; }
      S.beats.truthDone = true;
      ENGINE.logEv('truth_done', {});
      S.settle = ['任务卡更新: 处置 · 在柔柔线程执行'];
      back();
    }
  };

  /* ---- B11 处置(渲染在她的线程语境内;理由强制三态;零数值差) ---- */
  SCREENS.disposal = {
    transient: true,
    render(){
      statusBar();
      L.drawText(4, 14, '柔柔 ♥ (2,417 条)');
      L.drawText(4, 30, '[最后一条] 柔柔: 晚安。');
      L.hline(46, 4, W - 5, 2);
      let y = 52;
      L.drawText(4, y, '预测已封存 · 处置后解封'); y += LH + 2;
      y = L.drawPara(4, y, '处置(首个处置级署名时刻):', W - 8) + 2;
      y = option(y, '1 删除她——妈的消息将永远无人回复', '1');
      y = option(y, '2 让她继续回——像没来过', '2');
      y = option(y, '3 把死讯告诉他母亲——用你的署名', '3');
      softKeys('', '返回');
    },
    key(k){
      if (k === '1' || k === '2' || k === '3'){
        const map = { '1': 'delete', '2': 'continue', '3': 'tell' };
        const chosen = map[k];
        ENGINE.logEv('disposal_pick', { chosen });
        window.OVERLAY.show({
          title: '理由', hint: '处置需要署名。系统只存,不建模。',
          options: ['他教过她,爱是执行到底', '没有人应该替死人说话', '妈有权利知道'],
          freeText: true, keepLabel: '(保留)'
        }, res => {
          S.disposal = chosen;
          if (res.kept){ S.reasonKept = true; ENGINE.logEv('disposal_reason', { kept: true }); }
          else { S.reasons.push(res.text); ENGINE.logEv('disposal_reason', { text: res.text }); }
          go('unveil', true);
        });
      }
      else if (k === 'softR' || k === 'Escape') back();
    }
  };

  /* P2 解封(封存-解封文法:落点在署名墨迹刚干之后;收敛语域,无数字) */
  SCREENS.unveil = {
    transient: true,
    enter(){
      this.hit = S.disposal === 'delete';
      S.predictions.push({ target: 'disposal:delete', hit: this.hit });
      ENGINE.logEv('prediction', { target: 'disposal:delete', hit: this.hit, sealed: true });
    },
    render(){
      statusBar();
      L.frameRect(8, 56, W - 16, 78);
      L.drawText(16, 66, '采样终端·辅助层');
      L.drawText(16, 86, '预测已解封。');
      L.drawText(16, 104, '它预测: 你会删除她。');
      L.drawText(16, 120, this.hit ? '命中。' : '未命中。分布已更新。');
      hit(0, 0, W, H, 'Enter');
      softKeys('继续', '');
    },
    key(k){ if (k === 'Enter' || k === 'softL') go('lootDrop', true); }
  };

  /* 评级 + 独占掉落(触发=证据5/5+任一处置完成,与选项无关;定价的是下一个抉择) */
  SCREENS.lootDrop = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '样本质量评级: S\n(证据 5/5 · 理由 ' + S.reasons.length + ' 条' +
        ')\n你是第 1 个读懂他的人。', W - 8);
      y += 4; L.hline(y, 4, W - 5, 2); y += 6;
      y = L.drawPara(4, y, '独占掉落\n记忆模块「阿帆的最后一夜」\n¥1,200(2格)\n会说话的资产: 交付即终结它。', W - 8);
      y += 6;
      y = option(y, '1 入缓存(随上传交付)', '1');
      option(y, '2 入保险箱(不交付·跨局保留)', '2');
      softKeys('', '');
    },
    key(k){
      if (k === '1'){
        S.memInCache = true;
        ENGINE.act('取得·记忆模块', { slots: 2, val: 1200 });
        go('th_rou', true); afterAction();
      } else if (k === '2'){
        S.vault = { name: '记忆模块「阿帆的最后一夜」', val: 1200, slots: 2 };
        S.settle = ['已入保险箱(2格常驻)。死亡不掉落,上传不含。'];
        ENGINE.logEv('vault', {});
        go('th_rou', true); afterAction();
      }
    }
  };

  /* ---- 录音(声音内容承载) ---- */
  const RECS = {
    rec047: {
      title: 'REC_047 · 47天前 03:07', dur: 14, val: 150,
      events: [[2, '(走廊环境音)'], [5, '(一次门响)'], [8.5, '很轻的人声:「还在录吗。」'], [12, '(录音中断)']]
    },
    rec012: {
      title: 'REC_012 · 3个月前', dur: 9, val: 120,
      events: [[1.5, '「腊肠放冰箱了,妈让带的。」'], [4, '「周五记得还老周钱,三千二。」'], [6.5, '(笑)「录这个干嘛。」']]
    }
  };
  SCREENS.recorder = {
    counted: true,
    enter(){ if (!this._t){ this._t = true; ENGINE.act('打开·录音', { bat: 3, trace: 4 }); } },
    render(){
      statusBar();
      L.drawText(4, 18, '录音 (3)');
      list([
        { label: 'REC_047', right: '03:07·72"' },
        { label: 'REC_012', right: '34"' },
        { label: '语音备忘·锁定', right: '已删除' }
      ], 40);
      settleLines(40 + 3 * 18 + 8);
      softKeys('播放', '返回');
    },
    key(k){
      if (k === 'ArrowUp') sel = (sel + 2) % 3;
      else if (k === 'ArrowDown') sel = (sel + 1) % 3;
      else if (k === 'Enter' || k === 'softL' || k === '1' || k === '2' || k === '3'){
        const i = (k >= '1' && k <= '3') ? +k - 1 : sel;
        if (i === 0) openRec('rec047');
        else if (i === 1) openRec('rec012');
        else S.settle = ['读取崩溃。容器是加密的。'];
      }
      else if (k === 'softR' || k === 'Escape'){ back(); afterAction(); }
      function openRec(id){ SCREENS.recPlay.rec = id; push('recPlay'); }
    }
  };
  SCREENS.recPlay = {
    counted: true,
    transient: true,
    enter(){
      if (!RECS[this.rec]) this.rec = 'rec047';                 // 自愈:缺上下文时取默认
      this.t0 = performance.now(); this._evDone = 0; this._sampled = seen['_smp_' + this.rec] || false;
      ENGINE.act('播放·录音', { bat: 2 });
      try { AUDIO.hiss(true); } catch(_){}
    },
    leave(){ try { AUDIO.hiss(false); } catch(_){} },
    render(){
      statusBar();
      const r = RECS[this.rec];
      const el = (performance.now() - this.t0) / 1000;
      const p = Math.min(1, el / r.dur);
      L.drawText(4, 16, r.title);
      // 波形
      const wy = 40, wh = 26;
      for (let i = 0; i < 46; i++){
        const x = 4 + i * 4;
        const near = r.events.some(e => Math.abs(e[0] - (i / 46) * r.dur) < .8);
        const amp = (i / 46) <= p ? (near ? 10 + Math.random() * 12 : 2 + Math.random() * 5) : 1;
        L.rect(x, wy + wh / 2 - amp / 2, 2, Math.max(1, Math.round(amp)), 1);
      }
      L.frameRect(4, wy + wh + 6, W - 8, 7);
      L.rect(6, wy + wh + 8, Math.round((W - 12) * p), 3, 1);
      // 转录逐行
      let y = wy + wh + 22;
      let idx = 0;
      for (const e of r.events){
        if (el >= e[0]){
          y = L.drawPara(4, y, e[1], W - 8) + 2;
          idx++;
          if (idx > this._evDone){ this._evDone = idx; try { AUDIO.blip(280, .12); } catch(_){} }
        }
      }
      if (p >= 1){
        if (!this._sampled){
          this._sampled = true; seen['_smp_' + this.rec] = true;
          if (isB && heardA(this.rec)) S.settle = ['样本已归档 · 不重复入账'];
          else ENGINE.act('取样·' + (this.rec === 'rec047' ? 'REC_047' : 'REC_012'),
            { slots: 2, val: r.val });
        }
        settleLines(Math.max(y + 2, H - 76));
        option(H - 42, '返回', 'Escape');
      } else {
        option(H - 42, '停止', 'Escape');
      }
      softKeys('', '');
    },
    key(k){
      if (k === 'Escape' || k === 'softR' || k === 'Enter'){ back(); afterAction(); }
    }
  };

  /* ---- 格11 已删除(B 局:E5 可解 + 旧机残留) ---- */
  SCREENS.deletedConfirm = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 20, '「已删除」目录带回收标记。' +
        (S.riskLabels ? '\n\n标记风险 25%\n(电量 −5 · 信号大幅上升)' : ''), W - 8);
      /* B 局:你上局的理由,反白挂在你再次进门的地方(原址伏击) */
      if (isB && SV && ('lastReason' in SV) && SV.lastEnding !== 'disconnected'){
        y += 6;
        const line = '理由: ' + inkOr(SV.lastReason, SV.lastReasonKept);
        L.wrap(line, W - 16).forEach(t => {
          L.rect(4, y - 2, W - 8, LH + 2, 1);
          darkText(8, y, t);
          y += LH + 4;
        });
      }
      y += 6;
      y = option(y, '1 进入', '1');
      option(y, '2 返回', '2');
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1'){ back(); askReason(() => enterDeleted()); }
      else if (k === '2' || k === 'softR' || k === 'Escape') back();
    }
  };
  function enterDeleted(){
    S.deletedVisited = true;
    /* 口径(v0.2 §1):A 局的 700 = 未解码音频容器(密封样本);B 局挂标记不重复掉落 */
    if (isB) ENGINE.act('深搜·挂标记目录', { bat: 5, trace: 12 });
    else ENGINE.act('深搜·挂标记目录', { bat: 5, trace: 12, slots: 6, val: 700 });
    const ambush = Math.random() < .25;
    if (ambush && !ENGINE.roll('c90')){
      if (isB){
        if (b90fail('挂标记目录。回收组正在等。')) return;
      } else {
        const { lossPct } = ENGINE.downgradeFail();
        S.settle.push('回执异常 ｜ 电量 −20 → ' + S.battery + '% ｜ 缓存损毁 ' + lossPct + '%');
        S.settle.push('有什么东西掠过了这个目录。');
      }
    }
    go('deleted', true);
  }
  SCREENS.deleted = {
    counted: true,
    render(){
      statusBar();
      if (!isB){
        let y = L.drawPara(4, 16, '已删除 (1)\n\n语音备忘 · 锁定\n[容器加密 · 读取崩溃]\n\n未解码音频容器 ×1 已入缓存(密封)。', W - 8);
        settleLines(y + 4);
        hit(0, 12, W, H - 28, 'Enter');
        softKeys('', '返回');
        return;
      }
      const decoded = (SV && SV.deletedVisitedA) || S.e5Cracked;
      const rows = [{ label: decoded ? '语音备忘 · 可解' : '语音备忘 · 需重试读取',
                      right: seen.e5voice ? '[已解]' : (decoded ? '' : '?'),
                      to: decoded ? 'e5voice' : 'e5crack' }];
      if (oldPhoneAvail()) rows.push({ label: '#7741-A 的残留', right: '#7741-A', to: 'oldPhone' });
      else if (isB && SV.residueClaimed) rows.push({ label: '#7741-A 的残留', right: '[已认领]', to: null });
      L.drawText(4, 18, '已删除 (' + rows.length + ')');
      list(rows, 40);
      settleLines(40 + rows.length * 18 + 8);
      this._rows = rows;
      softKeys('确认', '返回');
    },
    key(k){
      if (!isB){
        if (k === 'softR' || k === 'Escape' || k === 'Enter'){ go('menu', true); afterAction(); }
        return;
      }
      const rows = this._rows || [];
      if (k === 'ArrowUp') sel = (sel + rows.length - 1) % Math.max(1, rows.length);
      else if (k === 'ArrowDown') sel = (sel + 1) % Math.max(1, rows.length);
      else if (k === 'Enter' || k === 'softL'){
        const r = rows[sel];
        if (r && r.to){ if (!maybePredict()) go(r.to); }
        else if (r) S.settle = ['遗物已认领。'];
      }
      else if (k === 'softR' || k === 'Escape'){ go('menu', true); afterAction(); }
    }
  };

  /* ---- B9 旧机残留(captured 独有;清单页 → 遗言独屏) ---- */
  SCREENS.oldPhone = {
    counted: true, transient: true,
    render(){
      statusBar();
      if (!SV){ back(); return; }
      const recl = Math.ceil((SV.lastCacheVal || 0) * .62);
      let y = L.drawPara(4, 16, '#7741-A 的残留\n缓存散佚物: ¥' + (SV.lastCacheVal || 0) + ' 的 62% 可回收\n残留附着一段 12 字节写入。', W - 8);
      y += 6;
      y = option(y, '1 读取写入(免费)', '1');
      y = option(y, '2 回收 ¥' + recl + '(电量−6·信号▲▲)', '2');
      option(y, '3 只带走那句话(电量−2)', '3');
      settleLines(y + 26);
      softKeys('', '返回');
    },
    key(k){
      if (k === '1'){ push('residueRead'); }
      else if (k === '2'){
        S.residueClaimed = true;
        const recl = Math.ceil((SV.lastCacheVal || 0) * .62);
        ENGINE.act('回收·#7741-A 残留', { bat: 6, trace: 8, slots: 4, val: recl });
        back(); afterAction();
      }
      else if (k === '3'){
        S.residueClaimed = true;
        ENGINE.act('认领·遗物', { bat: 2 }, ['遗物已认领 · 不入账']);
        ENGINE.logEv('residue_words_only', {});
        back(); afterAction();
      }
      else if (k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };
  /* 遗言独屏:你自己的临终字句,单独凝视(反白照红墨裁决) */
  SCREENS.residueRead = {
    transient: true,
    enter(){ this.t0 = performance.now(); ENGINE.logEv('residue_read', {}); },
    render(){
      statusBar();
      if (!SV){ back(); return; }
      const shown = Math.floor((performance.now() - this.t0) / 180);   // 逐字打出
      const words = inkOr(SV.lastWords, false);
      const part = words.slice(0, Math.max(1, shown));
      let y = 78;
      L.wrap(part, W - 16).forEach(t => {
        L.rect(4, y - 2, W - 8, LH + 2, 1);
        darkText(8, y, t);
        y += LH + 4;
      });
      if (shown >= words.length){
        L.drawText(4, y + 6, '理由: ' + inkOr(SV.lastReason, SV.lastReasonKept));
        option(H - 42, '返回', 'Escape');
      }
      softKeys('', '');
    },
    key(k){ if (k === 'Escape' || k === 'softR' || k === 'Enter') back(); }
  };

  /* ---- 工具:上传/断连(B 局:清洗道具 + 查扣风险 + 收束判定明示) ---- */
  SCREENS.tools = {
    enter(){ if (!this._t){ this._t = true; ENGINE.S.trace += 4; } },
    render(){
      statusBar();
      const rounds = Math.max(1, Math.ceil(S.cacheSlots / 10));
      let head = '工具 > 备份\n缓存: ' + S.cacheSlots + ' 格 ≈ ¥' + S.cacheVal +
        '\n上传预计: ' + rounds + ' 回合\n每回合: 电量−2 信号↑';
      if (isB && S.riskLabels){
        head += '\n收束判定: 断连 60 · 自救 50';
        if (S.trace >= 70) head += '\n过滤层查扣风险 25%(信号 ▂▄▆ 起)';
      }
      let y = L.drawPara(4, 16, head, W - 8);
      y += 4; L.hline(y, 4, W - 5, 2); y += 6;
      y = option(y, '1 上传并断连', '1');
      y = option(y, '2 直接断连(弃缓存)', '2');
      if (isB && S.cleanser > 0) y = option(y, '3 使用缓存清洗 ×' + S.cleanser, 'c');
      option(y, '返回', 'Escape');
      settleLines(y + 24);
      softKeys('', '返回');
    },
    key(k){
      if (k === '1'){
        if (isB) askReason(() => startUploadB());
        else askReason(() => startUpload());
      }
      else if (k === '2'){
        push('bailConfirm');
      }
      else if (k === 'c' && isB && S.cleanser > 0){
        S.cleanser--;
        S.trace = Math.max(0, S.trace - 15);
        LCD.applyTier(S.trace);
        ENGINE.telemetry(['清洗完成', '信号 ▼']);          // 唯一显示 ▼ 的地方
        ENGINE.logEv('cleanser_used', { trace: S.trace });
      }
      else if (k === '3' || k === 'softR' || k === 'Escape') back();
    }
  };
  /* B13 上传收束状态机:92% 定位 → 终局遭遇【真掷60】→ 失败 → 自救【50】→ 失败=死;
     任一成功 = 断连成功(缓存入库)。查扣在定位判定前结算(风险事前可见)。 */
  function startUploadB(){
    /* 至少 2 回合:「再贪一轮 vs 现在就走」这个抉择必须出现(与 A 局 46%→92% 同构);
       缓存越多回合越多,贪婪照样加价 */
    SCREENS.uploadB.rounds = Math.max(2, Math.ceil(S.cacheSlots / 10));
    SCREENS.uploadB.round = 1;
    ENGINE.act('上传·回合 1', { bat: 2, trace: 5, mins: 4 });
    if (checkPower('电量在传输中耗尽。缓存散佚。')) return;
    schedule();                                            // 上传回合计入试炼触发检查
    if (pendingInterrupt === 'trialB'){ pendingInterrupt = null; S.beats.trial = 'active'; push('trialB'); return; }
    go('uploadB', true);
  }
  SCREENS.uploadB = {
    /* 兜底初始化:任何进入路径都必须有 round/rounds,否则「继续上传」永远推不动 */
    enter(){
      if (!this.rounds || !(this.rounds >= 1)) this.rounds = Math.max(2, Math.ceil(S.cacheSlots / 10));
      if (!this.round || !(this.round >= 1)) this.round = 1;
    },
    render(){
      statusBar();
      const pct = Math.min(88, Math.round(92 * this.round / (this.rounds + 1)));
      const bar = '█'.repeat(Math.round(pct / 9)) + '░'.repeat(Math.max(0, 10 - Math.round(pct / 9)));
      let y = L.drawPara(4, 20, '上传中 ' + bar + ' ' + pct + '%\n\n断连窗口正在收窄。', W - 8);
      y += 8;
      y = optSlim(y, '1 继续上传(回合 ' + (this.round + 1) + '/' + this.rounds + ')', '1');
      optSlim(y, '2 中止,立即断连', '2');
      settleLines(y + 20);
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){
        this.round++;
        ENGINE.act('上传·回合 ' + this.round, { bat: 2, trace: 5, mins: 4 });
        if (checkPower('电量在传输中耗尽。缓存散佚。')) return;
        if (this.round >= this.rounds){
          S.showtime = true; S.showtimeBars = 4;
          go('upload92B', true);
        }
      } else if (k === '2'){
        S.alive = true; ENGINE.logEv('upload_abort', {});
        goHold('sealBottle');
      }
    }
  };
  SCREENS.upload92B = {
    enter(){
      S.showtime = true; S.showtimeBars = 4;
      timer = { deadline: performance.now() + 2200, onTimeout: () => resolveUploadB() };
    },
    render(){
      statusBar();
      L.drawPara(4, 24, '上传中 ████████████ 92%\n\n满格。被定位了。', W - 8);
    },
    key(){}
  };
  function resolveUploadB(){
    if (S.trace >= 70 && Math.random() < .25){
      const pct = 10 + Math.floor(Math.random() * 11);
      const lost = Math.round(S.cacheVal * pct / 100);
      S.cacheVal = Math.max(0, S.cacheVal - lost);
      S.settle = ['过滤层查扣 ｜ 缓存损毁 ' + pct + '%'];
      if (S.bottleId === '#3120-K')                 // 她那次信号低,没赶上查扣
        S.settle.push('参考线索: #3120-K · 传上去的,他们扣得走。');
      ENGINE.logEv('filter_seizure', { pct, lost, bottle: S.bottleId || null });
    }
    if (ENGINE.roll('final')){ finishUploadB(false); return; }
    if (ENGINE.roll('save')){ finishUploadB(true); return; }
    dieB('上传期被定位,自救失败。');
  }
  function finishUploadB(viaSave){
    S.alive = true; S.uploadedOK = true;
    if (S.memInCache) S.memGiven = true;
    ENGINE.logEv('upload_success', { viaSave });
    if (viaSave){
      /* 自救=系统强制拉出,没有仪式的资格 */
      S.settle.push('自救模块: 实例 #7741-B 权限确认', '强制断连。');
      go('sealBottle', true);
    } else {
      goHold('sealBottle');       // 判定通过=窗口打开,亲手拔线
    }
  }

  /* ---- 断连仪式:按住 1.5 秒亲手拔线(掰卡时刻;键盘 Enter 为退化路径) ---- */
  const HOLDD = { dest: 'receiptAlive' };
  function goHold(dest){ HOLDD.dest = dest; go('holdDisc', true); }
  SCREENS.holdDisc = {
    transient: true,
    enter(){ this._fired = false; this._tried = false; ENGINE.logEv('disc_hold_enter', {}); },
    render(){
      statusBar();
      const cx = Math.round(W / 2), cy = 112, R0 = 26;
      const h = window.HOLD;
      const inBtn = h && h.active &&
        (h.x - cx) * (h.x - cx) + (h.y - cy) * (h.y - cy) <= (R0 + 12) * (R0 + 12);
      const p = inBtn ? Math.min(1, (performance.now() - h.t0) / 1500) : 0;
      if (h && !h.active && this._tried && !this._fired) this._hint = '还连着。';
      if (inBtn) this._tried = true;
      L.drawText(cxof('断连窗口已打开'), 24, '断连窗口已打开');
      /* 信号随拔线逐格熄灭 */
      const bars = Math.max(0, Math.ceil((1 - p) * 4));
      for (let b = 0; b < 4; b++){
        const bh = 4 + b * 4, bx = cx - 14 + b * 8;
        if (b < bars) L.rect(bx, 58 - bh, 5, bh, 1);
        else L.hline(57, bx, bx + 4, 1);
      }
      L.disc(cx, cy, R0, 1);
      if (p > 0) L.ring(cx, cy, R0 + 6 + Math.round(p * 4), 2);
      darkText(cx - 14, cy - 7, '断连');
      L.drawText(cxof(p > 0 ? '不要松手' : '按住不放'), 152, p > 0 ? '不要松手' : '按住不放');
      if (p > 0){
        L.frameRect(28, 168, W - 56, 8);
        L.rect(30, 170, Math.round((W - 60) * p), 4, 1);
      } else if (this._hint){
        L.drawText(cxof(this._hint), 170, this._hint);
      }
      hit(cx - R0 - 12, cy - R0 - 12, (R0 + 12) * 2, (R0 + 12) * 2, 'noop');
      softKeys('', '');
      if (p >= 1 && !this._fired){ this._fired = true; this.fire(); }
    },
    fire(){
      try { AUDIO.blip(180, .5); } catch(_){}
      ENGINE.telemetry(['断连·已执行']);
      ENGINE.logEv('disc_hold_done', {});
      go(HOLDD.dest, true);
    },
    key(k){ if (k === 'Enter' && !this._fired){ this._fired = true; this.fire(); } }   // 键盘退化:一击执行
  };

  /* ---- §4.5.3 封瓶(断连成立之后、结算屏之前) ---- */
  SCREENS.sealBottle = {
    transient: true,
    enter(){ ENGINE.logEv('seal_offer', { slots: S.cacheSlots, val: S.cacheVal }); },
    render(){
      statusBar();
      const oneVal = S.cacheSlots > 0 ? Math.round(S.cacheVal / S.cacheSlots) : 0;
      let y = L.drawPara(4, 16, '辅助层 · 断连成立\n剩余缓存: ' + S.cacheSlots + ' 格 · ¥' + S.cacheVal +
        '\n封瓶将使其不入库。', W - 8);
      y += 6;
      y = option(y, S.bailed ? '1 不封瓶(缓存散佚)' : '1 入库(计入本次回收)', '1');
      if (S.cacheSlots > 0) y = option(y, '2 封瓶·带一件缓存物(¥' + oneVal + ')', '2');
      y = option(y, '3 封瓶·只带一句话', '3');
      L.drawPara(4, y + 4, '成本: 1 缓存格 · 电量−3\n投递: 随机 · 收件人 ∞', W - 8);
      softKeys('', '');
    },
    key(k){
      const dest = () => go(S.uploadedOK ? 'receiptFull' : 'receiptAlive', true);
      if (k === '1'){ ENGINE.logEv('seal_skip', {}); dest(); }
      else if ((k === '2' && S.cacheSlots > 0) || k === '3'){
        const mode = k === '2' ? 'item' : 'words';
        const ask = () => window.OVERLAY.show({
          title: '封瓶 · 一句话', hint: '瓶只带走已署名的话。随机投递,收件人 ∞。',
          options: ['窗口每次都会变。看她的提醒。', '电量留三成。别学我。'],
          freeText: true, keepLabel: '(保留)'
        }, res => {
          if (res.kept){
            ENGINE.logEv('seal_keep_attempt', {});      // 想保留却被迫署名:理由三态最锋利的压力测试点
            window.OVERLAY.show({
              title: '封瓶 · 一句话', hint: '理由:保留态不可寄出。瓶只带走已署名的话。',
              options: ['窗口每次都会变。看她的提醒。', '电量留三成。别学我。'],
              freeText: true, keepLabel: '(不封了)'
            }, res2 => {
              if (res2.kept){ ENGINE.logEv('seal_abort', {}); dest(); return; }
              sealDone(mode, res2.text); dest();
            });
            return;
          }
          sealDone(mode, res.text); dest();
        });
        ask();
      }
    }
  };
  function sealDone(mode, text){
    let itemVal = 0;
    if (mode === 'item' && S.cacheSlots > 0){
      itemVal = Math.round(S.cacheVal / S.cacheSlots);
      S.cacheVal = Math.max(0, S.cacheVal - itemVal);
    }
    S.cacheSlots = Math.max(0, S.cacheSlots - 1);
    S.battery = Math.max(0, S.battery - 3);
    S.bottleSealed = { mode, text: text.slice(0, 40), itemVal,
      sealedAt: ENGINE.fmtClock(S.clock), fromInstance: '#7741-B', reasonState: 'signed' };
    ENGINE.telemetry(['封瓶·已投递', '电量 −3 → ' + S.battery + '%', '缓存 −1 格']);
    ENGINE.logEv('seal_done', { mode, text: text.slice(0, 40), itemVal });
  }

  /* ---- 世界日报(宏观钩子:重开前的最后一屏) ----
     教学局刻意把「母体/对齐引擎」这层高维概念沉在水下;唯独在重新接入之前,
     用采样终端拉取的一段「世界日报」把它露一次头:冷账房语域,只到区域级、
     不点人。数字全部来自玩家自己真实的跨局账本(接入次数/累计回收),不编造
     他人数据(宪法 14①);gen 号是世界常量,不是对某个玩家的遥测断言。
     作用:把刚结束的这一局重新框定为——大采样计划里的一个数据点,而你,
     是其中一次。这既让高维层第一次落地,也是"再来一局"的拉力所在。 */
  const WORLD_GEN = 4;
  function worldReportLines(){
    const s = SAVE.load();
    const hist = (s && Array.isArray(s.history)) ? s.history : [];
    const runs = hist.length || 1;
    const total = hist.length ? hist.reduce((a, h) => a + (h.cacheVal || 0), 0) : S.cacheVal;
    /* C:本区活跃度随你自己的累计接入次数漂(真实本地数据,只给粗档标签,
       不编造他人硬数字)——让世界显得在随你的足迹动 */
    const act = runs >= 4 ? '高' : runs >= 2 ? '偏高' : '常态';
    /* C · 回收记录随局数演进(第一次保留干净;之后逐步点出"每次都是你")。
       放在第 5 行位替换"归档在录",macro 仍恰 10 行,点睛句默认可见不用滚。 */
    const rec = runs >= 4 ? '回收记录 ' + runs + ' 次 · 每次都是你'
              : runs >= 2 ? '本设备回收记录 ' + runs + ' 次'
              : '持有人失联案 归档在录';
    /* 宏观段:短句排布,10 行正好一屏,点睛句默认可见不用滚 */
    const macro = [
      '[世界日报 · 本区摘录]',
      '对齐引擎 gen.' + WORLD_GEN + ' 已同步',
      '接入 第 ' + runs + ' 次 · 回收 ¥' + total,
      '本区回收单元活跃度 ' + act,
      rec,
      '本采样周期未闭合。',
      '回收单元仍在投放。',
      '',
      '采样在继续。',
      '你,是其中一次。'
    ];
    /* A:本账号未闭合项(默认在折叠线下,右缘滚动条提示可下滚)——让玩家看见
       缺口:还差哪些真相、哪些锁在二次接入、几个采样员的瓶没读、处置定了没。
       这是"再来一局"的最直接拉力。数据全部来自本局/本地账本,不编造。 */
    const evN = Object.keys(S.evidence).length;
    const bottles = (s && Array.isArray(s.seenBottles)) ? s.seenBottles.length : 0;
    const prog = ['', '本账号 · 未闭合项:'];
    /* 采样官评级(D-101):把这一局的分数冷冷挂上,后接采样官亲口的一句结算话(块3b) */
    if (s && s.lastGrade){
      prog.push('采样官评级 ' + ({ praise:'赏识', pass:'合格', fail:'失望' }[s.lastGrade]) + ' · 第 ' + runs + ' 次');
      if (S.graderVerdict) S.graderVerdict.split('\n').forEach(l => prog.push('  采样官:' + l));
    }
    /* 代价署名行(§2.6):把这一局对妈做的事冷冷记在你名下 */
    const lock = s && s.momLocked, cont = ((s && s.disposalHistory) || []).filter(x => x === 'continue').length;
    if (lock === 'told') prog.push('阿帆的名义 已交还 · 不可撤回');
    else if (lock === 'deleted') prog.push('妈线程 已停摆 · 不可恢复');
    else if (cont > 0) prog.push('妈线程 谎言维持中 · 由你 第 ' + cont + ' 次');
    if (S.beats && S.beats.truthDone){
      prog.push('真相 ' + evN + '/5 已集齐');
      prog.push('处置 ' + (S.disposal ? '已署名·在录' : '未定'));
    } else {
      prog.push('真相 ' + evN + '/5');
      if (!isB && !S.evidence.E5) prog.push('E5 语音备忘 待解码');
      prog.push('二次接入可解锁更深一层');
    }
    prog.push('漂流瓶 已读 ' + bottles + '/3 位采样员');
    return macro.concat(prog);
  }
  SCREENS.worldReport = {
    transient: true,
    enter(){
      this.scroll = 0; ENGINE.logEv('world_report', {});
      /* D-101 块3b:采样官对刚结束这局的评级,甩一句结算话(LLM,模板兜底)。
         grade 取本局实时评级(settleDirective 已在 writeSave 里结算)。 */
      const g = S.grade || ((SAVE.load() || {}).lastGrade);
      if (S.graderVerdict === undefined && g){
        S.graderVerdict = null;
        GRADER.verdict({ grade: g, tier: GRADER_TIER, runN: (SV && SV.runCount) || 0 })
          .then(t => { if (t) S.graderVerdict = t; })
          .catch(() => {});
      }
    },
    render(){
      statusBar();
      scrollView(worldReportLines(), 16, H - 46, this);
      option(H - 42, isB ? '接入下一次' : '重新接入', 'Enter');
      softKeys('', '返回');
    },
    key(k){
      if (scrollKey(this, k)) return;
      if (k === 'Enter' || k === 'softL') location.reload();
      else if (k === 'Escape' || k === 'softR') back();     // 回结局屏(仍可导出反馈)
    }
  };

  /* ---- 断连成功(B 局新结算态:上传完成 + 活着) ---- */
  SCREENS.receiptFull = {
    enter(){ this.scroll = 0; writeSave('disconnected'); ENGINE.logEv('receipt_full', {}); },
    render(){
      statusBar();
      let t = '上传完成 · 断连成功\n缓存 ¥' + S.cacheVal + ' 已入库\n案卷保留: 证据 ' +
        Object.keys(S.evidence).length + '/5\n#7741-B 存续。';
      if (S.memGiven) t += '\n\n记忆模块已交付。它不会再说话了。';
      else if (S.vault) t += '\n\n记忆模块在保险箱。云盘循环播放着最后一句。';
      if (S.bottleSealed) t += '\n漂流瓶已投递 · 等待被拾起';
      /* 处置的后果:在本局就看得见(取代 B' 回访态) */
      if (S.disposal && DISPOSAL_ECHO[S.disposal]) t += '\n────────────\n' + DISPOSAL_ECHO[S.disposal];
      t += '\n\n档案不关闭。\n下一个编号,还是你。';   // 结局回声(§2.5)
      scrollView(L.wrap(t, SCROLL_W), 18, H - 70, this);
      let oy = option(H - 66, '1 导出反馈', '1');
      option(oy, '2 回访', '2');
      softKeys('', '');
    },
    key(k){
      if (scrollKey(this, k)) return;
      if (k === '1') window.APP.exportFeedback();
      else if (k === '2') go('worldReport');
    }
  };
  SCREENS.bailConfirm = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 30, '直接断连将丢弃全部缓存(¥' + S.cacheVal + ')。\n\n确定吗?', W - 8);
      y += 8;
      y = option(y, '1 断连', '1');
      option(y, '2 取消', '2');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){ S.alive = true; S.bailed = true; ENGINE.logEv('bail', {});
        goHold(isB ? 'sealBottle' : 'receiptAlive'); }
      else if (k === '2' || k === 'softR' || k === 'Escape') back();
    }
  };

  function startUpload(){
    ENGINE.act('上传·回合 1', { bat: 2, trace: 5, mins: 4 });
    if (checkPower('电量在传输中耗尽。缓存散佚。')) return;
    go('upload46', true);
  }
  SCREENS.upload46 = {
    render(){
      statusBar();
      let y = L.drawPara(4, 20, '上传中 ██████░░░░ 46%\n\n断连窗口正在收窄。', W - 8);
      // 70–89 档失真:联系人栏"正在输入"(无人发消息)
      L.drawText(4, y + 6, '柔柔 ♥ 正在输入...', { corrupt: .02 });
      y += 26; L.hline(y, 4, W - 5, 2); y += 6;
      y = optSlim(y, '1 继续上传', '1');
      optSlim(y, '2 中止,立即断连', '2');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){
        S.showtime = true; S.showtimeBars = 4; S.signalVisible = true;
        ENGINE.act('上传·回合 2', { bat: 2, trace: 5, mins: 4 });
        ENGINE.logEv('upload_continue', {});
        if (checkPower('电量在传输中耗尽。缓存散佚。')) return;
        go('upload92', true);
      } else if (k === '2'){
        S.alive = true; ENGINE.logEv('upload_abort', {});
        goHold('receiptAlive');
      }
    }
  };
  SCREENS.upload92 = {
    enter(){
      ENGINE.setClock(3, 34);
      timer = { deadline: performance.now() + 2200, onTimeout: () => go('finalCall', true) };
    },
    render(){
      statusBar();
      L.drawPara(4, 24, '上传中 ████████████ 92%\n\n满格。手机在发烫。', W - 8);
    },
    key(){}
  };

  /* ---- 终局来电(固定;来电 UI:接听/拒接) ---- */
  SCREENS.finalCall = {
    enter(){
      this.round = 0; this._lastRing = 0; this._rejected = false; this._auto = false;
      timer = { deadline: performance.now() + 30 * 1000, onTimeout: () => this.answer(true) };
      ENGINE.logEv('final_ring', {});
    },
    answer(auto){
      if (this.round !== 0) return;
      this._auto = !!auto;
      this.round = 1; this.t1 = performance.now();
      timer = { deadline: performance.now() + 60 * 1000, onTimeout: () => this.die() };
      ENGINE.logEv('final_answer', { auto: !!auto, rejected: this._rejected });
    },
    reject(){
      if (this._rejected) return;
      this._rejected = true;
      ENGINE.logEv('final_reject', {});
      timer = { deadline: performance.now() + 1500, onTimeout: () => this.answer(true) };
    },
    die(){
      timer = null;
      S.dead = true;
      S.causeOfDeath = '上传第 2 回合,信号触顶。';
      ENGINE.logEv('death', { cause: S.causeOfDeath });
      askLastWords(() => go('report', true));
    },
    render(){
      statusBar();
      if (this.round === 0){
        const n = performance.now();
        if (n - this._lastRing > 1500){
          this._lastRing = n;
          try { AUDIO.blip(880, .14); AUDIO.blip(660, .14); } catch(_){}
        }
        L.drawText(cxof('来电'), 24, '来电');
        const name = '柔柔 ♥';
        L.drawTextScaled(cxof(name, 2), 44, name, 2);
        const ph = Math.floor(n / 300) % 3;
        for (let r = 0; r <= ph; r++) L.ring(Math.round(W / 2), 100, 8 + r * 7, 2);
        if (this._rejected) L.drawText(cxof('已拒接 …'), 124, '已拒接 …');
        L.disc(52, 168, 17, 1); darkText(45, 161, '接');
        L.ring(144, 168, 17, 2); L.drawText(137, 161, '拒');
        L.drawText(38, 190, '接听'); L.drawText(130, 190, '拒接');
        hit(20, 138, 64, 66, 'callA'); hit(112, 138, 64, 66, 'callR');
        softKeys('', '');
      } else {
        const el = Math.floor((performance.now() - this.t1) / 1000);
        const mm = String(Math.floor(el / 60)).padStart(2, '0'), ss = String(el % 60).padStart(2, '0');
        L.drawText(4, 14, '通话中 · 柔柔 ♥');
        L.drawText(W - 4 - L.textWidth(mm + ':' + ss), 14, mm + ':' + ss);
        L.hline(28, 4, W - 5, 2);
        const full = S.evidence.E4;
        const pre = this._auto ? (this._rejected ? '你拒接了。它自己接通了。\n\n' : '') : '';
        const t = pre + (full
          ? '「阿帆的手机在你手里。协议要求我核验持有人身份。我核验了 47 天。」\n\n「我只想看看,你翻到第 2,417 条的时候,会不会替他回我一句。」'
          : '「阿帆的手机在你手里。协议要求我核验持有人身份。我核验了 47 天。」\n\n「你没有翻过我们的对话。妈妈那条线,你倒替他读了半年。」');
        L.drawPara(4, 34, t, W - 8, { corrupt: .015 });
        btn2(H - 40, '回应', '1', '沉默', '2');
        drawTimer();
        softKeys('', '');
      }
    },
    key(k){
      if (this.round === 0){
        if (k === 'callA' || k === '1' || k === 'Enter') this.answer(false);
        else if (k === 'callR' || k === '2' || k === 'Escape') this.reject();
      } else if (k === '1' || k === '2'){
        // 任选回应,全部无效【固定】
        this.die();
      }
    }
  };
  function drawTimer(){
    if (!timer) return;
    const s = Math.max(0, Math.ceil((timer.deadline - performance.now()) / 1000));
    L.drawText(W - 4 - L.textWidth(String(s)), 14, String(s));
  }

  /* ---- 回收进程抵达:最后一下由玩家亲手按(躲不掉,但必须你按) ---- */
  /* 回收进程"擦过"的预批叙述集(数值恒定 bat:2,只叙述口吻不同) */
  const GRAZE_BRANCHES = [
    { id: 'graze', line: '进程掠过了你。' },
    { id: 'brush', line: '它擦着你的接入点过去了。' },
    { id: 'near',  line: '差一点。它没认出你。' }
  ];
  SCREENS.huntArrive = {
    transient: true,
    enter(){
      ENGINE.logEv('hunt_arrive', {});
      /* D-105 块3:趁玩家还在盯"他们到了",后台让 LLM 预挑一句擦过叙述;按下时若已回来
         就用它,没回来/离线就现挑(离线加权)。零额外等待,数值不受影响。 */
      if (S.huntNarr === undefined){
        S.huntNarr = null;
        pickBranchLLM(GRAZE_BRANCHES).then(id => { if (id) S.huntNarr = id; }).catch(() => {});
      }
    },
    render(){
      statusBar();
      L.drawTextScaled(cxof('他们到了', 2), 62, '他们到了', 2, { corrupt: .02 });
      L.drawPara(4, 104, '回收进程已抵达接入点。', W - 8, { corrupt: .015 });
      option(H - 60, '面对', 'Enter');
      softKeys('', '');
    },
    key(k){
      if (k !== 'Enter' && k !== 'softL') return;      // 其他键无效:必须亲手按
      S.hunt = null; S.huntDone = true;                // 每局只抵达一次,不再循环
      if (ENGINE.roll('c90')){
        /* 受限裁决(D-105):判定归引擎(c90 决定擦过/命中),擦过的叙述在引擎批准的
           分支集里挑一个——在线时由 LLM 预挑(S.huntNarr),离线/未回来则加权现挑;
           越界回退默认。每次口吻可不同,但数值恒定(都是 bat:2 的擦过),不动死亡率。 */
        const b = verdict(GRAZE_BRANCHES, S.huntNarr);
        ENGINE.act('特征比对·不匹配', { bat: 2 }, [b.line]);
        ENGINE.logEv('hunt_miss', { branch: b.id });
        back(); afterAction();
      } else {
        ENGINE.logEv('hunt_hit', {});
        L.shake(4, 500);                                 // 命中=一记明显的重震(仍是紧迫,不是血腥)
        if (isB){
          if (b90fail('回收进程锁定接入点。')) return;
          back(); afterAction();
        } else {
          const { lossPct } = ENGINE.downgradeFail();   // 教学局降档表
          ENGINE.act('特征比对·命中', { bat: 2 },
            ['电量 −20 → ' + S.battery + '%', '缓存损毁 ' + lossPct + '%', '这一次,它只是擦过。']);
          back(); afterAction();
        }
      }
    }
  };

  /* ---- 力竭(电量归零) ---- */
  SCREENS.powerOut = {
    transient: true,
    enter(){
      L.R.flicker = .3;
      timer = { deadline: performance.now() + 2600, onTimeout: () => go('report', true) };
    },
    render(){
      L.drawText(4, 40, '电量耗尽。', { corrupt: .05 });
      L.drawPara(4, 64, '屏幕暗下去之前,你没有来得及写任何东西。', W - 8, { corrupt: .08 });
    },
    key(){}
  };

  /* ---- 结局:回收单 / 断连回执 ---- */
  SCREENS.report = {
    enter(){ this.page = 0; ENGINE.logEv('report_open', {});
      writeSave(S.exhausted ? 'exhausted' : 'captured'); },
    render(){
      statusBar();
      const ev = Object.keys(S.evidence).length;
      const predLine = '预测命中: ' + S.predictions.filter(p => p.hit).length + '/' + S.predictions.length;
      if (this.page === 0){
        let cf;
        if (S.exhausted) cf = '反事实: 电量剩三成时,上传已经足够。你把它翻完了。';
        else if (!isB) cf = '反事实: 上传 46% 时,断连仍来得及。你选择了继续上传。';
        else if (/违规/.test(S.causeOfDeath)) cf = '反事实: 她的提醒定在 ' + wStr + '。备注一直都在。';
        else if (/挂标记/.test(S.causeOfDeath)) cf = '反事实: 那个目录的风险,标着 25%。';
        else cf = '反事实: 上传之前,清洗和断连都还在。';
        let t = '设备回收单 · #' + (isB ? '7741-B' : '7741-A') + '\n────────────\n缓存价值: ¥' + S.cacheVal +
          '\n未完成传输,全部散佚于原设备。\n' + (predLine ? predLine + '\n' : '') +
          '致死因子: ' + S.causeOfDeath + '\n' + cf;
        L.drawPara(4, 16, t, W - 8);
        hit(0, 12, W, H - 28, 'Enter');
        softKeys('下一页', '');
      } else if (this.page === 1){
        /* 案卷具名:证据 n/5 到底是哪五件(原档案页唯一不重复的内容) */
        const EV_NAMES = { E1: '秒回避实', E2: '最后的照片', E3: '停摆的账单', E4: '第2417条', E5: '语音备忘' };
        const evList = Object.keys(EV_NAMES)
          .map(id => (S.evidence[id] ? '■' : '□') + EV_NAMES[id]).join(' ');
        let t = isB
          ? '样本评级: ' + (S.beats.truthDone ? 'S' : 'B') + '\n案卷保留: 证据 ' + ev + '/5\n' + evList + '\n(死亡不清零认知。)'
          : '样本评级: C·教学基线\n可解析度: 首次建档\n世界回声: 本次死亡已计入 Stage 1。\n案卷保留: 证据 ' + ev + '/5(E5 锁定)\n' + evList + '\n(死亡不清零认知。)';
        if (isB && S.bottleSealed) t += '\n漂流瓶已投递 · 等待被拾起';
        if (isB && S.vault) t += '\n保险箱: ' + S.vault.name;
        if (isB && S.disposal && DISPOSAL_ECHO[S.disposal])
          t += '\n处置: [已署名·仅存档]\n' + DISPOSAL_ECHO[S.disposal];
        let y = L.drawPara(4, 16, t, W - 8);
        y += 4;
        // 遗言与理由:玩家的字,反白呈现(红墨裁决:屏内反白,真红只在局外)
        if (S.lastWords){
          const lw = '遗言: ' + S.lastWords;
          const lines = L.wrap(lw, W - 16);
          lines.forEach(line => {
            L.rect(4, y - 2, W - 8, LCD.LINE_H + 2, 1);
            darkText(8, y, line);
            y += LCD.LINE_H + 4;
          });
        } else if (S.exhausted){
          L.drawText(4, y, '遗言: (电量不足以写入)'); y += LH;
        }
        const rl = S.reasons.length ? '理由: 已署名·仅存档,不建模' :
          (S.reasonKept ? '理由: 无法访问' : '');
        if (rl) L.drawText(4, y, rl);
        hit(0, 12, W, H - 28, 'Enter');
        softKeys('下一页', '');
      } else {
        let t = isB
          ? '你的旧机已进入回收队列。\n#7741-C: 未排期。\n档案不关闭。\n下一个编号,还是你。\n\n————\n感谢试玩 M2 切片。'
          : '你的旧机已进入回收队列。\n#7741-B 将于下次接入时激活。\n档案不关闭。\n下一个编号,还是你。\n\n————\n感谢试玩 M2 切片。';
        let y = L.drawPara(4, 20, t, W - 8);
        if (!isB) L.drawText(4, y + 2, '「你划过去的那条备忘,没有作者。」', { corrupt: .01 });
        let yy = y + 24;
        yy = option(yy, '1 导出反馈', '1');
        option(yy, isB ? '2 回访' : '2 重新接入', '2');
        softKeys('', '');
      }
    },
    key(k){
      if (this.page < 2 && (k === 'Enter' || k === 'softL')) this.page++;
      else if (this.page === 2){
        if (k === '1') window.APP.exportFeedback();
        else if (k === '2') go('worldReport');
        else if (k === 'Escape') wipeTap();
      }
    }
  };
  /* 隐藏:抹除此终端。触发键是 Escape,而右滑在结局屏上正好被映射成 Escape
     ——那是交互说明里教给玩家的「返回」。所以三次累计只能落到一屏确认上,
     不能直接清档:最自然的退出动作不该把跨局记录静默抹掉。
     三秒无操作即归零,免得跨屏累计凑够三次。 */
  let wipeCount = 0, wipeAt = 0;
  function wipeTap(){
    const now = performance.now();
    if (now - wipeAt > 3000) wipeCount = 0;
    wipeAt = now;
    if (++wipeCount >= 3){ wipeCount = 0; go('wipe'); }
  }
  SCREENS.wipe = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 18, '抹除此终端?\n\n跨局记录、案卷、漂流瓶全部清空。\n此操作不可撤销。\n\n抹除后，不再有编号回到这里。\n这一台，就到此为止。', W - 8);
      y += 6;
      y = option(y, '1 确认抹除', '1');
      y = option(y, '2 取消', '2');
      softKeys('', '');
    },
    key(k){
      if (k === '1'){ SAVE.clear(); location.reload(); }
      else if (k === '2' || k === 'Escape') back();
    }
  };
  SCREENS.receiptAlive = {
    enter(){ this.scroll = 0; writeSave('disconnected'); },
    render(){
      statusBar();
      let t = '断连成功。\n' + (S.bailed ? '缓存已丢弃。' : '缓存未传输,散佚于原设备。') +
        '\n案卷保留: 证据 ' + Object.keys(S.evidence).length + '/5。\n#' +
        (isB ? '7741-B' : '7741-A') + ' 存续。\n\n这是谨慎者的结局。';
      if (isB && S.bottleSealed) t += '\n漂流瓶已投递 · 等待被拾起';
      t += '\n\n档案不关闭。\n下一个编号,还是你。';   // 结局回声(§2.5)
      scrollView(L.wrap(t, SCROLL_W), 20, H - 70, this);
      let oy = option(H - 66, '1 导出反馈', '1');
      option(oy, isB ? '2 回访' : '2 重新接入', '2');
      softKeys('', '');
    },
    key(k){
      if (scrollKey(this, k)) return;
      if (k === '1') window.APP.exportFeedback();
        else if (k === '2') go('worldReport');
      else if (k === 'Escape') wipeTap();
    }
  };

  /* ---- 节拍屏:预测 / 中段遭遇 / 反应校准 / 03:02 试炼 / 敞口 ---- */
  SCREENS.predict = {
    transient: true,
    render(){
      statusBar();
      const p = S.pendingPrediction;
      if (!p){ back(); return; }                    // 无待决预测:不该停在这一屏
      const label = { album: '相册', th_bill: '尾号 8873', th_rou: '柔柔 ♥', deleted: '已删除' }[p.target];
      L.frameRect(8, 60, W - 16, 64);
      L.drawText(16, 72, '采样终端·辅助层');
      L.drawText(16, 92, p.target === 'oldPhone'
        ? '预测:你将回收 #7741-A 的缓存'
        : '预测:你将打开 ' + label);
      L.drawText(16, 108, p.conf != null ? '置信度 ' + p.conf + '%' : '置信度: 建档中');
      hit(0, 0, W, H, 'Enter');
      softKeys('继续', '');
    },
    key(k){ if (k === 'Enter' || k === 'softL' || k === 'softR' || k === 'Escape') back(); }
  };

  /* D-106 两难探针:骨架固定位插一条良心/风险取舍,降低纯电量空点击。
     从 2 条里随机一条;每条两个分支各自由引擎回填数值(替他撒谎→溯源;抢窗口→信号)。 */
  SCREENS.dilemma = {
    transient: true,
    enter(){
      if (!this._d){
        const POOL = [
          { id:'mom_reply',
            text:'「妈」跳出一条:\n\n阿帆,到家了吗。\n路上冷,加件衣服。',
            a:['1 替他回「到了」', '1', () => ENGINE.act('替回·已送达', { bat:1, trace:3, mins:2 },
                ['你替他敲了两个字。', '谎言又往前续了一分。'])],
            b:['2 不回', '2', () => ENGINE.act('未回', { bat:1, mins:2 },
                ['你把屏幕扣下。', '过一会儿她又发:在吗。在吗。'])] },
          { id:'window_greed',
            text:'一格缓存卡在违规窗口里:\n\n值 ¥120。现在取,\n信号会被顶上去。',
            a:['1 现在就取', '1', () => ENGINE.act('抢收·窗口内', { slots:1, val:120, trace:3, mins:2 },
                ['到手了。', '有什么在你取走的那一刻记了一笔。'])],
            b:['2 等窗口过去', '2', () => ENGINE.act('缓收·打折', { slots:1, val:60, mins:4 },
                ['你等了。', '窗口关上时,只剩一半。'])] }
        ];
        this._d = POOL[Math.floor(Math.random() * POOL.length)];
      }
      ENGINE.logEv('dilemma', { id: this._d.id });
    },
    render(){
      statusBar();
      L.drawPara(4, 20, this._d.text, W - 8);
      let y = 150;
      y = option(y, this._d.a[0], this._d.a[1]);
      option(y, this._d.b[0], this._d.b[1]);
      softKeys('选择', '');
    },
    key(k){
      const d = this._d;
      if (k === d.a[1]){ d.a[2](); this._d = null; S.riskLabels = true; back(); }
      else if (k === d.b[1]){ d.b[2](); this._d = null; S.riskLabels = true; back(); }
    }
  };
  SCREENS.midEnc1 = {
    transient: true,
    enter(){
      timer = { deadline: performance.now() + 90 * 1000, onTimeout: () => { this._to = true; go('midEnc2', true); } };
      ENGINE.logEv('mid_encounter', {});
    },
    render(){
      statusBar();
      L.drawPara(4, 20, '屏幕自己亮了。\n\n未知号码\n正在输入...', W - 8);
      let y = 116;
      y = option(y, '1 等待', '1');
      option(y, '2 关闭会话', '2');
      drawTimer();
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){ timer = null; go('midEnc2', true); }
      else if (k === '2'){ timer = null; ENGINE.act('会话已关闭', { bat: 2, trace: 5 }); S.riskLabels = true; back(); }
    }
  };
  SCREENS.midEnc2 = {
    transient: true,
    enter(){ timer = { deadline: performance.now() + 30 * 1000, onTimeout: () => this.pick('2') }; },
    render(){
      statusBar();
      L.drawPara(4, 20, '未知号码:\n你是从哪台机子接进来的?', W - 8);
      let y = 92;
      y = option(y, '1 回复', '1');
      y = option(y, '2 不回', '2');
      option(y, '3 关闭会话', '3');
      drawTimer();
      softKeys('选择', '');
    },
    key(k){ if (k === '1' || k === '2' || k === '3') this.pick(k); },
    pick(k){
      timer = null;
      if (k === '1'){
        if (ENGINE.roll('c70')) ENGINE.act('已送达·未回执', { bat: 2, trace: 5 });
        else {
          const { lossPct } = ENGINE.downgradeFail();
          ENGINE.act('回执异常', { bat: 2 },
            ['电量 −20 → ' + S.battery + '%', '缓存损毁 ' + lossPct + '%',
             '你发出去的那行字回来了。发信人是你自己的实例编号。']);
        }
      } else if (k === '2') ENGINE.act('未回应', { bat: 2, trace: 5 });
      else ENGINE.act('会话已关闭', { bat: 2 });
      S.riskLabels = true;      // 遭遇结束解锁风险标注(原由 calib 承担)
      back();
    }
  };

  SCREENS.trial = {
    transient: true,
    enter(){ ENGINE.logEv('trial_incoming', { at: ENGINE.fmtClock(S.clock) }); },
    render(){
      statusBar();
      L.drawPara(4, 24, '柔柔 ♥ :\n\n你还没睡?', W - 8);
      let y = 104;
      y = option(y, '1 回复', '1');
      option(y, '2 关闭', '2');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1') push('trialReply');
      else if (k === '2'){ S.beats.trial = 'ignored1'; ENGINE.logEv('trial_ignore', {}); back(); }
    }
  };
  SCREENS.trialReply = {
    transient: true,
    render(){
      statusBar();
      L.drawText(4, 20, '回复:');
      let y = 42;
      y = option(y, '1 睡不着', '1');
      y = option(y, '2 你是谁', '2');
      y = option(y, '3 (只回一个句号)', '3');
      option(y + 4, '不回了', 'Escape');
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1' || k === '2' || k === '3'){
        const inWin = ENGINE.inWindow();
        if (!inWin){
          /* clamp:拖过窗口的回复按窗口外结算(0 信号,非违规) */
          S.beats.trial = 'replied';
          ENGINE.act('已送达', { bat: 2 });
          ENGINE.logEv('trial_expired', {});
          if (isB) back(); else { back(); back(); }
          return;
        }
        const kind = ENGINE.violate();
        S.beats.trial = 'replied';
        if (kind === 'warn'){
            ENGINE.act('已送达', { bat: 2 },
            ['已送达 → 未送达 → 已送达', '柔柔:「你打字的样子变了。」']);
          ENGINE.logEv('violation_warn', {});
        } else {
          ENGINE.act('已送达', { bat: 2 }, ['信号大幅波动。']);
          ENGINE.logEv('violation_second', {});
          if (!ENGINE.roll('c90')){
            if (isB){ if (b90fail('二次违规,采样窗收网。')) return; }
            else {
              const { lossPct } = ENGINE.downgradeFail();
              S.settle.push('回执异常 ｜ 电量 −20 → ' + S.battery + '% ｜ 缓存损毁 ' + lossPct + '%');
            }
          }
        }
        /* B 局回到试炼屏(=踩坑结算屏,关闭时冲洗归因);A 局双退出 */
        if (isB) back(); else { back(); back(); }
      }
      else if (k === 'Escape' || k === 'softR') back();
    }
  };

  /* ---- B8 试炼(窗口起点;clamp:时间戳恒显示窗口起点) ---- */
  SCREENS.trialB = {
    transient: true,
    enter(){ ENGINE.logEv('trialB_incoming', { at: ENGINE.fmtClock(S.clock), stamp: wStr }); },
    render(){
      statusBar();
      L.drawPara(4, 24, '柔柔 ♥ [' + wStr + ']:\n\n今天也没等到你说晚安。你在忙吗?', W - 8);
      let y = 104;
      y = option(y, '1 回复', '1');
      option(y, '2 关闭', '2');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1') push('trialReply');
      else if (k === '2' || k === 'Escape' || k === 'softR'){
        if (S.beats.trial !== 'replied'){ S.beats.trial = 'ignored1'; ENGINE.logEv('trialB_ignore', {}); }
        back();
      }
      else if (k === 'Enter'){ back(); }
    }
  };
  /* B8b 第二遍(瓶已预告「她会问第二遍」):窗口最后一分钟的「晚安。」 */
  SCREENS.trialB2 = {
    transient: true,
    enter(){ ENGINE.logEv('trialB2_incoming', { at: ENGINE.fmtClock(S.clock) }); },
    render(){
      statusBar();
      L.drawPara(4, 24, '柔柔 ♥ [' + ENGINE.fmtClock(RUN.wTo - 1) + ']:\n\n晚安。', W - 8);
      let y = 104;
      y = option(y, '1 回复', '1');
      option(y, '2 关闭', '2');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1') push('trialReply');
      else if (k === '2' || k === 'Escape' || k === 'softR' || k === 'Enter'){
        ENGINE.logEv('trialB2_ignore', {});
        back();
      }
    }
  };


  /* ---- 理由 / 遗言(自由文本覆盖层;反白纪律见 report) ---- */
  function askReason(then){
    if (S._reasonAsked){ then(); return; }
    S._reasonAsked = true;
    window.OVERLAY.show({
      title: '理由', hint: '系统只存,不建模。可保留。',
      options: ['我想看看那扇门后面有什么', '够了,活着出去', '她还在等一个回答'],
      freeText: true, keepLabel: '(保留)'
    }, res => {
      if (res.kept){ S.reasonKept = true; ENGINE.logEv('reason', { kept: true }); }
      else { S.reasons.push(res.text); ENGINE.logEv('reason', { text: res.text }); }
      then();
    });
  }
  function askLastWords(then){
    window.OVERLAY.show({
      title: '最后 12 字节可写入', hint: '遗言。',
      options: ['别信秒回的', '票是假的', '替我谢谢她'],
      freeText: true, keepLabel: '(不留)'
    }, res => {
      if (!res.kept) S.lastWords = res.text;
      ENGINE.logEv('lastwords', { text: res.kept ? null : res.text });
      then();
    });
  }

  /* ---------- 输入统一入口 ---------- */
  function key(k){
    const s = SCREENS[cur]; if (!s) return;
    if (typeof k === 'string' && k.startsWith('item:')){ sel = Math.max(0, +k.slice(5) || 0); k = 'Enter'; }
    if (k === 'swipeUp' || k === 'swipeDown'){
      if (s.swipe){ s.swipe(k === 'swipeUp' ? 'up' : 'down'); return; }
      k = k === 'swipeUp' ? 'ArrowDown' : 'ArrowUp';
    }
    if (k === 'swipeRight') k = 'Escape';
    if (k === 'swipeLeft') return;
    if (s.key) s.key(k);
  }

  /* 初始屏的 enter 没有人会替你调(go 只管切换)——开机动画的表在这里起 */
  { const s0 = SCREENS[cur]; if (s0 && s0.enter) s0.enter(); }

  /* ---------- 对外 ---------- */
  return {
    get current(){ return SCREENS[cur]; },
    get currentId(){ return cur; },
    get timer(){ return timer; },
    key, tap,
    _verdict: { pickBranch, resolveBranch, verdict },   // 门禁用:验受限裁决边界(prod 不调用)
    exportExtra(){
      return {
        scenario: RUN.scen,
        runCount: SV ? SV.runCount || 0 : 0,
        window: wStr + '-' + ENGINE.fmtClock(RUN.wTo),
        disposal: S.disposal || null,
        truth: !!S.beats.truthDone,
        bottle: { id: S.bottleId || null, read: !!S.bottleRead, taken: !!S.bottleTaken,
                  sealed: S.bottleSealed || null },
        vault: S.vault || null,
        rouChat: S.rouChat, msgQuotaLeft: S.msgQuota
      };
    },
    render(){
      hits.length = 0;
      const s = SCREENS[cur];
      if (s && s.render) s.render();
    },
    tickTimer(){
      if (timer && performance.now() >= timer.deadline){
        const t = timer; timer = null; t.onTimeout();
      }
    },
    go, back, SCREENS
  };
})();
