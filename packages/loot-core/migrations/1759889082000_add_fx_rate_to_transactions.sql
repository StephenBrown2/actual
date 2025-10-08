BEGIN TRANSACTION;

-- Add fx_rate column to transactions table for foreign exchange rate tracking
-- fx_rate stores the exchange rate applied to this transaction
-- For example: if converting from USD to EUR, fx_rate would be the USD->EUR rate
-- A value of NULL, 0, or 1 indicates no foreign exchange (same currency transfer)
ALTER TABLE transactions ADD COLUMN fx_rate REAL;

COMMIT;
