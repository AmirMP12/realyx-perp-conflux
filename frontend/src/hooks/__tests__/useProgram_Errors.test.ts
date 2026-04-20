
import { describe, it, expect, vi } from 'vitest';
// We need to import the functions to test. Since they are inside useProgram.ts 
// and might not be exported, let's check if we should export them or test them 
// via the hook.
// Looking at useProgram.ts: closeTxErrorMessage, decodeCreateOrderRevert, mapRevertToMessage are NOT exported.
// I will temporarily export them in useProgram.ts to provide "deep branch" testing 
// as requested by the user, which is a common practice for internal logic testing.

import { 
    // @ts-ignore - these will be exported in the next step
    closeTxErrorMessage, 
    // @ts-ignore
    decodeCreateOrderRevert, 
    // @ts-ignore
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
    });
});
