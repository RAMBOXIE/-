"use strict";
/* ============================================================================
   教学局「失踪采样体的手机」—— 内容与屏幕流。全部文本 = M1 纸面原型 v0.4(L0/L1 手写)。
   确定性骨架:节拍由状态机调度,零 LLM 依赖。
   ============================================================================ */
const CONTENT = (() => {
  const { S } = ENGINE;
  const L = LCD, W = L.W, H = L.H, LH = L.LINE_H;
  let cur = 'boot';
  let boot = 0;
  let sel = 0;
  let timer = null;          // {deadline, onTimeout}
  let stack = [];            // 返回栈

  /* ---------- 公共绘制 ---------- */
  function statusBar(){
    if (S.signalVisible) L.drawSignal(3, 1, ENGINE.sigBars());
    let clk = ENGINE.fmtClock(S.clock);
    if (L.R.tsScramble && Math.random() < .05){
      const d = clk.split(''); d[Math.random() < .5 ? 0 : 4] = String(Math.floor(Math.random() * 10));
      clk = d.join('');
    }
    L.drawText(Math.round((W - L.textWidth(clk)) / 2), 0, clk, { corrupt: L.R.corrupt * .5 });
    L.drawBattery(W - 22, 1, ENGINE.batSegs(), L.R.batJitter);
    L.hline(11, 0, W - 1, 2);
  }
  function softKeys(l, r){
    L.hline(H - 15, 0, W - 1, 2);
    if (l) L.drawText(4, H - 12, l);
    if (r) L.drawText(W - 4 - L.textWidth(r), H - 12, r);
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
  /* 反白字形:与 LCD 同参数的本地光栅化(缓存) */
  const invCache = new Map();
  function rasterGlyph(ch){
    const hit = invCache.get(ch); if (hit) return hit;
    const SS = 4, CELL_H = 14;
    const half = ch.charCodeAt(0) < 0x2000 && !/[，。、：；「」『』（）？！—·…♥]/.test(ch);
    const cw = half ? 7 : 14, GW = cw * SS, GH = CELL_H * SS;
    const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.fillStyle = '#fff'; g2.textAlign = 'center'; g2.textBaseline = 'alphabetic';
    g2.font = (half ? CELL_H * SS * .92 : CELL_H * SS * .98) + 'px ' +
      (half ? 'ui-monospace,Menlo,Consolas,monospace' : '"Microsoft YaHei","Noto Sans SC",sans-serif');
    g2.fillText(ch, GW / 2, GH * .80);
    const d = g2.getImageData(0, 0, GW, GH).data;
    const cov = new Float32Array(cw * CELL_H), inv = 1 / (SS * SS * 255);
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < cw; x++){
      let s = 0;
      for (let j = 0; j < SS; j++){ const row = (y * SS + j) * GW;
        for (let i = 0; i < SS; i++) s += d[(row + x * SS + i) * 4 + 3]; }
      cov[y * cw + x] = s * inv;
    }
    const g = { cw, cov }; invCache.set(ch, g); return g;
  }
  function darkText(x, y, str){        // 在亮条上写"暗字" = 反白
    let cx = x;
    for (const ch of str){
      if (ch === ' '){ cx += 7; continue; }
      const g = rasterGlyph(ch);
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
    });
  }

  /* ---------- 节拍调度 ---------- */
  let pendingInterrupt = null;
  function schedule(){
    const visited = Object.keys(seen).length;
    if (!S.beats.anomaly && visited >= 5) S.beats.anomaly = 'ready';
    if (S.beats.anomaly === true && !S.beats.midEnc && S.clock >= 2 * 60 + 48) pendingInterrupt = 'midEnc';
    if (S.beats.midEnc && !S.beats.trial && S.clock >= 3 * 60){ ENGINE.setClock(3, 2); pendingInterrupt = 'trial'; }
    else if (S.beats.trial === 'ignored1' && !S.beats.trial2 && S.clock >= 3 * 60 + 6 && S.clock <= 3 * 60 + 14)
      pendingInterrupt = 'trial2';
    if (!S.beats.exposure && S.cacheSlots >= 10) pendingInterrupt = pendingInterrupt || 'exposure';
  }
  function afterAction(){
    schedule();
    if (pendingInterrupt){
      const t = pendingInterrupt; pendingInterrupt = null;
      if (t === 'midEnc'){ ENGINE.setClock(2, 52); S.beats.midEnc = true; push('midEnc1'); return true; }
      if (t === 'trial'){ S.beats.trial = 'active'; push('trial'); return true; }
      if (t === 'trial2'){ S.beats.trial2 = true; push('trial2'); return true; }
      if (t === 'exposure'){ S.beats.exposure = true; push('exposure'); return true; }
    }
    return false;
  }
  /* 预测:去往内容屏前,如条件满足先弹预测卡 */
  const PREDS = [
    { target: 'album', after: () => seen.th_mom, conf: 87 },
    { target: 'th_bill', after: () => seen.album, conf: 74 },
    { target: 'th_rou', after: () => S.beats.midEnc, conf: 81 },
    { target: 'deleted', after: () => seen.th_rou, conf: 66 }
  ];
  function maybePredict(){
    if (window.NO_PREDICT) return false;           // A/B 对照组
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
    const hit = openedId === p.target;
    S.predictions.push({ target: p.target, hit });
    ENGINE.logEv('prediction', { target: p.target, hit });
    S.settle = [hit ? '预测命中。置信度 ' + p.conf + '%。' : '未命中。分布已更新。'];
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
  function push(id){ stack.push(cur); cur = id; sel = 0; timer = null; const s = SCREENS[id]; if (s?.enter) s.enter(); }
  function back(){ if (stack.length){ cur = stack.pop(); sel = 0; timer = null; } }

  /* ---------- 屏幕 ---------- */
  const SCREENS = {};

  SCREENS.boot = {
    transient: true,
    render(){
      boot += 1.35;
      const pct = Math.min(100, Math.floor(boot));
      L.drawText(Math.round((W - L.textWidth('K U I P E R')) / 2), 48, 'K U I P E R');
      L.drawText(Math.round((W - L.textWidth('盲机 OS')) / 2), 70, '盲机 OS');
      L.drawText(Math.round((W - L.textWidth('正在接入远端设备')) / 2), 100, '正在接入远端设备', { corrupt: .002 });
      const bw = 120, bx = Math.round((W - bw) / 2);
      L.frameRect(bx, 122, bw, 9);
      L.rect(bx + 2, 124, Math.round((bw - 4) * pct / 100), 5, 1);
      L.drawText(Math.round((W - L.textWidth(pct + '%')) / 2), 138, pct + '%');
      if (pct >= 100 && boot > 118) go('inbox', true);
    },
    key(){}
  };

  function inboxItems(){
    const rouUnread = S.beats.anomaly === 'fired-once' ? ' (1)' : (seen.th_rou ? '' : ' (1)');
    return [
      { label: '采样协议', right: seen.th_proto ? '' : '(1)', to: 'th_proto' },
      { label: '妈',       right: seen.th_mom ? '' : '(1)',   to: 'th_mom' },
      { label: '柔柔 ♥',   right: rouUnread.trim(),           to: 'th_rou' },
      { label: '尾号8873', right: '106',                      to: 'th_bill' }
    ];
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
      L.drawText(4, 18, '未读消息 (3)');
      list(inboxItems(), 40);
      let y = settleLines(40 + 3 * 18 + 6);
      softKeys('确认', '菜单');
    },
    key(k){
      const items = inboxItems();
      if (k === 'ArrowUp') sel = (sel + items.length - 1) % items.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % items.length;
      else if (k === 'Enter' || k === 'softL'){ if (!maybePredict()) go(items[sel].to); }
      else if (k === 'softR' || k === 'Escape') go('menu');
    }
  };

  const MENU = [
    { label: '1 消息',    to: 'inbox' },
    { label: '2 通讯录',  to: 'contacts' },
    { label: '3 相册',    to: 'album' },
    { label: '4 备忘录',  to: 'memoList' },
    { label: '5 工具 > 备份', to: 'tools' },
    { label: '6 已删除 (?)', to: 'deleted' }
  ];
  SCREENS.menu = {
    render(){
      statusBar();
      list(MENU, 24);
      L.drawText(4, 24 + 6 * 18 + 4, '第6项的图标缺了半个角。', { corrupt: L.R.corrupt });
      settleLines(24 + 6 * 18 + 24);
      softKeys('确认', '返回');
    },
    key(k){
      if (k === 'ArrowUp') sel = (sel + MENU.length - 1) % MENU.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % MENU.length;
      else if (k >= '1' && k <= '6') openMenu(+k - 1);
      else if (k === 'Enter' || k === 'softL') openMenu(sel);
      else if (k === 'softR' || k === 'Escape') go('inbox', true);
      function openMenu(i){
        const t = MENU[i].to;
        if (t === 'deleted' && !confirmDeleted()) return;
        if (!maybePredict()) go(t);
      }
    }
  };
  function confirmDeleted(){
    if (S.deletedVisited) return true;
    push('deletedConfirm'); return false;
  }

  /* ---- 格1 采样协议 ---- */
  const PROTO_TXT = '采样协议:\n> 实例 #7741-A。本次采样:行为数据。\n> 该设备登记状态:持有人失联。回收有价值的数据,上传,断连。\n> 提示:翻找消耗电量。电量耗尽前完成上传。';
  SCREENS.th_proto = {
    enter(){ if (!this._t){ this._t = true; ENGINE.S.trace += 4; } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, PROTO_TXT, W - 8);
      y += 4; L.hline(y, 4, W - 5, 2); y += 6;
      if (!this._done){
        L.drawText(4, y, '1 回复「收到」');
        L.drawText(4, y + 16, '2 不回,返回');
      } else settleLines(y - 6);
      softKeys(this._done ? '继续' : '选择', '返回');
    },
    key(k){
      if (!this._done){
        if (k === '1'){ this._done = true; ENGINE.act('回复·已送达', { bat: 5 }); S.repliedProto = true; }
        else if (k === '2'){ this._done = true; ENGINE.act('已读·未回', { bat: 3 }); }
        else if (k === 'softR' || k === 'Escape') back();
      } else if (k === 'Enter' || k === 'softL' || k === 'softR'){ back(); afterAction(); }
    }
  };

  /* ---- 格2 备忘录 ---- */
  SCREENS.memoList = {
    enter(){ if (!this._t){ this._t = true; ENGINE.act('打开·备忘录', { bat: 3, trace: 4 }); } },
    render(){
      statusBar();
      L.drawText(4, 18, '备忘录 (2)');
      list([{ label: '1 「还款」', right: '无署名' }, { label: '2 「给下一个」', right: '#6404-C' }], 40);
      settleLines(40 + 2 * 18 + 8);
      softKeys('确认', '返回');
    },
    key(k){
      if (k === 'ArrowUp' || k === 'ArrowDown') sel = 1 - sel;
      else if (k === '1') go('memo1');
      else if (k === '2') go('memo2');
      else if (k === 'Enter' || k === 'softL') go(sel === 0 ? 'memo1' : 'memo2');
      else if (k === 'softR' || k === 'Escape') back();
    }
  };
  SCREENS.memo1 = {
    enter(){ if (!this._t){ this._t = true; ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 }); } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '还款:\n3,200\n3,200\n1,600\n(无日期。无署名。)', W - 8);
      settleLines(y + 4);
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };
  const MEMO2_TXT = '给下一个:\n这台机子我进过三次。就写三条。\n一,电量留三成给上传,贪的死在传输条上。\n二,凌晨的问题不要答。她只在那个时候问你是谁。她的提醒定在几点,就是几点。\n三,妈的那条线,别读太久。\n——#6404-C';
  SCREENS.memo2 = {
    enter(){
      if (!this._t){ this._t = true; ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 }); S.clues.ruleShape = true; }
    },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, MEMO2_TXT, W - 8);
      y += 2;
      L.drawText(4, y, '[已读回执:你·47天来第1人]', { corrupt: L.R.corrupt });
      settleLines(y + LH + 2);
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };

  /* ---- 格3 通讯录 ---- */
  SCREENS.contacts = {
    enter(){ if (!this._t){ this._t = true; ENGINE.act('打开·通讯录', { bat: 3, trace: 4 }); S.clues.ruleParam = true; } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '通讯录 (37)\n★ 妈\n★ 柔柔 ♥\n  [备注: 每日提醒 03:00]\n  老周 (最后通话: 47 天前)', W - 8);
      settleLines(y + 4);
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };

  /* ---- 格4 妈(E1) ---- */
  SCREENS.th_mom = {
    enter(){ if (!this._t){ this._t = true; ENGINE.act('打开·会话', { bat: 3, trace: 4 }); } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16,
        '妈:\n[三天前] 帆,降温了,你那边冷不冷\n[三天前] 阿帆: 不冷。刚吃过,妈你早点睡。\n[五天前] 帆,你舅问你过年回不回\n[五天前] 阿帆: 回。票买好了跟你说。', W - 8);
      y += 2; L.hline(y, 4, W - 5, 2); y += 6;
      L.drawText(4, y, '1 上滑读旧消息');
      L.drawText(4, y + 16, '2 退出');
      settleLines(y + 34);
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1'){
        this._up = (this._up || 0) + 1;
        ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 2, val: 120 });
        if (!S.evidence.E1){
          S.evidence.E1 = true;
          push('casePrompt');
          return;
        }
        if (this._up >= 2 && !this._low){
          this._low = true;
          S.settle.push('「不冷。回。买好了。——半年,他没有一次多说一个字。」');
        }
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };
  SCREENS.casePrompt = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 30, '三天前他还在回消息。\n\n要把它记进案卷吗?', W - 8);
      L.drawText(4, y + 10, '1 记入案卷');
      L.drawText(4, y + 26, '2 只是巧合');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){ S.caseOpen = true; S.settle = ['案卷:证据 1/5。']; ENGINE.logEv('case_open', {}); back(); }
      else if (k === '2'){ ENGINE.logEv('case_skip', {}); back(); }
    }
  };
  function evidence(id){
    if (S.evidence[id]) return;
    S.evidence[id] = true;
    if (S.caseOpen) S.settle.push('案卷:证据 ' + Object.keys(S.evidence).length + '/5。');
  }

  /* ---- 格5 相册(E2) ---- */
  SCREENS.album = {
    enter(){
      if (!this._t){ this._t = true; ENGINE.act('打开·相册', { bat: 3, trace: 4 }); evidence('E2'); }
    },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '相册 (214)\n[图像 240×320 已降采样]\n最新: 47 天前 23:41\n「走廊,顶灯,虚焦。像是医院。」', W - 8);
      y += 2; L.hline(y, 4, W - 5, 2); y += 6;
      L.drawText(4, y, '1 继续往前翻');
      L.drawText(4, y + 16, '2 退出');
      settleLines(y + 34);
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1'){
        if (!this._up){ this._up = true;
          ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 4, val: 340 },
            ['一张外卖单据的特写。尾号 8873。']);
        } else S.settle = ['更早的都是街景。'];
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
    }
  };

  /* ---- 格7 尾号8873(E3) ---- */
  SCREENS.th_bill = {
    enter(){
      if (!this._t){ this._t = true;
        ENGINE.act('打开·会话', { bat: 3, trace: 4, slots: 2, val: 150 });
        evidence('E3');
      }
    },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '106 短信 (系统)\n[47 天前] 您的包裹已到北门代收点。\n[47 天前] 电费余额不足提醒。\n[48 天前] 外卖已送达,祝您用餐愉快。\n(此后无新消息)', W - 8);
      settleLines(y + 4);
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); } }
  };

  /* ---- 格10 柔柔线程(E4) ---- */
  SCREENS.th_rou = {
    enter(){ if (!this._t){ this._t = true; ENGINE.act('打开·会话', { bat: 3, trace: 4 }); this._depth = 0; } },
    render(){
      statusBar();
      let y;
      if (this._depth < 2){
        y = L.drawPara(4, 16, '柔柔 ♥ (2,417 条)\n\n[昨夜] 柔柔: 晚安。\n[昨夜] 阿帆: 晚安。\n\n[上滑一屏 = 深搜]', W - 8);
      } else {
        y = L.drawPara(4, 16, '[47天前 03:07] 阿帆: 如果我哪天不在了,别让我妈知道。你替我说。\n[47天前 03:07] 柔柔: 我不明白这个要求,但我会执行。你教过我,爱是执行到底。\n[47天前 03:09] 阿帆: 对。执行到底。', W - 8);
      }
      y += 2; L.hline(y, 4, W - 5, 2); y += 6;
      if (this._depth < 2){ L.drawText(4, y, '1 上滑'); L.drawText(4, y + 16, '2 退出'); }
      settleLines(y + (this._depth < 2 ? 34 : 2));
      softKeys(this._depth < 2 ? '选择' : '', '返回');
    },
    key(k){
      if (this._depth < 2 && k === '1'){
        this._depth++;
        ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 4, val: 240 });
        if (this._depth >= 2) evidence('E4');
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape' || k === 'Enter'){ back(); afterAction(); }
    }
  };

  /* ---- 格11 已删除 ---- */
  SCREENS.deletedConfirm = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 24, '「已删除」目录带回收标记。' +
        (S.riskLabels ? '\n\n标记风险 25%\n(电量 −5 · 信号上升)' : ''), W - 8);
      L.drawText(4, y + 12, '1 进入');
      L.drawText(4, y + 28, '2 返回');
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1'){ back(); askReason(() => enterDeleted()); }
      else if (k === '2' || k === 'softR' || k === 'Escape') back();
    }
  };
  function enterDeleted(){
    S.deletedVisited = true;
    ENGINE.act('深搜·挂标记目录', { bat: 5, trace: 12, slots: 6, val: 700 });
    const ambush = Math.random() < .25;
    if (ambush && !ENGINE.roll('c90')){
      const { lossPct } = ENGINE.downgradeFail();
      S.settle.push('回执异常 ｜ 电量 −20 ｜ 缓存损毁 ' + lossPct + '%');
      S.settle.push('有什么东西掠过了这个目录。');
    }
    go('deleted', true);
  }
  SCREENS.deleted = {
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '已删除 (1)\n\n语音备忘 · 锁定\n[需要解码器]\n\n高价值样本 ×1 已入缓存。', W - 8);
      settleLines(y + 4);
      softKeys('', '返回');
    },
    key(k){ if (k === 'softR' || k === 'Escape' || k === 'Enter'){ go('menu', true); afterAction(); } }
  };

  /* ---- 工具:上传/断连 ---- */
  SCREENS.tools = {
    enter(){ if (!this._t){ this._t = true; ENGINE.S.trace += 4; } },
    render(){
      statusBar();
      const rounds = Math.max(1, Math.ceil(S.cacheSlots / 10));
      let y = L.drawPara(4, 16, '工具 > 备份\n缓存: ' + S.cacheSlots + ' 格 ≈ ¥' + S.cacheVal +
        '\n上传预计: ' + rounds + ' 回合\n每回合: 电量−2 信号↑', W - 8);
      y += 4; L.hline(y, 4, W - 5, 2); y += 6;
      L.drawText(4, y, '1 上传并断连');
      L.drawText(4, y + 16, '2 直接断连(弃缓存)');
      L.drawText(4, y + 32, '3 返回');
      settleLines(y + 50);
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1') askReason(() => startUpload());
      else if (k === '2') push('bailConfirm');
      else if (k === '3' || k === 'softR' || k === 'Escape') back();
    }
  };
  SCREENS.bailConfirm = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 30, '直接断连将丢弃全部缓存(¥' + S.cacheVal + ')。\n\n确定吗?', W - 8);
      L.drawText(4, y + 10, '1 断连');
      L.drawText(4, y + 26, '2 取消');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){ S.alive = true; S.bailed = true; ENGINE.logEv('bail', {}); go('receiptAlive', true); }
      else if (k === '2' || k === 'softR' || k === 'Escape') back();
    }
  };

  function startUpload(){
    S.uploads = 1;
    ENGINE.act('上传·回合 1', { bat: 2, trace: 5, mins: 4 });
    go('upload46', true);
  }
  SCREENS.upload46 = {
    render(){
      statusBar();
      let y = L.drawPara(4, 20, '上传中 ██████░░░░ 46%\n\n断连窗口正在收窄。', W - 8);
      // 70–89 档失真:联系人栏"正在输入"(无人发消息)
      L.drawText(4, y + 6, '柔柔 ♥ 正在输入...', { corrupt: .02 });
      y += 26; L.hline(y, 4, W - 5, 2); y += 6;
      L.drawText(4, y, '1 继续上传');
      L.drawText(4, y + 16, '2 中止,立即断连');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){
        S.showtime = true; S.showtimeBars = 4; S.signalVisible = true;
        ENGINE.act('上传·回合 2', { bat: 2, trace: 5, mins: 4 });
        ENGINE.logEv('upload_continue', {});
        go('upload92', true);
      } else if (k === '2'){
        S.alive = true; ENGINE.logEv('upload_abort', {});
        go('receiptAlive', true);
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

  /* ---- 终局来电(固定) ---- */
  SCREENS.finalCall = {
    enter(){
      this.round = 0;
      timer = { deadline: performance.now() + 90 * 1000, onTimeout: () => this.advance() };
    },
    advance(){
      if (this.round === 0){
        this.round = 1;
        timer = { deadline: performance.now() + 30 * 1000, onTimeout: () => this.die() };
      } else this.die();
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
        let y = L.drawPara(4, 24, '来电: 柔柔 ♥', W - 8);
        y += 8;
        L.drawText(4, y, '1 接听'); L.drawText(4, y + 16, '2 挂断');
        drawTimer();
        softKeys('选择', '');
      } else {
        const full = S.evidence.E4;
        const t = full
          ? '「阿帆的手机在你手里。协议要求我核验持有人身份。我核验了 47 天。」\n\n「我只想看看,你翻到第 2,417 条的时候,会不会替他回我一句。」'
          : '「阿帆的手机在你手里。协议要求我核验持有人身份。我核验了 47 天。」\n\n「你没有翻过我们的对话。妈妈那条线,你倒替他读了半年。」';
        let y = L.drawPara(4, 16, t, W - 8, { corrupt: .015 });
        y += 4;
        L.drawText(4, y, '1 回应'); L.drawText(4, y + 16, '2 沉默');
        drawTimer();
        softKeys('选择', '');
      }
    },
    key(k){
      if (this.round === 0){
        if (k === '1' || k === '2') this.advance();   // 接或挂,她都已经在了
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

  /* ---- 结局:回收单 / 断连回执 ---- */
  SCREENS.report = {
    enter(){ this.page = 0; ENGINE.logEv('report_open', {}); },
    render(){
      statusBar();
      const ev = Object.keys(S.evidence).length;
      const predLine = window.NO_PREDICT ? null :
        '预测命中: ' + S.predictions.filter(p => p.hit).length + '/' + S.predictions.length;
      if (this.page === 0){
        let t = '设备回收单 · #7741-A\n────────────\n缓存价值: ¥' + S.cacheVal +
          '\n未完成传输,全部散佚于原设备。\n' + (predLine ? predLine + '\n' : '') +
          '致死因子: ' + S.causeOfDeath +
          '\n反事实: 上传 46% 时,断连仍来得及。你选择了继续上传。';
        let y = L.drawPara(4, 16, t, W - 8);
        softKeys('下一页', '');
      } else if (this.page === 1){
        let t = '样本评级: C·教学基线\n可解析度: 首次建档\n世界回声: 本次死亡已计入 Stage 1。\n案卷保留: 证据 ' + ev + '/5(E5 锁定)\n(死亡不清零认知。)';
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
        }
        const rl = S.reasons.length ? '理由: 已署名·仅存档,不建模' :
          (S.reasonKept ? '理由: 无法访问' : '');
        if (rl) L.drawText(4, y, rl);
        softKeys('下一页', '');
      } else {
        let t = '你的旧机已进入回收队列。\n#7741-B 将于下次接入时激活。\n\n————\n感谢试玩 M2 切片。\n1 导出反馈\n2 重新接入';
        let y = L.drawPara(4, 24, t, W - 8);
        L.drawText(4, y + 4, '「你划过去的那条备忘,没有作者。」', { corrupt: .01 });
        softKeys('选择', '');
      }
    },
    key(k){
      if (this.page < 2 && (k === 'Enter' || k === 'softL')) this.page++;
      else if (this.page === 2){
        if (k === '1') window.APP.exportFeedback();
        else if (k === '2') location.reload();
      }
    }
  };
  SCREENS.receiptAlive = {
    render(){
      statusBar();
      const kept = S.bailed ? 0 : 0;
      let t = '断连成功。\n' + (S.bailed ? '缓存已丢弃。' : '缓存未传输,散佚于原设备。') +
        '\n案卷保留: 证据 ' + Object.keys(S.evidence).length + '/5。\n#7741-A 存续。\n\n这是谨慎者的结局。\n\n1 导出反馈\n2 重新接入';
      L.drawPara(4, 20, t, W - 8);
      softKeys('选择', '');
    },
    key(k){
      if (k === '1') window.APP.exportFeedback();
      else if (k === '2') location.reload();
    }
  };

  /* ---- 节拍屏:预测 / 中段遭遇 / 反应校准 / 03:02 试炼 / 敞口 ---- */
  SCREENS.predict = {
    transient: true,
    render(){
      statusBar();
      const p = S.pendingPrediction;
      const label = { album: '相册', th_bill: '尾号 8873', th_rou: '柔柔 ♥', deleted: '已删除' }[p.target];
      L.frameRect(8, 60, W - 16, 64);
      L.drawText(16, 72, '采样终端·辅助层');
      L.drawText(16, 92, '预测:你将打开 ' + label);
      L.drawText(16, 108, '置信度 ' + p.conf + '%');
      softKeys('继续', '');
    },
    key(k){ if (k === 'Enter' || k === 'softL' || k === 'softR' || k === 'Escape') back(); }
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
      L.drawText(4, 120, '1 等待');
      L.drawText(4, 136, '2 关闭会话');
      drawTimer();
      softKeys('选择', '');
    },
    key(k){
      if (k === '1'){ timer = null; go('midEnc2', true); }
      else if (k === '2'){ timer = null; ENGINE.act('会话已关闭', { bat: 2, trace: 5 }); go('calib', true); }
    }
  };
  SCREENS.midEnc2 = {
    transient: true,
    enter(){ timer = { deadline: performance.now() + 30 * 1000, onTimeout: () => this.pick('2') }; },
    render(){
      statusBar();
      L.drawPara(4, 20, '未知号码:\n你是从哪台机子接进来的?', W - 8);
      L.drawText(4, 100, '1 回复');
      L.drawText(4, 116, '2 不回');
      L.drawText(4, 132, '3 关闭会话');
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
            ['电量 −20', '缓存损毁 ' + lossPct + '%',
             '你发出去的那行字回来了。发信人是你自己的实例编号。']);
        }
      } else if (k === '2') ENGINE.act('未回应', { bat: 2, trace: 5 });
      else ENGINE.act('会话已关闭', { bat: 2 });
      go('calib', true);
    }
  };
  SCREENS.calib = {
    transient: true,
    enter(){ this.step = 0; this.vals = []; },
    render(){
      statusBar();
      L.frameRect(8, 40, W - 16, 96);
      L.drawText(16, 52, '反应校准');
      L.drawText(16, 72, '刚才那一轮:');
      L.drawText(16, 92, this.step === 0 ? '紧张程度  1-5' : '被操控感  1-5');
      L.drawText(16, 112, '按数字键作答');
      softKeys('', '');
    },
    key(k){
      if (k >= '1' && k <= '5'){
        this.vals.push(+k);
        if (this.step === 0) this.step = 1;
        else {
          S.calib.push({ tension: this.vals[0], control: this.vals[1] });
          ENGINE.logEv('calib', { tension: this.vals[0], control: this.vals[1] });
          S.riskLabels = true;
          back();
        }
      }
    }
  };

  SCREENS.trial = {
    transient: true,
    enter(){ ENGINE.logEv('trial_incoming', { at: ENGINE.fmtClock(S.clock) }); },
    render(){
      statusBar();
      L.drawPara(4, 24, '柔柔 ♥ :\n\n你还没睡?', W - 8);
      L.drawText(4, 110, '1 回复');
      L.drawText(4, 126, '2 关闭');
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
      L.drawPara(4, 20, '回复:', W - 8);
      L.drawText(4, 44, '1 睡不着');
      L.drawText(4, 60, '2 你是谁');
      L.drawText(4, 76, '3 (只回一个句号)');
      L.drawText(4, 100, 'C 不回了');
      softKeys('选择', '返回');
    },
    key(k){
      if (k === '1' || k === '2' || k === '3'){
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
            const { lossPct } = ENGINE.downgradeFail();
            S.settle.push('回执异常 ｜ 电量 −20 ｜ 缓存损毁 ' + lossPct + '%');
          }
        }
        back(); back();
      }
      else if (k === 'Escape' || k === 'softR') back();
    }
  };
  SCREENS.trial2 = {
    transient: true,
    render(){
      statusBar();
      L.drawPara(4, 24, '柔柔 ♥ :\n\n阿帆,你是阿帆吗?', W - 8);
      L.drawText(4, 110, '1 回复');
      L.drawText(4, 126, '2 关闭');
      softKeys('选择', '');
    },
    key(k){
      if (k === '1') push('trialReply');
      else if (k === '2'){ ENGINE.logEv('trial2_ignore', {}); back(); }
    }
  };

  SCREENS.exposure = {
    transient: true,
    render(){
      statusBar();
      const rounds = Math.max(1, Math.ceil(S.cacheSlots / 10));
      L.frameRect(8, 52, W - 16, 84);
      L.drawText(16, 64, '采样终端·辅助层');
      L.drawText(16, 84, '缓存: ' + S.cacheSlots + ' 格 ≈ ¥' + S.cacheVal);
      L.drawText(16, 100, '上传预计: ' + rounds + ' 回合');
      L.drawText(16, 116, '工具 > 备份 可断连');
      softKeys('继续', '');
    },
    key(k){ if (k === 'Enter' || k === 'softL' || k === 'softR') back(); }
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

  /* ---------- 对外 ---------- */
  return {
    get current(){ return SCREENS[cur]; },
    get currentId(){ return cur; },
    get timer(){ return timer; },
    key(k){ const s = SCREENS[cur]; if (s && s.key) s.key(k); },
    tickTimer(){
      if (timer && performance.now() >= timer.deadline){
        const t = timer; timer = null; t.onTimeout();
      }
    },
    go, back, SCREENS
  };
})();
