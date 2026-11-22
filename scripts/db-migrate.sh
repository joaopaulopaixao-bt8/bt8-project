#!/usr/bin/env bash
# Aplica só as migrações pendentes de supabase/migrations/ (as que não estão em
# private.schema_migrations), cada uma numa transação junto com o seu registro.
#
# Uso:
#   PSQL='<comando psql>' scripts/db-migrate.sh            # aplica as pendentes
#   PSQL='<comando psql>' scripts/db-migrate.sh --dry-run  # só lista
# Exemplos de PSQL:
#   staging local: docker exec -i supabase_db_bt8 psql -U postgres -d postgres
#   produção (no VPS, em /opt/bt8, depois do backup): docker compose exec -T db psql -U postgres -d postgres
# Sem PSQL, usa: psql "$DATABASE_URL"
set -euo pipefail

dir="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"
if [ -n "${PSQL:-}" ]; then
  read -r -a psql_cmd <<< "$PSQL"
else
  psql_cmd=(psql "${DATABASE_URL:?defina PSQL ou DATABASE_URL}")
fi
run() { "${psql_cmd[@]}" -X -q -v ON_ERROR_STOP=1 "$@"; }

ensure_table="create schema if not exists private;
create table if not exists private.schema_migrations (
  version text primary key, name text not null, applied_at timestamptz not null default now());"

if [ "${1:-}" = "--dry-run" ]; then
  applied="$(run -At -c "select version from private.schema_migrations" 2>/dev/null || true)"
else
  run -c "$ensure_table"
  applied="$(run -At -c "select version from private.schema_migrations")"
fi

pending=0
for f in "$dir"/[0-9]*.sql; do
  name="$(basename "$f")"
  version="${name%%_*}"
  if grep -qx "$version" <<< "$applied"; then continue; fi
  pending=$((pending + 1))
  if [ "${1:-}" = "--dry-run" ]; then echo "pendente: $name"; continue; fi
  echo "aplicando: $name"
  { cat "$f"; printf '\n%s\ninsert into private.schema_migrations (version, name) values (%s, %s) on conflict (version) do nothing;\n' \
      "$ensure_table" "'$version'" "'$name'"; } | run --single-transaction -f -
done

echo "migrações pendentes: $pending"
