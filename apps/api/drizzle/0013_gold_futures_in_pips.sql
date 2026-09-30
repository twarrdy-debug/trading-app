-- Gold futures (GC1, MGC1): results in pips like XAUUSD. Their tick (0.10) equals the gold pip, so
-- stored numbers stay the same; only the unit changes.
UPDATE "instruments" SET "measure_unit" = 'pip' WHERE "symbol" IN ('GC1', 'MGC1') AND "measure_unit" = 'tick';
