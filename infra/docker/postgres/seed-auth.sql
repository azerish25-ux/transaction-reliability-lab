\set ON_ERROR_STOP on
\getenv demo_password LEDGER_DEMO_PASSWORD
BEGIN;
-- Only upgrade the four deliberately disabled foundation fixtures. Never reset a real registration.
-- pgcrypto's established bcrypt implementation is compatible with Spring BCryptPasswordEncoder.
UPDATE ledger.app_users
SET password_hash=extensions.crypt(:'demo_password',extensions.gen_salt('bf',12))
WHERE (id,email) IN (
 ('00000000-0000-0000-0000-000000000001'::uuid,'alice@example.test'),
 ('00000000-0000-0000-0000-000000000002'::uuid,'bob@example.test'),
 ('00000000-0000-0000-0000-000000000003'::uuid,'merchant@example.test'),
 ('00000000-0000-0000-0000-000000000004'::uuid,'admin@example.test')
) AND password_hash LIKE 'seed-password-hash-disabled-%';
COMMIT;
