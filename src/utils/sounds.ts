let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/**
 * Prime the AudioContext so subsequent playback works on mobile (Chrome Android / WebView).
 * Call this on a user gesture (e.g. "Navegar" button, GPS toggle).
 */
export async function primeAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Play an inaudible tone to fully unlock the context
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  } catch {
    // Silently ignore
  }
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine') {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

export function playStartSound() {
  playTone(880, 0.15);
  setTimeout(() => playTone(1100, 0.2), 160);
}

export function playEndSound() {
  playTone(1100, 0.15);
  setTimeout(() => playTone(880, 0.15), 160);
  setTimeout(() => playTone(660, 0.25), 320);
}

export function playDeviationSound() {
  playTone(440, 0.3, 'sawtooth');
  setTimeout(() => playTone(440, 0.3, 'sawtooth'), 400);
}
