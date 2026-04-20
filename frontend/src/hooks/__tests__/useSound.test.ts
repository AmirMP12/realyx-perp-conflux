import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSound } from '../useSound';

describe('useSound', () => {
  let mockOscillator: any;
  let mockGain: any;
  let mockAudioContext: any;

  beforeEach(() => {
    mockOscillator = {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };

    mockAudioContext = {
      currentTime: 0,
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
      destination: {},
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function() {
      return mockAudioContext;
    }));
    vi.useFakeTimers();
  });

  it('should play click sound', () => {
    const { result } = renderHook(() => useSound());
    result.current.playClick();

    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(800, 0);
    expect(mockOscillator.start).toHaveBeenCalled();
  });

  it('should play success sound', () => {
    const { result } = renderHook(() => useSound());
    result.current.playSuccess();

    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    // Use call index to check different frequencies
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(600, 0);
    
    vi.advanceTimersByTime(100);
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenLastCalledWith(1200, 0);
  });

  it('should play error sound', () => {
    const { result } = renderHook(() => useSound());
    result.current.playError();

    expect(mockOscillator.type).toBe('square');
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(300, 0);

    vi.advanceTimersByTime(150);
    expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(200, 0);
  });

  it('should handle missing AudioContext', () => {
    vi.stubGlobal('AudioContext', undefined);
    const { result } = renderHook(() => useSound());
    
    // Should not throw
    expect(() => result.current.playClick()).not.toThrow();
  });
});
