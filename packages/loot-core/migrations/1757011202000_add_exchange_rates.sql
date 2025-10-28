-- Create exchange rates table for rate caching
CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  date TEXT NOT NULL,  -- ISO date (YYYY-MM-DD)
  timestamp TEXT NOT NULL,  -- ISO datetime when rate was fetched
  source TEXT NOT NULL, -- 'api', 'manual'
  UNIQUE(from_currency, to_currency, date)
);

-- Create index for efficient rate lookups
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, date);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_timestamp ON exchange_rates(timestamp);
