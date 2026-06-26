import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthRing } from '../HealthRing';

describe('HealthRing', () => {
    it('renders infinite health as ∞ and Healthy', () => {
        render(<HealthRing healthFactor={Infinity} />);
        expect(screen.getByText('∞')).toBeInTheDocument();
        expect(screen.getByText('Healthy')).toBeInTheDocument();
        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('aria-label', expect.stringContaining('Healthy'));
    });

    it('renders a healthy (safe) factor', () => {
        render(<HealthRing healthFactor={2} />);
        expect(screen.getByText('2.00')).toBeInTheDocument();
        expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    it('renders a caution factor', () => {
        render(<HealthRing healthFactor={1.2} />);
        expect(screen.getByText('Caution')).toBeInTheDocument();
    });

    it('renders an at-risk factor', () => {
        render(<HealthRing healthFactor={1.05} />);
        expect(screen.getByText('At risk')).toBeInTheDocument();
    });

    it('shows an optional caption', () => {
        render(<HealthRing healthFactor={3} caption="3 cross positions" />);
        expect(screen.getByText('3 cross positions')).toBeInTheDocument();
    });
});
