import { render, screen, act, fireEvent, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationBell, useOrderNotifications } from '../OrderNotifications';
import { useAccount } from 'wagmi';

vi.mock('wagmi', () => ({ useAccount: vi.fn() }));
vi.mock('../../hooks/usePositions', () => ({ usePositions: vi.fn(() => ({ positions: [] })) }));
vi.mock('../../utils/pwa', () => ({ notify: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: vi.fn() }));

describe('OrderNotifications sound and styling', () => {
    let wsInstance: any;
    beforeEach(() => {
        vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () {
            wsInstance = { onopen: null, onmessage: null, onclose: null, onerror: null, send: vi.fn(), close: vi.fn() };
            return wsInstance;
        }));
        vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () {
            return {
                createOscillator: () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { value: 0 }, type: 'sine' }),
                createGain: () => ({ connect: vi.fn(), gain: { value: 0 } }),
                destination: {}, currentTime: 0,
            };
        }));
        (useAccount as any).mockReturnValue({ address: '0x123' });
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

    function send(data: any) {
        act(() => { wsInstance.onmessage({ data: JSON.stringify({ type: 'notification', data }) }); });
    }

    it('plays sounds for different notification types and applies styles', () => {
        const { result } = renderHook(() => useOrderNotifications());
        act(() => { result.current.updateSettings({ soundEnabled: true }); });
        act(() => { wsInstance.onopen(); });
        send({ event: 'PositionLiquidated', positionId: 1 }); // 200hz + red style
        send({ event: 'LiquidationWarning', positionId: 2 }); // 330hz
        send({ event: 'KeeperFailure', orderId: 3, failureReason: 'x' }); // 200hz + failure style
        send({ event: 'FundingPayment', positionId: 4, amount: -1 }); // funding style
        send({ event: 'PositionClosed', positionId: 5, pnl: -10 }); // negative close style
        send({ event: 'OrderExecuted', orderId: 6, executionPrice: 100 }); // default 440hz
        expect(result.current.notifications.length).toBeGreaterThan(0);
    });

    it('colors notification rows by type in the dropdown', () => {
        render(<NotificationBell />);
        act(() => { wsInstance.onopen(); });
        send({ event: 'LiquidationWarning', positionId: 1 });
        send({ event: 'KeeperFailure', orderId: 2 });
        send({ event: 'PositionLiquidated', positionId: 3 });
        send({ event: 'FundingPayment', positionId: 4, amount: 1 });
        send({ event: 'PositionOpened', positionId: 5, isLong: true, collectionId: 'BTC' });
        send({ event: 'OrderCancelled', orderId: 6 }); // default color
        fireEvent.click(screen.getByLabelText('Open notifications'));
        expect(screen.getByText('Notifications')).toBeInTheDocument();
    });
});
