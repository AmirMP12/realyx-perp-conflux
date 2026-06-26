import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationSetup } from '../NotificationSetup';
import * as pwa from '../../utils/pwa';

vi.mock('../../utils/pwa', () => ({
    notificationPermission: vi.fn(),
    requestNotificationPermission: vi.fn(),
    subscribeToPush: vi.fn(),
    notify: vi.fn(),
    isStandalone: vi.fn(),
    notificationsSupported: vi.fn(),
}));

describe('NotificationSetup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (pwa.notificationPermission as any).mockReturnValue('default');
        (pwa.isStandalone as any).mockReturnValue(false);
        (pwa.notificationsSupported as any).mockReturnValue(true);
        (pwa.requestNotificationPermission as any).mockResolvedValue('granted');
        (pwa.subscribeToPush as any).mockResolvedValue(null);
        (pwa.notify as any).mockResolvedValue(undefined);
    });

    it('shows enable button when permission is default', () => {
        render(<NotificationSetup />);
        expect(screen.getByText('Enable alerts')).toBeInTheDocument();
        expect(screen.getByText('Install Realyx')).toBeInTheDocument();
    });

    it('enables alerts and requests permission', async () => {
        render(<NotificationSetup />);
        fireEvent.click(screen.getByText('Enable alerts'));
        await waitFor(() => expect(pwa.requestNotificationPermission).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
        expect(pwa.subscribeToPush).toHaveBeenCalled();
        expect(pwa.notify).toHaveBeenCalled();
    });

    it('shows "Not supported" when notifications unsupported', () => {
        (pwa.notificationsSupported as any).mockReturnValue(false);
        render(<NotificationSetup />);
        expect(screen.getByText(/Not supported/)).toBeInTheDocument();
    });

    it('shows blocked state when denied', () => {
        (pwa.notificationPermission as any).mockReturnValue('denied');
        render(<NotificationSetup />);
        expect(screen.getByText(/Blocked/)).toBeInTheDocument();
    });

    it('shows enabled state when already granted', () => {
        (pwa.notificationPermission as any).mockReturnValue('granted');
        render(<NotificationSetup />);
        expect(screen.getByText('Enabled')).toBeInTheDocument();
    });

    it('shows installed state when standalone', () => {
        (pwa.isStandalone as any).mockReturnValue(true);
        render(<NotificationSetup />);
        expect(screen.getByText('Installed')).toBeInTheDocument();
    });

    it('handles beforeinstallprompt and install click', async () => {
        render(<NotificationSetup />);
        const promptEvent: any = new Event('beforeinstallprompt');
        promptEvent.prompt = vi.fn();
        promptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
        fireEvent(window, promptEvent);
        const installBtn = await screen.findByText('Install');
        fireEvent.click(installBtn);
        expect(promptEvent.prompt).toHaveBeenCalled();
    });

    it('marks installed on appinstalled event', async () => {
        render(<NotificationSetup />);
        fireEvent(window, new Event('appinstalled'));
        await waitFor(() => expect(screen.getByText('Installed')).toBeInTheDocument());
    });
});
