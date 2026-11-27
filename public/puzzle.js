// ═══════════════════════════════════════════════
//   CHERRY LIVE PUZZLE — PUZZLE ENGINE
// ═══════════════════════════════════════════════
const PuzzleEngine = (function () {
  // ─── State ───────────────────────────────────
  let canvas, ctx, ghostCanvas, ghostCtx;
  let sourceImage = null;  // ImageBitmap or canvas
  let pieces = [];
  let cols = 4, rows = 4;
  let PIECE_W, PIECE_H;
  let boardX, boardY, boardW, boardH;
  let dragPiece = null, dragOffX = 0, dragOffY = 0;
  let snappedCount = 0;
  let totalPieces = 0;
  let score = 0;
  let settings = {};
  let onSnapCb = null, onCompleteCb = null, onScoreCb = null;
  let animFrame = null;
  let snapSound = null;
  let isRunning = false;
  let isPaused = false;
  let waveEnabled = true;
  let waveTime = 0;
  let lastLoopTs = 0;
  let eventsBound = false;
  let lastWaveOffset = new Map();
  let snapRipples = [];

  // ─── Jigsaw tab geometry ────────────────────
  const TAB_SIZE = 0.25;  // fraction of piece size

  function getTabPath(piece, cw, ch) {
    const { col, row, tabs } = piece;
    const x = 0, y = 0;
    const w = cw, h = ch;
    const tx = cw * TAB_SIZE, ty = ch * TAB_SIZE;
    const tr = Math.min(tx, ty) * 0.4; // tab bump radius

    const path = new Path2D();
    path.moveTo(x, y);

    // Top edge
    const topTab = tabs.top;
    path.lineTo(x + w * 0.35, y);
    if (topTab !== 0) {
      const dir = topTab;
      path.bezierCurveTo(
        x + w * 0.35, y + dir * ty * 0.5,
        x + w * 0.5 - tx * 0.5, y + dir * ty,
        x + w * 0.5, y + dir * ty
      );
      path.bezierCurveTo(
        x + w * 0.5 + tx * 0.5, y + dir * ty,
        x + w * 0.65, y + dir * ty * 0.5,
        x + w * 0.65, y
      );
    }
    path.lineTo(x + w, y);

    // Right edge
    const rightTab = tabs.right;
    path.lineTo(x + w, y + h * 0.35);
    if (rightTab !== 0) {
      const dir = rightTab;
      path.bezierCurveTo(
        x + w + dir * tx * 0.5, y + h * 0.35,
        x + w + dir * tx, y + h * 0.5 - ty * 0.5,
        x + w + dir * tx, y + h * 0.5
      );
      path.bezierCurveTo(
        x + w + dir * tx, y + h * 0.5 + ty * 0.5,
        x + w + dir * tx * 0.5, y + h * 0.65,
        x + w, y + h * 0.65
      );
    }
    path.lineTo(x + w, y + h);

    // Bottom edge
    const bottomTab = tabs.bottom;
    path.lineTo(x + w * 0.65, y + h);
    if (bottomTab !== 0) {
      const dir = bottomTab;
      path.bezierCurveTo(
        x + w * 0.65, y + h - dir * ty * 0.5,
        x + w * 0.5 + tx * 0.5, y + h - dir * ty,
        x + w * 0.5, y + h - dir * ty
      );
      path.bezierCurveTo(
        x + w * 0.5 - tx * 0.5, y + h - dir * ty,
        x + w * 0.35, y + h - dir * ty * 0.5,
        x + w * 0.35, y + h
      );
    }
    path.lineTo(x, y + h);

    // Left edge
    const leftTab = tabs.left;
    path.lineTo(x, y + h * 0.65);
    if (leftTab !== 0) {
      const dir = leftTab;
      path.bezierCurveTo(
        x - dir * tx * 0.5, y + h * 0.65,
        x - dir * tx, y + h * 0.5 + ty * 0.5,
        x - dir * tx, y + h * 0.5
      );
      path.bezierCurveTo(
        x - dir * tx, y + h * 0.5 - ty * 0.5,
        x - dir * tx * 0.5, y + h * 0.35,
        x, y + h * 0.35
      );
    }
    path.lineTo(x, y);
    path.closePath();
    return path;
  }

  // ─── Init ────────────────────────────────────
  function init(cfg) {
    canvas = document.getElementById('puzzle-canvas');
    ctx = canvas.getContext('2d');
    ghostCanvas = document.getElementById('ghost-canvas');
    ghostCtx = ghostCanvas.getContext('2d');
    settings = cfg;

    cols = parseInt(cfg.cols) || 4;
    rows = parseInt(cfg.rows) || 4;
    totalPieces = cols * rows;
    snappedCount = 0;
    score = 0;
    pieces = [];
    isPaused = false;
    waveEnabled = cfg.wave !== false;
    waveTime = 0;
    lastLoopTs = 0;
    lastWaveOffset.clear();
    snapRipples = [];

    resize();
    if (!eventsBound) {
      window.addEventListener('resize', resize);
      bindEvents();
      eventsBound = true;
    }
  }

  function getPlayBounds() {
    return {
      minX: 10,
      maxX: Math.max(10, canvas.width - PIECE_W - 10),
      minY: 66,
      maxY: Math.max(66, canvas.height - PIECE_H - 10)
    };
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ghostCanvas.width = canvas.width;
    ghostCanvas.height = canvas.height;

    // Board occupies center area (leave room for HUD)
    const marginTop = 64, marginBottom = 24, marginSide = 24;
    boardW = canvas.width - marginSide * 2;
    boardH = canvas.height - marginTop - marginBottom;
    boardX = marginSide;
    boardY = marginTop;

    // Fit pieces to board
    PIECE_W = Math.floor(boardW / cols);
    PIECE_H = Math.floor(boardH / rows);

    // Update snap and scatter bounds for all pieces
    if (pieces.length > 0) {
      const bounds = getPlayBounds();
      pieces.forEach(p => {
        p.snapX = boardX + p.col * PIECE_W;
        p.snapY = boardY + p.row * PIECE_H;
        if (p.snapped) {
          p.x = p.snapX;
          p.y = p.snapY;
        } else {
          p.baseX = clamp(p.baseX ?? p.x, bounds.minX, bounds.maxX);
          p.baseY = clamp(p.baseY ?? p.y, bounds.minY, bounds.maxY);
        }
      });
    }
    drawGhost();
  }

  // ─── Load image and build pieces ────────────────
  async function loadImage(imgSource) {
    if (imgSource instanceof HTMLVideoElement) {
      // Capture frame
      const tmp = document.createElement('canvas');
      tmp.width = imgSource.videoWidth || 640;
      tmp.height = imgSource.videoHeight || 480;
      const tc = tmp.getContext('2d');
      if (settings.mirror) {
        tc.translate(tmp.width, 0); tc.scale(-1, 1);
      }
      tc.drawImage(imgSource, 0, 0);
      sourceImage = tmp;
    } else if (imgSource instanceof HTMLCanvasElement) {
      sourceImage = imgSource;
    } else if (imgSource instanceof HTMLImageElement) {
      sourceImage = imgSource;
    }
    drawGhost();
    buildPieces();
    if (settings.scrambleAnim) await scrambleAnimation();
  }

  function drawGhost() {
    if (!sourceImage || !ghostCtx) return;
    ghostCtx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);
    // Draw image scaled to exact snapped board grid
    ghostCtx.drawImage(sourceImage, boardX, boardY, cols * PIECE_W, rows * PIECE_H);
  }

  function randomScatterPos() {
    const { minX, maxX, minY, maxY } = getPlayBounds();
    return {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY)
    };
  }

  function buildPieces() {
    pieces = [];
    // Pre-compute tabs: each edge shared between two pieces must be mirrored
    const hTabs = []; // hTabs[row][col] = tab between (row-1,col) and (row,col): 1=down knob, -1=up knob
    const vTabs = []; // vTabs[row][col] = tab between (row,col-1) and (row,col)

    for (let r = 0; r <= rows; r++) {
      hTabs[r] = [];
      for (let c = 0; c < cols; c++) {
        hTabs[r][c] = (r === 0 || r === rows) ? 0 : (Math.random() < 0.5 ? 1 : -1);
      }
    }
    for (let r = 0; r < rows; r++) {
      vTabs[r] = [];
      for (let c = 0; c <= cols; c++) {
        vTabs[r][c] = (c === 0 || c === cols) ? 0 : (Math.random() < 0.5 ? 1 : -1);
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tabs = {
          top:    hTabs[r][c],
          bottom: -hTabs[r + 1][c],  // shared edge, mirrored
          left:   vTabs[r][c],
          right:  -vTabs[r][c + 1]
        };

        const snapX = boardX + c * PIECE_W;
        const snapY = boardY + r * PIECE_H;
        const pos = randomScatterPos();

        pieces.push({
          id: `${r}-${c}`,
          col: c, row: r,
          x: pos.x, y: pos.y,
          baseX: pos.x, baseY: pos.y,
          snapX, snapY,
          tabs,
          snapped: false,
          rotation: settings.rotation ? (Math.floor(Math.random() * 4) * 90) : 0,
          wavePhase: c * 0.7 + r * 0.45,
          zIndex: r * cols + c,
          highlightAlpha: 0, // for snap flash
        });
      }
    }
    totalPieces = pieces.length;
  }

  async function scrambleAnimation() {
    return new Promise(resolve => {
      let t = 0;
      const dur = 65;
      function animStep() {
        t++;
        const raw = Math.min(1, t / dur);
        // Smooth ease-in-out
        const ease = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
        const waveEnvelope = Math.sin(raw * Math.PI);

        pieces.forEach((p) => {
          const waveArcX = Math.sin(p.wavePhase + raw * 6) * 26 * waveEnvelope;
          const waveArcY = Math.cos(p.wavePhase * 1.2 + raw * 6) * 22 * waveEnvelope;
          p.x = p.snapX + (p.baseX - p.snapX) * ease + waveArcX;
          p.y = p.snapY + (p.baseY - p.snapY) * ease + waveArcY;
        });
        render();
        if (t < dur) requestAnimationFrame(animStep);
        else {
          pieces.forEach(p => { p.x = p.baseX; p.y = p.baseY; });
          render();
          resolve();
        }
      }
      // First show the newly clicked photo assembled on the board
      pieces.forEach(p => { p.x = p.snapX; p.y = p.snapY; });
      render();
      setTimeout(() => requestAnimationFrame(animStep), 450);
    });
  }

  // ─── Render ──────────────────────────────────
  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoardOutline();

    // Sort by zIndex
    const sorted = [...pieces].sort((a, b) => a.zIndex - b.zIndex);
    sorted.forEach(p => drawPiece(p));
  }

  function drawBoardOutline() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,60,110,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(boardX, boardY, cols * PIECE_W, rows * PIECE_H);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawPiece(piece) {
    if (!sourceImage) return;
    const { x, y, col, row, snapped, tabs, highlightAlpha } = piece;
    const pw = PIECE_W, ph = PIECE_H;
    const ext = pw * TAB_SIZE; // extra space for tabs

    ctx.save();
    ctx.translate(x, y);

    // Clipping path
    const path = getTabPath(piece, pw, ph);
    ctx.save();
    ctx.clip(path);

    // Draw image slice scaled properly from sourceImage dimensions
    const imgW = sourceImage.naturalWidth || sourceImage.width;
    const imgH = sourceImage.naturalHeight || sourceImage.height;
    const srcPieceW = imgW / cols;
    const srcPieceH = imgH / rows;
    const srcExtX = srcPieceW * TAB_SIZE;
    const srcExtY = srcPieceH * TAB_SIZE;
    const rawSx = col * srcPieceW - srcExtX;
    const rawSy = row * srcPieceH - srcExtY;
    const rawSw = srcPieceW + srcExtX * 2;
    const rawSh = srcPieceH + srcExtY * 2;
    const csx = Math.max(0, rawSx);
    const csy = Math.max(0, rawSy);
    const csw = Math.min(imgW, rawSx + rawSw) - csx;
    const csh = Math.min(imgH, rawSy + rawSh) - csy;
    const extY = ph * TAB_SIZE;
    const scaleX = pw / srcPieceW;
    const scaleY = ph / srcPieceH;

    ctx.drawImage(
      sourceImage,
      csx, csy, csw, csh,
      -ext + (csx - rawSx) * scaleX,
      -extY + (csy - rawSy) * scaleY,
      csw * scaleX,
      csh * scaleY
    );

    // Snap highlight flash
    if (highlightAlpha > 0) {
      ctx.fillStyle = `rgba(255, 217, 61, ${highlightAlpha})`;
      ctx.fillRect(-ext, -ext, pw + ext * 2, ph + ext * 2);
    }

    ctx.restore();

    // Stroke
    ctx.strokeStyle = snapped
      ? 'rgba(255,217,61,0.5)'
      : 'rgba(255,60,110,0.4)';
    ctx.lineWidth = snapped ? 1 : 1.5;
    ctx.stroke(path);

    // Dragging glow
    if (piece === dragPiece) {
      ctx.shadowColor = '#ff3c6e';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = '#ff6b9d';
      ctx.lineWidth = 2;
      ctx.stroke(path);
    }

    ctx.restore();
  }

  // ─── Event Handlers ──────────────────────────
  function bindEvents() {
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
  }

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    if (!isRunning) return;
    const pos = getPos(e);
    const piece = getPieceAt(pos.x, pos.y);
    if (!piece || piece.snapped) return;
    dragPiece = piece;
    dragOffX = pos.x - piece.x;
    dragOffY = pos.y - piece.y;
    // Bring to top
    const maxZ = Math.max(...pieces.map(p => p.zIndex));
    piece.zIndex = maxZ + 1;
    canvas.classList.add('grabbing');
  }

  function onMove(e) {
    if (!dragPiece) return;
    const pos = getPos(e);
    dragPiece.x = pos.x - dragOffX;
    dragPiece.y = pos.y - dragOffY;
  }

  function onUp() {
    if (!dragPiece) return;
    const off = lastWaveOffset.get(dragPiece.id) || { dx: 0, dy: 0 };
    const bounds = getPlayBounds();
    dragPiece.baseX = clamp(dragPiece.x - off.dx, bounds.minX, bounds.maxX);
    dragPiece.baseY = clamp(dragPiece.y - off.dy, bounds.minY, bounds.maxY);
    trySnap(dragPiece);
    dragPiece = null;
    canvas.classList.remove('grabbing');
  }

  // Touch
  function onTouchStart(e) { e.preventDefault(); if (e.touches.length) onDown(e.touches[0]); }
  function onTouchMove(e) { e.preventDefault(); if (e.touches.length) onMove(e.touches[0]); }
  function onTouchEnd() { onUp(); }

  // ─── Snap Logic ──────────────────────────────
  function trySnap(piece) {
    const snapThreshold = Math.min(PIECE_W, PIECE_H) * 0.35;
    const dx = piece.x - piece.snapX;
    const dy = piece.y - piece.snapY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < snapThreshold) {
      piece.x = piece.snapX;
      piece.y = piece.snapY;
      piece.snapped = true;
      snappedCount++;
      score += Math.max(10, Math.floor(100 - dist));
      flashPiece(piece);
      snapRipples.push({ col: piece.col, row: piece.row, startTime: performance.now() });
      if (onSnapCb) onSnapCb(piece, snappedCount, score);
      if (snappedCount === totalPieces) {
        setTimeout(() => { if (onCompleteCb) onCompleteCb(score); }, 300);
      }
    }
  }

  function getPieceAt(x, y) {
    const pad = 6;
    const sorted = [...pieces].sort((a, b) => b.zIndex - a.zIndex);
    for (const p of sorted) {
      if (x >= p.x - pad && x <= p.x + PIECE_W + pad && y >= p.y - pad && y <= p.y + PIECE_H + pad) return p;
    }
    return null;
  }

  function flashPiece(piece) {
    piece.highlightAlpha = 1;
    const fade = () => {
      piece.highlightAlpha -= 0.05;
      if (piece.highlightAlpha > 0) requestAnimationFrame(fade);
      else piece.highlightAlpha = 0;
    };
    requestAnimationFrame(fade);
  }

  // ─── Wave Motion & Game Loop ──────────────────
  function updateWave(now) {
    if (!lastLoopTs) lastLoopTs = now;
    const dt = Math.min(0.05, (now - lastLoopTs) / 1000);
    lastLoopTs = now;

    if (!isPaused && waveEnabled) {
      waveTime += dt;
    }

    const bounds = getPlayBounds();
    const ampX = Math.min(24, Math.max(10, PIECE_W * 0.22));
    const ampY = Math.min(20, Math.max(8, PIECE_H * 0.18));

    // Expire old snap ripples
    snapRipples = snapRipples.filter(r => now - r.startTime < 550);

    pieces.forEach(p => {
      if (p === dragPiece) return;

      if (p.snapped) {
        let rx = 0, ry = 0;
        if (waveEnabled && snapRipples.length > 0) {
          snapRipples.forEach(r => {
            const age = (now - r.startTime) / 550;
            const d = Math.hypot(p.col - r.col, p.row - r.row);
            const ring = Math.sin(d * 1.8 - age * 14) * (1 - age) * 4;
            rx += ring * 0.5;
            ry += ring;
          });
        }
        p.x = p.snapX + rx;
        p.y = p.snapY + ry;
        return;
      }

      if (waveEnabled) {
        const dx = Math.sin(waveTime * 2.1 + p.wavePhase) * ampX;
        const dy = Math.sin(waveTime * 2.8 + p.wavePhase * 1.3 + 0.8) * ampY;
        p.x = clamp(p.baseX + dx, bounds.minX, bounds.maxX);
        p.y = clamp(p.baseY + dy, bounds.minY, bounds.maxY);
        lastWaveOffset.set(p.id, { dx: p.x - p.baseX, dy: p.y - p.baseY });
      } else {
        p.x = p.baseX;
        p.y = p.baseY;
        lastWaveOffset.set(p.id, { dx: 0, dy: 0 });
      }
    });
  }

  function startLoop() {
    isRunning = true;
    lastLoopTs = performance.now();
    function loop(now) {
      updateWave(now);
      render();
      animFrame = requestAnimationFrame(loop);
    }
    animFrame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    isRunning = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  }

  function setWaveEnabled(v) {
    waveEnabled = !!v;
  }

  function setPaused(v) {
    isPaused = !!v;
    lastLoopTs = performance.now();
  }

  // ─── Ghost Preview ────────────────────────────
  function setGhostVisible(v) {
    ghostCanvas.classList.toggle('visible', v);
  }

  // ─── Shuffle ──────────────────────────────────
  function shufflePieces() {
    pieces.forEach(p => {
      if (p.snapped) return;
      const pos = randomScatterPos();
      p.baseX = pos.x;
      p.baseY = pos.y;
      p.x = pos.x;
      p.y = pos.y;
    });
  }

  // ─── Public API ──────────────────────────────
  return {
    init,
    loadImage,
    startLoop,
    stopLoop,
    shufflePieces,
    setGhostVisible,
    setWaveEnabled,
    setPaused,
    getSnappedCount: () => snappedCount,
    getTotalPieces: () => totalPieces,
    getScore: () => score,
    onSnap(cb) { onSnapCb = cb; },
    onComplete(cb) { onCompleteCb = cb; },
    getSourceCanvas: () => sourceImage,
    resize,
    get cols() { return cols; },
    get rows() { return rows; }
  };
})();
