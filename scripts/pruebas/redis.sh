#!/usr/bin/env bash
# =============================================================================
# REDIS DE PRUEBAS en Docker: pruebas-redis en 127.0.0.1:6479.
# Nombre «pruebas-*», NUNCA «tessera-*» (el barrido de Tessera borra esos).
# El puerto no es el 6379 de fábrica a propósito: en esta máquina ya hay otro Redis ahí.
#
# Uso:
#   scripts/pruebas/redis.sh levantar [--de-cero]   crea o arranca y siembra (idempotente)
#   scripts/pruebas/redis.sh correr <orden...>       corre la orden con el destino en el entorno
#     p. ej.: scripts/pruebas/redis.sh correr npm run -s test:db-redis
#
# POR QUÉ `redis:8`. Desde la 8, la imagen oficial trae JSON, búsqueda, series temporales y
# los probabilísticos DENTRO (antes eran redis-stack), así que el tipo `ReJSON-RL` del visor
# por tipo (D5) se puede probar con el mismo contenedor. Valkey es compatible en lo demás
# pero sin JSON salvo su imagen «bundle»; si hiciera falta probarlo, IMAGEN=valkey/valkey:8.
#
# Usuarios (ACL): `default` con la clave (el `requirepass` de siempre, AUTH <clave>), `tessera`
# con todo, y `lector` con solo lo de lectura (+@read +@connection, sin @dangerous salvo
# INFO): la garantía real del solo lectura, igual que el `db_datareader` de SQL Server.
# Variables que pone `correr` (URI estándar redis://usuario:clave@host:puerto/base):
#   TESSERA_TEST_REDIS         = redis://tessera:<clave>@127.0.0.1:6479/0
#   TESSERA_TEST_REDIS_LECTOR  = redis://lector:<clave>@127.0.0.1:6479/0
#   TESSERA_TEST_REDIS_DEFAULT = redis://:<clave>@127.0.0.1:6479/0     (AUTH sin usuario)
# La clave sale de `redis-pw.txt` (ver comun.sh), se genera si falta y nunca se imprime.
# Va en la línea de órdenes del contenedor (`--requirepass`), así que `docker inspect` la
# enseña: es la misma exposición que el MSSQL_SA_PASSWORD de mssql.sh, y es de pruebas.
#
# MAC (sin verificar): la imagen oficial es multiarquitectura; corre nativa en Apple Silicon.
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
NOMBRE=pruebas-redis
PUERTO=6479
IMAGEN="${IMAGEN:-redis:8.2}"
SIEMBRA="$(dirname "${BASH_SOURCE[0]}")/redis-siembra.txt"

cli() {
  local pw="$1"; shift
  MSYS_NO_PATHCONV=1 docker exec -i -e "REDISCLI_AUTH=$pw" "$NOMBRE" redis-cli "$@"
}

levantar() {
  asegurar_clave redis-pw.txt
  local pw; pw="$(leer_secreto redis-pw.txt)" || return 1
  if [ "${1:-}" = "--de-cero" ]; then docker rm -f -v "$NOMBRE" >/dev/null 2>&1; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then
    docker start "$NOMBRE" >/dev/null
  else
    MSYS_NO_PATHCONV=1 docker run -d --name "$NOMBRE" -p "127.0.0.1:$PUERTO:6379" "$IMAGEN" \
      redis-server --requirepass "$pw" --appendonly no >/dev/null \
      || { echo "no arrancó $NOMBRE"; return 1; }
  fi
  local listo=0
  for i in $(seq 1 30); do
    if [ "$(cli "$pw" PING 2>/dev/null)" = "PONG" ]; then listo=1; break; fi
    sleep 1
  done
  [ "$listo" = 1 ] || { echo "$NOMBRE no contesta tras 30 s"; docker logs --tail 20 "$NOMBRE"; return 1; }
  # Los usuarios, con la clave por argumento de ACL SETUSER: redis-cli la recibe por el
  # exec, no por un guion en disco.
  cli "$pw" ACL SETUSER tessera reset on ">$pw" '~*' '&*' +@all >/dev/null
  cli "$pw" ACL SETUSER lector reset on ">$pw" '~*' '&*' +@read +@connection -@dangerous +info >/dev/null
  cli "$pw" < "$SIEMBRA" >/dev/null || { echo "la siembra falló"; return 1; }
  # 5 000 claves para el SCAN paginado, en un solo EVAL (un viaje, no 5 000).
  cli "$pw" EVAL "for i=0,4999 do redis.call('SET', 'grande:' .. string.format('%04d', i), i) end return 1" 0 >/dev/null
  echo "$NOMBRE listo en 127.0.0.1:$PUERTO (bases 0 y 1; usuarios default, tessera, lector)"
}

correr() {
  local pw; pw="$(leer_secreto redis-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  TESSERA_TEST_REDIS="redis://tessera:${pw}@127.0.0.1:${PUERTO}/0" \
  TESSERA_TEST_REDIS_LECTOR="redis://lector:${pw}@127.0.0.1:${PUERTO}/0" \
  TESSERA_TEST_REDIS_DEFAULT="redis://:${pw}@127.0.0.1:${PUERTO}/0" \
    "$@" 2>&1 | sed "s/${pw}/<clave>/g"
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) shift; levantar "$@" ;;
  correr) shift; correr "$@" ;;
  *) echo "uso: redis.sh levantar [--de-cero] | correr <orden...>"; exit 2 ;;
esac
