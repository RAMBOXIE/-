"use strict";
/* ============================================================================
   盲机 LCD 渲染器(迁自 research/M1_LCD原型,模块化)
   逻辑屏 196×224。潜望镜原则:一切内容——正文、仪表、故障——写进同一个帧缓冲。
   ============================================================================ */
const LCD = (() => {
  const W = 196, H = 224, SCALE = 3;
  const CELL_H = 13, CW_ASC = 6, LINE_H = 15, SS = 4;
  const CJK_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
  const ASC_FONT = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

  const cvs = document.getElementById('lcd');
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const offc = off.getContext('2d');
  const img = offc.createImageData(W, H);

  const target = new Float32Array(W * H);
  const actual = new Float32Array(W * H);
  const px = (x, y) => y * W + x;

  function setPx(x, y, v){ if (x >= 0 && x < W && y >= 0 && y < H) target[px(x, y)] = v; }
  function rect(x, y, w, h, v = 1){ for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(x + i, y + j, v); }
  function frameRect(x, y, w, h){
    for (let i = 0; i < w; i++){ setPx(x + i, y, 1); setPx(x + i, y + h - 1, 1); }
    for (let j = 0; j < h; j++){ setPx(x, y + j, 1); setPx(x + w - 1, y + j, 1); }
  }
  function hline(y, x0 = 0, x1 = W - 1, step = 1){ for (let x = x0; x <= x1; x += step) setPx(x, y, 1); }
  function disc(cx, cy, r, v = 1){
    const r2 = r * r;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++)
      if (i * i + j * j <= r2) setPx(cx + i, cy + j, v);
  }
  function ring(cx, cy, r, thick = 2){
    const ro = r * r, ri = (r - thick) * (r - thick);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++){
      const d = i * i + j * j;
      if (d <= ro && d >= ri) setPx(cx + i, cy + j, 1);
    }
  }
  function invertRect(x, y, w, h){
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++){
      const k = px(x + i, y + j); if (k >= 0 && k < target.length) target[k] = target[k] > .5 ? 0 : 1;
    }
  }

  /* ---- 字形:真字体 → 4× 超采样 → 盒式降采样 → 阈值二值化(阈值=失真参数) ---- */
  const gcan = document.createElement('canvas');
  const gctx = gcan.getContext('2d', { willReadFrequently: true });
  const glyphCache = new Map();
  const isHalf = ch => ch.charCodeAt(0) < 0x2000 && !/[，。、：；「」『』（）？！—·…♥]/.test(ch);
  const cellW = ch => isHalf(ch) ? CW_ASC : CELL_H;

  function glyph(ch){
    const hit = glyphCache.get(ch); if (hit) return hit;
    const cw = cellW(ch), GW = cw * SS, GH = CELL_H * SS;
    gcan.width = GW; gcan.height = GH;
    gctx.clearRect(0, 0, GW, GH);
    gctx.fillStyle = '#fff'; gctx.textAlign = 'center'; gctx.textBaseline = 'alphabetic';
    gctx.font = (isHalf(ch) ? CELL_H * SS * .92 : CELL_H * SS * .98) + 'px ' + (isHalf(ch) ? ASC_FONT : CJK_FONT);
    gctx.fillText(ch, GW / 2, GH * .80);
    const d = gctx.getImageData(0, 0, GW, GH).data;
    const cov = new Float32Array(cw * CELL_H);
    const inv = 1 / (SS * SS * 255);
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < cw; x++){
      let s = 0;
      for (let j = 0; j < SS; j++){
        const row = (y * SS + j) * GW;
        for (let i = 0; i < SS; i++) s += d[(row + x * SS + i) * 4 + 3];
      }
      cov[y * cw + x] = s * inv;
    }
    const g = { cw, cov }; glyphCache.set(ch, g); return g;
  }

  function textWidth(str){ let w = 0; for (const ch of str) w += (ch === ' ' ? CW_ASC : cellW(ch)); return w; }

  function drawText(x, y, str, o = {}){
    const thr = o.threshold ?? R.threshold, corrupt = o.corrupt ?? R.corrupt;
    let cx = x;
    for (const ch of str){
      if (ch === ' '){ cx += CW_ASC; continue; }
      const g = glyph(ch);
      for (let j = 0; j < CELL_H; j++) for (let i = 0; i < g.cw; i++){
        let on = g.cov[j * g.cw + i] > thr ? 1 : 0;
        if (corrupt > 0 && Math.random() < corrupt) on ^= 1;
        if (on) setPx(cx + i, y + j, 1);
      }
      cx += g.cw;
    }
    return cx;
  }

  /* 放大字(开机标志/来电人名):字形覆盖率按 scale×scale 块放大 */
  function drawTextScaled(x, y, str, scale, o = {}){
    const thr = o.threshold ?? R.threshold;
    let cx = x;
    for (const ch of str){
      if (ch === ' '){ cx += CW_ASC * scale; continue; }
      const g = glyph(ch);
      for (let j = 0; j < CELL_H; j++) for (let i = 0; i < g.cw; i++){
        if (g.cov[j * g.cw + i] > thr) rect(cx + i * scale, y + j * scale, scale, scale, 1);
      }
      cx += g.cw * scale;
    }
    return cx;
  }

  const NO_LINE_START = '。，、：；！？）」』】·…%>';
  /* 不可在中间折断的 token 字符:ASCII 字母数字 + 编号/时刻/千分位里的连接符。
     这样 #7741-A、03:14、2,417、#6404-C 折行时整段一起走,不会被拦腰断成两行。 */
  const TOKEN = /[0-9A-Za-z#:._,\-]/;
  function wrap(str, maxW){
    const out = []; let line = '', w = 0;
    for (const ch of str){
      if (ch === '\n'){ out.push(line); line = ''; w = 0; continue; }
      const cw = ch === ' ' ? CW_ASC : cellW(ch);
      if (w + cw > maxW){
        if (NO_LINE_START.includes(ch) && line.length > 1){
          const carry = line[line.length - 1];
          out.push(line.slice(0, -1)); line = carry; w = cellW(carry);
        } else if (TOKEN.test(ch) && line.length && TOKEN.test(line[line.length - 1])){
          /* 正落在一个 token 中间:退到 token 起点,把整段挪到下一行 */
          let i = line.length;
          while (i > 0 && TOKEN.test(line[i - 1])) i--;
          if (i > 0){ const carry = line.slice(i); out.push(line.slice(0, i)); line = carry; w = textWidth(carry); }
          else { out.push(line); line = ''; w = 0; }   // 整行都是 token(超长)才硬断
        } else { out.push(line); line = ''; w = 0; }
      }
      line += ch; w += cw;
    }
    if (line) out.push(line);
    return out;
  }
  function drawPara(x, y, str, maxW, o){
    const lines = wrap(str, maxW);
    lines.forEach((l, i) => drawText(x, y + i * LINE_H, l, o));
    return y + lines.length * LINE_H;
  }

  /* ---- 仪表(与正文同一渲染器) ---- */
  function drawSignal(x, y, bars){
    for (let b = 0; b < 4; b++){
      const h = 2 + b * 2, bx = x + b * 3;
      if (b < bars) rect(bx, y + 8 - h, 2, h, 1);
      else setPx(bx, y + 7, 1);
    }
  }
  function drawBattery(x, y, segs, jitter){
    frameRect(x, y, 18, 8); rect(x + 18, y + 2, 1, 4);
    for (let s = 0; s < 4; s++){
      if (s < segs){
        const jx = jitter && Math.random() < .25 ? 1 : 0;
        rect(x + 2 + s * 4 + jx, y + 2, 3, 4, 1);
      }
    }
  }

  /* ---- 失真参数(渲染器参数,不是散落的 if) ----
     shake:  瞬时抖屏 {mag(逻辑px), until(performance.now 时刻)}
     accents:本帧的变色区 [{x,y,w,h,rgb}];每帧由绘制方(statusBar)重建 */
  const R = { threshold:.42, corrupt:.0004, scanline:.14, scanPhase:0,
              ghost:true, showUnlit:true, flicker:0, batJitter:false, tsScramble:false,
              shake:null, accents:[], dim:1 };
  /* D-108:低电量屏幕变暗(canon §7 呈现,此前只有文字+震屏+色彩告警)。
     省电模式(电量<20%)整屏调暗,极低(<8%)再暗一档——像真机电量不足降亮度。 */
  function setBatteryDim(bat){
    R.dim = bat < 8 ? .5 : bat < 20 ? .7 : 1;
  }
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 抖屏:扣电量/回收抵达等"紧迫"时刻的一下震动。宪法 11:这是紧迫感不是恐怖峰,
     幅度要小、时间要短。同时有多次请求时取更强的一个。尊重系统减动效设置。 */
  function shake(mag, ms){
    if (reduceMotion) return;
    const until = performance.now() + ms;
    if (!R.shake || until > R.shake.until || mag > R.shake.mag) R.shake = { mag, until };
  }
  /* 变色区:让指定矩形内的"亮像素"改用 rgb(而非默认磷光青)。只影响前景亮度映射,
     底色不变——保持哑机质感。目前只用在状态栏(电量告警 / 回收逼近)。 */
  function accent(x, y, w, h, rgb){ R.accents.push({ x, y, w, h, rgb }); }
  function applyTier(tr){
    if (tr < 40){ R.corrupt=.0004; R.threshold=.42; R.flicker=0;   R.batJitter=false; R.tsScramble=false; return 0; }
    if (tr < 70){ R.corrupt=.0035; R.threshold=.44; R.flicker=.02; R.batJitter=false; R.tsScramble=true;  return 1; }
    if (tr < 90){ R.corrupt=.0110; R.threshold=.47; R.flicker=.05; R.batJitter=true;  R.tsScramble=true;  return 2; }
                  R.corrupt=.0290; R.threshold=.51; R.flicker=.10; R.batJitter=true;  R.tsScramble=true;  return 3;
  }

  /* ---- 呈现 ---- */
  const LIT = [0x5F,0xF0,0xC8], UNLIT = [0x14,0x33,0x2C], SUB = [0x08,0x13,0x0F];
  function present(){
    const flick = R.flicker > 0 && Math.random() < R.flicker ? .55 + Math.random() * .3 : 1;
    const d = img.data;
    const acc = R.accents;
    for (let y = 0; y < H; y++){
      const scan = R.scanline > 0 && ((y + R.scanPhase | 0) % 3 === 0) ? 1 - R.scanline : 1;
      /* 本行命中的变色区(通常为空,几乎零开销) */
      let rowAcc = null;
      for (let i = 0; i < acc.length; i++){
        const r = acc[i];
        if (y >= r.y && y < r.y + r.h) (rowAcc || (rowAcc = [])).push(r);
      }
      for (let x = 0; x < W; x++){
        const k = px(x, y), a = actual[k] * scan * flick * R.dim;   // R.dim<1=低电量整屏变暗(D-108)
        const base = R.showUnlit ? UNLIT : SUB, o = k * 4;
        let lit = LIT;
        if (rowAcc){
          for (let i = 0; i < rowAcc.length; i++){
            const r = rowAcc[i];
            if (x >= r.x && x < r.x + r.w){ lit = r.rgb; break; }
          }
        }
        d[o]   = base[0] + (lit[0] - base[0]) * a;
        d[o+1] = base[1] + (lit[1] - base[1]) * a;
        d[o+2] = base[2] + (lit[2] - base[2]) * a;
        d[o+3] = 255;
      }
    }
    offc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    let ox = 0, oy = 0;
    if (R.shake){
      if (performance.now() < R.shake.until){
        const m = R.shake.mag;
        ox = Math.round((Math.random() * 2 - 1) * m) * SCALE;
        oy = Math.round((Math.random() * 2 - 1) * m) * SCALE;
      } else R.shake = null;
    }
    if (ox || oy){
      ctx.clearRect(0, 0, W * SCALE, H * SCALE);       // 抖动露出的边缘留黑,不拖影
      ctx.drawImage(off, 0, 0, W, H, ox, oy, W * SCALE, H * SCALE);
    } else {
      ctx.drawImage(off, 0, 0, W, H, 0, 0, W * SCALE, H * SCALE);
    }
  }
  function frame(drawFn){
    target.fill(0);
    R.accents.length = 0;                               // 变色区每帧重建
    drawFn();
    if (R.ghost){
      for (let i = 0; i < actual.length; i++){
        const t = target[i], a = actual[i];
        actual[i] = a + (t - a) * (t > a ? .62 : .17);
      }
    } else actual.set(target);
    R.scanPhase += .35;
    present();
  }

  return { W, H, LINE_H, R, applyTier, setBatteryDim, frame, setPx, rect, frameRect, hline, invertRect,
           disc, ring, drawTextScaled, glyph, shake, accent,
           drawText, drawPara, drawSignal, drawBattery, textWidth, wrap };
})();
