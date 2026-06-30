// Synthesized SFX via Web Audio — no asset files. Audio must be unlocked by a
// user gesture (key/click/Join) before browsers will let it play.

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
}

// Retro 16-bit-ish explosion: square-wave pitch sweep + filtered noise burst.
export function playExplosion(): void {
  if (!ctx) return;
  const now = ctx.currentTime;

  // square pitch sweep 135Hz -> 54Hz
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(135, now);
  osc.frequency.exponentialRampToValueAtTime(54, now + 0.35);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.25, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.42);

  // bright filtered noise burst
  const dur = 0.4;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(900, now);
  band.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  noise.connect(band).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + dur);
}

// Cute little ascending chime for picking up a powerup.
export function playPickup(): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [660, 880, 1320];
  notes.forEach((freq, i) => {
    const t = now + i * 0.07;
    const osc = ctx!.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(ctx!.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  });
}
