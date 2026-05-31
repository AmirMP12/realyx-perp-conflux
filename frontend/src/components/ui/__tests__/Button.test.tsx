import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
    it('renders children and handles clicks', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Trade</Button>);
        const btn = screen.getByRole('button', { name: 'Trade' });
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('defaults to type="button" to avoid accidental form submits', () => {
        render(<Button>Go</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('is disabled and not clickable while loading', () => {
        const onClick = vi.fn();
        render(<Button loading onClick={onClick}>Submit</Button>);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('respects the disabled prop', () => {
        render(<Button disabled>Nope</Button>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('applies fullWidth when requested', () => {
        render(<Button fullWidth>Wide</Button>);
        expect(screen.getByRole('button').className).toContain('w-full');
    });
});
