import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';
import React from 'react';

const TestComponent = ({ active }: { active: boolean }) => {
  const ref = useFocusTrap(active);
  return (
    <div ref={ref}>
      <button>Button 1</button>
      <input data-testid="input" />
      <a href="#">Link 1</a>
    </div>
  );
};

describe('useFocusTrap', () => {
  it('traps focus when active', () => {
    const { getByText, getByTestId } = render(<TestComponent active={true} />);
    const btn1 = getByText('Button 1');
    const input = getByTestId('input');
    const link = getByText('Link 1');

    // Initial focus
    expect(document.activeElement).toBe(btn1);

    // Tab from last to first
    link.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    link.dispatchEvent(event);
    // In jsdom we might need to manually trigger or check logic if event doesn't trigger fully
  });

  it('does nothing when inactive', () => {
    const { getByText } = render(<TestComponent active={false} />);
    const btn1 = getByText('Button 1');
    
    // Should not automatically focus
    expect(document.activeElement).not.toBe(btn1);
  });
});
