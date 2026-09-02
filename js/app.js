"use strict";
/* ============================================================================
   引导:渲染循环 + 触摸/手势输入 + 覆盖层(自由文本) + 音频 + 反馈导出
   交互原则:LCD 像素呈现 + 触摸式操作——点屏幕上的选项,滑动翻阅,右滑返回。
   ============================================================================ */
(() => {
  /* ---- 覆盖层:理由/遗言(词库默认 + 自由文本 + 保留) ---- */
  const ovl = document.getElementById('ovl');
  const ovlTitle = document.getElementById('ovlTitle');
  const ovlHint = document.getElementById('ovlHint');
  const ovlOpts = document.getElementById('ovlOpts');
  const ovlText = document.getElementById('ovlText');
  const ovlOk = document.getElementById('ovlOk');
  let ovlCb = null;

  window.OVERLAY = {
    show(cfg, cb){
      ovlCb = cb;
      ovlTitle.textContent = cfg.title;
      ovlHint.textContent = cfg.hint || '';
      ovlOpts.innerHTML = '';
      ovlText.style.display = 'none'; ovlText.value = '';
      (cfg.options || []).forEach(t => {
        const b = document.createElement('button');
        b.textContent = t;
        b.onclick = () => done({ text: t, kept: false });
        ovlOpts.appendChild(b);
      });
      if (cfg.freeText){
        if (cfg.textOpen){                      // 关系通道:输入框直接展开
          ovlText.style.display = 'block';
          setTimeout(() => { try { ovlText.focus(); } catch(_){} }, 0);
        } else {
          const b = document.createElement('button');
          b.textContent = '自由输入…';
          b.onclick = () => { ovlText.style.display = 'block'; ovlText.focus(); };
          ovlOpts.appendChild(b);
        }
      }
      if (cfg.keepLabel){
        const b = document.createElement('button');
        b.textContent = cfg.keepLabel;
        b.onclick = () => done({ kept: true });
        ovlOpts.appendChild(b);
      }
      ovl.classList.add('on');
    },
    text(cfg, cb){   // 纯展示(导出)
      ovlCb = cb || (() => {});
      ovlTitle.textContent = cfg.title;
      ovlHint.textContent = cfg.hint || '';
      ovlOpts.innerHTML = '';
      ovlText.style.display = 'block';
      ovlText.value = cfg.value || '';
      ovl.classList.add('on');
      ovlText.select();
    }
  };
  function done(res){
    ovl.classList.remove('on');
    const cb = ovlCb; ovlCb = null;
    if (cb) cb(res);
  }
  ovlOk.onclick = () => {
    if (ovlText.style.display !== 'none' && ovlText.value.trim())
      done({ text: ovlText.value.trim().slice(0, 60), kept: false });
    else done({ kept: true });
  };

  /* ---- 音频(录音回放/铃声;全部程序合成,失败静默) ---- */
  let actx = null, hissSrc = null;
  window.AUDIO = {
    ensure(){
      try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(_){}
      try { if (actx && actx.state === 'suspended') actx.resume(); } catch(_){}
      return actx;
    },
    hiss(on){
      try {
        const c = this.ensure(); if (!c) return;
        if (on){
          if (hissSrc) return;
          const len = c.sampleRate * 2;
          const buf = c.createBuffer(1, len, c.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * .5;
          const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
          const bp = c.createBiquadFilter(); bp.type = 'bandpass';
          bp.frequency.value = 900; bp.Q.value = .5;
          const g = c.createGain(); g.gain.value = .05;
          src.connect(bp); bp.connect(g); g.connect(c.destination);
          src.start(); hissSrc = src;
        } else if (hissSrc){
          try { hissSrc.stop(); } catch(_){}
          hissSrc = null;
        }
      } catch(_){}
    },
    blip(freq, dur){
      try {
        const c = this.ensure(); if (!c) return;
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'square'; o.frequency.value = freq || 620;
        g.gain.value = .035;
        o.connect(g); g.connect(c.destination);
        o.start(); o.stop(c.currentTime + (dur || .09));
      } catch(_){}
    }
  };

  /* ---- 输入:触摸/点击 + 手势 + 键盘兜底 ---- */
  function dispatch(k){
    if (ovl.classList.contains('on')) return;      // 覆盖层期间屏蔽
    CONTENT.key(k);
  }
  const zone = document.getElementById('tapzone');
  const cvs = document.getElementById('lcd');
  let pd = null;   // {x,y,t}
  /* 长按状态(断连仪式用):LCD 逻辑坐标 + 起按时刻;content 在 render 里轮询 */
  window.HOLD = { active: false, x: 0, y: 0, t0: 0 };
  function holdStart(e){
    const r = cvs.getBoundingClientRect();
    window.HOLD = {
      active: true,
      x: (e.clientX - r.left) / r.width * LCD.W,
      y: (e.clientY - r.top) / r.height * LCD.H,
      t0: performance.now()
    };
  }
  zone.addEventListener('pointerdown', e => {
    window.AUDIO.ensure();
    pd = { x: e.clientX, y: e.clientY, t: performance.now() };
    holdStart(e);
    /* 捕获指针:手指拖出屏幕外松手时 pointerup 仍回到 zone,防长按状态悬挂 */
    try { zone.setPointerCapture(e.pointerId); } catch(_){}
    e.preventDefault();
  });
  zone.addEventListener('pointerup', e => {
    window.HOLD.active = false;
    if (!pd) return;
    const dx = e.clientX - pd.x, dy = e.clientY - pd.y;
    const dt = performance.now() - pd.t;
    pd = null;
    if (ovl.classList.contains('on')) return;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (ady > 30 && ady > adx * 1.4){ dispatch(dy < 0 ? 'swipeUp' : 'swipeDown'); return; }
    if (adx > 40 && adx > ady * 1.4){ dispatch(dx > 0 ? 'swipeRight' : 'swipeLeft'); return; }
    if (dt < 700 && adx < 14 && ady < 14){
      const r = cvs.getBoundingClientRect();
      const lx = (e.clientX - r.left) / r.width * LCD.W;
      const ly = (e.clientY - r.top) / r.height * LCD.H;
      CONTENT.tap(lx, ly);
    }
    e.preventDefault();
  });
  zone.addEventListener('pointercancel', () => { pd = null; window.HOLD.active = false; });

  addEventListener('keydown', e => {
    const map = { ArrowUp:1, ArrowDown:1, Enter:1, Escape:1,
                  '1':1, '2':1, '3':1, '4':1, '5':1, '6':1, '7':1 };
    if (ovl.classList.contains('on')) return;
    if (map[e.key]){ e.preventDefault(); dispatch(e.key); }
  });

  /* ---- 反馈导出(跑测记录表自动化) ---- */
  window.APP = {
    exportFeedback(){
      const data = ENGINE.exportFeedback(CONTENT.exportExtra ? CONTENT.exportExtra() : undefined);
      window.OVERLAY.text({
        title: '反馈数据', hint: '全选复制,发给开发者。感谢试玩。', value: data
      });
      try { navigator.clipboard?.writeText(data); } catch(_){}
    }
  };

  /* ---- 循环 ---- */
  setInterval(() => CONTENT.tickTimer(), 250);   // 定时器独立于 rAF(后台标签页 rAF 会暂停)
  function loop(){
    CONTENT.tickTimer();
    LCD.frame(() => CONTENT.render());
    document.getElementById('brandR').textContent =
      ENGINE.S.dead ? '已回收' : ENGINE.S.alive ? '已断连' : '接入中';
    requestAnimationFrame(loop);
  }
  loop();

  /* 调试钩子(顶层 const 外部不可见,显式挂出) */
  window.GAME = { S: ENGINE.S, ENGINE, CONTENT, LCD,
    key: dispatch, go: id => CONTENT.go(id, true), tap: (x, y) => CONTENT.tap(x, y) };
})();
