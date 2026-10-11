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
#   scripts/pruebas/redis.sh levantar-sentinel [--de-cero]   pruebas-redis-sentinel (ver abajo)
#   scripts/pruebas/redis.sh correr-sentinel <orden...>
#   scripts/pruebas/redis.sh levantar-cluster [--de-cero]    pruebas-redis-cluster (ver abajo)
#   scripts/pruebas/redis.sh correr-cluster <orden...>
#   scripts/pruebas/redis.sh borrar-topologias               borra los dos contenedores de arriba
#
# SENTINEL Y CLUSTER, UN CONTENEDOR CADA UNO con todos los procesos dentro
# (`redis-sentinel-inicio.sh`, `redis-cluster-inicio.sh`). POR QUÉ: Tessera corre en el
# anfitrión y se conecta a la dirección que le DAN (el maestro que dice el sentinel, los nodos
# de CLUSTER SLOTS). Con un contenedor por nodo, esa dirección sería la IP interna de Docker,
# inalcanzable desde Windows o macOS. Con todos en el mismo espacio de red, cada nodo se anuncia
# como 127.0.0.1 y su puerto, que dentro es el propio y fuera el publicado con el mismo número.
#   Sentinel: maestro 6481, réplica 6482, sentinels 26481-26483, maestro «mimaestro»; los
#     sentinels tienen su propia clave (`redis-sentinel-pw.txt`) para probar las dos.
#   Cluster: seis nodos 6491-6496, tres maestros con una réplica cada uno.
# Variables de `correr-sentinel`: TESSERA_TEST_REDIS_SENTINEL (lista host:puerto de los
# sentinels), TESSERA_TEST_REDIS_SENTINEL_MAESTRO, TESSERA_TEST_REDIS_SENTINEL_CLAVE (la de
# Redis) y TESSERA_TEST_REDIS_SENTINEL_CLAVE_SENTINELS. De `correr-cluster`:
# TESSERA_TEST_REDIS_CLUSTER (un nodo semilla: el resto se descubre) y TESSERA_TEST_REDIS_CLUSTER_CLAVE.
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
# MAC: la imagen oficial es multiarquitectura; corre nativa en Apple Silicon.
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

# --- Sentinel y Cluster ----------------------------------------------------------------------
SENTINEL=pruebas-redis-sentinel
CLUSTER=pruebas-redis-cluster
DIR_PRUEBAS="$(dirname "${BASH_SOURCE[0]}")"

# Crea (o arranca) un contenedor con su guion de inicio dentro: `docker cp` y no un volumen, que
# en Windows obliga a traducir rutas. $1 nombre, $2 guion, $3 «--de-cero» o nada; el resto, a `docker create`.
contenedor_con_guion() {
  local nombre="$1" guion="$2" cero="$3"; shift 3
  if [ "$cero" = "--de-cero" ]; then docker rm -f -v "$nombre" >/dev/null 2>&1; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$nombre"; then
    docker start "$nombre" >/dev/null || return 1
    return 0
  fi
  MSYS_NO_PATHCONV=1 docker create --name "$nombre" "$@" "$IMAGEN" sh /inicio.sh >/dev/null || return 1
  MSYS_NO_PATHCONV=1 docker cp "$guion" "$nombre:/inicio.sh" >/dev/null || return 1
  docker start "$nombre" >/dev/null
}

# redis-cli dentro de un contenedor de topología, con la clave por el entorno. $1 contenedor, $2 clave.
cli_en() {
  local nombre="$1" pw="$2"; shift 2
  MSYS_NO_PATHCONV=1 docker exec -i -e "REDISCLI_AUTH=$pw" "$nombre" redis-cli "$@"
}

