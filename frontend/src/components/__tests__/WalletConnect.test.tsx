import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WalletConnectButton, useWalletConnection } from '../WalletConnect';
import { renderHook } from '@testing-library/react';

describe('WalletConnect', () => {
    describe('WalletConnectButton', () => {
        it('renders the ConnectButton', () => {
            render(<WalletConnectButton />);
            expect(screen.getByTestId('connect-button')).toBeInTheDocument();
        });
    });

    describe('useWalletConnection', () => {
        it('returns connection status and address', () => {
            const { result } = renderHook(() => useWalletConnection());
            
            expect(result.current.isConnected).toBe(true);
            expect(result.current.address).toBe('0x123');
        });
    });
});
