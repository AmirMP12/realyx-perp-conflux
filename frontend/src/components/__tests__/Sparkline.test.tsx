import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
    it('renders nothing when data is empty', () => {
        const { container } = render(<Sparkline data={[]} />);
        expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('renders nothing when all values are non-positive', () => {
        const { container } = render(<Sparkline data={[{ timestamp: 1, value: 0 }, { timestamp: 2, value: -1 }]} />);
        expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('renders a positive trend path', () => {
        const data = [
            { timestamp: 1, value: 10 },
            { timestamp: 2, value: 20 },
        ];
        const { container } = render(<Sparkline data={data} positiveColor="green" />);
        const path = container.querySelector('path');
        expect(path).toBeInTheDocument();
        expect(path).toHaveAttribute('stroke', 'green');
    });

    it('renders a negative trend path', () => {
        const data = [
            { timestamp: 1, value: 20 },
            { timestamp: 2, value: 10 },
        ];
        const { container } = render(<Sparkline data={data} negativeColor="red" />);
        const path = container.querySelector('path');
        expect(path).toBeInTheDocument();
        expect(path).toHaveAttribute('stroke', 'red');
    });

    it('handles a single data point', () => {
        const data = [{ timestamp: 1, value: 10 }];
        const { container } = render(<Sparkline data={data} />);
        const div = container.querySelector('div');
        expect(div).toBeInTheDocument();
    });
});
