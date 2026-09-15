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

  /* ---- 非-diegetic 福祉阀门(D-108):柔柔通道一键永久关断 ----
     活在外壳(.brand)里,不经过 LCD、不经过她的嗓音、不涉及剧情、随时可按可撤销。
     用同一个 #ovl 覆盖层展示,但内容与游戏内 OVERLAY.show 走的路径无关。 */
  const rouPref = document.getElementById('rouPref');
  function syncRouPrefLabel(){
    if (!rouPref) return;
    rouPref.textContent = PREFS.rouOff ? '柔柔通道:已关' : '柔柔通道';
    rouPref.classList.toggle('off', PREFS.rouOff);
  }
  if (rouPref){
    rouPref.onclick = (e) => {
      e.stopPropagation();
      const off = PREFS.rouOff;
      ovlCb = null; ovlTitle.textContent = '柔柔通道';
      ovlHint.textContent = off
        ? '通道已关闭。开着或关着都不影响游戏进度、不计入任何存档,你随时可以改回来。'
        : '这会让柔柔停止回复,不再收到她的任何消息。不影响游戏进度,随时可以改回来。';
      ovlOpts.innerHTML = '';
      const b = document.createElement('button');
      b.textContent = off ? '重新打开' : '关闭这个通道';
      b.onclick = () => { PREFS.setRouOff(!off); syncRouPrefLabel(); done({ kept: true }); };
      ovlOpts.appendChild(b);
      ovlText.style.display = 'none';
      ovl.classList.add('on');
    };
    syncRouPrefLabel();
  }

  /* ---- 非-diegetic AI 声明(D-108:§9 合规红线,onboarding + 设置页) ----
     角色为 AI 生成、玩家行为被统计建模、部分残留可能是对照样本——这条是法务要求的
     跳出叙事的明文披露,不能靠游戏内"采样协议"那句 diegetic 台词替代。
     首次打开自动弹一次;之后从外壳顶栏「AI 声明」随时可重看。 */
  const DISCLOSURE_TEXT =
    '这是一部互动小说。\n\n' +
    '游戏内与你对话的角色(柔柔、采样官、妈、陌生号码等)由 AI 生成文本驱动。\n' +
    '你在游戏内的选择与输入会被用于生成这些角色的回应与你本局的结算内容。\n' +
    '部分你会遇到的"其他采样员"线索是预先编写的对照样本,不是真实他人。\n\n' +
    '这条声明与游戏叙事无关,可随时在顶栏「AI 声明」重新查看。';
  const aiDisclosure = document.getElementById('aiDisclosure');
  function showDisclosure(){
    window.OVERLAY.text({ title: 'AI 声明', hint: '与游戏叙事无关。', value: DISCLOSURE_TEXT });
    PREFS.setSeenDisclosure(true);
  }
  if (aiDisclosure) aiDisclosure.onclick = (e) => { e.stopPropagation(); showDisclosure(); };
  if (!PREFS.seenDisclosure) showDisclosure();

  /* ---- 静音开关(D-108:AUDIO 全程自动播放,游戏内此前无法关闭)---- */
  const mutePref = document.getElementById('mutePref');
  function syncMuteLabel(){
    if (!mutePref) return;
    mutePref.textContent = PREFS.muted ? '♪̶' : '♪';
    mutePref.classList.toggle('off', PREFS.muted);
    mutePref.title = PREFS.muted ? '已静音 · 点开声' : '静音';
  }
  if (mutePref){
    mutePref.onclick = (e) => {
      e.stopPropagation();
      PREFS.setMuted(!PREFS.muted);
      if (PREFS.muted){ try { window.AUDIO.hiss(false); } catch(_){} }   // 切静音顺手停掉常驻底噪
      syncMuteLabel();
    };
    syncMuteLabel();
  }

  /* ---- 音频(录音回放/铃声;全部程序合成,失败静默) ----
     D-108:静音开关(PREFS.muted)。静音时 ensure 返回 null,hiss/blip 直接不出声;
     切静音顺手把常驻底噪停掉。开关活在外壳顶栏,不是游戏内选项。 */
  let actx = null, hissSrc = null;
  window.AUDIO = {
    ensure(){
      if (typeof PREFS !== 'undefined' && PREFS.muted) return null;
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

  /* ---- 失焦冻结仲裁(D-108:附录A「现实打断致死」对策)----
     标签页切走后 setInterval 仍会(受限地)继续跑,真实倒计时(终局来电/中段遭遇/
     试炼等)原样在背后消耗;玩家接个电话回来可能已经死了。切走时记下时刻,回来时
     把隐藏掉的这段时长整体喂回当前 timer 的 deadline——等于冻结,不是暂停判定本身。 */
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt){ CONTENT.freezeAdjust(performance.now() - hiddenAt); hiddenAt = 0; }
  });

  /* ---- 循环 ---- */
  /* 常驻锚点三件套(§1 宪法13):Kuiper(运营商) · 实例编号 · 接入状态。实例编号本局不变,设一次。 */
  try { document.getElementById('brandInst').textContent = CONTENT.instanceId || ''; } catch(_){}
  setInterval(() => CONTENT.tickTimer(), 250);   // 定时器独立于 rAF(后台标签页 rAF 会暂停)
  function loop(){
    CONTENT.tickTimer();
    LCD.setBatteryDim(ENGINE.S.battery);           // 低电量整屏变暗(D-108)
    LCD.frame(() => CONTENT.render());
    document.getElementById('brandR').textContent =
      ENGINE.S.dead ? '已回收' : ENGINE.S.alive ? '已断连' : '接入中';
    requestAnimationFrame(loop);
  }
  loop();

  /*[SITE-STRIP-BEGIN]*/
  /* 调试钩子。注意:classic script 的顶层 const 是进全局词法环境的,DevTools 里
     ENGINE / CONTENT 本来就够得着——所以删掉这段并不等于关上门,真正关门的是
     build.sh 给 dist/site 打的那层 IIFE。这段在 site 产物里连同 IIFE 一起消失。
     GAME.go 能直达任意屏,而结局屏的 enter() 会写档:手滑一次就把下一局判成 B 局。 */
  window.GAME = { S: ENGINE.S, ENGINE, CONTENT, LCD,
    key: dispatch, go: id => CONTENT.go(id, true), tap: (x, y) => CONTENT.tap(x, y) };
  /*[SITE-STRIP-END]*/
})();
