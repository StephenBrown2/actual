#!/usr/bin/env node

/**
 * Adds a new currency to currencies.ts and Currency.tsx
 *
 * Usage: CODE=USD node add-currency.mjs
 *
 * Fetches metadata from LocalePlanet API and:
 * 1. Adds currency entry to currencies.ts in alphabetical order
 * 2. Adds translation entry to Currency.tsx in alphabetical order
 * 3. Determines symbol (uses API symbol when symbol_native is $)
 * 4. Determines numberFormat from locale conventions
 * 5. Determines symbolFirst from locale conventions
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

/**
 * Exhaustive hardcoded currency code list from:
 * - LocalePlanet currencymap.json
 * - OpenExchangeRates currencies.json
 */
const allCurrencyCodes = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BOV',
  'BRL',
  'BSD',
  'BTC',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHE',
  'CHF',
  'CHW',
  'CLF',
  'CLP',
  'CNH',
  'CNY',
  'COP',
  'COU',
  'CRC',
  'CUC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GGP',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HRK',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'IMP',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JEP',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRO',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MXV',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SLL',
  'SOS',
  'SRD',
  'SSP',
  'STD',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'USN',
  'UYI',
  'UYU',
  'UZS',
  'VEF',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XAG',
  'XAU',
  'XCD',
  'XCG',
  'XDR',
  'XOF',
  'XPD',
  'XPF',
  'XPT',
  'YER',
  'ZAR',
  'ZMW',
  'ZWG',
  'ZWL',
];

/**
 * Explicit number format overrides based on locale conventions.
 * Any code not listed here defaults to comma-dot.
 */
const numberFormatOverrides = {
  ARS: 'dot-comma',
  BRL: 'dot-comma',
  CHF: 'apostrophe-dot',
  CLP: 'dot-comma',
  COP: 'dot-comma',
  CZK: 'space-comma',
  DKK: 'dot-comma',
  EUR: 'dot-comma',
  IDR: 'dot-comma',
  INR: 'comma-dot-in',
  MDL: 'dot-comma',
  NOK: 'space-comma',
  PLN: 'space-comma',
  RON: 'dot-comma',
  RSD: 'dot-comma',
  RUB: 'space-comma',
  SEK: 'space-comma',
  TRY: 'dot-comma',
  UAH: 'space-comma',
  UZS: 'space-comma',
  BYN: 'space-comma',
};

/**
 * Explicit symbol position overrides.
 * Any code not listed here defaults to symbolFirst=true.
 */
const symbolFirstOverrides = {
  AED: false,
  BYN: false,
  CZK: false,
  DKK: false,
  EGP: false,
  EUR: false,
  HUF: false,
  KRW: false,
  MDL: false,
  NOK: false,
  PLN: false,
  QAR: false,
  RON: false,
  RSD: false,
  RUB: false,
  SAR: false,
  SEK: false,
  TWD: false,
  UAH: false,
  UZS: false,
};

const numberFormatByCode = Object.fromEntries(
  allCurrencyCodes.map(code => [
    code,
    numberFormatOverrides[code] ?? 'comma-dot',
  ]),
);

const symbolFirstByCode = Object.fromEntries(
  allCurrencyCodes.map(code => [code, symbolFirstOverrides[code] ?? true]),
);

/**
 * Determine number format for a currency
 */
function determineNumberFormat(code) {
  return numberFormatByCode[code] ?? 'comma-dot';
}

/**
 * Determine symbol position for a currency
 */
function determineSymbolFirst(code) {
  return symbolFirstByCode[code] ?? true;
}

/**
 * Fetch currency data from LocalePlanet API
 */
