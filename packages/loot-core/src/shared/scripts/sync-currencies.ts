/**
 * Script to sync currencies.ts with openexchangerates.org supported currencies.
 *
 * Usage: npx tsx packages/loot-core/src/shared/scripts/sync-currencies.ts
 *
 * This script will:
 * 1. Fetch the current list of supported currencies from openexchangerates.org
 * 2. Compare with the currencies defined in currencies.ts
 * 3. Report any missing or extra currencies
 * 4. Optionally show suggested changes (with --update flag)
 */

/* eslint-disable actual/typography */

import { currencies, type Currency } from '../currencies';

const OPENEXCHANGERATES_URL =
  'https://openexchangerates.org/api/currencies.json?prettyprint=false&show_alternative=false&show_inactive=false';

const LOCALEPLANET_URL =
  'https://www.localeplanet.com/api/auto/currencymap.json?name=Y';

type LocalePlanetCurrency = {
  name: string;
  decimal_digits: number;
  symbol_native: string;
  symbol: string;
};

// Currencies marked as deprecated in openexchangerates
// (shown with * on https://docs.openexchangerates.org/reference/supported-currencies)
// These are in openexchangerates but may be removed in the future
const DEPRECATED_CURRENCIES = new Set([
  'ANG', // Netherlands Antillean Guilder
  'SLL', // Sierra Leonean Leone (Old)
  'STD', // São Tomé and Príncipe Dobra (pre-2018)
  'VEF', // Venezuelan Bolívar Fuerte (Old)
  'ZWL', // Zimbabwean Dollar
]);

// Currencies where our symbol intentionally differs from localeplanet's native symbol
// These are excluded from the symbol mismatch check
const EXPECTED_SYMBOL_MISMATCHES = new Map<string, string>([
  ['CLF', 'Uses "UF" (Unidad de Fomento) - standard Chilean abbreviation'],
  ['CNH', 'Uses "CN¥" to disambiguate offshore yuan from CNY'],
  ['CUC', 'Uses "CUC$" for disambiguation; localeplanet just has code "CUC"'],
  ['CVE', 'Uses "Esc" (Escudo); localeplanet has empty/whitespace symbol'],
  [
    'JPY',
    'Uses half-width "¥" (U+00A5) for universal compatibility; localeplanet has fullwidth "￥" (U+FFE5)',
  ],
  ['RON', 'Uses "lei" (plural form)'],
  ['RSD', 'Uses "дин" (Cyrillic for dinar) - standard Serbian notation'],
  [
    'SOS',
    'Uses "Sh.So." (Somali Shilling) for clarity; localeplanet has just "S"',
  ],
  ['THB', 'Uses native "฿" symbol; localeplanet has code "THB" as symbol'],
  ['UYU', 'Uses "$U" - standard Uruguayan peso notation'],
  [
    'VEF',
    'Uses "Bs.F" (Bolívar Fuerte); deprecated currency with minor difference',
  ],
]);

async function fetchOpenExchangeRatesCurrencies(): Promise<
  Record<string, string>
