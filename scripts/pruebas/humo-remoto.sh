#!/usr/bin/env bash
# =============================================================================
# HUMO DE SOLO LECTURA contra una base remota de solo lectura (una Oracle 11.2, por VPN).
# Un cambio de BD puede probarse también ahí, y SOLO LEYENDO: nada de DML, DDL, PL/SQL,
# COMMIT ni «Enviar». Corre `test-db-oracle-lectura.mts`, que solo lanza consultas de
# catálogo y lectura.
#
# La base NO se nombra en el repo: su alias (en el registro de conexiones de la app) va en
# `humo-remoto.alias` y su contraseña en `humo-remoto-pw.txt` (ver comun.sh). La contraseña
# entra solo en el entorno del test como TESSERA_DB_SECRET_<ID> y se tacha de la salida.
# Se quitan el puente y el perfil de ESTA terminal para que el test use ese respaldo.
#
# Uso:
#   scripts/pruebas/humo-remoto.sh [tabla]
#   scripts/pruebas/humo-remoto.sh --en <carpeta-de-otro-worktree> [tabla]
#     (--en mide OTRO árbol, p. ej. un commit concreto mientras el repo está a medias)
# Si el servidor no contesta, el test lo dice («¿la VPN está levantada?») y sale en rojo.
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

ARBOL="$RAIZ_REPO"
if [ "${1:-}" = "--en" ]; then ARBOL="$2"; shift 2; fi

PW="$(leer_secreto humo-remoto-pw.txt)" || exit 1
ALIAS="$(leer_secreto humo-remoto.alias)" || exit 1
REGISTRO="${TESSERA_DB_REGISTRY:-$(carpeta_datos_tessera)/db-connections.json}"
ID="$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^﻿/,''));const l=Array.isArray(r)?r:(r.connections||r.conexiones||[]);const c=l.find(x=>x.alias===process.argv[2]);process.stdout.write(c?c.id:'')" "$REGISTRO" "$ALIAS")"
if [ -z "$ID" ]; then echo "no encuentro la conexión de humo en el registro ($REGISTRO)"; exit 2; fi
VAR="TESSERA_DB_SECRET_$(printf '%s' "$ID" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"

cd "$ARBOL" || exit 2
env -u TESSERA_DB_PIPE -u TESSERA_DB_SESSION -u TESSERA_PROFILE -u TESSERA_DB_SCOPE -u TESSERA_DB_MODE \
  TESSERA_DB_REGISTRY="$REGISTRO" "$VAR=$PW" node src/main/db/explorador/test-db-oracle-lectura.mts "$ALIAS" ${1:+"$1"} 2>&1 \
  | sed "s/${PW}/<clave>/g"
exit "${PIPESTATUS[0]}"
