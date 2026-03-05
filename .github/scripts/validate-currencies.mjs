#!/usr/bin/env node

/**
 * Validates currency data in currencies.ts against LocalePlanet API data
 * and ensures consistency with Currency.tsx translation map.
 *
 * Validation checks:
 * 1. All currencies have matching entries in Currency.tsx translation map
 * 2. Currencies are in alphabetical order by code ('' naturally sorts first)
 * 3. Metadata matches LocalePlanet API:
 *    - decimalPlaces === decimal_digits
 *    - When symbol_native === "$", symbol must match API symbol field
 *    - Otherwise, symbol === symbol_native
 *    - name matches either LocalePlanet or OpenExchangeRates source
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

// ANSI color codes for terminal output
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
 * Alternate symbols accepted for select currencies where local convention
 * commonly uses an abbreviation-style symbol.
 */
const alternateDollarSymbols = {
  ARS: ['Arg$'],
  COP: ['Col$'],
  JMD: ['J$'],
  SGD: ['S$'],
};

/**
 * Fetch currency data from LocalePlanet API.
 */
async function fetchCurrencyData() {
  const apiUrl =
    'https://www.localeplanet.com/api/auto/currencymap.json?name=Y';

  info('Fetching currency data from LocalePlanet...');
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch LocalePlanet currency data: HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = await response.json();
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    throw new Error(
      'LocalePlanet returned no currency data. Please retry the workflow.',
    );
  }

  success(`Fetched data for ${Object.keys(data).length} currencies`);
  return data;
}

/**
 * Fetch currency names from OpenExchangeRates.
 * If unavailable, return an empty object.
 */
async function fetchOpenExchangeRatesNames() {
  const apiUrl = 'https://openexchangerates.org/api/currencies.json';

  try {
    info('Fetching currency names from OpenExchangeRates...');
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    success(`Fetched names for ${Object.keys(data).length} currencies`);
    return data;
  } catch (err) {
    info(`OpenExchangeRates names unavailable: ${err.message}`);
    return {};
  }
}

/**
 * Parse currencies array from currencies.ts
 */
async function parseCurrenciesFile() {
  const filePath = join(rootDir, 'packages/loot-core/src/shared/currencies.ts');
  const content = await readFile(filePath, 'utf-8');

  // Extract the currencies array using regex
  const match = content.match(
    /export const currencies: Currency\[\] = \[([\s\S]*?)\];/,
  );
  if (!match) {
    throw new Error('Could not find currencies array in currencies.ts');
  }

  // Parse currency objects
  const arrayContent = match[1];
  const currencies = [];
  const currencyRegex =
    /\{\s*code:\s*'([^']*)'\s*,\s*name:\s*'([^']*)'\s*,\s*symbol:\s*'([^']*)'\s*,\s*decimalPlaces:\s*(\d+)\s*,\s*numberFormat:\s*'([^']*)'\s*,\s*symbolFirst:\s*(true|false)\s*\}/g;

  let currencyMatch;
  while ((currencyMatch = currencyRegex.exec(arrayContent)) !== null) {
    currencies.push({
      code: currencyMatch[1],
      name: currencyMatch[2],
      symbol: currencyMatch[3],
      decimalPlaces: parseInt(currencyMatch[4], 10),
      numberFormat: currencyMatch[5],
      symbolFirst: currencyMatch[6] === 'true',
    });
  }

  info(`Parsed ${currencies.length} currencies from currencies.ts`);
  return currencies;
}

/**
 * Parse currency translation map from Currency.tsx
 */
async function parseCurrencyTranslations() {
  const filePath = join(
    rootDir,
    'packages/desktop-client/src/components/settings/Currency.tsx',
  );
  const content = await readFile(filePath, 'utf-8');

  // Extract the Map constructor content
  const match = content.match(/new Map<string, string>\(\[([\s\S]*?)\]\)/);
  if (!match) {
    throw new Error('Could not find currencyTranslations Map in Currency.tsx');
  }

  const mapContent = match[1];
  const translations = new Map();
  const entryRegex = /\['([^']*)',\s*t\('([^']*)'\)\]/g;

  let entryMatch;
  while ((entryMatch = entryRegex.exec(mapContent)) !== null) {
    translations.set(entryMatch[1], entryMatch[2]);
  }

  info(`Parsed ${translations.size} translation entries from Currency.tsx`);
  return translations;
}

/**
 * Normalize name for comparison
 */
function normalizeName(name) {
  return name
    .replace(/United Arab Emirates/g, 'UAE')
    .replace(/Złoty/g, 'Zloty');
}

/**
 * Validate a single currency against API data
 */
