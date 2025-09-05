import React from 'react';

import { render, fireEvent } from '@testing-library/react';

import { AmountInput } from './AmountInput';

const mockCurrency = {
  code: 'USD',
  symbol: '$',
  name: 'US Dollar',
  decimalPlaces: 2,
  decimalSeparator: '.',
  groupSeparator: ',',
  locale: 'en-US',
  symbolFirst: true,
};

describe('AmountInput with currency prop', () => {
  it('formats value with currency symbol and decimals when not editing', () => {
    const { getByRole } = render(
      <AmountInput value={12345} currency={mockCurrency} />,
    );
    const input = getByRole('textbox');
    // Should display $123.45 (12345 / 100)
    expect(input).toHaveValue('$123.45');
  });

  it('shows raw value for editing', () => {
    const { getByRole } = render(
      <AmountInput value={12345} currency={mockCurrency} focused />,
    );
    const input = getByRole('textbox');
    // Should show 123.45 for editing
    expect(input).toHaveValue('123.45');
  });

  it('calls onUpdate with correct value and sign', () => {
    const onUpdate = vi.fn();
    const { getByRole } = render(
      <AmountInput
        value={-12345}
        currency={mockCurrency}
        onUpdate={onUpdate}
      />,
    );
    const button = getByRole('button');
    fireEvent.click(button); // Switch sign
    expect(onUpdate).toHaveBeenCalledWith(12345);
  });
});
