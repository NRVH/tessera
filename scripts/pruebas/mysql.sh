#!/usr/bin/env bash
# =============================================================================
# MYSQL Y MARIADB DE PRUEBAS en Docker: pruebas-mysql en 127.0.0.1:13306 (MySQL 8.4 LTS) y
# pruebas-mariadb en 127.0.0.1:13307 (MariaDB 11.8 LTS).
# Nombre «pruebas-*», NUNCA «tessera-*» (el barrido de Tessera borra esos).
#
# Uso:
#   scripts/pruebas/mysql.sh levantar [--de-cero]   crea o arranca los dos y siembra (idempotente)
#   scripts/pruebas/mysql.sh correr <orden...>       corre la orden con los destinos en el entorno
#     p. ej.: scripts/pruebas/mysql.sh correr npm run -s test:db-mysql
#
# Siembra (`mysql-siembra.sql`): bases `pruebas` y `otra`; en `pruebas`, tablas con todos los
# tipos propios, una vista, un procedimiento, una función, un disparador y un evento. Usuarios
# `tessera` (todo sobre las dos bases) y `lector` (solo SELECT y SHOW VIEW: la garantía real
# del solo lectura). Los dos servidores cifran con su certificado autogenerado.
# Variables que pone `correr` (formato de `destinoDePrueba` en src/tdb/mysqlComun.cjs):
#   TESSERA_TEST_MYSQL          = tessera/<clave>@127.0.0.1:13306/pruebas
#   TESSERA_TEST_MYSQL_LECTOR   = lector/<clave>@127.0.0.1:13306/pruebas
#   TESSERA_TEST_MARIADB        = tessera/<clave>@127.0.0.1:13307/pruebas
#   TESSERA_TEST_MARIADB_LECTOR = lector/<clave>@127.0.0.1:13307/pruebas
# La clave sale de `mysql-pw.txt` (ver comun.sh), se genera si falta y nunca se imprime.
#
# MAC: las dos imágenes son multiarquitectura (arm64 nativo).
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
MYSQL_NOMBRE=pruebas-mysql
MYSQL_PUERTO=13306
MYSQL_IMAGEN="${MYSQL_IMAGEN:-mysql:8.4}"
MARIADB_NOMBRE=pruebas-mariadb
MARIADB_PUERTO=13307
MARIADB_IMAGEN="${MARIADB_IMAGEN:-mariadb:11.8}"

# El cliente de línea de órdenes de cada imagen (MariaDB 11 ya no trae el nombre `mysql`).
cliente_de() {
  case "$1" in
    "$MARIADB_NOMBRE") echo mariadb ;;
    *) echo mysql ;;
  esac
}

# SQL por la entrada estándar contra el contenedor $1, como root y con la clave por el ENTORNO.
sql_root() {
  local nombre="$1" pw="$2"; shift 2
  MSYS_NO_PATHCONV=1 docker exec -i -e "MYSQL_PWD=$pw" "$nombre" "$(cliente_de "$nombre")" -uroot "$@"
}

levantar_uno() {
  local nombre="$1" puerto="$2" imagen="$3" pw="$4" de_cero="$5"
  if [ "$de_cero" = "--de-cero" ]; then docker rm -f -v "$nombre" >/dev/null 2>&1; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$nombre"; then
    docker start "$nombre" >/dev/null
  else
    local env_root=MYSQL_ROOT_PASSWORD
    [ "$nombre" = "$MARIADB_NOMBRE" ] && env_root=MARIADB_ROOT_PASSWORD
    MSYS_NO_PATHCONV=1 docker run -d --name "$nombre" -e "$env_root=$pw" \
      -p "127.0.0.1:$puerto:3306" "$imagen" >/dev/null || { echo "no arrancó $nombre"; return 1; }
  fi
  local listo=0
  for i in $(seq 1 90); do
    if echo "SELECT 1" | sql_root "$nombre" "$pw" >/dev/null 2>&1; then listo=1; break; fi
    sleep 2
  done
  [ "$listo" = 1 ] || { echo "$nombre no contesta tras 180 s"; docker logs --tail 20 "$nombre"; return 1; }
  sql_root "$nombre" "$pw" < "$(dirname "${BASH_SOURCE[0]}")/mysql-siembra.sql" >/dev/null \
    || { echo "la siembra de $nombre falló"; return 1; }
  # Los usuarios, con la clave por la entrada estándar: nunca en un archivo ni en la línea de órdenes.
  printf "%s\n" \
    "CREATE USER IF NOT EXISTS 'tessera'@'%' IDENTIFIED BY '$pw';" \
    "CREATE USER IF NOT EXISTS 'lector'@'%' IDENTIFIED BY '$pw';" \
    "GRANT ALL PRIVILEGES ON pruebas.* TO 'tessera'@'%';" \
    "GRANT ALL PRIVILEGES ON otra.* TO 'tessera'@'%';" \
    "GRANT PROCESS ON *.* TO 'tessera'@'%';" \
    "GRANT SELECT, SHOW VIEW ON pruebas.* TO 'lector'@'%';" \
    "FLUSH PRIVILEGES;" | sql_root "$nombre" "$pw" >/dev/null || { echo "los usuarios de $nombre fallaron"; return 1; }
  # Ver el cuerpo de las rutinas que creó root (el «Ver DDL» y la fuente): un privilegio que cada
  # servidor llama a su manera.
  if [ "$nombre" = "$MARIADB_NOMBRE" ]; then
    echo "GRANT SHOW CREATE ROUTINE ON pruebas.* TO 'tessera'@'%';" | sql_root "$nombre" "$pw" >/dev/null
  else
    echo "GRANT SHOW_ROUTINE ON *.* TO 'tessera'@'%';" | sql_root "$nombre" "$pw" >/dev/null
  fi
  echo "$nombre listo en 127.0.0.1:$puerto (bases pruebas y otra; usuarios root, tessera, lector)"
}

levantar() {
  asegurar_clave mysql-pw.txt
  local pw; pw="$(leer_secreto mysql-pw.txt)" || return 1
  levantar_uno "$MYSQL_NOMBRE" "$MYSQL_PUERTO" "$MYSQL_IMAGEN" "$pw" "${1:-}" || return 1
  levantar_uno "$MARIADB_NOMBRE" "$MARIADB_PUERTO" "$MARIADB_IMAGEN" "$pw" "${1:-}" || return 1
}

correr() {
  local pw; pw="$(leer_secreto mysql-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  TESSERA_TEST_MYSQL="tessera/${pw}@127.0.0.1:${MYSQL_PUERTO}/pruebas" \
  TESSERA_TEST_MYSQL_LECTOR="lector/${pw}@127.0.0.1:${MYSQL_PUERTO}/pruebas" \
  TESSERA_TEST_MARIADB="tessera/${pw}@127.0.0.1:${MARIADB_PUERTO}/pruebas" \
  TESSERA_TEST_MARIADB_LECTOR="lector/${pw}@127.0.0.1:${MARIADB_PUERTO}/pruebas" \
    "$@" 2>&1 | sed "s/${pw}/<clave>/g"
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) shift; levantar "$@" ;;
  correr) shift; correr "$@" ;;
  *) echo "uso: mysql.sh levantar [--de-cero] | correr <orden...>"; exit 2 ;;
esac
