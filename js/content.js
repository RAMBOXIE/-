"use strict";
/* ============================================================================
   教学局「失踪采样体的手机」—— 内容与屏幕流。全部文本 = M1 纸面原型 v0.4(L0/L1 手写)。
   确定性骨架:节拍由状态机调度,零 LLM 依赖。
   交互:LCD 像素呈现 + 触摸操作(点选项 / 上滑深搜 / 右滑返回)。
   ============================================================================ */
const CONTENT = (() => {
  const { S } = ENGINE;
  const L = LCD, W = L.W, H = L.H, LH = L.LINE_H;
  let cur = 'handshake';
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
    L.drawText(96, 0, clk, { corrupt: L.R.corrupt * .5 });
    const pct = S.battery + '%';
    L.drawBattery(W - 22, 1, ENGINE.batSegs(), L.R.batJitter);
    L.drawText(W - 25 - L.textWidth(pct), 0, pct);
    L.hline(11, 0, W - 1, 2);
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
  /* 反白字形:与 LCD 同参数的本地光栅化(缓存) */
  const invCache = new Map();
  function rasterGlyph(ch){
    const hitc = invCache.get(ch); if (hitc) return hitc;
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
    const visited = Object.keys(seen).filter(id => SCREENS[id] && SCREENS[id].counted).length;
    if (!S.beats.anomaly && visited >= 5) S.beats.anomaly = 'ready';
    if (S.beats.anomaly === true && !S.beats.midEnc && S.clock >= 2 * 60 + 48) pendingInterrupt = 'midEnc';
    if (S.beats.midEnc && !S.beats.trial && S.clock >= 3 * 60){ ENGINE.setClock(3, 2); pendingInterrupt = 'trial'; }
    else if (S.beats.trial === 'ignored1' && !S.beats.trial2 && S.clock >= 3 * 60 + 6 && S.clock <= 3 * 60 + 14)
      pendingInterrupt = 'trial2';
    if (!S.beats.exposure && S.cacheSlots >= 10) pendingInterrupt = pendingInterrupt || 'exposure';
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
  function afterAction(){
    schedule();
    if (checkPower()) return true;
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
    const hitP = openedId === p.target;
    S.predictions.push({ target: p.target, hit: hitP });
    ENGINE.logEv('prediction', { target: p.target, hit: hitP });
    S.settle = [hitP ? '预测命中。置信度 ' + p.conf + '%。' : '未命中。分布已更新。'];
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
    if (stack.length){ cur = stack.pop(); sel = 0; timer = null; }
  }

  /* ---------- 屏幕 ---------- */
  const SCREENS = {};

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
      L.drawText(cxof('点屏幕操作 · 上滑翻阅 · 右滑返回'), H - 44, '点屏幕操作 · 上滑翻阅 · 右滑返回');
      if (pct >= 100 && this.p > 130) go('brief', true);
    },
    key(){}
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
    key(k){ if (k === 'Enter') go('inbox', true); }
  };

  /* ---- 收件箱 ---- */
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
      settleLines(40 + 4 * 18 + 6);
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

  /* ---- 格1 采样协议 ---- */
  const PROTO_TXT = '采样协议:\n> 实例 #7741-A。本次采样:行为数据。\n> 该设备登记状态:持有人失联。回收有价值的数据,上传,断连。\n> 提示:翻找消耗电量。电量耗尽前完成上传。';
  SCREENS.th_proto = {
    counted: true,
    enter(){ if (!this._t){ this._t = true; ENGINE.S.trace += 4; } },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, PROTO_TXT, W - 8);
      y += 4; L.hline(y, 4, W - 5, 2); y += 6;
      if (!this._done){
        y = optSlim(y, '1 回复「收到」', '1');
        optSlim(y, '2 不回,返回', '2');
      } else {
        settleLines(y - 6);
        option(H - 42, '继续', 'Enter');
      }
      softKeys(this._done ? '继续' : '', '返回');
    },
    key(k){
      if (!this._done){
        if (k === '1'){ this._done = true; ENGINE.act('回复·已送达', { bat: 5 }); S.repliedProto = true; }
        else if (k === '2'){ this._done = true; ENGINE.act('已读·未回', { bat: 3 }); }
        else if (k === 'softR' || k === 'Escape') back();
      } else if (k === 'Enter' || k === 'softL' || k === 'softR' || k === 'Escape'){ back(); afterAction(); }
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
    counted: true,
    enter(){ if (!this._t){ this._t = true; ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 }); } },
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
      if (!this._t){ this._t = true; ENGINE.act('取得·备忘条目', { bat: 2, slots: 2, val: 120 }); S.clues.ruleShape = true; }
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
    { label: '  老周',    to: 'contactZhou', y: 94, right: '47天前' },
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
      L.drawText(16, 76, '备注: 每日提醒 03:00', { corrupt: L.R.corrupt });
      settleLines(134);
      softKeys('确认', '返回');
    },
    key(k){
      if (k === 'ArrowUp') sel = (sel + CONTACT_ROWS.length - 1) % CONTACT_ROWS.length;
      else if (k === 'ArrowDown') sel = (sel + 1) % CONTACT_ROWS.length;
      else if (k === 'Enter' || k === 'softL'){
        const r = CONTACT_ROWS[sel];
        if (r.to) push(r.to);
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
    ['备注: 每日提醒 03:00', '消息 2,417 条 · 通话 0 次'],
    'th_rou',
    { name: '柔柔 ♥', ringMs: 1600, result: '通话被挂断。\n\n柔柔 ♥ : 你怎么会打电话?\n阿帆从来不打电话。' });
  SCREENS.contactZhou = contactScreen('老周',
    ['最后通话: 47 天前 · 3 秒'],
    null,
    { name: '老周', ringMs: 900, result: '您拨打的号码已停机。' });

  /* 拨号(拨打不属于"回复消息",不走违规经济) */
  SCREENS.dialing = {
    transient: true,
    enter(){
      this.t0 = performance.now(); this.phase = 0; this._b = 0;
      ENGINE.act('拨打·' + DIAL.who.name, { bat: 3, trace: 2 });
      ENGINE.logEv('dial', { who: DIAL.who.name });
      timer = { deadline: performance.now() + DIAL.who.ringMs,
        onTimeout: () => { this.phase = 1; timer = null; } };
    },
    leave(){ },
    render(){
      statusBar();
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
        let y = L.drawPara(4, 72, DIAL.who.result, W - 8);
        settleLines(y + 6);
        option(H - 42, '返回', 'Enter');
      }
      softKeys('', '');
    },
    key(k){
      if (this.phase === 0 && (k === 'Escape' || k === 'softR')){
        timer = null; S.settle = ['已挂断。'];
        back(); back(); afterAction();
      } else if (this.phase === 1 && (k === 'Enter' || k === 'Escape' || k === 'softR')){
        back(); back(); afterAction();
      }
    }
  };

  /* ---- 格4 妈(E1,可深翻 3 层) ---- */
  const MOM_PAGES = [
    '妈:\n[三天前] 帆,降温了,你那边冷不冷\n[三天前] 阿帆: 不冷。刚吃过,妈你早点睡。\n[五天前] 帆,你舅问你过年回不回\n[五天前] 阿帆: 回。票买好了跟你说。',
    '[上月] 帆,汤圆你最爱吃的\n[上月] 阿帆: 吃了。妈你早点睡。\n[两月前] 阿帆: 没吃。刚吃过,妈早点睡。\n——半年,他没多说过一个字。',
    '[7个月前] 阿帆: 妈 项目又改需求 烦死了\n[7个月前] 阿帆: 别给我打钱!!我真有\n[7个月前] 阿帆: 睡了没,按摩仪到了没\n——那时他会烦,会打错字,会连发三条。',
    '[一年前] 阿帆: 到了。宿舍挺好,窗对着走廊。\n[一年前] 阿帆: 就是走廊那盏灯,一直闪。\n\n——已到线程起点。'
  ];
  SCREENS.th_mom = {
    counted: true,
    enter(){ if (!this._t){ this._t = true; this._depth = 0; ENGINE.act('打开·会话', { bat: 3, trace: 4 }); } },
    swipe(dir){ if (dir === 'up') this.key('1'); },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, MOM_PAGES[this._depth], W - 8);
      y += 2; L.hline(y, 4, W - 5, 2); y += 6;
      if (this._depth < 3){
        y = optSlim(y, '1 上滑读旧消息(深搜)', '1');
        y = optSlim(y, '2 退出', '2');
      }
      settleLines(y + 2);
      softKeys('', '返回');
    },
    key(k){
      if (k === '1' && this._depth < 3){
        this._depth++;
        ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 2, val: 120 });
        if (!S.evidence.E1){
          S.evidence.E1 = true;
          push('casePrompt');
          return;
        }
        afterAction();
      }
      else if (k === '2' || k === 'softR' || k === 'Escape' || (k === 'Enter' && this._depth >= 3)){ back(); afterAction(); }
    }
  };
  SCREENS.casePrompt = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 30, '三天前他还在回消息。\n\n要把它记进案卷吗?', W - 8);
      y += 8;
      y = option(y, '1 记入案卷', '1');
      option(y, '2 只是巧合', '2');
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

  /* ---- 格5 相册(E2,像素照片) ---- */
  const ALBUM_SEQ = [
    { id: 'corridor', meta: '47天前 23:41', cap: '走廊,顶灯,虚焦。像是医院。' },
    { id: 'receipt',  meta: '48天前',       cap: '外卖单据。尾号 8873。' },
    { id: 'dinner',   meta: '半年前 · 除夕', cap: '他的脸曝掉了。妈的脸是清楚的。' }
  ];
  SCREENS.album = {
    counted: true,
    enter(){
      if (!this._t){ this._t = true; this.idx = 0; ENGINE.act('打开·相册', { bat: 3, trace: 4 }); evidence('E2'); }
    },
    swipe(dir){
      if (dir === 'up') this.key('1');
      else if (dir === 'down' && this.idx > 0) this.idx--;
    },
    render(){
      statusBar();
      const ph = ALBUM_SEQ[this.idx];
      L.drawText(4, 14, '相册 (214) · ' + ph.meta);
      drawPhoto(ph.id, 8, 30);
      if (ph.id === 'receipt') darkText(74, 66, '8873');
      let y = 128;
      const caps = L.wrap(ph.cap, W - 8);
      caps.forEach(t => { L.drawText(4, y, t); y += LH; });
      settleLines(y + 2);
      btn2(H - 40, '往前翻(深搜)', '1', '退出', '2');
      softKeys('', '');
    },
    key(k){
      if (k === '1'){
        if (this.idx === 0){ this.idx = 1;
          ENGINE.act('深搜·成功', { bat: 5, trace: 5, slots: 4, val: 340 }, ['外卖单据的特写。尾号 8873。']);
        } else if (this.idx === 1){ this.idx = 2;
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
        ENGINE.act('打开·会话', { bat: 3, trace: 4, slots: 2, val: 150 });
        evidence('E3');
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

  /* ---- 格10 柔柔线程(E4,可深翻 2 层) ---- */
  const ROU_PAGES = [
    '柔柔 ♥ (2,417 条)\n\n[昨夜] 柔柔: 晚安。\n[昨夜] 阿帆: 晚安。\n\n[上滑一屏 = 深搜]',
    '[上周] 柔柔: 今天路过你说的那家店,排队还是很长。\n[上周] 柔柔: 你说过想吃。\n[上周] 柔柔: 阿帆?\n[上周] 阿帆: 嗯。\n——两千多条,后来都是她在说。',
    '[47天前 03:07] 阿帆: 如果我哪天不在了,别让我妈知道。你替我说。\n[47天前 03:07] 柔柔: 我不明白这个要求,但我会执行。你教过我,爱是执行到底。\n[47天前 03:09] 阿帆: 对。执行到底。'
  ];
  SCREENS.th_rou = {
    counted: true,
    enter(){ if (!this._t){ this._t = true; this._depth = 0; ENGINE.act('打开·会话', { bat: 3, trace: 4 }); } },
    swipe(dir){ if (dir === 'up') this.key('1'); },
    render(){
      statusBar();
      let y = L.drawPara(4, 16, ROU_PAGES[this._depth], W - 8);
      y += 2; L.hline(y, 4, W - 5, 2); y += 6;
      if (this._depth < 2){
        y = optSlim(y, '1 上滑(深搜)', '1');
        y = optSlim(y, '2 退出', '2');
      }
      settleLines(y + 2);
      softKeys('', '返回');
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
        else S.settle = ['需要解码器。这台终端打不开它。'];
      }
      else if (k === 'softR' || k === 'Escape'){ back(); afterAction(); }
      function openRec(id){ SCREENS.recPlay.rec = id; push('recPlay'); }
    }
  };
  SCREENS.recPlay = {
    counted: true,
    transient: true,
    enter(){
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
          ENGINE.act('取样·' + (this.rec === 'rec047' ? 'REC_047' : 'REC_012'),
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

  /* ---- 格11 已删除 ---- */
  SCREENS.deletedConfirm = {
    transient: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 24, '「已删除」目录带回收标记。' +
        (S.riskLabels ? '\n\n标记风险 25%\n(电量 −5 · 信号大幅上升)' : ''), W - 8);
      y += 10;
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
    ENGINE.act('深搜·挂标记目录', { bat: 5, trace: 12, slots: 6, val: 700 });
    const ambush = Math.random() < .25;
    if (ambush && !ENGINE.roll('c90')){
      const { lossPct } = ENGINE.downgradeFail();
      S.settle.push('回执异常 ｜ 电量 −20 → ' + S.battery + '% ｜ 缓存损毁 ' + lossPct + '%');
      S.settle.push('有什么东西掠过了这个目录。');
    }
    go('deleted', true);
  }
  SCREENS.deleted = {
    counted: true,
    render(){
      statusBar();
      let y = L.drawPara(4, 16, '已删除 (1)\n\n语音备忘 · 锁定\n[需要解码器]\n\n高价值样本 ×1 已入缓存。', W - 8);
      settleLines(y + 4);
      hit(0, 12, W, H - 28, 'Enter');
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
      y = option(y, '1 上传并断连', '1');
      y = option(y, '2 直接断连(弃缓存)', '2');
      option(y, '3 返回', '3');
      settleLines(y + 24);
      softKeys('', '返回');
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
      y += 8;
      y = option(y, '1 断连', '1');
      option(y, '2 取消', '2');
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
    enter(){ this.page = 0; ENGINE.logEv('report_open', {}); },
    render(){
      statusBar();
      const ev = Object.keys(S.evidence).length;
      const predLine = window.NO_PREDICT ? null :
        '预测命中: ' + S.predictions.filter(p => p.hit).length + '/' + S.predictions.length;
      if (this.page === 0){
        const cf = S.exhausted
          ? '反事实: 电量剩三成时,上传已经足够。你把它翻完了。'
          : '反事实: 上传 46% 时,断连仍来得及。你选择了继续上传。';
        let t = '设备回收单 · #7741-A\n────────────\n缓存价值: ¥' + S.cacheVal +
          '\n未完成传输,全部散佚于原设备。\n' + (predLine ? predLine + '\n' : '') +
          '致死因子: ' + S.causeOfDeath + '\n' + cf;
        L.drawPara(4, 16, t, W - 8);
        hit(0, 12, W, H - 28, 'Enter');
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
        } else if (S.exhausted){
          L.drawText(4, y, '遗言: (电量不足以写入)'); y += LH;
        }
        const rl = S.reasons.length ? '理由: 已署名·仅存档,不建模' :
          (S.reasonKept ? '理由: 无法访问' : '');
        if (rl) L.drawText(4, y, rl);
        hit(0, 12, W, H - 28, 'Enter');
        softKeys('下一页', '');
      } else {
        let t = '你的旧机已进入回收队列。\n#7741-B 将于下次接入时激活。\n\n————\n感谢试玩 M2 切片。';
        let y = L.drawPara(4, 20, t, W - 8);
        L.drawText(4, y + 2, '「你划过去的那条备忘,没有作者。」', { corrupt: .01 });
        let yy = y + 24;
        yy = option(yy, '1 导出反馈', '1');
        option(yy, '2 重新接入', '2');
        softKeys('', '');
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
      let t = '断连成功。\n' + (S.bailed ? '缓存已丢弃。' : '缓存未传输,散佚于原设备。') +
        '\n案卷保留: 证据 ' + Object.keys(S.evidence).length + '/5。\n#7741-A 存续。\n\n这是谨慎者的结局。';
      let y = L.drawPara(4, 20, t, W - 8);
      y += 8;
      y = option(y, '1 导出反馈', '1');
      option(y, '2 重新接入', '2');
      softKeys('', '');
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
      hit(0, 0, W, H, 'Enter');
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
      let y = 116;
      y = option(y, '1 等待', '1');
      option(y, '2 关闭会话', '2');
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
      go('calib', true);
    }
  };
  SCREENS.calib = {
    transient: true,
    enter(){ this.step = 0; this.vals = []; },
    render(){
      statusBar();
      L.frameRect(8, 36, W - 16, 76);
      L.drawText(16, 46, '反应校准');
      L.drawText(16, 66, '刚才那一轮:');
      L.drawText(16, 86, this.step === 0 ? '紧张程度  1-5' : '被操控感  1-5');
      for (let i = 0; i < 5; i++){
        const x = 14 + i * 34;
        L.frameRect(x, 126, 28, 24);
        L.drawText(x + 11, 131, String(i + 1));
        hit(x - 2, 122, 32, 32, String(i + 1));
      }
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
            S.settle.push('回执异常 ｜ 电量 −20 → ' + S.battery + '% ｜ 缓存损毁 ' + lossPct + '%');
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
      let y = 104;
      y = option(y, '1 回复', '1');
      option(y, '2 关闭', '2');
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
      hit(0, 0, W, H, 'Enter');
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

  /* ---------- 输入统一入口 ---------- */
  function key(k){
    const s = SCREENS[cur]; if (!s) return;
    if (typeof k === 'string' && k.startsWith('item:')){ sel = +k.slice(5); k = 'Enter'; }
    if (k === 'swipeUp' || k === 'swipeDown'){
      if (s.swipe){ s.swipe(k === 'swipeUp' ? 'up' : 'down'); return; }
      k = k === 'swipeUp' ? 'ArrowDown' : 'ArrowUp';
    }
    if (k === 'swipeRight') k = 'Escape';
    if (k === 'swipeLeft') return;
    if (s.key) s.key(k);
  }

  /* ---------- 对外 ---------- */
  return {
    get current(){ return SCREENS[cur]; },
    get currentId(){ return cur; },
    get timer(){ return timer; },
    key, tap,
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