> {
  const response = await fetch(OPENEXCHANGERATES_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch currencies: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

async function fetchLocalePlanetCurrencies(): Promise<
  Record<string, LocalePlanetCurrency>
> {
  const response = await fetch(LOCALEPLANET_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch localeplanet data: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function getLocalCurrencies(): Map<string, Currency> {
  const currencyMap = new Map<string, Currency>();
  for (const currency of currencies) {
    if (currency.code !== '') {
      currencyMap.set(currency.code, currency);
    }
  }
  return currencyMap;
}

function generateCurrencyEntry(
  code: string,
  name: string,
  localePlanetData?: LocalePlanetCurrency,
): string {
  const lpData = localePlanetData;
  const currencyName = lpData?.name || name;
  let symbol = lpData?.symbol_native || code;
  const decimalPlaces = lpData?.decimal_digits ?? 2;

  // Disambiguate common symbols by prefixing with country code
  // e.g., AUD -> AU$, CAD -> CA$, FKP -> FK£, GIP -> GI£
  // Keep USD as plain $ and GBP as plain £ (base currencies)
  if (symbol === '$' && code !== 'USD') {
    const prefix = code.slice(0, 2);
    symbol = `${prefix}$`;
  } else if (symbol === '£' && code !== 'GBP') {
    const prefix = code.slice(0, 2);
    symbol = `${prefix}£`;
  }

  return `{ code: '${code}', name: '${currencyName}', symbol: '${symbol}', decimalPlaces: ${decimalPlaces}, numberFormat: 'comma-dot', symbolFirst: true }, // TODO: Review numberFormat and symbolFirst`;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldUpdate = args.includes('--update');

  console.log('Fetching currencies from openexchangerates.org...');
  const oxrCurrencies = await fetchOpenExchangeRatesCurrencies();
  const oxrCodes = new Set(Object.keys(oxrCurrencies));

  console.log(`Found ${oxrCodes.size} currencies from openexchangerates.org\n`);

  console.log('Fetching currency metadata from localeplanet.com...');
  const localePlanetCurrencies = await fetchLocalePlanetCurrencies();
  console.log(
    `Found ${Object.keys(localePlanetCurrencies).length} currencies from localeplanet.com\n`,
  );

  console.log('Loading currencies from currencies.ts...');
  const localCurrencies = getLocalCurrencies();
  const localCodes = new Set(localCurrencies.keys());

  console.log(`Found ${localCodes.size} currencies in currencies.ts\n`);

  // Check for duplicate currency codes
  const seenCodes = new Map<string, Currency[]>();
  for (const currency of currencies) {
    if (currency.code === '') continue;
    const existing = seenCodes.get(currency.code) || [];
    existing.push(currency);
    seenCodes.set(currency.code, existing);
  }

  const duplicates = [...seenCodes.entries()].filter(
    ([, entries]) => entries.length > 1,
  );

  if (duplicates.length > 0) {
    console.log(`❌ Duplicate currency codes found (${duplicates.length}):\n`);
    for (const [code, entries] of duplicates.sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      console.log(`   ${code} appears ${entries.length} times:`);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(
          `     [${i + 1}] name: "${entry.name}", symbol: "${entry.symbol}", decimalPlaces: ${entry.decimalPlaces}, numberFormat: "${entry.numberFormat}", symbolFirst: ${entry.symbolFirst}`,
        );
      }
      console.log();
    }
  } else {
    console.log('✅ No duplicate currencies\n');
  }

  // Find missing currencies (in OXR but not in local)
  const missingCurrencies: string[] = [];
  for (const code of oxrCodes) {
    if (!localCodes.has(code)) {
      missingCurrencies.push(code);
    }
  }

  // Find extra currencies (in local but not in OXR)
  const extraCurrencies: string[] = [];
  for (const code of localCodes) {
    if (!oxrCodes.has(code)) {
      extraCurrencies.push(code);
    }
  }

  // Report results
  if (missingCurrencies.length > 0) {
    console.log(
      '❌ Missing currencies (in openexchangerates but not in currencies.ts):',
    );
    for (const code of missingCurrencies.sort()) {
      const name = oxrCurrencies[code];
      const isDeprecated = DEPRECATED_CURRENCIES.has(code);
      console.log(`   ${code}: ${name}${isDeprecated ? ' (deprecated)' : ''}`);
    }
    console.log();
  } else {
    console.log('✅ No missing currencies\n');
  }

  if (extraCurrencies.length > 0) {
    console.log(
      '❌ Extra currencies (in currencies.ts but not in openexchangerates):',
    );
    for (const code of extraCurrencies.sort()) {
      const currency = localCurrencies.get(code);
      console.log(`   ${code}: ${currency?.name}`);
    }
    console.log();
  } else {
    console.log('✅ No extra currencies\n');
  }

  // Check for deprecated currencies still in use
  const deprecatedInUse: string[] = [];
  for (const code of DEPRECATED_CURRENCIES) {
    if (localCodes.has(code)) {
      deprecatedInUse.push(code);
    }
  }

  if (deprecatedInUse.length > 0) {
    console.log('⚠️  Deprecated currencies still in currencies.ts:');
    for (const code of deprecatedInUse.sort()) {
      const currency = localCurrencies.get(code);
      console.log(`   ${code}: ${currency?.name}`);
    }
    console.log(
      '   (These are still in openexchangerates but may be removed in the future)\n',
    );
  }

  // Summary
  const isInSync =
    missingCurrencies.length === 0 && extraCurrencies.length === 0;
  if (isInSync) {
    console.log('✅ currencies.ts is in sync with openexchangerates.org!');

    // Check for symbol mismatches with localeplanet data
    console.log('\nChecking symbol accuracy against localeplanet.com...');

    const symbolMismatches: Array<{
      code: string;
      current: string;
      expected: string;
    }> = [];

    for (const [code, currency] of localCurrencies) {
      // Skip currencies with expected/intentional mismatches
      if (EXPECTED_SYMBOL_MISMATCHES.has(code)) {
        continue;
      }

      const lpData = localePlanetCurrencies[code];
      if (lpData?.symbol_native) {
        // Use endsWith to handle disambiguated symbols (e.g., A$ ends with $)
        if (!currency.symbol.endsWith(lpData.symbol_native)) {
          symbolMismatches.push({
            code,
            current: currency.symbol,
            expected: lpData.symbol_native,
          });
        }
      }
    }

    if (symbolMismatches.length > 0) {
      console.log(
        `\n⚠️  Symbol mismatches (${symbolMismatches.length} currencies):`,
      );
      for (const { code, current, expected } of symbolMismatches.sort((a, b) =>
        a.code.localeCompare(b.code),
      )) {
        console.log(
          `   ${code}: current "${current}" does not end with native "${expected}"`,
        );
      }
      console.log(
        '\n   (Add intentional mismatches to EXPECTED_SYMBOL_MISMATCHES with reasoning)',
      );
    } else {
      console.log('\n✅ All symbols match localeplanet native symbols');
    }

    if (EXPECTED_SYMBOL_MISMATCHES.size > 0) {
      console.log(
        `\nℹ️  ${EXPECTED_SYMBOL_MISMATCHES.size} currencies have intentional symbol differences (see EXPECTED_SYMBOL_MISMATCHES)`,
      );
    }
  } else {
    console.log('📋 Summary:');
    console.log(`   Missing: ${missingCurrencies.length} currencies`);
    console.log(`   Extra: ${extraCurrencies.length} currencies`);

    if (shouldUpdate) {
      console.log('\n🔧 Suggested changes:');

      if (missingCurrencies.length > 0) {
        console.log('\nAdd these entries to currencies.ts:');
        for (const code of missingCurrencies.sort()) {
          console.log(
            generateCurrencyEntry(
              code,
              oxrCurrencies[code],
              localePlanetCurrencies[code],
            ),
          );
        }
      }

      if (extraCurrencies.length > 0) {
        console.log('\nRemove these currency codes from currencies.ts:');
        for (const code of extraCurrencies.sort()) {
          console.log(`   ${code}`);
        }
      }
    } else {
      console.log('\nRun with --update flag to see suggested changes.');
    }
  }
}

main().catch(console.error);
