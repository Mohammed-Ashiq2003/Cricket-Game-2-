/**
 * ================================================================
 * CRICKET BLITZ — script.js
 * Production-ready cricket mini-game
 * Architecture: Module pattern with clear separation of concerns
 * ================================================================
 */

'use strict';

/* ── CONFIGURATION ──────────────────────────────────────────
   All tunable game constants in one place.
   ──────────────────────────────────────────────────────────── */
const CONFIG = {
  difficulty: {
    easy:   { baseSpeed: 3200, minSpeed: 1600, speedStep: 60,  hitWindowMs: 420, label: 'EASY' },
    medium: { baseSpeed: 2400, minSpeed: 1200, speedStep: 80,  hitWindowMs: 320, label: 'MED'  },
    hard:   { baseSpeed: 1700, minSpeed:  850, speedStep: 100, hitWindowMs: 220, label: 'HARD' },
  },
  scoring:       [1, 2, 4, 6, 6],      // weighted pool (6 appears twice for excitement)
  maxWickets:    3,                      // lives
  ballsPerOver:  6,
  maxSpeedMult:  4.0,
  storageKey:    'cricketBlitzHS',
};

/* ── SOUND ENGINE ────────────────────────────────────────────
   Web Audio API synthetic sounds — no external files needed.
   ──────────────────────────────────────────────────────────── */
