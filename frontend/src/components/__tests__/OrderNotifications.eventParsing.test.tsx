import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationBell } from '../OrderNotifications';
import { useAccount } from 'wagmi';
import { usePositions } from '../../hooks/usePositions';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/usePositions', () => ({ usePositions: vi.fn() }));
vi.mock('../../utils/pwa', () => ({ notify: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: vi.fn() }));

describe('OrderNotifications extra', () => {
    let wsInstance: any;

    beforeEach(() => {
        vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () {
            wsInstance = { onopen: null, onmessage: null, onclose: null, onerror: null, send: vi.fn(), close: vi.fn() };
            return wsInstance;
        }));
        (useAccount as any).mockReturnValue({ address: '0x123' });
        (usePositions as any).mockReturnValue({ positions: [] });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function send(data: any) {
        wsInstance.onmessage({ data: JSON.stringify({ type: 'notification', data }) });
    }

    it('parses funding, keeper-failure, liquidation-warning and unknown events', async () => {
        render(<NotificationBell />);
        await act(async () => { wsInstance.onopen(); });
        await act(async () => {
            send({ event: 'FundingPayment', positionId: 1, amount: 1.5 });
            send({ event: 'KeeperFailure', orderId: 2, failureReason: 'oops' });
            send({ event: 'LiquidationWarning', positionId: 3 });
            send({ event: 'PositionClosed', positionId: 4, pnl: -25 });
            send({ event: 'SomethingUnknown', foo: 'bar' });
        });
        // 4 known events produce notifications; the unknown one is ignored.
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(toast).toHaveBeenCalled();
    });

    it('logs a parse error for malformed messages', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<NotificationBell />);
        await act(async () => { wsInstance.onopen(); });
        await act(async () => { wsInstance.onmessage({ data: '{not json' }); });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('emits a local liquidation warning from health monitoring', async () => {
        (usePositions as any).mockReturnValue({
            positions: [
                { id: '9', isLong: true, markPrice: '105', liquidationPrice: '100' }, // HF 1.05 -> warn
                { id: '10', isLong: false, markPrice: '50', liquidationPrice: '40' }, // not at risk
                { id: '11', isLong: true, markPrice: '0', liquidationPrice: '0' }, // skipped
            ],
        });
        render(<NotificationBell />);
        await act(async () => { /* checkHealth runs on mount */ });
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('nearing liquidation'), expect.anything());
    });
});
