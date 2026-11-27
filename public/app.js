// ═══════════════════════════════════════════════
//   CHERRY LIVE PUZZLE — APP CONTROLLER
// ═══════════════════════════════════════════════
const App = (function () {
  // ─── Storage Keys ────────────────────────────
  const STORAGE_SCORES_KEY = 'cherrylive_top10_scores';
  const STORAGE_NAME_KEY = 'cherrylive_player_name';

  // ─── State ───────────────────────────────────
  let currentScreen = 'menu';
  let source = 'camera';      // 'camera' | 'upload'
  let difficulty = '4x4';
  let timerMode = 'countup';
  let stream = null;
  let uploadedImage = null;
  let timerInterval = null;
  let elapsedSeconds = 0;
  let countdownSeconds = 5 * 60;
  let ghostVisible = false;
  let waveEnabled = true;
  let isPaused = false;
  let snapshotCanvas = null;
  let activeCountdownCancel = null;

  // ─── Screen Nav ───────────────────────────────
  function goTo(screen) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = '';
    });
    const el = document.getElementById(`screen-${screen}`);
    if (el) {
      el.style.display = 'flex';
      el.classList.add('active');
    }
    currentScreen = screen;
    if (screen === 'menu') {
      renderLeaderboard('menu-leaderboard-list');
      window.ParticleSystem?.start();
    } else {
      window.ParticleSystem?.stop();
    }
  }

  function goToSetup() {
    goTo('setup');
    const nameInput = document.getElementById('player-name');
    if (nameInput && !nameInput.value) {
      try {
        nameInput.value = localStorage.getItem(STORAGE_NAME_KEY) || '';
      } catch (_) {}
    }
    initCamera();
  }

  // ─── Camera ───────────────────────────────────
  async function initCamera() {
    const video = document.getElementById('setup-video');
    const noMsg = document.getElementById('no-camera-msg');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      noMsg.style.display = 'none';
      video.style.display = 'block';
    } catch (e) {
      console.warn('Camera error:', e);
      noMsg.style.display = 'flex';
      video.style.display = 'none';
    }
  }

  function stopCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ─── Setup Controls ───────────────────────────
  function setDifficulty(btn, val) {
    document.querySelectorAll('#difficulty-group .pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    difficulty = val;
  }

  function setSource(btn, val) {
    btn.closest('.pill-group').querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    source = val;
    if (val === 'upload') document.getElementById('img-upload').click();
  }

  function onImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => { uploadedImage = img; toast('Image loaded! ✓', 'success'); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    source = 'upload';
  }

  function takeSnapshot() {
    const video = document.getElementById('setup-video');
    if (!video.srcObject) { toast('Camera not available', 'error'); return; }
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 640;
    c.height = video.videoHeight || 480;
    const cx = c.getContext('2d');
    const mirror = document.getElementById('fx-mirror').checked;
    if (mirror) { cx.translate(c.width, 0); cx.scale(-1, 1); }
    cx.drawImage(video, 0, 0);
    snapshotCanvas = c;
    source = 'snapshot';
    // Show preview
    const setupCanvas = document.getElementById('setup-canvas');
    setupCanvas.width = c.width;
    setupCanvas.height = c.height;
    setupCanvas.getContext('2d').drawImage(c, 0, 0);
    toast('Snapshot taken! 📸', 'success');
  }

  function setTimer(btn, val) {
    btn.closest('.pill-group').querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    timerMode = val;
    document.getElementById('countdown-input').style.display = val === 'countdown' ? 'block' : 'none';
  }

  // ─── Start Game ───────────────────────────────
  async function startGame() {
    const nameInput = document.getElementById('player-name');
    const playerName = (nameInput?.value.trim() || 'Player').substring(0, 20);
    try {
      localStorage.setItem(STORAGE_NAME_KEY, playerName);
    } catch (_) {}

    const [c, r] = difficulty.split('x').map(Number);
    await launchGame(c, r);
  }

  function playBeep(freq, durationMs, gainVal = 0.08) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = gainVal;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close().catch(() => {});
      }, durationMs);
    } catch (_) {}
  }

  function runCaptureCountdown(mirror) {
    if (activeCountdownCancel) activeCountdownCancel();

    return new Promise((resolve) => {
      const overlay = document.getElementById('capture-countdown-overlay');
      const video = document.getElementById('countdown-video');
      const numEl = document.getElementById('capture-countdown-num');
      const labelEl = document.getElementById('capture-countdown-label');
      const flashEl = document.getElementById('camera-flash');
      let cancelled = false;
      let timerId = null;

      activeCountdownCancel = () => {
        cancelled = true;
        if (timerId) clearTimeout(timerId);
        overlay.style.display = 'none';
        flashEl.classList.remove('active');
        activeCountdownCancel = null;
        resolve(null);
      };

      video.srcObject = stream;
      video.classList.toggle('mirrored', mirror);
      labelEl.textContent = '📸 Get ready! Capturing in...';
      flashEl.classList.remove('active');
      overlay.style.display = 'flex';

      const steps = ['3', '2', '1'];
      let idx = 0;

      function showStep() {
        if (cancelled) return;
        if (idx < steps.length) {
          numEl.textContent = steps[idx];
          numEl.classList.remove('pop');
          void numEl.offsetWidth;
          numEl.classList.add('pop');
          playBeep(idx === 2 ? 780 : 580, 120);
          idx++;
          timerId = setTimeout(showStep, 850);
          return;
        }

        // Capture frame + flash
        numEl.textContent = '📸';
        labelEl.textContent = '✨ Click! Making puzzle...';
        flashEl.classList.remove('active');
        void flashEl.offsetWidth;
        flashEl.classList.add('active');
        playBeep(1040, 90, 0.12);

        const srcVideo = video.videoWidth ? video : document.getElementById('setup-video');
        const c = document.createElement('canvas');
        c.width = srcVideo.videoWidth || 640;
        c.height = srcVideo.videoHeight || 480;
        const cx = c.getContext('2d');
        if (mirror) {
          cx.translate(c.width, 0);
          cx.scale(-1, 1);
        }
        cx.drawImage(srcVideo, 0, 0, c.width, c.height);

        timerId = setTimeout(() => {
          if (cancelled) return;
          overlay.style.display = 'none';
          flashEl.classList.remove('active');
          activeCountdownCancel = null;
          resolve(c);
        }, 320);
      }

      showStep();
    });
  }

  async function launchGame(cols, rows) {
    goTo('game');
    isPaused = false;
    document.getElementById('pause-overlay').style.display = 'none';

    const mirror = document.getElementById('fx-mirror').checked;
    waveEnabled = document.getElementById('fx-wave')?.checked !== false;
    ghostVisible = !!document.getElementById('fx-ghost')?.checked;

    const settings = {
      cols, rows,
      mirror,
      scrambleAnim: document.getElementById('fx-scramble').checked,
      celebration: document.getElementById('fx-celebrate').checked,
      wave: waveEnabled,
      rotation: document.getElementById('fx-rotation').checked,
    };

    // Wait for 3-2-1 camera capture if using live camera
    let capturedFrame = null;
    if (source === 'camera' && stream) {
      capturedFrame = await runCaptureCountdown(mirror);
      if (!capturedFrame || currentScreen !== 'game') return;
    }

    // Setup game video (live corner preview)
    const gameVideo = document.getElementById('game-video');
    if (source === 'camera' && stream) {
      gameVideo.srcObject = stream;
      gameVideo.style.display = 'block';
    } else {
      gameVideo.style.display = 'none';
    }

    PuzzleEngine.init(settings);
    PuzzleEngine.setGhostVisible(ghostVisible);
    PuzzleEngine.setWaveEnabled(waveEnabled);
    document.getElementById('btn-ghost')?.classList.toggle('active', ghostVisible);
    document.getElementById('btn-wave')?.classList.toggle('active', waveEnabled);

    // Load image source
    if (capturedFrame) {
      await PuzzleEngine.loadImage(capturedFrame);
    } else if (source === 'snapshot' && snapshotCanvas) {
      await PuzzleEngine.loadImage(snapshotCanvas);
    } else if (source === 'upload' && uploadedImage) {
      await PuzzleEngine.loadImage(uploadedImage);
    } else if (stream) {
      await PuzzleEngine.loadImage(document.getElementById('setup-video'));
    } else {
      toast('No image source! Using placeholder.', 'info');
      const c = document.createElement('canvas');
      c.width = 640; c.height = 480;
      const cx = c.getContext('2d');
      const grad = cx.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, '#ff3c6e'); grad.addColorStop(1, '#4d96ff');
      cx.fillStyle = grad; cx.fillRect(0, 0, 640, 480);
      cx.fillStyle = '#fff'; cx.font = 'bold 48px Orbitron, sans-serif'; cx.textAlign = 'center';
      cx.fillText('🍒 CherryLive', 320, 240);
      await PuzzleEngine.loadImage(c);
    }

    // HUD
    updateHUD();
    PuzzleEngine.onSnap(() => {
      updateHUD();
    });
    PuzzleEngine.onComplete((score) => {
      onPuzzleComplete(score);
    });

    startTimer();
    PuzzleEngine.startLoop();
  }

  // ─── Timer ───────────────────────────────────
  function startTimer() {
    elapsedSeconds = 0;
    countdownSeconds = (parseInt(document.getElementById('countdown-minutes')?.value) || 5) * 60;
    clearInterval(timerInterval);
    if (timerMode === 'none') { document.getElementById('hud-timer').textContent = '--:--'; return; }
    timerInterval = setInterval(() => {
      if (isPaused) return;
      elapsedSeconds++;
      if (timerMode === 'countdown') {
        const rem = countdownSeconds - elapsedSeconds;
        if (rem <= 0) { clearInterval(timerInterval); onPuzzleComplete(PuzzleEngine.getScore()); }
        document.getElementById('hud-timer').textContent = fmtTime(rem);
        if (rem <= 30) document.getElementById('hud-timer').style.color = '#ff3c6e';
      } else {
        document.getElementById('hud-timer').textContent = fmtTime(elapsedSeconds);
      }
    }, 1000);
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function stopTimer() { clearInterval(timerInterval); }

  // ─── HUD ─────────────────────────────────────
  function updateHUD() {
    const snapped = PuzzleEngine.getSnappedCount();
    const total = PuzzleEngine.getTotalPieces();
    const score = PuzzleEngine.getScore();
    document.getElementById('hud-score').textContent = score;
    document.getElementById('hud-progress-text').textContent = `${snapped} / ${total} pieces`;
    const pct = total > 0 ? (snapped / total) * 100 : 0;
    document.getElementById('hud-progress-bar').style.width = pct + '%';
  }

  // ─── Ghost ───────────────────────────────────
  function toggleGhost() {
    ghostVisible = !ghostVisible;
    PuzzleEngine.setGhostVisible(ghostVisible);
    document.getElementById('btn-ghost').classList.toggle('active', ghostVisible);
  }

  // ─── Wave Motion ─────────────────────────────
  function toggleWave() {
    waveEnabled = !waveEnabled;
    PuzzleEngine.setWaveEnabled(waveEnabled);
    document.getElementById('btn-wave')?.classList.toggle('active', waveEnabled);
    toast(waveEnabled ? 'Wave motion ON 🌊' : 'Wave motion OFF');
  }

  // ─── Shuffle ─────────────────────────────────
  function shufflePieces() {
    PuzzleEngine.shufflePieces();
    toast('Pieces shuffled! 🔀');
  }

  // ─── Pause ───────────────────────────────────
  function pauseGame() {
    isPaused = true;
    PuzzleEngine.setPaused(true);
    document.getElementById('pause-overlay').style.display = 'flex';
  }
  function resumeGame() {
    isPaused = false;
    PuzzleEngine.setPaused(false);
    document.getElementById('pause-overlay').style.display = 'none';
  }

  // ─── Quit ────────────────────────────────────
  function quitGame() {
    if (activeCountdownCancel) activeCountdownCancel();
    stopTimer();
    PuzzleEngine.stopLoop();
    isPaused = false;
    document.getElementById('pause-overlay').style.display = 'none';
    goTo('menu');
  }

  // ─── LocalStorage Top 10 Scoreboard ──────────
  function getLeaderboard() {
    try {
      const raw = localStorage.getItem(STORAGE_SCORES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveScoreToLeaderboard(entry) {
    const board = getLeaderboard();
    board.push(entry);
    board.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.time !== b.time) return a.time - b.time;
      return b.date - a.date;
    });
    const top10 = board.slice(0, 10);
    try {
      localStorage.setItem(STORAGE_SCORES_KEY, JSON.stringify(top10));
    } catch (_) {}
    const idx = top10.findIndex(item => item.id === entry.id);
    return { board: top10, rank: idx >= 0 ? idx + 1 : -1 };
  }

  function renderLeaderboard(containerId, highlightId = null) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const board = getLeaderboard();
    if (board.length === 0) {
      el.innerHTML = '<div class="lb-empty">No scores yet. Complete a puzzle to claim #1! 🍒</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = board.map((item, i) => {
      const rankLabel = medals[i] || `#${i + 1}`;
      const isCurrent = highlightId && item.id === highlightId;
      return `
        <div class="leaderboard-row ${isCurrent ? 'current-run' : ''}">
          <span class="lb-rank">${rankLabel}</span>
          <span class="lb-name">${escapeHtml(item.name || 'Player')}</span>
          <span class="lb-meta">${escapeHtml(item.difficulty || '')} • ${fmtTime(item.time || 0)}</span>
          <span class="lb-score">${item.score}</span>
        </div>
      `;
    }).join('');
  }

  function showLeaderboard() {
    renderLeaderboard('modal-leaderboard-list');
    document.getElementById('modal-leaderboard').style.display = 'flex';
  }

  function clearLeaderboard() {
    try {
      localStorage.removeItem(STORAGE_SCORES_KEY);
    } catch (_) {}
    renderLeaderboard('menu-leaderboard-list');
    renderLeaderboard('modal-leaderboard-list');
    renderLeaderboard('win-leaderboard-list');
    toast('Local scoreboard cleared 🗑️');
  }

  // ─── Complete ─────────────────────────────────
  function onPuzzleComplete(score) {
    stopTimer();
    PuzzleEngine.stopLoop();

    const winCanvas = document.getElementById('win-preview');
    const src = PuzzleEngine.getSourceCanvas();
    if (src) {
      winCanvas.width = 320;
      winCanvas.height = Math.round(320 * (src.height || src.videoHeight || 480) / (src.width || src.videoWidth || 640));
      winCanvas.getContext('2d').drawImage(src, 0, 0, winCanvas.width, winCanvas.height);
    }

    const total = PuzzleEngine.getTotalPieces();
    const snapped = PuzzleEngine.getSnappedCount();
    const completedAll = total > 0 && snapped === total;
    const timedOut = timerMode === 'countdown' && elapsedSeconds >= countdownSeconds && !completedAll;

    let highlightId = null;
    if (completedAll && score > 0) {
      const nameInput = document.getElementById('player-name');
      let playerName = nameInput?.value.trim() || '';
      if (!playerName) {
        try { playerName = localStorage.getItem(STORAGE_NAME_KEY) || ''; } catch (_) {}
      }
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: (playerName || 'Player').substring(0, 20),
        score,
        time: elapsedSeconds,
        difficulty,
        pieces: total,
        date: Date.now()
      };
      const { rank } = saveScoreToLeaderboard(entry);
      if (rank > 0) {
        highlightId = entry.id;
        toast(`🏆 Top 10! Ranked #${rank}`, 'success');
      }
    }

    renderLeaderboard('win-leaderboard-list', highlightId);

    document.getElementById('win-time').textContent = fmtTime(elapsedSeconds);
    document.getElementById('win-score').textContent = score;
    document.getElementById('win-pieces').textContent = total;
    document.getElementById('win-emoji').textContent = score > 500 ? '🏆' : score > 200 ? '🎉' : '🍒';
    document.getElementById('win-title').textContent = timedOut ? "Time's Up!" : 'Puzzle Complete!';

    goTo('win');

    const settings_ = document.getElementById('fx-celebrate')?.checked !== false;
    if (settings_ && !timedOut) startConfetti();
  }

  // ─── Win Screen Actions ───────────────────────
  function playAgain() {
    stopConfetti();
    goToSetup();
  }

  function saveWinPhoto() {
    const c = document.getElementById('win-preview');
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `cherry-puzzle-${Date.now()}.png`;
    a.click();
    toast('Photo saved! 📸', 'success');
  }

  // ─── Confetti ─────────────────────────────────
  let confettiCtx, confettiParticles = [], confettiRaf;
  function startConfetti() {
    const c = document.getElementById('confetti-canvas');
    c.width = window.innerWidth; c.height = window.innerHeight;
    confettiCtx = c.getContext('2d');
    confettiParticles = [];
    const colors = ['#ff3c6e', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9a3c'];
    for (let i = 0; i < 180; i++) {
      confettiParticles.push({
        x: Math.random() * c.width,
        y: Math.random() * c.height - c.height,
        w: Math.random() * 12 + 6,
        h: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vy: Math.random() * 3 + 2,
        vx: (Math.random() - 0.5) * 2,
        rot: Math.random() * 360,
        rotV: (Math.random() - 0.5) * 5
      });
    }
    animConfetti();
  }
  function animConfetti() {
    const c = document.getElementById('confetti-canvas');
    confettiCtx.clearRect(0, 0, c.width, c.height);
    confettiParticles.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.rot += p.rotV;
      if (p.y > c.height) { p.y = -20; p.x = Math.random() * c.width; }
      confettiCtx.save();
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rot * Math.PI / 180);
      confettiCtx.fillStyle = p.color;
      confettiCtx.globalAlpha = 0.9;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();
    });
    confettiRaf = requestAnimationFrame(animConfetti);
  }
  function stopConfetti() {
    if (confettiRaf) { cancelAnimationFrame(confettiRaf); confettiRaf = null; }
    const c = document.getElementById('confetti-canvas');
    if (c) confettiCtx?.clearRect(0, 0, c.width, c.height);
  }

  // ─── Toast ───────────────────────────────────
  function toast(msg, type = '') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3100);
  }

  // ─── How To ───────────────────────────────────
  function showHowTo() { document.getElementById('modal-howto').style.display = 'flex'; }
  function closeModal(id) { document.getElementById(`modal-${id}`).style.display = 'none'; }

  // ─── Helpers ─────────────────────────────────
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  // ─── Init ────────────────────────────────────
  function init() {
    goTo('menu');
  }

  document.addEventListener('DOMContentLoaded', init);

  // ─── Public ──────────────────────────────────
  return {
    goTo, goToSetup,
    setDifficulty, setSource, setTimer,
    onImageUpload, takeSnapshot,
    startGame, pauseGame, resumeGame, quitGame,
    toggleGhost, toggleWave, shufflePieces,
    playAgain, saveWinPhoto,
    showHowTo, showLeaderboard, clearLeaderboard, closeModal,
    toast,
    // Expose for HTML onclick
    initCamera
  };
})();
