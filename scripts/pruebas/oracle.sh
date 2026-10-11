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
#   scripts/pruebas/oracle.sh tcps <11|21>             el cifrado (test-oracle-tcps.mts); TCPS
#                                                      solo en la 21, en 127.0.0.1:15213
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
# MAC: las imágenes gvenzl son amd64; van con la emulación de Docker Desktop (la 21 pide unos
# 3 GB: con el tope de memoria de fábrica de Docker Desktop no cabe junto a otros servidores).
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
    # Un pruebas-ora21 de antes del TCPS no publica el 2484: se rehace (solo lleva la siembra).
    if [ "$nombre" = pruebas-ora21 ] && docker ps -a --format '{{.Names}}' | grep -qx "$nombre" \
      && [ -z "$(docker port "$nombre" 2484 2>/dev/null)" ]; then
      docker rm -f "$nombre" >/dev/null
    fi
    if docker ps -a --format '{{.Names}}' | grep -qx "$nombre"; then
      docker start "$nombre" >/dev/null
    else
      docker run -d --name "$nombre" $extra -p "127.0.0.1:$puerto:1521" \
        -e ORACLE_PASSWORD="$pw" -e APP_USER=tessera -e APP_USER_PASSWORD="$pw" "$imagen" >/dev/null
    fi
  }
  crear pruebas-ora11 15211 gvenzl/oracle-xe:11-slim "--shm-size=1g"
  crear pruebas-ora21 15212 gvenzl/oracle-xe:21-slim "-p 127.0.0.1:15213:2484"
  for n in pruebas-ora11 pruebas-ora21; do
    for i in $(seq 1 120); do
      if docker logs "$n" 2>&1 | grep -q "DATABASE IS READY TO USE"; then echo "$n listo"; break; fi
      sleep 5
    done
  done
  local siembra; siembra="$(dirname "${BASH_SOURCE[0]}")/oracle-siembra.sql"
  sql_como_system 11 "$siembra" | tail -3
  sql_como_system 21 "$siembra" | tail -3
  poner_tcps
}

# Ruta de una carpeta del host tal como la monta `docker run -v` (Windows la quiere con unidad).
ruta_docker() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi
}

# TCPS en pruebas-ora21 (puerto 2484, publicado en 15213) con un wallet de certificado
# autofirmado CN=localhost. El wallet lo hace `orapki` desde sus jar de Maven Central en un
# contenedor con Java (la imagen slim no lo trae) y se guarda en $SECRETOS/oracle-tcps junto
# al certificado, que es la CA que instala la prueba. La 11.2 XE no se cifra aquí: su
# auto-login (cwallet.sso) tiene un formato que los `orapki` publicados ya no escriben (ORA-29106).
poner_tcps() {
  local dir="$SECRETOS/oracle-tcps" wpw v=21.9.0.0 a
  asegurar_clave oracle-wallet-pw.txt
  wpw="$(leer_secreto oracle-wallet-pw.txt)" || return 1
  mkdir -p "$dir/jars"
  if [ ! -s "$dir/servidor.crt" ]; then
    for a in oraclepki osdt_core osdt_cert; do
      [ -s "$dir/jars/$a.jar" ] || curl -sSfL -o "$dir/jars/$a.jar" \
        "https://repo1.maven.org/maven2/com/oracle/database/security/$a/$v/$a-$v.jar" || return 1
    done
    MSYS_NO_PATHCONV=1 docker run --rm -e WPW="$wpw" -v "$(ruta_docker "$dir"):/w" eclipse-temurin:17-jre bash -c '
      set -e
      P="java -cp /w/jars/oraclepki.jar:/w/jars/osdt_core.jar:/w/jars/osdt_cert.jar oracle.security.pki.textui.OraclePKITextUI"
      $P wallet create -wallet /w/wallet -pwd "$WPW" -auto_login >/dev/null
      $P wallet add -wallet /w/wallet -pwd "$WPW" -dn CN=localhost -keysize 2048 -self_signed -validity 3650 -sign_alg sha256 >/dev/null
      $P wallet export -wallet /w/wallet -pwd "$WPW" -dn CN=localhost -cert /w/servidor.crt >/dev/null' || return 1
  fi
  local admin
  admin="$(MSYS_NO_PATHCONV=1 docker exec pruebas-ora21 bash -c 'echo "$(orabasehome)/network/admin"')"
  if MSYS_NO_PATHCONV=1 docker exec pruebas-ora21 grep -q TCPS "$admin/listener.ora"; then echo "pruebas-ora21: TCPS ya puesto"; return 0; fi
  for a in cwallet.sso ewallet.p12; do
    MSYS_NO_PATHCONV=1 docker cp "$(ruta_docker "$dir/wallet/$a")" "pruebas-ora21:/opt/oracle/tessera-wallet-$a" || return 1
  done
  MSYS_NO_PATHCONV=1 docker exec -u root pruebas-ora21 bash -c '
    mkdir -p /opt/oracle/tessera-wallet
    for a in cwallet.sso ewallet.p12; do mv "/opt/oracle/tessera-wallet-$a" "/opt/oracle/tessera-wallet/$a"; done
    chown -R oracle:oinstall /opt/oracle/tessera-wallet' || return 1
  MSYS_NO_PATHCONV=1 docker exec -e ADMIN="$admin" pruebas-ora21 bash -c '
    export PATH="$ORACLE_HOME/bin:$PATH"
    W="WALLET_LOCATION = (SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/opt/oracle/tessera-wallet)))"
    sed -i "s#(ADDRESS = (PROTOCOL = TCP)(HOST = 0.0.0.0)(PORT = 1521))#&\n      (ADDRESS = (PROTOCOL = TCPS)(HOST = 0.0.0.0)(PORT = 2484))#" "$ADMIN/listener.ora"
    for f in listener.ora sqlnet.ora; do printf "%s\nSSL_CLIENT_AUTHENTICATION = FALSE\n" "$W" >> "$ADMIN/$f"; done
    lsnrctl stop >/dev/null; lsnrctl start >/dev/null
    echo "alter system register;" | sqlplus -S -L / as sysdba >/dev/null
    sleep 5
    lsnrctl status | grep -qi "PROTOCOL=tcps" && echo "pruebas-ora21: TCPS en 2484 (127.0.0.1:15213)"' || return 1
}

# El cifrado (test-oracle-tcps.mts) contra el servidor de verdad, con el Instant Client para lo de thick.
tcps() {
  local version="$1"
  export TESSERA_TEST_ORACLE_VERSION="$version"
  if [ "$version" = "21" ]; then
    export TESSERA_TEST_ORACLE_TCPS=15213 TESSERA_TEST_ORACLE_CA="$SECRETOS/oracle-tcps/servidor.crt"
  fi
  correr "$version" thin src/tdb/test-oracle-tcps.mts || return
  correr "$version" thick src/tdb/test-oracle-tcps.mts
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
  tcps) shift; tcps "$@" ;;
  sql) shift; sql_como_system "$@" ;;
  *) echo "uso: oracle.sh levantar | correr <11|21> <thick|thin> [script] | tcps <11|21> | sql <11|21> <guion.sql>"; exit 2 ;;
esac
