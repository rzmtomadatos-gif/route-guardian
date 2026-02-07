const audioCtx = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine') {
  if (!audioCtx) return;
  
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + duration);
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
