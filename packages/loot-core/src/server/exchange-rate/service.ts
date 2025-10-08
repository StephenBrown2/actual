import * as connection from '../../platform/server/connection';
import { logger } from '../../platform/server/log';
import * as db from '../db';

import { getOpenExchangeRatesAppId } from './prefs';
import { OpenExchangeRatesProvider, MempoolSpaceProvider } from './providers';
import {
  ExchangeRateProvider,
  ExchangeRateData,
  ExchangeRateEntity,
} from './types';

class ExchangeRateService {
  private providers: ExchangeRateProvider[] = [];
  private periodicUpdatesStarted = false;
  private initialFetchComplete = false;

  async initializeProviders(): Promise<void> {
    try {
      const openExchangeRatesAppId = await getOpenExchangeRatesAppId();

      this.providers = [];

      if (openExchangeRatesAppId) {
        this.providers.push(
          new OpenExchangeRatesProvider(openExchangeRatesAppId),
        );
      } else {
        logger.warn(
          'No OpenExchangeRates App ID configured. Exchange rates will be limited to major currencies ' +
            '(USD, JPY, GBP, EUR, CHF, CAD, BTC, AUD). ' +
            'Please set the openExchangeRatesAppId preference to enable full exchange rate support. ' +
            'Sign up for a free account at https://openexchangerates.org/signup',
        );
      }

      // Always include MempoolSpace provider for basic rate support
      // for USD, JPY, GBP, EUR, CHF, CAD, BTC, AUD
      this.providers.push(new MempoolSpaceProvider());
    } catch (error) {
      logger.error('Failed to initialize exchange rate providers:', error);
      // Fallback to just MempoolSpace provider on error
      this.providers = [new MempoolSpaceProvider()];
    }
  }

  async fetchAndCacheRates(
    baseCurrency: string,
    targetCurrencies: string[],
  ): Promise<void> {
    if (this.providers.length === 0) {
      await this.initializeProviders();
    }

    const fallbackTimestamp = new Date().toISOString();

    for (const provider of this.providers) {
      try {
        const rates = await provider.fetchRates(baseCurrency, targetCurrencies);

        for (const rateData of rates) {
          await this.cacheRate({
            ...rateData,
            timestamp: rateData.timestamp || fallbackTimestamp,
          });
        }
      } catch (error) {
        logger.error(`Failed to fetch rates from ${provider.name}:`, error);
      }
    }
  }

