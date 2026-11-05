#!/usr/bin/env bash
# Postgres local só para os testes (porta 54329, pasta .pgtest/ no projeto, sem senha).
# Uso: tests/db/pg.sh start | stop
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
DADOS="${PGTEST_DIR:-$RAIZ/.pgtest}"
PORTA="${PGTEST_PORT:-54329}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$BIN/pg_ctl" ] || { echo "Postgres não encontrado (instale postgresql)"; exit 1; }
# o Postgres não roda como root: usa o usuário postgres quando necessário
roda() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    mkdir -p "$DADOS"; [ "$(id -u)" = 0 ] && chown postgres "$DADOS"
    if [ ! -f "$DADOS/PG_VERSION" ]; then
      roda "'$BIN/initdb' -D '$DADOS' -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    if roda "'$BIN/pg_ctl' -D '$DADOS' status" >/dev/null 2>&1; then echo "Postgres de teste já está ligado (porta $PORTA)"; exit 0; fi
    roda "'$BIN/pg_ctl' -D '$DADOS' -o '-p $PORTA -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off' -l '$DADOS/log.txt' -w start" >/dev/null
    echo "Postgres de teste ligado (porta $PORTA)";;
  stop)
    roda "'$BIN/pg_ctl' -D '$DADOS' -m fast stop" >/dev/null 2>&1 || true; echo "Postgres de teste desligado";;
  *) echo "uso: $0 start|stop"; exit 1;;
esac
