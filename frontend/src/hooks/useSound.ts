import { useCallback } from 'react';

// Simple beep sounds using Web Audio API to avoid external assets
const createBeep = (freq: number, type: 'sine' | 'square' | 'triangle' = 'sine', duration: number = 0.1) => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
};

export function useSound() {
    const playClick = useCallback(() => {
        createBeep(800, 'sine', 0.05);
    }, []);

    const playSuccess = useCallback(() => {
        createBeep(600, 'sine', 0.1);
        setTimeout(() => createBeep(1200, 'sine', 0.2), 100);
    }, []);

    const playError = useCallback(() => {
        createBeep(300, 'square', 0.2);
        setTimeout(() => createBeep(200, 'square', 0.2), 150);
    }, []);

    return { playClick, playSuccess, playError };
}
