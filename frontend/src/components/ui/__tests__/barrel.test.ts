import { describe, it, expect } from 'vitest';
import * as ui from '../index';

describe('ui barrel', () => {
    it('re-exports the shared UI primitives', () => {
        expect(ui.Skeleton).toBeDefined();
        expect(ui.Button).toBeDefined();
        expect(ui.Card).toBeDefined();
        expect(ui.Modal).toBeDefined();
        expect(ui.HealthRing).toBeDefined();
        expect(ui.NumberTicker).toBeDefined();
    });
});
