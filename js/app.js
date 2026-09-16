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
  const reportOvl = document.getElementById('reportOvl');   // D-117 死亡报告局外页

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
  function overlayOn(){ return ovl.classList.contains('on') || reportOvl.classList.contains('on'); }
  function dispatch(k){
    if (overlayOn()) return;      // 覆盖层期间屏蔽
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
    if (overlayOn()) return;
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
    if (reportOvl.classList.contains('on')){ if (e.key === 'Escape') closeReport(); return; }
    if (overlayOn()) return;
    if (map[e.key]){ e.preventDefault(); dispatch(e.key); }
  });

  /* ==================== D-117 死亡报告 · 局外表现层(canon M17) ====================
     范围声明(见决策日志 D-117 §0):canon 原设计是"短链网页"——服务端生成一个可分享
     的独立 URL,任何人不装游戏也能打开,而且"点谁的报告进来,首局注入谁的残留"依赖
     真实多人数据。这个项目没有后端,这里做的是**同一局结算后的本地导出预览**——
     内容结构、红墨裁决(真红只在局外)、水印都照 canon 做,但不生成真实可分享的
     URL,底部如实说明这一点,不冒充真的短链。
     红墨裁决执行处:`.report-ink` 只用在理由/遗言两处——玩家自己的字,局外显真色;
     其余一律是系统测得的数据,维持中性色,不喧宾夺主。
     账本永真(宪法14①,同 SCREENS.report 里的既有纪律):不编造"世界回声行"这类
     需要真实世界层/母体代际状态才成立的数字——那个系统这个项目还没有,宁可不印,
     不假装。 */
  const escHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const reportPage = document.getElementById('reportPage');
  function closeReport(){ reportOvl.classList.remove('on'); }
  window.APP = {
    /* data 由 content.js 的结局屏在导出前用它已经算好的字段拼(见 CONTENT.exportExtra
       同款用法),这里只管排版,不重算任何数值——避免局外页和局内报告口径漂移。 */
    showDeathReport(data){
      window.APP._lastReportData = data;
      const rows = [
        ['缓存价值', '¥' + data.cacheVal],
        ['传输状态', data.uploaded ? '已入库' : '未完成传输,散佚于原设备'],
        ['预测命中', data.predHit + '/' + data.predTotal],
        ['样本评级', data.grade],
        ['案卷进度', '证据 ' + data.evCount + '/5'],
      ];
      let html = '<span class="report-close" data-act="close">✕</span>' +
        '<div class="report-water">KUIPER<br>' + escHtml(data.inst) + '</div>' +
        '<p class="report-h">设备回收单</p>' +
        '<h1 class="report-inst">' + escHtml(data.inst) + '</h1>' +
        rows.map(([k, v]) => '<div class="report-row"><span>' + escHtml(k) + '</span><b>' + escHtml(v) + '</b></div>').join('') +
        '<div class="report-block"><h4>致死因子</h4>' + escHtml(data.cause) +
          (data.counterfactual ? '<div class="report-cf">' + escHtml(data.counterfactual) + '</div>' : '') + '</div>';
      if (data.disposalEcho) html += '<div class="report-block"><h4>处置回声</h4>' + escHtml(data.disposalEcho).replace(/\n/g, '<br>') + '</div>';
      if (data.lastWords || data.reason){
        html += '<div class="report-block"><h4>遗言 / 理由</h4>';
        if (data.lastWords) html += '<div class="report-ink">' + escHtml(data.lastWords) + '</div>';
        if (data.reason) html += '<div class="report-ink" style="margin-top:6px">' + escHtml(data.reason) + '</div>';
        html += '</div>';
      }
      html += '<div class="report-block"><h4>回收队列</h4>你的旧机已进入回收队列。\n档案不关闭。下一个编号,还是你。</div>' +
        '<button class="report-cta" data-act="next">接入下一部手机</button>' +
        '<span class="report-link" data-act="transp">本账号付费状态对本局参数的影响</span>' +
        '<p class="report-foot">这不是真的可分享短链——本项目没有服务端,这是本局结算后的本地导出预览。</p>';
      reportPage.innerHTML = html;
      reportPage.querySelector('[data-act="close"]').onclick = closeReport;
      reportPage.querySelector('[data-act="next"]').onclick = () => { closeReport(); location.reload(); };
      reportPage.querySelector('[data-act="transp"]').onclick = () => window.APP.showTransparency();
      reportOvl.classList.add('on');
    },
    /* canon §8.2 付费透明度页:逐项列出被检查参数。这个项目没有任何付费系统,
       所以这份清单不是"占位符"——canon 描述的理想终态本来就是"0 项被检查",
       这里如实展示这个事实,不是敷衍。 */
    showTransparency(){
      const items = [
        '掉落表 seed', 'near-miss 旋钮', '诱饵密度', 'BOT 投放权重', '拾取上限',
      ];
      let html = '<span class="report-close" data-act="close">✕</span>' +
        '<p class="report-h">付费透明度报告</p>' +
        '<h1 class="report-inst" style="font-size:15px;line-height:1.4">本账号付费状态<br>对本局参数的影响:0 项</h1>' +
        '<ul class="transp-list">' +
        items.map(k => '<li><span>' + escHtml(k) + '</span><span class="transp-ok">未检测到付费行为 · 未调整</span></li>').join('') +
        '</ul><p class="report-foot">本项目当前没有任何付费系统——不是"还没检查完",是没有可检查的东西。</p>' +
        '<span class="report-link" data-act="back">返回死亡报告</span>';
      reportPage.innerHTML = html;
      reportPage.querySelector('[data-act="close"]').onclick = closeReport;
      const back = reportPage.querySelector('[data-act="back"]');
      if (back) back.onclick = () => { if (window.APP._lastReportData) window.APP.showDeathReport(window.APP._lastReportData); };
    }
  };

  /* ---- 反馈导出(跑测记录表自动化) ---- */
  Object.assign(window.APP, {
    exportFeedback(){
      const data = ENGINE.exportFeedback(CONTENT.exportExtra ? CONTENT.exportExtra() : undefined);
      window.OVERLAY.text({
        title: '反馈数据', hint: '全选复制,发给开发者。感谢试玩。', value: data
      });
      try { navigator.clipboard?.writeText(data); } catch(_){}
    }
  });

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
