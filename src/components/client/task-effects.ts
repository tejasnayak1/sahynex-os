'use client';
/**
 * Small, optional feedback for task moves: synthesised sounds (no audio files) and a brief
 * sparkle / confetti burst. Everything here is best-effort — failures are swallowed so they can
 * never interfere with saving a task.
 */

const SOUND_KEY = 'sx.taskSound';

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return memorySound;
  }
}

const soundListeners = new Set<() => void>();

export function subscribeSound(cb: () => void) {
  soundListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    soundListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

let memorySound = false; // used when localStorage is unavailable

export function setSoundEnabled(on: boolean) {
  memorySound = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable — preference lasts for this page only */
  }
  soundListeners.forEach((l) => l());
}

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, gain = 0.06) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Plays only if the person turned sound on; must be called from a user gesture. */
export function playSound(kind: 'move' | 'done') {
  if (!soundEnabled()) return;
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    if (kind === 'move') tone(660, 0, 0.12, 0.045);
    else {
      tone(784, 0, 0.18);
      tone(1047, 0.09, 0.28);
    }
  } catch {
    /* audio blocked or unsupported */
  }
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const CONFETTI = ['#4fb3b8', '#7fd3d6', '#f2c14e', '#e98a7a', '#9ad1a5', '#b9a0e6'];

/**
 * A burst anchored on an element. 'sparkle' is a few soft dots for moving forward; 'confetti' is a
 * short shower for reaching Done. Rendered in a fixed, click-through layer and removed afterwards.
 */
export function celebrate(anchor: Element | null, kind: 'sparkle' | 'confetti') {
  if (!anchor || reducedMotion()) return;
  try {
    const r = anchor.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.className = 'sx-burst';
    layer.style.left = `${r.left + r.width / 2}px`;
    layer.style.top = `${r.top + (kind === 'confetti' ? 8 : r.height / 2)}px`;
    const n = kind === 'confetti' ? 26 : 8;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      const angle = kind === 'confetti' ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : (i / n) * Math.PI * 2;
      const dist = kind === 'confetti' ? 60 + Math.random() * 90 : 22 + Math.random() * 10;
      p.className = kind === 'confetti' ? 'sx-confetti' : 'sx-spark';
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 540)}deg`);
      p.style.background = kind === 'confetti' ? CONFETTI[i % CONFETTI.length] : '#7fd3d6';
      p.style.animationDelay = `${Math.random() * (kind === 'confetti' ? 90 : 30)}ms`;
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), kind === 'confetti' ? 1400 : 700);
  } catch {
    /* purely decorative */
  }
}
