#!/usr/bin/env bash
# =============================================================================
# SQL SERVER DE PRUEBAS en Docker: pruebas-mssql en 127.0.0.1:14333.
# Nombre «pruebas-*», NUNCA «tessera-*» (el barrido de Tessera borra esos).
#
# Uso:
#   scripts/pruebas/mssql.sh levantar [--de-cero]   crea o arranca y siembra (idempotente)
#   scripts/pruebas/mssql.sh correr <orden...>       corre la orden con el destino en el entorno
#     p. ej.: scripts/pruebas/mssql.sh correr npm run -s test:db-sqlserver
#
# Siembra: base `pruebas`, login/usuario `tessera` (db_owner), `lector` (solo db_datareader:
# la garantía real del solo lectura) y dbo.t con 3 filas. Variables que ponen `correr`:
#   TESSERA_TEST_MSSQL        = tessera/<clave>@127.0.0.1:14333/pruebas
#   TESSERA_TEST_MSSQL_LECTOR = lector/<clave>@127.0.0.1:14333/pruebas
#   TESSERA_TEST_MSSQL_SA     = sa/<clave>@127.0.0.1:14333
# (formato de `destinoDePrueba` en src/tdb/sqlserverComun.cjs; la clave no lleva «/» ni «@»).
# La clave sale de `mssql-pw.txt` (ver comun.sh), se genera si falta y nunca se imprime.
#
# MAC (sin verificar): la imagen es x86-64; en Apple Silicon va con la emulación Rosetta de
# Docker Desktop. Si 2022-latest entra en bucle de reinicios, fijar etiqueta con IMAGEN=…
# (p. ej. 2022-CU27-ubuntu-22.04, sin comprobar); OrbStack es el plan B.
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
NOMBRE=pruebas-mssql
PUERTO=14333
IMAGEN="${IMAGEN:-mcr.microsoft.com/mssql/server:2022-latest}"

levantar() {
  asegurar_clave mssql-pw.txt
  local pw; pw="$(leer_secreto mssql-pw.txt)" || return 1
  if [ "${1:-}" = "--de-cero" ]; then docker rm -f -v "$NOMBRE" >/dev/null 2>&1; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then
    docker start "$NOMBRE" >/dev/null
  else
    MSYS_NO_PATHCONV=1 docker run -d --name "$NOMBRE" --platform linux/amd64 \
      -e ACCEPT_EULA=Y -e MSSQL_PID=Developer -e "MSSQL_SA_PASSWORD=$pw" \
      -p "127.0.0.1:$PUERTO:1433" "$IMAGEN" >/dev/null || { echo "no arrancó $NOMBRE"; return 1; }
  fi
  # sqlcmd dentro del contenedor, con la clave por el ENTORNO del exec.
  sql() {
    MSYS_NO_PATHCONV=1 docker exec -i -e "SQLCMDPASSWORD=$pw" "$NOMBRE" \
      /opt/mssql-tools18/bin/sqlcmd -C -S 127.0.0.1 -U sa -b "$@"
  }
  local listo=0
  for i in $(seq 1 90); do
    if sql -Q "SELECT 1" >/dev/null 2>&1; then listo=1; break; fi
    sleep 2
  done
  [ "$listo" = 1 ] || { echo "$NOMBRE no contesta tras 180 s"; docker logs --tail 20 "$NOMBRE"; return 1; }
  # La clave entra por variable de sqlcmd ($(PW)), no escrita en el guion.
  sql -v "PW=$pw" < "$(dirname "${BASH_SOURCE[0]}")/mssql-siembra.sql" >/dev/null \
    || { echo "la siembra falló"; return 1; }
  echo "$NOMBRE listo en 127.0.0.1:$PUERTO (base pruebas; usuarios sa, tessera, lector)"
}

correr() {
  local pw; pw="$(leer_secreto mssql-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  TESSERA_TEST_MSSQL="tessera/${pw}@127.0.0.1:${PUERTO}/pruebas" \
  TESSERA_TEST_MSSQL_LECTOR="lector/${pw}@127.0.0.1:${PUERTO}/pruebas" \
  TESSERA_TEST_MSSQL_SA="sa/${pw}@127.0.0.1:${PUERTO}" \
    "$@" 2>&1 | sed "s/${pw}/<clave>/g"
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) shift; levantar "$@" ;;
  correr) shift; correr "$@" ;;
  *) echo "uso: mssql.sh levantar [--de-cero] | correr <orden...>"; exit 2 ;;
esac