function validateCurrency(currency, lpData, oxrNames, errors) {
  const apiCurrency = lpData[currency.code];

  if (!apiCurrency) {
    if (currency.code === '') {
      return;
    }

    const openExchangeRatesName = oxrNames[currency.code];
    if (openExchangeRatesName != null) {
      const normalizedCurrencyName = normalizeName(currency.name);
      const normalizedOxrName = normalizeName(openExchangeRatesName);

      if (normalizedCurrencyName !== normalizedOxrName) {
        errors.push(
          `${currency.code}: name mismatch - expected '${openExchangeRatesName}', got '${currency.name}'`,
        );
      }

      return;
    }

    errors.push(`Currency ${currency.code} not found in LocalePlanet API`);
    return;
  }

  // Validate decimal places
  if (currency.decimalPlaces !== apiCurrency.decimal_digits) {
    errors.push(
      `${currency.code}: decimalPlaces mismatch - expected ${apiCurrency.decimal_digits}, got ${currency.decimalPlaces}`,
    );
  }

  // Validate name (must match one of the two source names exactly,
  // allowing only explicit normalization replacements)
  const normalizedCurrencyName = normalizeName(currency.name);
  const localePlanetName = apiCurrency.name;
  const openExchangeRatesName = oxrNames[currency.code];

  const matchesLocalePlanet =
    normalizedCurrencyName === normalizeName(localePlanetName);
  const matchesOpenExchangeRates =
    openExchangeRatesName != null &&
    normalizedCurrencyName === normalizeName(openExchangeRatesName);

  if (!matchesLocalePlanet && !matchesOpenExchangeRates) {
    const expectedNames =
      openExchangeRatesName != null &&
      openExchangeRatesName !== localePlanetName
        ? `'${localePlanetName}' or '${openExchangeRatesName}'`
        : `'${localePlanetName}'`;

    errors.push(
      `${currency.code}: name mismatch - expected ${expectedNames}, got '${currency.name}'`,
    );
  }

  // Validate symbol
  if (currency.code === 'THB' && currency.symbol === '฿') {
    return;
  }

  if (apiCurrency.symbol_native === '$') {
    // When native symbol is $, allow the disambiguated API symbol and
    // selected abbreviation-style alternatives.
    const acceptedSymbols = [
      apiCurrency.symbol,
      ...(alternateDollarSymbols[currency.code] ?? []),
    ];

    if (!acceptedSymbols.includes(currency.symbol)) {
      const expectedSymbols = acceptedSymbols
        .map(symbol => `'${symbol}'`)
        .join(' or ');
      errors.push(
        `${currency.code}: symbol mismatch (native is $) - expected ${expectedSymbols}, got '${currency.symbol}'`,
      );
    }
  } else {
    // Otherwise, should match symbol_native
    if (currency.symbol !== apiCurrency.symbol_native) {
      errors.push(
        `${currency.code}: symbol mismatch - expected '${apiCurrency.symbol_native}', got '${currency.symbol}'`,
      );
    }
  }
}

/**
 * Check if currencies are in alphabetical order
 */
function checkAlphabeticalOrder(currencies) {
  const codes = currencies.map(c => c.code);
  const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b));

  for (let i = 0; i < codes.length; i++) {
    if (codes[i] !== sortedCodes[i]) {
      return {
        valid: false,
        message: `Currencies not in alphabetical order: found '${codes[i]}' at position ${i}, expected '${sortedCodes[i]}'`,
      };
    }
  }

  return { valid: true };
}

/**
 * Check translation coverage
 */
function checkTranslationCoverage(currencies, translations) {
  const missing = [];
  const mismatched = [];

  for (const currency of currencies) {
    if (!translations.has(currency.code)) {
      missing.push(currency.code);
    } else {
      const translationName = translations.get(currency.code);
      if (!translationName || translationName.trim() === '') {
        mismatched.push(`${currency.code}: translation is empty`);
      } else if (translationName !== currency.name) {
        mismatched.push(
          `${currency.code}: translation mismatch - expected '${currency.name}', got '${translationName}'`,
        );
      }
    }
  }

  return { missing, mismatched };
}

/**
 * Main validation function
 */
async function main() {
  try {
    log('\n🔍 Starting currency validation...\n', 'cyan');

    // Load all data
    const [lpData, oxrNames, currencies, translations] = await Promise.all([
      fetchCurrencyData(),
      fetchOpenExchangeRatesNames(),
      parseCurrenciesFile(),
      parseCurrencyTranslations(),
    ]);

    const errors = [];

    // Check 1: Alphabetical order
    info('Checking alphabetical order...');
    const orderCheck = checkAlphabeticalOrder(currencies);
    if (!orderCheck.valid) {
      errors.push(orderCheck.message);
      error(orderCheck.message);
    } else {
      success('Currencies are in alphabetical order');
    }

    // Check 2: Translation coverage
    info('Checking translation coverage...');
    const coverageCheck = checkTranslationCoverage(currencies, translations);
    if (coverageCheck.missing.length > 0) {
      const msg = `Missing translations for currencies: ${coverageCheck.missing.join(', ')}`;
      errors.push(msg);
      error(msg);
    }
    if (coverageCheck.mismatched.length > 0) {
      coverageCheck.mismatched.forEach(msg => {
        errors.push(msg);
        error(msg);
      });
    }
    if (
      coverageCheck.missing.length === 0 &&
      coverageCheck.mismatched.length === 0
    ) {
      success('All currencies have translations');
    }

    // Check 3: Validate each currency against API
    info('Validating currency metadata...');
    for (const currency of currencies) {
      validateCurrency(currency, lpData, oxrNames, errors);
    }
    if (errors.length === 0) {
      success('All currency metadata is valid');
    }

    // Summary
    log('\n' + '='.repeat(60), 'cyan');
    if (errors.length === 0) {
      success('✨ All validation checks passed!');
      log('='.repeat(60) + '\n', 'cyan');
      process.exit(0);
    } else {
      error(`Found ${errors.length} validation error(s):`);
      errors.forEach((err, i) => {
        log(`  ${i + 1}. ${err}`, 'yellow');
      });
      log('='.repeat(60) + '\n', 'cyan');
      process.exit(1);
    }
  } catch (err) {
    error(`Validation failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
