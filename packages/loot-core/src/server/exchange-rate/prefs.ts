import { type SyncedPrefs } from '../../types/prefs';
import * as db from '../db';

/**
 * Gets synced preferences from the database
 * Returns an empty object if the database is not yet initialized
 */
async function getSyncedPrefs(): Promise<SyncedPrefs> {
  // Check if database is available before querying
  if (!db.getDatabase()) {
    return {};
  }

  try {
    const prefs = await db.all<{ id: string; value: string }>(
      'SELECT id, value FROM preferences',
    );

    return prefs.reduce<SyncedPrefs>((carry, { value, id }) => {
      carry[id as keyof SyncedPrefs] = value;
      return carry;
    }, {});
  } catch (error) {
    // If any error occurs (e.g., table doesn't exist yet), return empty object
    return {};
  }
}

/**
 * Gets the OpenExchangeRates App ID if configured.
 * Returns undefined if no App ID is set.
 */
export async function getOpenExchangeRatesAppId(): Promise<string | undefined> {
  const prefs = await getSyncedPrefs();
  return prefs.openExchangeRatesAppId;
}

/**
 * Gets the MempoolSpace base URL if configured.
 * Returns the default URL if no custom URL is set.
 * Appends /api/v1 to the base URL for API calls.
 */
export async function getMempoolSpaceBaseUrl(): Promise<string> {
  const prefs = await getSyncedPrefs();
  const baseUrl = prefs.mempoolSpaceBaseUrl || 'https://mempool.space';
  return `${baseUrl}/api/v1`;
}
