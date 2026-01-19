
let audioCtx: AudioContext | null = null;

const initCtx = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

export const SoundManager = {
  play: (type: 'drawStart' | 'drawEnd' | 'point' | 'tick') => {
    const ctx = initCtx();
    const now = ctx.currentTime;

    const createOsc = (freq: number, type: OscillatorType = 'sine', volume = 0.1) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(volume, now);
      osc.connect(gain);
      gain.connect(ctx.destination);
      return { osc, gain };
    };

    switch (type) {
      case 'drawStart': {
        const { osc, gain } = createOsc(440, 'sine', 0.05);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start();
        osc.stop(now + 0.05);
        break;
      }
      case 'drawEnd': {
        const { osc, gain } = createOsc(660, 'sine', 0.05);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start();
        osc.stop(now + 0.05);
        break;
      }
      case 'tick': {
        const { osc, gain } = createOsc(150, 'square', 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.start();
        osc.stop(now + 0.03);
        break;
      }
      case 'point': {
        // Celebratory arpeggio
        [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, now + i * 0.08);
          gain.gain.setValueAtTime(0.1, now + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.08);
          osc.stop(now + i * 0.08 + 0.2);
        });
        break;
      }
    }
  }
};