const SoundEngine = (() => {
  let ctx = null;

  /** Lazy-init AudioContext on first user interaction */
  function init() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  /** Low-level: play a tone with envelope */
  function tone(freq, type, startVol, endVol, duration, delay = 0) {
    if (!ctx) return;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(startVol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(endVol || 0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  }

  /** Bat hitting ball — sharp transient + wooden thunk */
  function hit(runs) {
    init();
    const freqs = { 1: 320, 2: 400, 4: 520, 6: 660 };
    const f = freqs[runs] || 400;
    tone(f,       'square',   0.25, 0.001, 0.12);
    tone(f * 0.5, 'triangle', 0.3,  0.001, 0.22, 0.04);
    if (runs >= 4) {
      // Extra crowd roar simulation for boundary
      tone(180, 'sawtooth', 0.12, 0.001, 0.6, 0.1);
      tone(220, 'sawtooth', 0.08, 0.001, 0.5, 0.15);
    }
  }

  /** Ball missed → out sound */
  function out() {
    init();
    tone(280, 'sawtooth', 0.2,  0.001, 0.35);
    tone(200, 'sawtooth', 0.15, 0.001, 0.25, 0.1);
    tone(150, 'triangle', 0.1,  0.001, 0.4,  0.2);
  }

  /** Crowd cheer wave */
  function cheer() {
    init();
    [0, 0.06, 0.12, 0.18, 0.24].forEach((d, i) => {
      tone(300 + i * 40, 'sine', 0.04, 0.001, 0.55, d);
    });
  }

  /** Game start whistle */
  function start() {
    init();
    tone(880, 'sine', 0.2, 0.001, 0.15);
    tone(1100, 'sine', 0.2, 0.001, 0.15, 0.18);
  }

  /** Over completed bell */
  function bell() {
    init();
    tone(660, 'sine', 0.18, 0.001, 0.6);
    tone(990, 'sine', 0.12, 0.001, 0.45, 0.12);
  }

  return { init, hit, out, cheer, start, bell };
})();

/* ── DOM CACHE ───────────────────────────────────────────────
   Single place to grab all elements — avoids repeated queries.
   ──────────────────────────────────────────────────────────── */
const DOM = {
  // Screens
  screenSplash: document.getElementById('screen-splash'),
  screenGame:   document.getElementById('screen-game'),
  screenOver:   document.getElementById('screen-over'),
  // Splash
  diffBtns:     document.querySelectorAll('.diff-btn'),
  splashHs:     document.getElementById('splash-hs'),
  btnStart:     document.getElementById('btn-start'),
  // HUD
  hudScore:     document.getElementById('hud-score'),
  hudHs:        document.getElementById('hud-hs'),
  hudDiff:      document.getElementById('hud-diff'),
  wickets:      [document.getElementById('w1'), document.getElementById('w2'), document.getElementById('w3')],
  // Arena
  ball:         document.getElementById('ball'),
  scorePopup:   document.getElementById('score-popup'),
  batVisual:    document.getElementById('bat-visual'),
  // Controls
  btnHit:       document.getElementById('btn-hit'),
  ballsRow:     document.getElementById('balls-row'),
  speedBar:     document.getElementById('speed-bar'),
  speedVal:     document.getElementById('speed-val'),
  // Game Over
  overTitle:    document.getElementById('over-title'),
  overSub:      document.getElementById('over-sub'),
  overScore:    document.getElementById('over-score'),
  overHs:       document.getElementById('over-hs'),
  overBalls:    document.getElementById('over-balls'),
  overIcon:     document.getElementById('over-icon'),
  btnRestart:   document.getElementById('btn-restart'),
  btnMenu:      document.getElementById('btn-menu'),
  // Arena element for positioning
  arena:        document.getElementById('arena'),
};

/* ── GAME STATE ──────────────────────────────────────────────
   Single source of truth. Never mutate outside GameState.*
   ──────────────────────────────────────────────────────────── */
const GameState = {
  difficulty:   'easy',
  score:        0,
  wicketsLeft:  CONFIG.maxWickets,
  ballsFaced:   0,
  totalBalls:   0,
  ballActive:   false,
  canHit:       false,
  dropTimer:    null,
  ballAnimId:   null,
  speedMultiplier: 1.0,
  ballY:        0,
  hitWindow:    false,
  hitWindowTimer: null,
  running:      false,

  reset() {
    this.score         = 0;
    this.wicketsLeft   = CONFIG.maxWickets;
    this.ballsFaced    = 0;
    this.ballActive    = false;
    this.canHit        = false;
    this.speedMultiplier = 1.0;
    this.ballY         = 0;
    this.hitWindow     = false;
    this.running       = true;
    clearTimeout(this.dropTimer);
    cancelAnimationFrame(this.ballAnimId);
  },
};

/* ── HIGH SCORE MANAGER ──────────────────────────────────────
   Reads/writes localStorage safely.
   ──────────────────────────────────────────────────────────── */
const HighScore = {
  get()  {
    try { return parseInt(localStorage.getItem(CONFIG.storageKey)) || 0; }
    catch { return 0; }
  },
  set(v) {
    try { localStorage.setItem(CONFIG.storageKey, v); }
    catch { /* incognito / storage blocked */ }
  },
  update(score) {
    const prev = this.get();
    if (score > prev) { this.set(score); return true; }
    return false;
  },
};

/* ── CROWD GENERATOR ─────────────────────────────────────────
   Decorative animated crowd dots in the background.
   ──────────────────────────────────────────────────────────── */
function buildCrowd() {
  const container = document.getElementById('crowd-container');
  if (!container) return;
  const colors = ['#e63946','#76c442','#f5c518','#3a86ff','#ff9f1c','#ffffff'];
  const count  = window.innerWidth < 500 ? 80 : 140;

  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'crowd-dot';
    const size  = 3 + Math.random() * 5;
    const left  = Math.random() * 100;
    const top   = 5 + Math.random() * 50;
    const delay = (Math.random() * 2).toFixed(2);
    const dur   = (1.2 + Math.random() * 1.4).toFixed(2);
    dot.style.cssText = `
      width:${size}px; height:${size}px;
      left:${left}%; top:${top}%;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      animation-duration:${dur}s;
      animation-delay:-${delay}s;
    `;
    container.appendChild(dot);
  }
}

/* ── SCREEN MANAGER ──────────────────────────────────────────
   Centralizes all screen transitions.
   ──────────────────────────────────────────────────────────── */
const Screen = {
  show(id) {
    document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${id}`).classList.add('active');
  },
};

/* ── FLASH OVERLAY ───────────────────────────────────────────
   Full-screen tinted flash for hit/miss feedback.
   ──────────────────────────────────────────────────────────── */
function createFlashOverlay() {
  const el = document.createElement('div');
  el.id = 'flash-overlay';
  document.body.appendChild(el);
  return el;
}
const flashEl = createFlashOverlay();

function flashScreen(type) {
  flashEl.className = '';
  void flashEl.offsetWidth; // reflow to restart animation
  flashEl.className = `flash-${type}`;
}

/* ── PARTICLE BURST ──────────────────────────────────────────
   Creates celebratory particles at a given screen position.
   ──────────────────────────────────────────────────────────── */
function spawnParticles(x, y, color, count = 18) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const angle = (Math.random() * Math.PI * 2);
    const dist  = 60 + Math.random() * 120;
    const size  = 4 + Math.random() * 8;
    const dur   = (0.5 + Math.random() * 0.6).toFixed(2);
    p.style.cssText = `
      width:${size}px; height:${size}px;
      background:${color};
      left:${x}px; top:${y}px;
      --dx:${Math.cos(angle)*dist}px;
      --dy:${Math.sin(angle)*dist}px;
      --dur:${dur}s;
    `;
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

/* ── HUD UPDATES ─────────────────────────────────────────────
   All HUD rendering in one module.
   ──────────────────────────────────────────────────────────── */
const HUD = {
  update() {
    DOM.hudScore.textContent = GameState.score;
    DOM.hudHs.textContent    = HighScore.get();
    DOM.hudDiff.textContent  = CONFIG.difficulty[GameState.difficulty].label;
    // Wicket icons
    DOM.wickets.forEach((w, i) => {
      w.classList.toggle('lost', i >= GameState.wicketsLeft);
    });
  },

  updateSpeed() {
    const pct = Math.min(100, ((GameState.speedMultiplier - 1) / (CONFIG.maxSpeedMult - 1)) * 100);
    DOM.speedBar.style.width = `${Math.max(8, pct)}%`;
    DOM.speedVal.textContent = `${GameState.speedMultiplier.toFixed(1)}x`;
    // Shift colour red as speed increases
    if (pct > 60) {
      DOM.speedBar.style.background = 'linear-gradient(90deg, #f5c518, #e63946)';
    } else {
      DOM.speedBar.style.background = 'linear-gradient(90deg, #76c442, #f5c518)';
    }
  },

  addBallDot(result) {
    const dot = document.createElement('div');
    dot.className = `ball-dot ${result === 'out' ? 'out' : 'played'}`;
    DOM.ballsRow.appendChild(dot);
    // Keep only last 6 dots visible
    const dots = DOM.ballsRow.querySelectorAll('.ball-dot');
    if (dots.length > CONFIG.ballsPerOver) dots[0].remove();
  },

  flashScore() {
    DOM.hudScore.style.color = '#f5c518';
    setTimeout(() => { DOM.hudScore.style.color = ''; }, 300);
  },
};

/* ── BALL PHYSICS ────────────────────────────────────────────
   CSS-transition-driven ball drop with JS timing for hit window.
   ──────────────────────────────────────────────────────────── */
const Ball = {
  /** Reset ball to top of arena */
  reset() {
    DOM.ball.style.transition = 'none';
    DOM.ball.style.top = '-50px';
    DOM.ball.classList.remove('glow', 'hit-flash');
    void DOM.ball.offsetWidth; // reflow
  },

  /** Start drop animation */
  drop() {
    if (!GameState.running) return;
    GameState.ballActive = true;
    GameState.canHit     = false;
    GameState.hitWindow  = false;

    const diff    = CONFIG.difficulty[GameState.difficulty];
    const arenaH  = DOM.arena.getBoundingClientRect().height;
    const target  = arenaH - 80; // px from top where ball lands near stumps

    // Duration decreases as speed multiplier increases
    const duration = Math.max(diff.minSpeed, diff.baseSpeed / GameState.speedMultiplier);

    DOM.ball.classList.add('glow');
    DOM.ball.style.transition = `top ${duration}ms linear`;
    DOM.ball.style.top = `${target}px`;

    // Open hit window when ball enters the sweet zone (bottom 30% of arena)
    const windowDelay = duration * 0.62;
    clearTimeout(GameState.hitWindowTimer);
    GameState.hitWindowTimer = setTimeout(() => {
      if (!GameState.running) return;
      GameState.canHit    = true;
      GameState.hitWindow = true;
      DOM.ball.classList.remove('glow');
    }, windowDelay);

    // Ball passes — missed!
    GameState.dropTimer = setTimeout(() => {
      if (!GameState.running) return;
      if (GameState.hitWindow) {
        Ball.missed();
      }
    }, duration + 40);
  },

  /** Player successfully hit */
  hit() {
    if (!GameState.canHit || !GameState.ballActive) return;
    GameState.canHit    = false;
    GameState.hitWindow = false;
    GameState.ballActive = false;
    clearTimeout(GameState.dropTimer);
    clearTimeout(GameState.hitWindowTimer);

    // Random runs from weighted pool
    const runs = CONFIG.scoring[Math.floor(Math.random() * CONFIG.scoring.length)];
    GameState.score     += runs;
    GameState.ballsFaced++;
    GameState.totalBalls++;

    // Visual: flash ball
    DOM.ball.classList.add('hit-flash');
    DOM.ball.style.transition = 'top 0.15s ease-out';
    DOM.ball.style.top = '-60px';

    // Bat swing
    DOM.batVisual.classList.remove('swing');
    void DOM.batVisual.offsetWidth;
    DOM.batVisual.classList.add('swing');

    // Score popup
    Ball.showPopup(runs);

    // Particles at ball position
    const ballRect = DOM.ball.getBoundingClientRect();
    const cx = ballRect.left + ballRect.width / 2;
    const cy = ballRect.top  + ballRect.height / 2;
    const colors = { 1: '#76c442', 2: '#76c442', 4: '#f5c518', 6: '#e63946' };
    spawnParticles(cx, cy, colors[runs] || '#f5c518', runs >= 4 ? 30 : 18);

    // Screen flash
    flashScreen('green');

    // Sound
    SoundEngine.hit(runs);
    if (runs >= 4) SoundEngine.cheer();

    // HUD
    HUD.update();
    HUD.flashScore();
    HUD.addBallDot('hit');

    // Speed increase every ball
    Ball.increaseSpeed();

    // Next ball
    setTimeout(() => {
      Ball.reset();
      setTimeout(() => Ball.drop(), 600);
    }, 900);
  },

  /** Player missed the ball */
  missed() {
    GameState.ballActive = false;
    GameState.canHit     = false;
    GameState.hitWindow  = false;
    clearTimeout(GameState.dropTimer);
    clearTimeout(GameState.hitWindowTimer);

    GameState.wicketsLeft--;
    GameState.ballsFaced++;
    GameState.totalBalls++;

    // Visual: ball continues off screen
    DOM.ball.style.transition = 'top 0.2s ease-in';
    DOM.ball.style.top = `${DOM.arena.getBoundingClientRect().height + 60}px`;

    flashScreen('red');
    SoundEngine.out();
    HUD.update();
    HUD.addBallDot('out');

    // Shake the wicket stumps
    Ball.shakeStumps();

    if (GameState.wicketsLeft <= 0) {
      setTimeout(() => Game.over(), 700);
    } else {
      setTimeout(() => {
        Ball.reset();
        setTimeout(() => Ball.drop(), 700);
      }, 900);
    }
  },

  showPopup(runs) {
    const colors = { 1: '#76c442', 2: '#76c442', 4: '#f5c518', 6: '#e63946' };
    const labels = { 1: '1 RUN!', 2: '2 RUNS!', 4: 'FOUR! 🏏', 6: 'SIX! 💥' };
    DOM.scorePopup.textContent = labels[runs] || `${runs}`;
    DOM.scorePopup.style.color = colors[runs] || '#f5c518';
    DOM.scorePopup.classList.remove('show');
    void DOM.scorePopup.offsetWidth;
    DOM.scorePopup.classList.add('show');
  },

  increaseSpeed() {
    const diff = CONFIG.difficulty[GameState.difficulty];
    GameState.speedMultiplier = Math.min(
      CONFIG.maxSpeedMult,
      GameState.speedMultiplier + (diff.speedStep / 1000)
    );
    HUD.updateSpeed();
  },

  shakeStumps() {
    const stumps = document.getElementById('wicket-stumps');
    stumps.style.animation = 'none';
    stumps.style.transform = 'translateX(-50%) rotate(-5deg)';
    setTimeout(() => { stumps.style.transform = 'translateX(-50%) rotate(5deg)'; }, 80);
    setTimeout(() => { stumps.style.transform = 'translateX(-50%) rotate(0)'; },   160);
  },
};

/* ── AI BOWLER ───────────────────────────────────────────────
   Simple AI: varies delivery angle and adds "swing" variation
   by offsetting the ball's horizontal position before each drop.
   ──────────────────────────────────────────────────────────── */
const AIBowler = {
  /** Randomise the ball's X offset to simulate different deliveries */
  setDelivery() {
    const arenaW = DOM.arena.getBoundingClientRect().width;
    // Deliveries: straight, off-side, leg-side
    const types  = ['straight', 'off', 'leg'];
    const type   = types[Math.floor(Math.random() * types.length)];
    const center = arenaW / 2 - 21; // 21 = half ball width
    let   offset = 0;

    if (type === 'off') offset = -(12 + Math.random() * 24);
    if (type === 'leg') offset =  (12 + Math.random() * 24);

    // Scale offset by difficulty
    const diffScale = { easy: 0.5, medium: 0.75, hard: 1.0 };
    offset *= diffScale[GameState.difficulty] || 1;

    DOM.ball.style.left = `${center + offset}px`;
    DOM.ball.style.transform = 'none'; // remove default translateX(-50%)
  },
};

/* ── GAME CONTROLLER ─────────────────────────────────────────
   Top-level game logic: start, over, restart.
   ──────────────────────────────────────────────────────────── */
const Game = {
  start() {
    SoundEngine.start();
    GameState.reset();

    // Clear ball dots
    DOM.ballsRow.innerHTML = '';

    // Update HUD
    HUD.update();
    HUD.updateSpeed();
    DOM.hudHs.textContent = HighScore.get();

    // Re-enable hit button
    DOM.btnHit.disabled = false;

    Screen.show('game');

    // First delivery after short delay
    Ball.reset();
    AIBowler.setDelivery();
    setTimeout(() => Ball.drop(), 900);
  },

  over() {
    GameState.running = false;
    clearTimeout(GameState.dropTimer);
    clearTimeout(GameState.hitWindowTimer);

    const isNewHS = HighScore.update(GameState.score);
    const hs      = HighScore.get();

    // Populate game over screen
    DOM.overScore.textContent  = GameState.score;
    DOM.overHs.textContent     = hs;
    DOM.overBalls.textContent  = GameState.ballsFaced;

    if (GameState.score === 0) {
      DOM.overTitle.textContent = 'DUCK!';
      DOM.overSub.textContent   = 'Scored nothing — try again!';
      DOM.overIcon.textContent  = '🦆';
    } else if (isNewHS) {
      DOM.overTitle.textContent = 'NEW HIGH SCORE!';
      DOM.overSub.textContent   = `Amazing innings of ${GameState.score} runs!`;
      DOM.overIcon.textContent  = '🏆';
      // Insert badge if not present
      if (!document.querySelector('.new-hs-badge')) {
        const badge = document.createElement('div');
        badge.className = 'new-hs-badge';
        badge.textContent = '🎉 PERSONAL BEST!';
        DOM.overScore.parentElement.parentElement.insertBefore(badge, DOM.overScore.parentElement);
      }
      SoundEngine.cheer();
    } else {
      DOM.overTitle.textContent = 'INNINGS OVER!';
      DOM.overSub.textContent   = 'All wickets lost!';
      DOM.overIcon.textContent  = '🏏';
      document.querySelector('.new-hs-badge')?.remove();
    }

    // Update splash high score
    DOM.splashHs.textContent = hs;

    Screen.show('over');
  },

  restart() {
    document.querySelector('.new-hs-badge')?.remove();
    Game.start();
  },

  menu() {
    GameState.running = false;
    clearTimeout(GameState.dropTimer);
    clearTimeout(GameState.hitWindowTimer);
    document.querySelector('.new-hs-badge')?.remove();
    DOM.splashHs.textContent = HighScore.get();
    Screen.show('splash');
  },
};

/* ── INPUT HANDLER ───────────────────────────────────────────
   Unified keyboard + mouse + touch hit detection.
   ──────────────────────────────────────────────────────────── */
const Input = {
  init() {
    // Hit button (mobile-friendly large tap area)
    DOM.btnHit.addEventListener('click', () => {
      SoundEngine.init(); // ensure audio context alive
      if (GameState.canHit) Ball.hit();
    });

    // Click/tap on ball itself
    DOM.ball.addEventListener('click', () => {
      SoundEngine.init();
      if (GameState.canHit) Ball.hit();
    });

    // Keyboard: spacebar or Enter
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        SoundEngine.init();
        if (GameState.running && GameState.canHit) Ball.hit();
      }
    });

    // Difficulty selection on splash
    DOM.diffBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.diffBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        GameState.difficulty = btn.dataset.diff;
      });
    });

    // Start button
    DOM.btnStart.addEventListener('click', () => {
      SoundEngine.init();
      Game.start();
    });

    // Restart / menu on game over
    DOM.btnRestart.addEventListener('click', () => {
      SoundEngine.init();
      Game.restart();
    });
    DOM.btnMenu.addEventListener('click', () => {
      Game.menu();
    });
  },
};

/* ── INIT ────────────────────────────────────────────────────
   Boot sequence on DOM ready.
   ──────────────────────────────────────────────────────────── */
function init() {
  buildCrowd();
  Input.init();
  DOM.splashHs.textContent = HighScore.get();
  Screen.show('splash');

  // Set default difficulty active state
  GameState.difficulty = 'easy';
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