async function fetchLocalePlanetData() {
  const apiUrl =
    'https://www.localeplanet.com/api/auto/currencymap.json?name=Y';

  info('Fetching currency data from LocalePlanet API...');
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch LocalePlanet data: HTTP ${response.status}`,
    );
  }

  const data = await response.json();
  return data;
}

/**
 * Fetch currency names from OpenExchangeRates.
 * If unavailable, return an empty object and fall back to LocalePlanet names.
 */
async function fetchOpenExchangeRatesNames() {
  const apiUrl = 'https://openexchangerates.org/api/currencies.json';

  try {
    info('Fetching currency names from OpenExchangeRates...');
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    info(
      `OpenExchangeRates fetch failed, falling back to LocalePlanet names: ${err.message}`,
    );
    return {};
  }
}

/**
 * Check if currency already exists
 */
async function currencyExists(code) {
  const filePath = join(rootDir, 'packages/loot-core/src/shared/currencies.ts');
  const content = await readFile(filePath, 'utf-8');
  const regex = new RegExp(`code:\\s*'${code}'`, 'g');
  return regex.test(content);
}

/**
 * Add currency to currencies.ts
 */
async function addToCurrenciesFile(currencyData) {
  const filePath = join(rootDir, 'packages/loot-core/src/shared/currencies.ts');
  const content = await readFile(filePath, 'utf-8');

  // Parse existing currencies
  const match = content.match(
    /export const currencies: Currency\[\] = \[([\s\S]*?)\];/,
  );
  if (!match) {
    throw new Error('Could not find currencies array');
  }

  const arrayContent = match[1];
  const currencyRegex =
    /(\{\s*code:\s*'[^']*'\s*,\s*name:\s*'[^']*'\s*,\s*symbol:\s*'[^']*'\s*,\s*decimalPlaces:\s*\d+\s*,\s*numberFormat:\s*'[^']*'\s*,\s*symbolFirst:\s*(?:true|false)\s*\})/g;

  let currencyMatch;
  const currencyStrings = [];
  while ((currencyMatch = currencyRegex.exec(arrayContent)) !== null) {
    currencyStrings.push({
      text: currencyMatch[1],
      code: currencyMatch[1].match(/code:\s*'([^']*)'/)[1],
    });
  }

  // Add new currency
  const newCurrencyStr = `{ code: '${currencyData.code}', name: '${currencyData.name}', symbol: '${currencyData.symbol}', decimalPlaces: ${currencyData.decimalPlaces}, numberFormat: '${currencyData.numberFormat}', symbolFirst: ${currencyData.symbolFirst} }`;
  currencyStrings.push({ text: newCurrencyStr, code: currencyData.code });

  // Sort alphabetically
  currencyStrings.sort((a, b) => a.code.localeCompare(b.code));

  // Rebuild array
  const newArrayContent =
    '\n  ' + currencyStrings.map(c => c.text).join(',\n  ') + ',\n';
  const newContent = content.replace(
    /export const currencies: Currency\[\] = \[[\s\S]*?\];/,
    `export const currencies: Currency[] = [${newArrayContent}];`,
  );

  await writeFile(filePath, newContent, 'utf-8');
  success(`Added ${currencyData.code} to currencies.ts`);
}

/**
 * Add currency translation to Currency.tsx
 */
async function addToCurrencyTranslations(code, name) {
  const filePath = join(
    rootDir,
    'packages/desktop-client/src/components/settings/Currency.tsx',
  );
  const content = await readFile(filePath, 'utf-8');

  // Parse existing translations
  const match = content.match(/new Map<string, string>\(\[([\s\S]*?)\]\)/);
  if (!match) {
    throw new Error('Could not find currencyTranslations Map');
  }

  const mapContent = match[1];
  const entryRegex = /(\['[^']*',\s*t\('[^']*'\)\])/g;

  let entryMatch;
  const entryStrings = [];
  while ((entryMatch = entryRegex.exec(mapContent)) !== null) {
    const codeMatch = entryMatch[1].match(/\['([^']*)'/);
    entryStrings.push({ text: entryMatch[1], code: codeMatch[1] });
  }

  // Add new translation
  const newEntryStr = `['${code}', t('${name}')]`;
  entryStrings.push({ text: newEntryStr, code });

  // Sort alphabetically
  entryStrings.sort((a, b) => a.code.localeCompare(b.code));

  // Rebuild map
  const newMapContent =
    '\n        ' +
    entryStrings.map(e => e.text).join(',\n        ') +
    ',\n      ';
  const newContent = content.replace(
    /new Map<string, string>\(\[[\s\S]*?\]\)/,
    `new Map<string, string>([${newMapContent}])`,
  );

  await writeFile(filePath, newContent, 'utf-8');
  success(`Added ${code} translation to Currency.tsx`);
}

/**
 * Main function
 */
async function main() {
  const code = process.env.CODE;

  if (!code) {
    error('CODE environment variable is required');
    error('Usage: CODE=USD node add-currency.mjs');
    process.exit(1);
  }

  if (!/^[A-Z]{3}$/.test(code)) {
    error(`Invalid currency code: ${code} (must be 3 uppercase letters)`);
    process.exit(1);
  }

  try {
    log(`\n💱 Adding currency: ${code}\n`, 'cyan');

    // Check if already exists
    if (await currencyExists(code)) {
      error(`Currency ${code} already exists in currencies.ts`);
      process.exit(1);
    }

    // Fetch API data
    const [apiData, oxrNames] = await Promise.all([
      fetchLocalePlanetData(),
      fetchOpenExchangeRatesNames(),
    ]);
    const apiCurrency = apiData[code];

    if (!apiCurrency) {
      error(`Currency ${code} not found in LocalePlanet API`);
      process.exit(1);
    }

    const selectedName = oxrNames[code] ?? apiCurrency.name;
    info(`Found ${code}: ${selectedName}`);

    // Determine symbol
    let symbol;
    if (apiCurrency.symbol_native === '$') {
      symbol = apiCurrency.symbol; // Use disambiguated symbol (e.g., CA$, A$)
      info(`Native symbol is $, using disambiguated: ${symbol}`);
    } else {
      symbol = apiCurrency.symbol_native;
      info(`Using native symbol: ${symbol}`);
    }

    // Build currency data
    const currencyData = {
      code,
      name: selectedName,
      symbol,
      decimalPlaces: apiCurrency.decimal_digits,
      numberFormat: determineNumberFormat(code),
      symbolFirst: determineSymbolFirst(code),
    };

    info(`Number format: ${currencyData.numberFormat}`);
    info(`Symbol position: ${currencyData.symbolFirst ? 'before' : 'after'}`);
    info(`Decimal places: ${currencyData.decimalPlaces}`);

    // Add to files
    await addToCurrenciesFile(currencyData);
    await addToCurrencyTranslations(code, selectedName);

    log('\n' + '='.repeat(60), 'cyan');
    success(`✨ Successfully added ${code} (${selectedName})`);
    log('='.repeat(60) + '\n', 'cyan');
    process.exit(0);
  } catch (err) {
    error(`Failed to add currency: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
