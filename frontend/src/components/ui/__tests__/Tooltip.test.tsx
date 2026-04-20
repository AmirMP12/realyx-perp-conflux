import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

describe('Tooltip', () => {
  it('shows tooltip content on hover', () => {
    render(
      <Tooltip content="Helper text">
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Hover me');
    
    // Initially not visible
    expect(screen.queryByText('Helper text')).not.toBeInTheDocument();

    // Hover
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText('Helper text')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Leave
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText('Helper text')).not.toBeInTheDocument();
  });

  it('shows tooltip content on focus', () => {
    render(
      <Tooltip content="Focus text">
        <button>Focus me</button>
      </Tooltip>
    );

    const trigger = screen.getByText('Focus me');

    // Focus
    fireEvent.focus(trigger);
    expect(screen.getByText('Focus text')).toBeInTheDocument();

    // Blur
    fireEvent.blur(trigger);
    expect(screen.queryByText('Focus text')).not.toBeInTheDocument();
  });

  it('renders on different sides', () => {
    const { rerender } = render(
      <Tooltip content="Side test" side="bottom">
        <span>Target</span>
      </Tooltip>
    );
    
    fireEvent.mouseEnter(screen.getByText('Target'));
    expect(screen.getByRole('tooltip')).toHaveClass('top-full');

    rerender(
      <Tooltip content="Side test" side="left">
        <span>Target</span>
      </Tooltip>
    );
    expect(screen.getByRole('tooltip')).toHaveClass('right-full');
  });
});
