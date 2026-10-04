#!/usr/bin/env bash
# =============================================================================
# LO COMÚN DE LOS SCRIPTS DE PRUEBAS: dónde está el repo y dónde viven los SECRETOS.
#
# POR QUÉ UNA CARPETA FIJA FUERA DEL REPO. Durante las fases 1-4 del explorador de BD
# estos scripts vivían en el scratchpad de UNA sesión de Claude Code, con rutas fijas a
# él: un chat nuevo no los veía, y la regla de «un chat por paso» fallaba en el primer
# relevo. Ahora viven versionados aquí y las claves en `~/.tessera-pruebas/` (o la carpeta
# de $TESSERA_PRUEBAS_DIR), que NO se versiona y los scripts nunca imprimen:
#   oracle-pw.txt       clave de los contenedores pruebas-ora11 / pruebas-ora21
#   mssql-pw.txt        clave del contenedor pruebas-mssql ('sa' y sus dos usuarios)
#   humo-remoto.alias   alias (en el registro de conexiones) de la base REMOTA de humo
#   humo-remoto-pw.txt  su contraseña
# Las de Docker se generan solas la primera vez; las de la base remota las pone el usuario.
#
# DOS PLATAFORMAS: Git Bash en Windows y bash/zsh en macOS. Nada de rutas de un solo
# sistema salvo donde se bifurca a propósito (`carpeta_datos_tessera`).
# =============================================================================
set -u

RAIZ_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETOS="${TESSERA_PRUEBAS_DIR:-$HOME/.tessera-pruebas}"
mkdir -p "$SECRETOS"

# Lee un secreto sin saltos de línea. Sale con error claro si falta.
leer_secreto() {
  local f="$SECRETOS/$1"
  if [ ! -s "$f" ]; then echo "falta el secreto $f" >&2; return 1; fi
  tr -d '\r\n' < "$f"
}

# Genera una clave de pruebas si no existe (mayúscula, minúscula, dígito y símbolo: lo que
# exige SQL Server; Oracle la acepta igual). Nunca la imprime.
asegurar_clave() {
  local f="$SECRETOS/$1"
  if [ ! -s "$f" ]; then
    node -e "const c=require('crypto');const b=c.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g,'');process.stdout.write('Ts'+b.slice(0,20)+'9q')" > "$f"
  fi
}

# La carpeta de datos de la app instalada (drivers, registro de conexiones), por sistema.
carpeta_datos_tessera() {
  case "$(uname -s)" in
    Darwin) echo "$HOME/Library/Application Support/Tessera" ;;
    *) echo "${APPDATA:-$HOME/AppData/Roaming}/Tessera" ;;
  esac
}

# Ejecuta una orden y tacha una clave de su salida, conservando el código de salida.
sin_clave() {
  local clave="$1"; shift
  "$@" 2>&1 | sed "s/${clave}/<clave>/g"
  return "${PIPESTATUS[0]}"
}
