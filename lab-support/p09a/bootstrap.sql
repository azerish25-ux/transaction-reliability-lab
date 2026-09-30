\set ON_ERROR_STOP on
\getenv instance_id LEDGER_LAB_INSTANCE
BEGIN;
-- The bootstrap is never part of the normal Flyway migration locations.
SELECT :'instance_id' ~ '^[a-f0-9]{32}$'
 AND current_database()='ledgerguard_lab_' || left(:'instance_id',12) AS disposable \gset
\if :disposable
\else
 \echo 'Refusing a database without the exact disposable lab identity'
 \quit 2
\endif
CREATE SCHEMA IF NOT EXISTS p09a_guard AUTHORIZATION ledger_owner;
REVOKE ALL ON SCHEMA p09a_guard FROM PUBLIC;
CREATE TABLE IF NOT EXISTS p09a_guard.instance (
 singleton integer PRIMARY KEY CHECK(singleton=1),
 instance_id text NOT NULL CHECK(instance_id ~ '^[a-f0-9]{32}$'),
 original_definition text NOT NULL,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$')
);
INSERT INTO p09a_guard.instance(singleton,instance_id,original_definition,original_sha256)
 SELECT 1, :'instance_id', definition,
 encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
 FROM (SELECT pg_get_functiondef('ledger.execute_command(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) definition) f
 ON CONFLICT(singleton) DO NOTHING;
SELECT instance_id=:'instance_id' AS matched FROM p09a_guard.instance WHERE singleton=1 \gset
\if :matched
\else
 \echo 'Refusing a different lab instance'
 \quit 2
\endif
CREATE TABLE IF NOT EXISTS p09a_guard.settlement_original (
 singleton integer PRIMARY KEY CHECK(singleton=1),
 original_definition text NOT NULL,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$')
);
INSERT INTO p09a_guard.settlement_original
 SELECT 1,definition,encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
 FROM (SELECT pg_get_functiondef('ledger.settle_event(uuid,uuid,uuid)'::regprocedure) definition) f
 ON CONFLICT(singleton) DO NOTHING;
REVOKE ALL ON p09a_guard.settlement_original FROM PUBLIC,ledger_runtime;
REVOKE ALL ON p09a_guard.instance FROM PUBLIC,ledger_runtime;
GRANT USAGE ON SCHEMA p09a_guard TO ledger_runtime;
GRANT SELECT(singleton,instance_id) ON p09a_guard.instance TO ledger_runtime;
COMMIT;
