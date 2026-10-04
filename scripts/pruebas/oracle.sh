#!/usr/bin/env bash
# =============================================================================
# ORACLE DE PRUEBAS en Docker: 11.2 XE (pruebas-ora11, 127.0.0.1:15211/XE) y 21c XE
# (pruebas-ora21, 127.0.0.1:15212/XEPDB1). Nombres «pruebas-*», NUNCA «tessera-*»: esos
# son de Tessera y su barrido los borra.
#
# Uso:
#   scripts/pruebas/oracle.sh levantar                 crea o arranca los dos y los siembra
#   scripts/pruebas/oracle.sh correr <11|21> <thick|thin> [script.mts]
#                                                      por defecto test-db-oracle.mts
#   scripts/pruebas/oracle.sh sql <11|21> <archivo.sql> corre un guion como SYSTEM
#
# La clave sale de `oracle-pw.txt` (ver comun.sh), se genera si falta y NUNCA se imprime:
# viaja por el entorno o por stdin y se tacha de toda salida. `tessera_sin` es el usuario
# SIN select_catalog_role que usa el repliegue de «Ver DDL» (sección 18 de test-db-oracle).
#
# thick usa el Instant Client que instala la app: en Windows el 19 (el de la 11.2), en Mac
# el 23 arm64 (medido que entra en la 11.2). Se puede forzar otro con
# TESSERA_TEST_ORACLE_DRIVERS. La 11.2 XE da el `FOR UPDATE WAIT 10` a 8 u 11 s (revisa las
# esperas cada ~3 s): el test ya lo tolera.
# MAC (sin verificar): las imágenes gvenzl son amd64; van con la emulación de Docker Desktop.
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

destino() {
  case "$1" in
    11) echo "tessera/$2@127.0.0.1:15211/XE" ;;
    21) echo "tessera/$2@127.0.0.1:15212/XEPDB1" ;;
    *) echo "servidor: 11 o 21" >&2; return 2 ;;
  esac
}

sql_como_system() {
  local version="$1" guion="$2" pw cont svc
  pw="$(leer_secreto oracle-pw.txt)" || return 1
  if [ "$version" = "11" ]; then cont=pruebas-ora11; svc=XE; else cont=pruebas-ora21; svc=XEPDB1; fi
  # La clave entra por stdin (no en la línea de órdenes) y __PW__ del guion se sustituye igual.
  { echo "system/${pw}@localhost:1521/${svc}"; echo "set pagesize 200 linesize 250 feedback on"; sed "s/__PW__/${pw}/g" "$guion"; echo "exit"; } \
    | MSYS_NO_PATHCONV=1 docker exec -i "$cont" bash -lc 'export ORACLE_SID=${ORACLE_SID:-XE}; for d in /u01/app/oracle/product/11.2.0/xe /opt/oracle/product/21c/dbhomeXE; do [ -x "$d/bin/sqlplus" ] && export ORACLE_HOME=$d; done; "$ORACLE_HOME/bin/sqlplus" -S -L' 2>&1 \
    | sed "s/${pw}/<clave>/g"
}

levantar() {
  asegurar_clave oracle-pw.txt
  local pw; pw="$(leer_secreto oracle-pw.txt)" || return 1
  crear() {
    local nombre="$1" puerto="$2" imagen="$3" extra="$4"
    if docker ps -a --format '{{.Names}}' | grep -qx "$nombre"; then
      docker start "$nombre" >/dev/null
    else
      docker run -d --name "$nombre" $extra -p "127.0.0.1:$puerto:1521" \
        -e ORACLE_PASSWORD="$pw" -e APP_USER=tessera -e APP_USER_PASSWORD="$pw" "$imagen" >/dev/null
    fi
  }
  crear pruebas-ora11 15211 gvenzl/oracle-xe:11-slim "--shm-size=1g"
  crear pruebas-ora21 15212 gvenzl/oracle-xe:21-slim ""
  for n in pruebas-ora11 pruebas-ora21; do
    for i in $(seq 1 120); do
      if docker logs "$n" 2>&1 | grep -q "DATABASE IS READY TO USE"; then echo "$n listo"; break; fi
      sleep 5
    done
  done
  local siembra; siembra="$(dirname "${BASH_SOURCE[0]}")/oracle-siembra.sql"
  sql_como_system 11 "$siembra" | tail -3
  sql_como_system 21 "$siembra" | tail -3
}

correr() {
  local version="$1" modo="$2" script="${3:-src/main/db/explorador/test-db-oracle.mts}" pw dest ic
  pw="$(leer_secreto oracle-pw.txt)" || return 1
  dest="$(destino "$version" "$pw")" || return 2
  case "$(uname -s)" in
    Darwin) ic="$(carpeta_datos_tessera)/drivers/oracle/oracle-ic-23-macos-arm64" ;;
    *) ic="$(carpeta_datos_tessera)/drivers/oracle/oracle-ic-19" ;;
  esac
  ic="${TESSERA_TEST_ORACLE_DRIVERS:-$ic}"
  cd "$RAIZ_REPO" || return 2
  if [ "$modo" = "thick" ]; then
    TESSERA_TEST_ORACLE_SIN=tessera_sin TESSERA_TEST_ORACLE="$dest" TESSERA_TEST_ORACLE_DRIVERS="$ic" \
      node "$script" 2>&1 | sed "s/${pw}/<clave>/g"
  else
    env -u TESSERA_TEST_ORACLE_DRIVERS TESSERA_TEST_ORACLE_SIN=tessera_sin TESSERA_TEST_ORACLE="$dest" \
      node "$script" 2>&1 | sed "s/${pw}/<clave>/g"
  fi
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) levantar ;;
  correr) shift; correr "$@" ;;
  sql) shift; sql_como_system "$@" ;;
  *) echo "uso: oracle.sh levantar | correr <11|21> <thick|thin> [script] | sql <11|21> <guion.sql>"; exit 2 ;;
esac