  private async cacheRate(
    rateData: ExchangeRateData & { timestamp: string },
  ): Promise<void> {
    const id = `${rateData.from_currency}-${rateData.to_currency}-${rateData.date}`;

    await db.runQuery(
      'INSERT OR REPLACE INTO exchange_rates (id, from_currency, to_currency, rate, date, timestamp, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        rateData.from_currency,
        rateData.to_currency,
        rateData.rate,
        rateData.date,
        rateData.timestamp,
        rateData.source,
      ],
    );
  }

  async getRate(
    fromCurrency: string,
    toCurrency: string,
    date?: string,
  ): Promise<number | null> {
    if (fromCurrency === toCurrency) {
      return 1.0;
    }

    // Lazy start periodic updates if not already started
    // (In case getRate is called before explicit initialization)
    if (!this.periodicUpdatesStarted) {
      this.startPeriodicUpdate()
        .then(() => {
          this.markPeriodicUpdatesStarted();
        })
        .catch(error => {
          logger.error('Failed to start periodic rate updates:', error);
          this.markPeriodicUpdatesStopped();
        });
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const isToday = targetDate === today;

    const cachedRate = await db.first<ExchangeRateEntity>(
      `SELECT * FROM exchange_rates
       WHERE from_currency = ? AND to_currency = ? AND date = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [fromCurrency, toCurrency, targetDate],
    );

    // If we have a cached rate for a historical date, use it
    if (cachedRate && !isToday) {
      return cachedRate.rate;
    }

    // If we have a cached rate for today, check if it's fresh enough
    if (cachedRate && isToday) {
      const now = new Date();
      const rateTime = new Date(cachedRate.timestamp);
      const ageLimitMs = await this.getNextUpdateDelay();

      if (now.getTime() - rateTime.getTime() < ageLimitMs) {
        // Cached rate is fresh enough
        return cachedRate.rate;
      }
    }

    // Either no cached rate exists, or today's rate is too old - fetch fresh rate
    // For historical dates, try to fetch historical rate if provider supports it
    if (!isToday) {
      for (const provider of this.providers) {
        if (provider.supportsHistory && provider.fetchHistoricalRate) {
          try {
            const rate = await provider.fetchHistoricalRate(
              fromCurrency,
              toCurrency,
              targetDate,
            );
            if (rate !== null) {
              // Cache the historical rate
              await this.cacheRate({
                from_currency: fromCurrency,
                to_currency: toCurrency,
                rate,
                date: targetDate,
                source: provider.name,
                timestamp: new Date().toISOString(),
              });
              return rate;
            }
          } catch (error) {
            logger.error(
              `Failed to fetch historical rate from ${provider.name}:`,
              error,
            );
          }
        }
      }
    }

    // For today's rate or if historical fetch failed, fetch current rate
    await this.fetchAndCacheRates(fromCurrency, [toCurrency]);

    const freshRate = await db.first<ExchangeRateEntity>(
      `SELECT * FROM exchange_rates
       WHERE from_currency = ? AND to_currency = ? AND date = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [fromCurrency, toCurrency, targetDate],
    );

    if (freshRate) {
      return freshRate.rate;
    }

    const reverseRate = await db.first<ExchangeRateEntity>(
      `SELECT * FROM exchange_rates
       WHERE from_currency = ? AND to_currency = ? AND date = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [toCurrency, fromCurrency, targetDate],
    );

    if (reverseRate && reverseRate.rate !== 0) {
      return 1 / reverseRate.rate;
    }

    return null;
  }

  async getUsedCurrencies(): Promise<string[]> {
    const defaultCurrency = await db.first<{ value: string }>(
      'SELECT value FROM preferences WHERE id = ?',
      ['defaultCurrencyCode'],
    );
    const defaultCurrencyCode = defaultCurrency?.value || '';

    const accountCurrencies = await db.runQuery<{ currency_code: string }>(
      `SELECT DISTINCT COALESCE(currency_code, ?) as currency_code FROM accounts WHERE tombstone = 0`,
      [defaultCurrencyCode],
      true,
    );

    const currencies = new Set<string>();
    accountCurrencies.forEach(
      row => row.currency_code && currencies.add(row.currency_code),
    );

    return Array.from(currencies);
  }

  markPeriodicUpdatesStarted(): void {
    this.periodicUpdatesStarted = true;
  }

  markPeriodicUpdatesStopped(): void {
    this.periodicUpdatesStarted = false;
  }

  async startPeriodicUpdate(): Promise<void> {
    if (this.periodicUpdatesStarted) {
      return;
    }

    const baseCurrency = await db.first<{ value: string }>(
      'SELECT value FROM preferences WHERE id = ?',
      ['defaultCurrencyCode'],
    );

    if (!baseCurrency) {
      setTimeout(() => {
        this.startPeriodicUpdate()
          .then(() => {
            this.markPeriodicUpdatesStarted();
          })
          .catch(error => {
            logger.error('Error in periodic update retry:', error);
            this.markPeriodicUpdatesStopped();
          });
      }, 60000);
      return;
    }

    const targetCurrencies = await this.getUsedCurrencies();

    if (targetCurrencies.length > 0) {
      // Fetch rates FROM each foreign currency TO the base currency
      // This allows SQL queries to convert account balances to the default currency
      // Note: getRate() can handle reverse lookups if needed (1/rate)
      for (const currency of targetCurrencies) {
        if (currency !== baseCurrency.value) {
          await this.fetchAndCacheRates(currency, [baseCurrency.value]);
        }
      }

      // After the initial fetch completes, trigger a sync-event to refresh
      // any converted balance queries that ran before rates were available
      if (!this.initialFetchComplete) {
        this.initialFetchComplete = true;
        logger.info(
          'Initial exchange rates fetched, triggering balance refresh',
        );
        connection.send('sync-event', {
          type: 'success',
          tables: ['accounts'],
        });
      }
    }

    const nextUpdateDelay = await this.getNextUpdateDelay();
    setTimeout(() => {
      this.startPeriodicUpdate()
        .then(() => {
          this.markPeriodicUpdatesStarted();
        })
        .catch(error => {
          logger.error('Error in periodic update:', error);
          this.markPeriodicUpdatesStopped();
        });
    }, nextUpdateDelay);
  }

  private async getNextUpdateDelay(): Promise<number> {
    // Check if OpenExchangeRates App ID is configured
    const openExchangeRatesAppId = await getOpenExchangeRatesAppId();
    const secondsInMinute = 60;
    const msInSecond = 1000;

    // Mempool.space: free API, more frequent updates are acceptable
    let minutes = 15;

    if (openExchangeRatesAppId) {
      // OpenExchangeRates free plan: 1000 requests/month
      // Polling hourly = ~720 requests/month (safe margin)
      minutes = 60; // 1 hour
    }
    return minutes * secondsInMinute * msInSecond;
  }

  async addManualRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    date?: string,
  ): Promise<void> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();

    await this.cacheRate({
      from_currency: fromCurrency,
      to_currency: toCurrency,
      rate,
      date: targetDate,
      source: 'manual',
      timestamp,
    });
  }

  async getOpenExchangeRatesUsage(): Promise<
    ReturnType<OpenExchangeRatesProvider['getUsageData']>
  > {
    const currentAppId = await getOpenExchangeRatesAppId();
    const tempProvider = new OpenExchangeRatesProvider(currentAppId);
    return await tempProvider.getUsageData();
  }
}

export const exchangeRateService = new ExchangeRateService();
