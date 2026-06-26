
import { describe, it, expect } from 'vitest';
// closeTxErrorMessage, decodeCreateOrderRevert and mapRevertToMessage are internal
// helpers in useProgram.ts, exported there so their error-mapping logic can be
// unit-tested directly.

import { 
    // @ts-expect-error - Internal functions not exported in type definition
    closeTxErrorMessage, 
    // @ts-expect-error - Internal functions not exported in type definition
    decodeCreateOrderRevert, 
    // @ts-expect-error - Internal functions not exported in type definition
    mapRevertToMessage 
} from '../useProgram';

describe('useProgram Error Mapping', () => {
    describe('closeTxErrorMessage', () => {
        it('handles StalePrice selector', () => {
            const err = { data: '0x19abf40e' };
            expect(closeTxErrorMessage(err)).toContain('Oracle price is stale');
        });

        it('handles "staleprice" text in error', () => {
            const err = new Error('Execution reverted: StalePrice');
            expect(closeTxErrorMessage(err)).toContain('Oracle price is stale');
        });

        it('handles minPositionDuration error', () => {
            const err = new Error('MinPositionDuration error');
            expect(closeTxErrorMessage(err)).toContain('minimum time before closing');
        });

        it('handles positionTooSmall error', () => {
            const err = new Error('PositionTooSmall');
            expect(closeTxErrorMessage(err)).toContain('remaining size would be below');
        });

        it('handles zeroCloseSize error', () => {
            const err = new Error('ZeroCloseSize');
            expect(closeTxErrorMessage(err)).toContain('rounds to zero');
        });

        it('handles deadlineexpired error', () => {
            const err = new Error('DeadlineExpired');
            expect(closeTxErrorMessage(err)).toContain('deadline passed');
        });

        it('handles notPositionOwner error', () => {
            const err = new Error('NotPositionOwner');
            expect(closeTxErrorMessage(err)).toContain('not the owner');
        });

        it('handles positionnotfound error/selector', () => {
            const err = { data: '0x6ec9be11' };
            expect(closeTxErrorMessage(err)).toContain('already closed or not active');
        });

        it('handles flashloan safety rule', () => {
            const err = new Error('FlashLoanDetected');
            expect(closeTxErrorMessage(err)).toContain('one block and retry');
        });

        it('handles paused trading', () => {
            const err = new Error('Trading is paused');
            expect(closeTxErrorMessage(err)).toContain('temporarily paused');
        });

        it('handles slippage errors', () => {
            const err = new Error('SlippageExceeded');
            expect(closeTxErrorMessage(err)).toContain('beyond the allowed bound');
        });

        it('handles insufficientliquidity errors', () => {
            const err = new Error('InsufficientLiquidity');
            expect(closeTxErrorMessage(err)).toContain('Insufficient vault liquidity');
        });

        it('walks a nested cause chain to find the revert data', () => {
            const err = { cause: { cause: { data: '0x19abf40e' } } };
            expect(closeTxErrorMessage(err)).toContain('Oracle price is stale');
        });

        it('returns a generic fallback for an empty/undefined error', () => {
            expect(closeTxErrorMessage(undefined)).toBe('Transaction failed');
            expect(closeTxErrorMessage({})).toBe('Transaction failed');
        });

        it('prefers shortMessage then message in the fallback', () => {
            expect(closeTxErrorMessage({ shortMessage: 'short' })).toBe('short');
            expect(closeTxErrorMessage(new Error('boom plain'))).toBe('boom plain');
        });
    });

    describe('decodeCreateOrderRevert', () => {
        it('decodes known selecters', () => {
            expect(decodeCreateOrderRevert({ data: '0xc8561601' })).toContain('Execution fee is too low');
            expect(decodeCreateOrderRevert({ data: '0x6b59e4ed' })).toContain('risk circuit breaker');
            expect(decodeCreateOrderRevert({ data: '0x3a23d825' })).toContain('Insufficient collateral');
            expect(decodeCreateOrderRevert({ data: '0xb521771a' })).toContain('Market is currently not active');
            expect(decodeCreateOrderRevert({ data: '0xaf610693' })).toContain('Invalid order parameters');
            expect(decodeCreateOrderRevert({ data: '0x8199f5f3' })).toContain('Slippage exceeded');
            expect(decodeCreateOrderRevert({ data: '0xf073bef9' })).toContain('Smart-contract wallets are blocked');
            expect(decodeCreateOrderRevert({ data: '0xa74c1c5f' })).toContain('too quickly');
            expect(decodeCreateOrderRevert({ data: '0xa0e1accb' })).toContain('Compliance check failed');
            expect(decodeCreateOrderRevert({ data: '0x0b5f6bf0' })).toContain('market is currently closed');
            expect(decodeCreateOrderRevert({ data: '0xd0ad2225' })).toContain('Protocol health guard');
            expect(decodeCreateOrderRevert({ data: '0x1ab7da6b' })).toContain('Transaction deadline expired');
            expect(decodeCreateOrderRevert({ data: '0xb28e83a9' })).toContain('Oracle sources are currently insufficient');
        });

        it('returns null for unknown selector', () => {
            expect(decodeCreateOrderRevert({ data: '0xdeadbeef' })).toBeNull();
        });
    });

    describe('mapRevertToMessage', () => {
        it('prefers decoded selector over generic text', () => {
            const err = { data: '0xc8561601', message: 'Generic error' };
            expect(mapRevertToMessage(err)).toContain('Execution fee is too low');
        });

        it('maps text-based errors when no selector matches', () => {
            expect(mapRevertToMessage({ message: 'executionfeetoolow' })).toContain('Execution fee is too low');
            expect(mapRevertToMessage({ message: 'breakeractive' })).toContain('risk circuit breaker');
            expect(mapRevertToMessage({ message: 'insufficientcollateral' })).toContain('Insufficient collateral');
            expect(mapRevertToMessage({ message: 'marketnotactive' })).toContain('Market is currently not active');
            expect(mapRevertToMessage({ message: 'transfer amount exceeds balance' })).toContain('Insufficient token balance');
            expect(mapRevertToMessage({ message: 'the contract function "createorder" reverted' })).toContain('Order creation reverted');
        });

        it('maps the remaining time-in-force / bracket / collateral text errors', () => {
            expect(mapRevertToMessage({ message: 'AltCollateralDisabled' })).toContain('Alternative collateral is not enabled');
            expect(mapRevertToMessage({ message: 'PostOnlyCrossesBook' })).toContain('Post-only price would fill immediately');
            expect(mapRevertToMessage({ message: 'PostOnlyNotAllowedForMarket' })).toContain('Post-only only applies to limit orders');
            expect(mapRevertToMessage({ message: 'UnsupportedTimeInForce' })).toContain('time-in-force is not supported');
            expect(mapRevertToMessage({ message: 'InvalidVisibleSize' })).toContain('Iceberg/TWAP slicing');
            expect(mapRevertToMessage({ message: 'ReduceOnlyRequiresPosition' })).toContain('Reduce-only orders require');
            expect(mapRevertToMessage({ message: 'InvalidOrder' })).toContain('Invalid bracket prices');
            expect(mapRevertToMessage({ message: 'erc20 transfer failed' })).toContain('Insufficient token balance');
        });

        it('falls back to shortMessage then message then a default', () => {
            expect(mapRevertToMessage({ shortMessage: 'short reason' })).toBe('short reason');
            expect(mapRevertToMessage({ message: 'plain message' })).toBe('plain message');
            expect(mapRevertToMessage({})).toBe('Failed to submit order');
        });
    });

    describe('decodeCreateOrderRevert extra', () => {
        it('decodes the alt-collateral selector', () => {
            expect(decodeCreateOrderRevert({ data: '0xcf6d6d6d' })).toContain('Alternative collateral is not enabled');
        });

        it('returns null when there is no hex selector in the error', () => {
            expect(decodeCreateOrderRevert({ message: 'no hex here' })).toBeNull();
        });
    });
});
