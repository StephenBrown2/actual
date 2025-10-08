import { getCurrency } from './currencies';
import {
  looselyParseAmount,
  getNumberFormat,
  setNumberFormat,
  formattedToAmount,
  titleFirst,
  currencyToFormatted,
  amountToFormatted,
} from './util';

describe('utility functions', () => {
  test('looseParseAmount works with basic numbers', () => {
    // Parsing is currently limited to 1,2 decimal places or 5-9.
    // Ignoring 3 places removes the possibility of improper parse
    //  of amounts without decimal amounts included.
    expect(looselyParseAmount('3')).toBe(3);
    expect(looselyParseAmount('3.4')).toBe(3.4);
    expect(looselyParseAmount('3.45')).toBe(3.45);
    // cant tell if this next case should be decimal or different format
    // so we set as full numbers
    expect(looselyParseAmount('3.456')).toBe(3456); // the expected failing case
    expect(looselyParseAmount('3.4500')).toBe(3.45);
    expect(looselyParseAmount('3.45000')).toBe(3.45);
    expect(looselyParseAmount('3.450000')).toBe(3.45);
    expect(looselyParseAmount('3.4500000')).toBe(3.45);
    expect(looselyParseAmount('3.45000000')).toBe(3.45);
    expect(looselyParseAmount('3.450000000')).toBe(3.45);
  });

  test('looseParseAmount works with alternate formats', () => {
    expect(looselyParseAmount('3,45')).toBe(3.45);
    expect(looselyParseAmount('3,456')).toBe(3456); //expected failing case
    expect(looselyParseAmount('3,4500')).toBe(3.45);
    expect(looselyParseAmount('3,45000')).toBe(3.45);
    expect(looselyParseAmount('3,450000')).toBe(3.45);
    expect(looselyParseAmount('3,4500000')).toBe(3.45);
    expect(looselyParseAmount('3,45000000')).toBe(3.45);
    expect(looselyParseAmount('3,450000000')).toBe(3.45);
    expect(looselyParseAmount("3'456.78")).toBe(3456.78);
    expect(looselyParseAmount("3'456.78000")).toBe(3456.78);
    expect(looselyParseAmount('1,00,000.99')).toBe(100000.99);
    expect(looselyParseAmount('1,00,000.99000')).toBe(100000.99);
  });

  test('looseParseAmount works with leading decimal characters', () => {
    expect(looselyParseAmount('.45')).toBe(0.45);
    expect(looselyParseAmount(',45')).toBe(0.45);
  });

  test('looseParseAmount works with negative numbers', () => {
    expect(looselyParseAmount('-3')).toBe(-3);
    expect(looselyParseAmount('-3.45')).toBe(-3.45);
    expect(looselyParseAmount('-3,45')).toBe(-3.45);
  });

  test('looseParseAmount works with parentheses (negative)', () => {
    expect(looselyParseAmount('(3.45)')).toBe(-3.45);
    expect(looselyParseAmount('(3)')).toBe(-3);
  });

  test('looseParseAmount ignores non-numeric characters', () => {
    // This is strange behavior because it does not work for just
    // `3_45_23` (it needs a decimal amount). This function should be
    // thought through more.
    expect(looselyParseAmount('3_45_23.10')).toBe(34523.1);
    expect(looselyParseAmount('(1 500.99)')).toBe(-1500.99);
  });

  test('number formatting works with comma-dot format', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1,234.56');

    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1,235');
  });

  test('number formatting works with comma-dot-in format', () => {
    setNumberFormat({ format: 'comma-dot-in', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234567.89'))).toBe('12,34,567.89');

    setNumberFormat({ format: 'comma-dot-in', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234567.89'))).toBe('12,34,568');
  });

  test('number formatting works with dot-comma format', () => {
    setNumberFormat({ format: 'dot-comma', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1.234,56');

    setNumberFormat({ format: 'dot-comma', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1.235');
  });

  test('number formatting works with space-comma format', () => {
    setNumberFormat({ format: 'space-comma', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    // grouping separator space char is a narrow non-breaking space (U+202F)
    expect(formatter.format(Number('1234.56'))).toBe('1\u202F234,56');

    setNumberFormat({ format: 'space-comma', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1\u202F235');
  });

  test('number formatting works with apostrophe-dot format', () => {
    setNumberFormat({ format: 'apostrophe-dot', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1’234.56');

    setNumberFormat({ format: 'apostrophe-dot', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1’235');
  });

  test('currencyToAmount works with basic numbers', () => {
    expect(formattedToAmount('3')).toBe(3);
    expect(formattedToAmount('3.4')).toBe(3.4);
    expect(formattedToAmount('3.45')).toBe(3.45);
    expect(formattedToAmount('3.45060')).toBe(3.4506);
  });

  test('currencyToAmount works with varied formats', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    expect(formattedToAmount('3,45')).toBe(3.45);
    expect(formattedToAmount('3,456')).toBe(3456);
    expect(formattedToAmount('3,45000')).toBe(345000);
    expect(formattedToAmount("3'456.78")).toBe(3456.78);
    expect(formattedToAmount("3'456.78000")).toBe(3456.78);
    expect(formattedToAmount('1,00,000.99')).toBe(100000.99);
    expect(formattedToAmount('1,00,000.99000')).toBe(100000.99);
  });

  test('currencyToAmount works with leading decimal characters', () => {
    expect(formattedToAmount('.45')).toBe(0.45);
    expect(formattedToAmount(',45')).toBe(0.45);
  });

  test('currencyToAmount works with negative numbers', () => {
    expect(formattedToAmount('-3')).toBe(-3);
    expect(formattedToAmount('-3.45')).toBe(-3.45);
    expect(formattedToAmount('-3,45')).toBe(-3.45);
  });

  test('currencyToAmount works with non-fractional numbers', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    expect(formattedToAmount('3.')).toBe(3);
    expect(formattedToAmount('3,')).toBe(3);
    expect(formattedToAmount('3,000')).toBe(3000);
    expect(formattedToAmount('3,000.')).toBe(3000);
  });

  test('currencyToAmount works with hidden fractions', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    expect(formattedToAmount('3.45')).toBe(3.45);
    expect(formattedToAmount('3.456')).toBe(3.456);
    expect(formattedToAmount('3.4500')).toBe(3.45);
    expect(formattedToAmount('3.')).toBe(3);
    expect(formattedToAmount('3,')).toBe(3);
    expect(formattedToAmount('3,000')).toBe(3000);
    expect(formattedToAmount('3,000.')).toBe(3000);
  });

  test('currencyToAmount works with dot-comma', () => {
    setNumberFormat({ format: 'dot-comma', hideFraction: false });
    expect(formattedToAmount('3,45')).toBe(3.45);
    expect(formattedToAmount('3,456')).toBe(3.456);
    expect(formattedToAmount('3,4500')).toBe(3.45);
    expect(formattedToAmount('3,')).toBe(3);
    expect(formattedToAmount('3.')).toBe(3);
    expect(formattedToAmount('3.000')).toBe(3000);
    expect(formattedToAmount('3.000,')).toBe(3000);
  });

  test('titleFirst works with all inputs', () => {
    expect(titleFirst('')).toBe('');
    expect(titleFirst(undefined)).toBe('');
    expect(titleFirst(null)).toBe('');
    expect(titleFirst('a')).toBe('A');
    expect(titleFirst('abc')).toBe('Abc');
  });

  describe('amountToFormatted with decimal places', () => {
    beforeEach(() => {
      // Set a consistent number format for these tests
      setNumberFormat({ format: 'comma-dot', hideFraction: false });
    });

    test('formats amounts with 8 decimal places (Bitcoin)', () => {
      expect(amountToFormatted(0.00114978, undefined, 8)).toBe('0.00114978');
      expect(amountToFormatted(1.23456789, undefined, 8)).toBe('1.23456789');
      expect(amountToFormatted(0, undefined, 8)).toBe('0.00000000');
    });

    test('formats amounts with 0 decimal places (Japanese Yen)', () => {
      expect(amountToFormatted(1500, undefined, 0)).toBe('1,500');
      expect(amountToFormatted(1234567, undefined, 0)).toBe('1,234,567');
      expect(amountToFormatted(0, undefined, 0)).toBe('0');
    });

    test('formats amounts with 3 decimal places', () => {
      expect(amountToFormatted(12.345, undefined, 3)).toBe('12.345');
      expect(amountToFormatted(1234.567, undefined, 3)).toBe('1,234.567');
      expect(amountToFormatted(0, undefined, 3)).toBe('0.000');
    });

    test('formats amounts with default 2 decimal places', () => {
      expect(amountToFormatted(123.45)).toBe('123.45');
      expect(amountToFormatted(123.45, undefined, 2)).toBe('123.45');
    });

    test('formats negative amounts correctly with various decimal places', () => {
      expect(amountToFormatted(-0.00114978, undefined, 8)).toBe('-0.00114978');
      expect(amountToFormatted(-1500, undefined, 0)).toBe('-1,500');
      expect(amountToFormatted(-12.345, undefined, 3)).toBe('-12.345');
    });
  });

  describe('currencyToFormatted', () => {
    test('formats USD amounts correctly', () => {
      const usd = getCurrency('USD');
      expect(currencyToFormatted({ currency: usd, amount: 12345 })).toBe(
        '\u202A$\u202C123.45',
      );
      expect(currencyToFormatted({ currency: usd, amount: -12345 })).toBe(
        '-\u202A$\u202C123.45',
      );
      expect(currencyToFormatted({ currency: usd, amount: 0 })).toBe(
        '\u202A$\u202C0.00',
      );
      expect(currencyToFormatted({ currency: usd, amount: 100 })).toBe(
        '\u202A$\u202C1.00',
      );
    });

    test('formats EUR amounts correctly', () => {
      const eur = getCurrency('EUR');
      expect(currencyToFormatted({ currency: eur, amount: 12345 })).toBe(
        '123,45€',
      );
      expect(currencyToFormatted({ currency: eur, amount: -12345 })).toBe(
        '-123,45€',
      );
      expect(currencyToFormatted({ currency: eur, amount: 0 })).toBe('0,00€');
    });

    test('formats GBP amounts correctly', () => {
      const gbp = getCurrency('GBP');
      expect(currencyToFormatted({ currency: gbp, amount: 12345 })).toBe(
        '\u202A£\u202C123.45',
      );
      expect(currencyToFormatted({ currency: gbp, amount: -12345 })).toBe(
        '-\u202A£\u202C123.45',
      );
    });

    test('formats amounts with space-comma format (SEK)', () => {
      const sek = getCurrency('SEK');
      expect(currencyToFormatted({ currency: sek, amount: 12345 })).toBe(
        '123,45kr',
      );
      expect(currencyToFormatted({ currency: sek, amount: 123456789 })).toBe(
        '1\u202F234\u202F567,89kr',
      );
    });

    test('formats amounts with apostrophe-dot format (CHF)', () => {
      const chf = getCurrency('CHF');
      expect(currencyToFormatted({ currency: chf, amount: 12345 })).toBe(
        '\u202AFr.\u202C123.45',
      );
      expect(currencyToFormatted({ currency: chf, amount: 123456789 })).toBe(
        '\u202AFr.\u202C1’234’567.89',
      );
    });

    test('formats amounts with comma-dot-in format (INR)', () => {
      const inr = getCurrency('INR');
      expect(currencyToFormatted({ currency: inr, amount: 123456789 })).toBe(
        '\u202A₹\u202C12,34,567.89',
      );
    });

    test('formats empty currency (no symbol)', () => {
      const noCurrency = getCurrency('');
      expect(currencyToFormatted({ currency: noCurrency, amount: 12345 })).toBe(
        '123.45',
      );
      expect(
        currencyToFormatted({ currency: noCurrency, amount: -12345 }),
      ).toBe('-123.45');
    });

    test('respects hideFraction option', () => {
      const usd = getCurrency('USD');
      expect(
        currencyToFormatted(
          { currency: usd, amount: 12345 },
          { hideFraction: true },
        ),
      ).toBe('\u202A$\u202C123');

      const eur = getCurrency('EUR');
      expect(
        currencyToFormatted(
          { currency: eur, amount: 12345 },
          { hideFraction: true },
        ),
      ).toBe('123€');
    });

    test('respects symbolPosition option', () => {
      const usd = getCurrency('USD');
      expect(
        currencyToFormatted(
          { currency: usd, amount: 12345 },
          { symbolPosition: 'after' },
        ),
      ).toBe('123.45$');

      const eur = getCurrency('EUR');
      expect(
        currencyToFormatted(
          { currency: eur, amount: 12345 },
          { symbolPosition: 'before' },
        ),
      ).toBe('\u202A€\u202C123,45');
    });

    test('respects spaceEnabled option', () => {
      const usd = getCurrency('USD');
      expect(
        currencyToFormatted(
          { currency: usd, amount: 12345 },
          { spaceEnabled: true },
        ),
      ).toBe('\u202A$\u202C\u202F123.45');

      expect(
        currencyToFormatted(
          { currency: usd, amount: 12345 },
          { symbolPosition: 'after', spaceEnabled: true },
        ),
      ).toBe('123.45\u202F$');
    });

    test('handles large amounts correctly', () => {
      const usd = getCurrency('USD');
      expect(currencyToFormatted({ currency: usd, amount: 1234567890 })).toBe(
        '\u202A$\u202C12,345,678.90',
      );

      const eur = getCurrency('EUR');
      expect(currencyToFormatted({ currency: eur, amount: 1234567890 })).toBe(
        '12.345.678,90€',
      );
    });

    test('handles zero and small amounts', () => {
      const usd = getCurrency('USD');
      expect(currencyToFormatted({ currency: usd, amount: 0 })).toBe(
        '\u202A$\u202C0.00',
      );
      expect(currencyToFormatted({ currency: usd, amount: 1 })).toBe(
        '\u202A$\u202C0.01',
      );
      expect(currencyToFormatted({ currency: usd, amount: 10 })).toBe(
        '\u202A$\u202C0.10',
      );
      expect(currencyToFormatted({ currency: usd, amount: 99 })).toBe(
        '\u202A$\u202C0.99',
      );
    });
  });
});
