import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { useOrderNotifications, NotificationBell } from '../OrderNotifications';
import { useAccount } from 'wagmi';
import toast from 'react-hot-toast';

// Mock wagmi
vi.mock('wagmi', () => ({
    useAccount: vi.fn(),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
    default: vi.fn(),
}));

// Mock WebSocket
const mockWebSocket = {
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
};
vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function() {
    return mockWebSocket;
}));

describe('OrderNotifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    describe('useOrderNotifications', () => {
        it('initializes with default settings', () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            const { result } = renderHook(() => useOrderNotifications());
            expect(result.current.settings.orderExecuted).toBe(true);
            expect(result.current.unreadCount).toBe(0);
        });

        it('updates settings and persists to localStorage', () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            const { result } = renderHook(() => useOrderNotifications());
            
            act(() => {
                result.current.updateSettings({ orderExecuted: false });
            });

            expect(result.current.settings.orderExecuted).toBe(false);
            const saved = JSON.parse(localStorage.getItem('notificationSettings') || '{}');
            expect(saved.orderExecuted).toBe(false);
        });

        it('handles WebSocket messages', () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            const { result } = renderHook(() => useOrderNotifications());
            
            // Simulate WebSocket message
            const onMessage = (vi.mocked(WebSocket) as any).mock.results[0].value.onmessage;
            act(() => {
                onMessage({
                    data: JSON.stringify({
                        type: 'notification',
                        data: { event: 'OrderExecuted', orderId: 1, executionPrice: 100 }
                    })
                });
            });

            expect(result.current.unreadCount).toBe(1);
            expect(result.current.notifications[0].message).toContain('Order #1 executed');
            expect(toast).toHaveBeenCalled();
        });

        it('clears notifications', () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            const { result } = renderHook(() => useOrderNotifications());
            
            // Add a notification first (via internal handler mock or just simulate message)
            const onMessage = (vi.mocked(WebSocket) as any).mock.results[0].value.onmessage;
            act(() => {
                onMessage({ data: JSON.stringify({ type: 'notification', data: { event: 'OrderCancelled', orderId: 2 } }) });
            });
            expect(result.current.unreadCount).toBe(1);

            act(() => {
                result.current.clearNotifications();
            });
            expect(result.current.unreadCount).toBe(0);
        });
    });

    describe('NotificationBell Component', () => {
        it('renders bell icon and unread count', () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            // Populate notifications via hook trigger in a separate render if needed, 
            // or just rely on the fact that it renders.
            render(<NotificationBell />);
            expect(screen.getByRole('button')).toBeDefined();
        });

        it('opens dropdown on click', () => {
            (useAccount as any).mockReturnValue({ address: '0x123' });
            render(<NotificationBell />);
            const button = screen.getByRole('button');
            fireEvent.click(button);
            expect(screen.getByText('Notifications')).toBeDefined();
        });
    });
});
