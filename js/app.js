"use strict";
/* ============================================================================
   引导:渲染循环 + 输入 + 覆盖层(自由文本) + 反馈导出
   ============================================================================ */
(() => {
  /* ---- 覆盖层:理由/遗言(词库默认 + 自由文本 + 保留) ---- */
  const ovl = document.getElementById('ovl');
  const ovlTitle = document.getElementById('ovlTitle');
  const ovlHint = document.getElementById('ovlHint');
  const ovlOpts = document.getElementById('ovlOpts');
  const ovlText = document.getElementById('ovlText');
  const ovlOk = document.getElementById('ovlOk');
  const ovlCancel = document.getElementById('ovlCancel');
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
        const b = document.createElement('button');
        b.textContent = '自由输入…';
        b.onclick = () => { ovlText.style.display = 'block'; ovlText.focus(); };
        ovlOpts.appendChild(b);
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

  /* ---- 输入 ---- */
  function dispatch(k){
    if (ovl.classList.contains('on')) return;      // 覆盖层期间屏蔽
    CONTENT.key(k);
  }
  addEventListener('keydown', e => {
    const map = { ArrowUp:1, ArrowDown:1, Enter:1, Escape:1, '1':1, '2':1, '3':1, '4':1, '5':1, '6':1 };
    if (ovl.classList.contains('on')) return;
    if (map[e.key]){ e.preventDefault(); dispatch(e.key); }
  });
  document.querySelectorAll('[data-k]').forEach(b => b.onclick = () => dispatch(b.dataset.k));
  document.getElementById('softL').onclick = () => dispatch('softL');
  document.getElementById('softR').onclick = () => dispatch('softR');

  /* ---- 反馈导出(跑测记录表自动化) ---- */
  window.APP = {
    exportFeedback(){
      const data = ENGINE.exportFeedback();
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
    LCD.frame(() => {
      const s = CONTENT.current;
      if (s && s.render) s.render();
    });
    document.getElementById('brandR').textContent =
      ENGINE.S.dead ? '已回收' : ENGINE.S.alive ? '已断连' : '接入中';
    requestAnimationFrame(loop);
  }
  loop();

  /* 调试钩子(顶层 const 外部不可见,显式挂出) */
  window.GAME = { S: ENGINE.S, ENGINE, CONTENT, LCD,
    key: dispatch, go: id => CONTENT.go(id, true) };
})();
