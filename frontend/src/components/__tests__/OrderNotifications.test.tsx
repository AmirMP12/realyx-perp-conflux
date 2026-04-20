import { render, screen, fireEvent, act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationBell, useOrderNotifications } from '../OrderNotifications';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: vi.fn(),
}));

describe('OrderNotifications', () => {
    let wsInstance: any;

    class MockWebSocket {
        onopen: any;
        onmessage: any;
        onclose: any;
        onerror: any;
        send = vi.fn();
        close = vi.fn();
        constructor() { wsInstance = this; }
    }

    beforeEach(() => {
        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => ({
            createOscillator: vi.fn(() => ({
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                frequency: { value: 440 },
                type: 'sine'
            })),
            createGain: vi.fn(() => ({
                connect: vi.fn(),
                gain: { value: 1 }
            })),
            destination: {},
            currentTime: 0
        })));
        (useAccount as any).mockReturnValue({ address: '0x123' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('connects to websocket and handles notifications', async () => {
        render(<NotificationBell />);
        
        await act(async () => {
            wsInstance.onopen();
        });
        expect(wsInstance.send).toHaveBeenCalledWith(expect.stringContaining('auth'));
        
        // Simulate notification message
        await act(async () => {
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'notification',
                    data: {
                        event: 'OrderExecuted',
                        orderId: 1,
                        executionPrice: 50000
                    }
                })
            });
        });
        
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('Order #1 executed'), expect.anything());
        expect(screen.getByText('1')).toBeInTheDocument(); // Unread count
    });

    it('handles different notification types', async () => {
        render(<NotificationBell />);
        await act(async () => {
            wsInstance.onopen();
        });

        const events = [
            { event: 'OrderPartiallyFilled', orderId: 2, filledSize: 100 },
            { event: 'OrderCancelled', orderId: 3 },
            { event: 'OrderExpired', orderId: 4 },
            { event: 'PositionOpened', positionId: 5, collectionId: 'BTC', isLong: true },
            { event: 'PositionClosed', positionId: 6, pnl: 100 },
            { event: 'PositionLiquidated', positionId: 7 }
        ];

        await act(async () => {
            events.forEach(event => {
                wsInstance.onmessage({
                    data: JSON.stringify({
                        type: 'notification',
                        data: event
                    })
                });
            });
        });

        expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('toggles the notification dropdown and interacts with it', async () => {
        render(<NotificationBell />);
        await act(async () => {
            wsInstance.onopen();
        });
        
        // Add a notification
        await act(async () => {
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'notification',
                    data: { event: 'OrderCancelled', orderId: 1 }
                })
            });
        });

        const bell = screen.getByLabelText('Open notifications');
        fireEvent.click(bell);
        
        expect(screen.getByText('Notifications')).toBeInTheDocument();
        expect(screen.getByText('Order #1 cancelled')).toBeInTheDocument();
        
        // Mark as read
        fireEvent.click(screen.getByText('Order #1 cancelled'));
        await waitFor(() => {
            expect(screen.queryByText('1')).not.toBeInTheDocument();
        });
        
        // Add another and clear all
        await act(async () => {
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'notification',
                    data: { event: 'OrderCancelled', orderId: 2 }
                })
            });
        });
        
        fireEvent.click(screen.getByText('Clear all'));
        expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });

    it('handles sound toggle and playing sound', async () => {
        const { result } = renderHook(() => useOrderNotifications());
        
        await act(async () => {
            result.current.updateSettings({ soundEnabled: true });
        });

        // Trigger notification
        await act(async () => {
            wsInstance.onopen();
            wsInstance.onmessage({
                data: JSON.stringify({
                    type: 'notification',
                    data: { event: 'OrderExecuted', orderId: 1 }
                })
            });
        });
        
        // Sound logic hit
    });

    it('handles WebSocket error and close', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<NotificationBell />);
        
        await act(async () => {
            wsInstance.onerror(new Error('WS error'));
        });
        expect(spy).toHaveBeenCalled();
        
        await act(async () => {
            wsInstance.onclose();
        });
        spy.mockRestore();
    });
});
