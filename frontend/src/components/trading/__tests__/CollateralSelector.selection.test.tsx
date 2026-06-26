import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollateralSelector } from '../CollateralSelector';

function asset(over: any = {}) {
    return {
        address: '0x0000000000000000000000000000000000000000', symbol: 'USDT0', isUSDC: true, enabled: true,
        baseHaircutBps: 0, balanceFormatted: 0, effectiveUsdcFormatted: 0, ...over,
    };
}

const usdc = asset();
const alt = asset({ address: '0xAlt', symbol: 'WBTC', isUSDC: false, enabled: true, baseHaircutBps: 200, balanceFormatted: 1.5, effectiveUsdcFormatted: 90000 });
const altDisabled = asset({ address: '0xAlt2', symbol: 'WETH', isUSDC: false, enabled: false, baseHaircutBps: 300, balanceFormatted: 2, effectiveUsdcFormatted: 6000 });

describe('CollateralSelector', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders a static USDT0 chip when there is no alt collateral', () => {
        render(<CollateralSelector assets={[usdc]} selected={usdc} onSelect={vi.fn()} ordersEnabled={false} />);
        expect(screen.getByText('USDT0')).toBeInTheDocument();
        expect(screen.queryByTestId('collateral-selector')).not.toBeInTheDocument();
    });

    it('opens the dropdown and selects an enabled alt asset', () => {
        const onSelect = vi.fn();
        render(<CollateralSelector assets={[usdc, alt, altDisabled]} selected={usdc} onSelect={onSelect} ordersEnabled />);
        fireEvent.click(screen.getByTestId('collateral-selector'));
        expect(screen.getAllByText('WBTC').length).toBeGreaterThan(0);
        fireEvent.click(screen.getAllByText('WBTC')[screen.getAllByText('WBTC').length - 1]);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'WBTC' }));
    });

    it('does not select a locked alt when orders are disabled', () => {
        const onSelect = vi.fn();
        render(<CollateralSelector assets={[usdc, alt]} selected={usdc} onSelect={onSelect} ordersEnabled={false} />);
        fireEvent.click(screen.getByTestId('collateral-selector'));
        fireEvent.click(screen.getAllByText('WBTC')[screen.getAllByText('WBTC').length - 1]);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('shows the haircut note when a non-USDC asset is selected', () => {
        render(<CollateralSelector assets={[usdc, alt]} selected={alt} onSelect={vi.fn()} ordersEnabled />);
        expect(screen.getAllByText(/haircut/).length).toBeGreaterThan(0);
    });
});
