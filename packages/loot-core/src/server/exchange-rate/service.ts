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
          'No OpenExchangeRates App ID configured. Exchange rates will be limited to major currencies. ' +
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

    if (!this.periodicUpdatesStarted) {
      this.periodicUpdatesStarted = true;
      this.startPeriodicUpdate().catch(error => {
        logger.error('Failed to start periodic rate updates:', error);
        this.periodicUpdatesStarted = false;
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
    const currencies = new Set<string>();

    return Array.from(currencies);
  }

  async startPeriodicUpdate(): Promise<void> {
    try {
      const baseCurrency = await db.first<{ value: string }>(
        'SELECT value FROM preferences WHERE id = ?',
        ['defaultCurrencyCode'],
      );

      if (!baseCurrency) {
        setTimeout(() => this.startPeriodicUpdate(), 60000);
        return;
      }

      const targetCurrencies = await this.getUsedCurrencies();

      if (targetCurrencies.length > 0) {
        await this.fetchAndCacheRates(baseCurrency.value, targetCurrencies);
      }

      const nextUpdateDelay = await this.getNextUpdateDelay();
      setTimeout(() => this.startPeriodicUpdate(), nextUpdateDelay);
    } catch (error) {
      logger.error('Error in periodic update:', error);
      setTimeout(() => this.startPeriodicUpdate(), 300000);
    }
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