levantar_sentinel() {
  asegurar_clave redis-pw.txt
  asegurar_clave redis-sentinel-pw.txt
  local pw spw; pw="$(leer_secreto redis-pw.txt)" || return 1; spw="$(leer_secreto redis-sentinel-pw.txt)" || return 1
  contenedor_con_guion "$SENTINEL" "$DIR_PRUEBAS/redis-sentinel-inicio.sh" "${1:-}" \
    -e "PW=$pw" -e "SPW=$spw" \
    -p 127.0.0.1:6481:6481 -p 127.0.0.1:6482:6482 \
    -p 127.0.0.1:26481:26481 -p 127.0.0.1:26482:26482 -p 127.0.0.1:26483:26483 \
    || { echo "no arrancó $SENTINEL"; return 1; }
  # Listo cuando cada sentinel conoce al maestro, a la réplica y a los otros dos sentinels.
  local listo=0 i p
  for i in $(seq 1 60); do
    listo=1
    for p in 26481 26482 26483; do
      [ "$(cli_en "$SENTINEL" "$spw" -p "$p" SENTINEL REPLICAS mimaestro 2>/dev/null | grep -c '^name$')" -ge 1 ] || listo=0
      [ "$(cli_en "$SENTINEL" "$spw" -p "$p" SENTINEL SENTINELS mimaestro 2>/dev/null | grep -c '^name$')" -ge 2 ] || listo=0
    done
    [ "$listo" = 1 ] && break
    sleep 1
  done
  [ "$listo" = 1 ] || { echo "$SENTINEL no está listo tras 60 s"; docker logs --tail 20 "$SENTINEL"; return 1; }
  echo "$SENTINEL listo: sentinels 127.0.0.1:26481-26483, maestro «mimaestro» (6481/6482)"
}

levantar_cluster() {
  asegurar_clave redis-pw.txt
  local pw; pw="$(leer_secreto redis-pw.txt)" || return 1
  contenedor_con_guion "$CLUSTER" "$DIR_PRUEBAS/redis-cluster-inicio.sh" "${1:-}" \
    -e "PW=$pw" \
    -p 127.0.0.1:6491:6491 -p 127.0.0.1:6492:6492 -p 127.0.0.1:6493:6493 \
    -p 127.0.0.1:6494:6494 -p 127.0.0.1:6495:6495 -p 127.0.0.1:6496:6496 \
    || { echo "no arrancó $CLUSTER"; return 1; }
  local listo=0 i
  for i in $(seq 1 60); do
    if cli_en "$CLUSTER" "$pw" -p 6491 CLUSTER INFO 2>/dev/null | grep -q 'cluster_state:ok'; then listo=1; break; fi
    sleep 1
  done
  [ "$listo" = 1 ] || { echo "$CLUSTER no está listo tras 60 s"; docker logs --tail 20 "$CLUSTER"; return 1; }
  echo "$CLUSTER listo: nodos 127.0.0.1:6491-6496 (tres maestros con réplica)"
}

correr_sentinel() {
  local pw spw; pw="$(leer_secreto redis-pw.txt)" || return 1; spw="$(leer_secreto redis-sentinel-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  TESSERA_TEST_REDIS_SENTINEL="127.0.0.1:26481,127.0.0.1:26482,127.0.0.1:26483" \
  TESSERA_TEST_REDIS_SENTINEL_MAESTRO=mimaestro \
  TESSERA_TEST_REDIS_SENTINEL_CLAVE="$pw" \
  TESSERA_TEST_REDIS_SENTINEL_CLAVE_SENTINELS="$spw" \
    "$@" 2>&1 | sed -e "s/${pw}/<clave>/g" -e "s/${spw}/<clave-sentinels>/g"
  return "${PIPESTATUS[0]}"
}

correr_cluster() {
  local pw; pw="$(leer_secreto redis-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  TESSERA_TEST_REDIS_CLUSTER="127.0.0.1:6491" \
  TESSERA_TEST_REDIS_CLUSTER_CLAVE="$pw" \
    "$@" 2>&1 | sed "s/${pw}/<clave>/g"
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) shift; levantar "$@" ;;
  correr) shift; correr "$@" ;;
  levantar-sentinel) shift; levantar_sentinel "$@" ;;
  correr-sentinel) shift; correr_sentinel "$@" ;;
  levantar-cluster) shift; levantar_cluster "$@" ;;
  correr-cluster) shift; correr_cluster "$@" ;;
  borrar-topologias) docker rm -f -v "$SENTINEL" "$CLUSTER" >/dev/null 2>&1; echo "borrados $SENTINEL y $CLUSTER" ;;
  *) echo "uso: redis.sh levantar|levantar-sentinel|levantar-cluster [--de-cero] | correr|correr-sentinel|correr-cluster <orden...> | borrar-topologias"; exit 2 ;;
esac
