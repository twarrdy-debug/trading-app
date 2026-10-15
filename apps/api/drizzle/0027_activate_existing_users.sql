-- Accounts created before e-mail activation became required stay usable: they count as activated.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
