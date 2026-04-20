import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConnectionStatus } from '../ConnectionStatus';
import { useWebSocket } from '../../hooks/useWebSocket';

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}));

describe('ConnectionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Default to real timers
    vi.useRealTimers();
    
    // Mock AbortSignal.timeout if it doesn't exist
    if (!AbortSignal.timeout) {
      (AbortSignal as any).timeout = (ms: number) => {
        const controller = new AbortController();
        // Use a real timeout or just never abort for tests unless specifically needed
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      };
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders connected status when everything is fine', async () => {
    (useWebSocket as any).mockReturnValue({ connected: true });
    (global.fetch as any).mockResolvedValue({ ok: true });

    render(<ConnectionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    }, { timeout: 10000 });
    expect(screen.getByLabelText('Connection status: Connected')).toBeInTheDocument();
  });

  it('renders partial status when WS is disconnected but API is OK', async () => {
    (useWebSocket as any).mockReturnValue({ connected: false });
    (global.fetch as any).mockResolvedValue({ ok: true });

    render(<ConnectionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Partial')).toBeInTheDocument();
    }, { timeout: 10000 });
    expect(screen.getByTitle('Data unavailable')).toBeInTheDocument();
  });

  it('renders offline status when both are down', async () => {
    (useWebSocket as any).mockReturnValue({ connected: false });
    (global.fetch as any).mockRejectedValue(new Error('Network Error'));

    render(<ConnectionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeInTheDocument();
    }, { timeout: 10000 });
    expect(screen.getByTitle('Connection issue — Retry or check network')).toBeInTheDocument();
  });

  it('polls health endpoint periodically', async () => {
    vi.useFakeTimers();
    (useWebSocket as any).mockReturnValue({ connected: true });
    (global.fetch as any).mockResolvedValue({ ok: true });

    render(<ConnectionStatus />);
    
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
