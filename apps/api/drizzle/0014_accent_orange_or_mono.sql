-- Only two accents remain: orange (#FFB020) and monochrome (#FFFFFF). The old near-white neutral
-- becomes monochrome; every other colour becomes orange.
UPDATE "users"
SET "accent_color" = CASE WHEN upper("accent_color") IN ('#E8EDF2', '#FFFFFF') THEN '#FFFFFF' ELSE '#FFB020' END
WHERE "accent_color" IS NOT NULL AND upper("accent_color") NOT IN ('#FFB020', '#FFFFFF');
