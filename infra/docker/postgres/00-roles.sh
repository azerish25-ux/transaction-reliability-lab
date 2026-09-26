#!/usr/bin/env bash
set -Eeuo pipefail
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${LEDGER_OWNER_PASSWORD:?LEDGER_OWNER_PASSWORD is required}"
: "${LEDGER_RUNTIME_PASSWORD:?LEDGER_RUNTIME_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=database_name="$POSTGRES_DB" \
  --set=owner_password="$LEDGER_OWNER_PASSWORD" \
  --set=runtime_password="$LEDGER_RUNTIME_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE ledger_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',
  :'owner_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ledger_owner') \gexec
SELECT format('ALTER ROLE ledger_owner PASSWORD %L', :'owner_password') \gexec

SELECT format(
  'CREATE ROLE ledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',
  :'runtime_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ledger_runtime') \gexec
SELECT format('ALTER ROLE ledger_runtime PASSWORD %L', :'runtime_password') \gexec

GRANT CONNECT, TEMPORARY, CREATE ON DATABASE :"database_name" TO ledger_owner;
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name" TO ledger_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO ledger_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
