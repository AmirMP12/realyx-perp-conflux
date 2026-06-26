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

describe('OrderNotifications — PnL formatting', () => {
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

    it('handles the positive-PnL and default-message cases', async () => {
        render(<NotificationBell />);
        await act(async () => { wsInstance.onopen(); });
        await act(async () => {
            send({ event: 'OrderExecuted', orderId: 1 }); // no executionPrice -> || 0
            send({ event: 'OrderPartiallyFilled', orderId: 1, filledSize: 5 });
            send({ event: 'OrderCancelled', orderId: 1 });
            send({ event: 'OrderExpired', orderId: 1 });
            send({ event: 'PositionOpened', positionId: 2, isLong: true, collectionId: 'BTC' });
            send({ event: 'PositionOpened', positionId: 3, isLong: false, collectionId: 'ETH' });
            send({ event: 'PositionClosed', positionId: 4, pnl: 42 }); // pnl >= 0 -> green + 💰
            send({ event: 'PositionLiquidated', positionId: 5 });
            send({ event: 'FundingPayment', positionId: 6, amount: -3 }); // amount < 0
            send({ event: 'KeeperFailure', orderId: 7 }); // no failureReason -> 'Unknown error'
        });
        expect(toast).toHaveBeenCalled();
        // 10 notifications shown (badge caps display at 9+)
        expect(screen.getByText('9+')).toBeInTheDocument();
    });

    it('warns on a short position nearing liquidation and skips zero liq price', async () => {
        (usePositions as any).mockReturnValue({
            positions: [
                { id: '20', isLong: false, markPrice: '100', liquidationPrice: '105' }, // short HF 1.05 -> warn
                { id: '21', isLong: true, markPrice: '50', liquidationPrice: '0' }, // liqPrice 0 -> skip
            ],
        });
        render(<NotificationBell />);
        await act(async () => { /* checkHealth runs on mount */ });
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('nearing liquidation'), expect.anything());
    });
});
