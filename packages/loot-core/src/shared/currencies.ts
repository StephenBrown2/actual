import { type NumberFormats } from './util';

export type Currency = {
  code: string;
  symbol: string;
  name: string;
  decimalPlaces: number;
  format?: NumberFormats;
  hideSymbol?: boolean;
  isCrypto?: boolean;
  symbolFirst?: boolean;
};

// When adding a new currency with a higher decimal precision, make sure to update
// the MAX_SAFE_NUMBER in util.ts.
// When adding a currency, also update the translation map in
// at packages/desktop-client/src/components/settings/Currency.tsx
// for the translation
// prettier-ignore
export const currencies: Currency[] = [
  // Default "no currency" option
  { code: '', name: 'None', symbol: '', decimalPlaces: 2 },
  // When adding a new currency, also update the translation map:
  // packages/desktop-client/src/components/settings/Currency.tsx
  //
  // ISO 4217 currencies
  // See https://en.wikipedia.org/wiki/ISO_4217
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimalPlaces: 2, format: 'dot-comma', symbolFirst: true },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr.', decimalPlaces: 2, format: 'apostrophe-dot', symbolFirst: true },
  { code: 'CNY', name: 'Yuan Renminbi', symbol: '¥', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'ج.م.', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2, format: 'comma-dot-in', symbolFirst: true },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimalPlaces: 0, format: 'comma-dot', symbolFirst: true },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'L', decimalPlaces: 2, format: 'comma-dot', symbolFirst: false },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', decimalPlaces: 2, format: 'space-comma', symbolFirst: false },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', decimalPlaces: 2, format: 'dot-comma', symbolFirst: false },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'RSD', decimalPlaces: 2, format: 'dot-comma', symbolFirst: false },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimalPlaces: 2, format: 'space-comma', symbolFirst: false },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimalPlaces: 2, format: 'dot-comma', symbolFirst: false },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimalPlaces: 2, format: 'dot-comma', symbolFirst: false },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', decimalPlaces: 2, format: 'space-comma', symbolFirst: false },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, format: 'comma-dot', symbolFirst: true },
  // Cryptocurrencies
  { code: 'BTC', name: 'Bitcoin', symbol: '₿', decimalPlaces: 8, format: 'sat-comma-dot', symbolFirst: false, isCrypto: true },
];

export function getCurrency(code: string): Currency {
  return currencies.find(c => c.code === code) || currencies[0];
}
