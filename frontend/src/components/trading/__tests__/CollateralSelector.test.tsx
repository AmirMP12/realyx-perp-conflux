import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollateralSelector } from '../CollateralSelector';
import type { CollateralAsset } from '../../../hooks/useCollateral';

const usdc: CollateralAsset = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'USDT0', decimals: 6, isUSDC: true, enabled: true,
    baseHaircutBps: 0, liquidationHaircutBps: 0, maxHaircutBps: 0,
    maxProtocolExposure: 0n, totalDeposited: 0n, exposureUsdc: 0n,
    balance: 0n, balanceFormatted: 0, effectiveUsdc: 0n, effectiveUsdcFormatted: 0,
    exposureUtilization: null,
};

const weth: CollateralAsset = {
    address: '0x00000000000000000000000000000000000000A1',
    symbol: 'WETH', decimals: 18, isUSDC: false, enabled: true,
    baseHaircutBps: 200, liquidationHaircutBps: 500, maxHaircutBps: 3000,
    maxProtocolExposure: 1_000_000n, totalDeposited: 0n, exposureUsdc: 0n,
    balance: 2_000_000_000_000_000_000n, balanceFormatted: 2, effectiveUsdc: 1_960_000n, effectiveUsdcFormatted: 1.96,
    exposureUtilization: 0.5,
};

describe('CollateralSelector', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders a static USDT0 chip when no alt collateral exists', () => {
        render(<CollateralSelector assets={[usdc]} selected={usdc} onSelect={vi.fn()} ordersEnabled={false} />);
        expect(screen.getByText('USDT0')).toBeInTheDocument();
        expect(screen.queryByTestId('collateral-selector')).not.toBeInTheDocument();
    });

    it('shows a dropdown when alt collateral is registered', () => {
        render(<CollateralSelector assets={[usdc, weth]} selected={usdc} onSelect={vi.fn()} ordersEnabled />);
        const trigger = screen.getByTestId('collateral-selector');
        expect(trigger).toBeInTheDocument();
        fireEvent.click(trigger);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getByText('WETH')).toBeInTheDocument();
    });

    it('selects an alt token when orders are enabled', () => {
        const onSelect = vi.fn();
        render(<CollateralSelector assets={[usdc, weth]} selected={usdc} onSelect={onSelect} ordersEnabled />);
        fireEvent.click(screen.getByTestId('collateral-selector'));
        fireEvent.click(screen.getByText('WETH'));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'WETH' }));
    });

    it('locks alt tokens (no selection) when orders are disabled', () => {
        const onSelect = vi.fn();
        render(<CollateralSelector assets={[usdc, weth]} selected={usdc} onSelect={onSelect} ordersEnabled={false} />);
        fireEvent.click(screen.getByTestId('collateral-selector'));
        fireEvent.click(screen.getByText('WETH'));
        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.getByText(/Settles in USDT0/i)).toBeInTheDocument();
    });
});
