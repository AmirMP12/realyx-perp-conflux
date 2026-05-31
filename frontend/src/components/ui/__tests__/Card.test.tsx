import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle } from '../Card';

describe('Card', () => {
    it('renders children with the default panel class', () => {
        render(<Card>Panel body</Card>);
        const el = screen.getByText('Panel body');
        expect(el.className).toContain('glass-panel');
    });

    it('uses the elevated surface when requested', () => {
        render(<Card variant="elevated">Hero</Card>);
        expect(screen.getByText('Hero').className).toContain('glass-panel-elevated');
    });

    it('renders header and title composition', () => {
        render(
            <Card>
                <CardHeader>
                    <CardTitle>Positions</CardTitle>
                </CardHeader>
            </Card>,
        );
        expect(screen.getByRole('heading', { name: 'Positions' })).toBeInTheDocument();
    });
});
