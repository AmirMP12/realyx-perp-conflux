import { describe, it, expect } from 'vitest';
import * as UI from '../index';

describe('UI Barrel File', () => {
    it('exports all expected components', () => {
        expect(UI.Skeleton).toBeDefined();
        expect(UI.showToast).toBeDefined();
        expect(UI.Tooltip).toBeDefined();
        expect(UI.NumberTicker).toBeDefined();
    });
});
