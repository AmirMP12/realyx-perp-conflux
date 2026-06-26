import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';
import { useWebSocket } from '../../hooks/useWebSocket';

vi.mock('../../hooks/useWebSocket', () => ({ useWebSocket: vi.fn() }));

describe('OfflineBanner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });
    afterEach(() => vi.restoreAllMocks());

    it('renders nothing when API ok and websocket connected', async () => {
        (useWebSocket as any).mockReturnValue({ connected: true });
        (global.fetch as any).mockResolvedValue({ ok: true });
        const { container } = render(<OfflineBanner />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it('shows a banner when the websocket is disconnected', async () => {
        (useWebSocket as any).mockReturnValue({ connected: false });
        (global.fetch as any).mockResolvedValue({ ok: true });
        render(<OfflineBanner />);
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByText(/Live prices unavailable/)).toBeInTheDocument();
    });

    it('shows the API-unavailable message when health check fails', async () => {
        (useWebSocket as any).mockReturnValue({ connected: true });
        (global.fetch as any).mockRejectedValue(new Error('down'));
        render(<OfflineBanner />);
        await waitFor(() => expect(screen.getByText(/API unavailable/)).toBeInTheDocument());
    });

    it('retries the connection on click', async () => {
        (useWebSocket as any).mockReturnValue({ connected: false });
        (global.fetch as any).mockResolvedValue({ ok: false });
        const reload = vi.fn();
        Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
        render(<OfflineBanner />);
        await waitFor(() => expect(screen.getByLabelText('Retry connection')).toBeInTheDocument());
        fireEvent.click(screen.getByLabelText('Retry connection'));
        await waitFor(() => expect(reload).toHaveBeenCalled());
    });
});
