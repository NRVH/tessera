#!/usr/bin/env bash
# =============================================================================
# LA SUITE DE INTERFAZ EN LINUX, desde Windows, contra una distro de WSL 2. Uso (Git Bash):
#   bash scripts/pruebas/linux.sh                 # sincroniza, empaqueta y corre la suite entera
#   bash scripts/pruebas/linux.sh e2e/x.spec.ts   # solo esos specs (lo que acepte Playwright)
#   TESSERA_LINUX_SIN_PAQUETE=1 bash …            # reutiliza el paquete (cambios solo en e2e/)
#   TESSERA_LINUX_TOPE_MIN=90 bash …              # tope de la pasada (60 min por defecto; la suite
#                                                 # entera tarda ~10): pasado, se corta y se limpia
#   bash scripts/pruebas/linux.sh app             # abre la Tessera de Linux en el escritorio (WSLg)
#   bash scripts/pruebas/mongo.sh correr bash scripts/pruebas/linux.sh e2e/mongodb.spec.ts
#                                                 # un spec de motor, con el destino de su guion
# OJO: toda Tessera barre al arrancar los contenedores `tessera-*` del Docker que ve, y el de WSL
# es el mismo Docker Desktop que el de Windows.
#
# QUÉ PRUEBA: el árbol de trabajo TAL CUAL, también lo que aún no está commiteado ni seguido (un
# índice temporal lo convierte en un commit suelto sin tocar nada) y viaja en un bundle a un clon
# propio de la distro (`~/tessera-linux`). No se trabaja sobre `/mnt/<unidad>`: visto desde
# WSL el repo es de otro dueño, y node_modules tiene que ser el de Linux (node-pty se compila).
#
# SIN VENTANAS EN EL ESCRITORIO: corre en Xvfb, no en WSLg, que pone cada ventana de prueba en
# el escritorio de Windows y le roba el foco a quien esté escribiendo (las teclas acaban
# dentro de la prueba). Y dentro de una sesión de D-Bus con un gnome-keyring desbloqueado cuyo
# llavero vive en un temporal con una clave de un solo uso: Tessera no guarda contraseñas sin
# llavero, y uno en `~/.local/share/keyrings` no se podría volver a desbloquear.
#
# LO QUE NECESITA LA DISTRO (una vez, como root): xvfb xauth dbus-x11 gnome-keyring
# libsecret-1-0 libnss3 libasound2t64 libgbm1 libgtk-3-0t64 libxss1 libxtst6
# libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1
# libxrandr2 libfuse2t64 libaio1t64 build-essential python3. Node 22 lo baja solo a
# `~/.local/node22`, sin tocar el Node del sistema. La distro: $TESSERA_WSL (Ubuntu-24.04).
# =============================================================================
set -euo pipefail

DISTRO="${TESSERA_WSL:-Ubuntu-24.04}"

# --- Dentro de WSL --------------------------------------------------------------
if [ "${1:-}" = "--dentro" ]; then
  BUNDLE="$2"
  REF="$3"
  shift 3
  NODE_DIR="$HOME/.local/node22"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    ver=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -o 'node-v22[^ ]*-linux-x64.tar.xz' | head -n1)
    echo "[linux] bajando $ver"
    mkdir -p "$NODE_DIR"
    curl -fsSL "https://nodejs.org/dist/latest-v22.x/$ver" | tar -xJ -C "$NODE_DIR" --strip-components=1
  fi
  export PATH="$NODE_DIR/bin:$PATH"

  REPO="$HOME/tessera-linux"
  if [ ! -d "$REPO/.git" ]; then git init -q "$REPO"; fi
  cd "$REPO"
  git fetch -q "$BUNDLE" "$REF"
  git reset -q --hard FETCH_HEAD
  git clean -qfdx -e node_modules -e dist -e .npm-ci-hash
  echo "[linux] árbol: $(git log --oneline -1 | cut -c1-90)"

  # `npm ci` solo si cambió el lockfile: compila node-pty y tarda.
  hash=$(sha256sum package-lock.json | cut -d' ' -f1)
  if [ ! -d node_modules ] || [ "$(cat .npm-ci-hash 2>/dev/null)" != "$hash" ]; then
    echo "[linux] npm ci"
    npm ci --no-audit --no-fund >/dev/null
    echo "$hash" > .npm-ci-hash
  fi
  if [ "${TESSERA_LINUX_SIN_PAQUETE:-}" != "1" ] || [ ! -x dist/linux-unpacked/tessera ]; then
    echo "[linux] npm run pack:linux:dir"
    npm run -s pack:linux:dir >/tmp/tessera-pack.log 2>&1 || { tail -30 /tmp/tessera-pack.log; exit 1; }
  fi

  # Modo `app`: la Tessera de Linux, a mano, en el escritorio de Windows (WSLg), con sus datos de
  # Linux (`~/.config/Tessera`). Su llavero es de clave vacía: es un equipo de pruebas.
  if [ "${1:-}" = "app" ]; then
    echo "[linux] abriendo Tessera de Linux (sus mensajes, en ~/tessera-app.log)"
    nohup dbus-run-session -- bash -c '
      printf "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
      export XDG_CURRENT_DESKTOP=GNOME
      exec "$HOME/tessera-linux/dist/linux-unpacked/tessera"
    ' > "$HOME/tessera-app.log" 2>&1 &
    exit 0
  fi

  echo "[linux] pruebas (registro entero en ~/e2e-linux.log)"
  unset WAYLAND_DISPLAY
  # Todo lo que nazca de esta pasada hereda la marca: al acabar se mata lo que la lleve, aunque se
  # haya soltado de su padre (un proceso suelto de un agente, un servicio de D-Bus de la sesión).
  export TESSERA_PASADA_LINUX="$$-$(date +%s)"
  set +e
  xvfb-run -a -s '-screen 0 1920x1080x24' dbus-run-session -- bash -c '
    llavero=$(mktemp -d) && chmod 700 "$llavero"
    clave=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d " \n")
    printf "%s" "$clave" | XDG_RUNTIME_DIR="$llavero" XDG_DATA_HOME="$llavero" gnome-keyring-daemon --unlock --components=secrets >/dev/null
    export XDG_CURRENT_DESKTOP=GNOME
    timeout --kill-after=30 "${TESSERA_LINUX_TOPE_MIN:-60}m" npx playwright test --reporter=line "$@"
    codigo=$?
    rm -rf "$llavero"
    exit $codigo
  ' _ "$@" > "$HOME/e2e-linux.log" 2>&1
  codigo=$?
  [ "$codigo" = "124" ] || [ "$codigo" = "137" ] && echo "[linux] CORTADA por el tope de ${TESSERA_LINUX_TOPE_MIN:-60} min: algo se colgó (ver ~/e2e-linux.log)"

  # Limpieza: procesos de la pasada (por la marca de su entorno) y temporales de las pruebas.
  restos=0
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    [ "$pid" = "$$" ] && continue
    if grep -qzx "TESSERA_PASADA_LINUX=$TESSERA_PASADA_LINUX" "$p/environ" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null && restos=$((restos + 1))
    fi
  done
  rm -rf /tmp/tessera-e2e-* /tmp/tessera-pack.log 2>/dev/null
  echo "[linux] limpieza: $restos proceso(s) de la pasada parados; temporales de /tmp borrados"

  grep -aE '^  [0-9]+\) |^  [0-9]+ (passed|failed|skipped|flaky|did not run)' "$HOME/e2e-linux.log" || tail -40 "$HOME/e2e-linux.log"
  exit $codigo
fi

# --- Desde Windows ----------------------------------------------------------------
RAIZ_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ_REPO"
command -v wsl.exe >/dev/null || { echo "Esto se lanza desde Windows con WSL 2 (wsl.exe)." >&2; exit 1; }

# La Tessera de Linux barrería al arrancar los contenedores de la de Windows (mismo Docker): con
# alguno vivo no se lanza nada; los cierra a mano quien los tenga abiertos.
if [ "${TESSERA_LINUX_IGNORAR_CONTENEDORES:-}" != "1" ]; then
  vivos="$(docker ps --filter 'name=^tessera-' --format '{{.Names}}' 2>/dev/null || true)"
  if [ -n "$vivos" ]; then
    echo "[linux] Hay contenedores de Tessera vivos en Docker; la Tessera de Linux los borraría al arrancar:" >&2
    printf '  %s\n' $vivos >&2
    echo "[linux] Ciérralos (hiberna esos perfiles o cierra Tessera) y vuelve a lanzar esto." >&2
    exit 2
  fi
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; git update-ref -d refs/tessera/linux 2>/dev/null || true' EXIT
# El árbol de trabajo entero (también lo nuevo sin seguir, respetando .gitignore) en un commit
# suelto, con una COPIA del índice: el del usuario no se toca.
cp "$(git rev-parse --git-path index)" "$tmp/index"
GIT_INDEX_FILE="$tmp/index" git add -A
commit="$(git commit-tree "$(GIT_INDEX_FILE="$tmp/index" git write-tree)" -p HEAD -m 'árbol de trabajo para Linux')"
git update-ref refs/tessera/linux "$commit"
git bundle create -q "$tmp/tessera.bundle" refs/tessera/linux
cp "$0" "$tmp/linux.sh"

# Las rutas de Windows, vistas desde WSL.
# Las variables del guion cruzan a WSL por `WSLENV`, y con ellas los destinos de prueba que pone
# `<motor>.sh correr` (`TESSERA_TEST_*`, `TESSERA_E2E_*`): sin ellos los specs de cada motor se
# saltan. Sus `127.0.0.1:<puerto>` valen igual dentro: Docker Desktop publica los puertos también
# en la distro. Así se corre un motor en Linux: `mongo.sh correr bash scripts/pruebas/linux.sh e2e/mongodb.spec.ts`.
export WSLENV="${WSLENV:+$WSLENV:}TESSERA_LINUX_SIN_PAQUETE:TESSERA_LINUX_TOPE_MIN"
for v in $(compgen -e | grep -E '^TESSERA_(TEST|E2E)_' || true); do WSLENV="$WSLENV:$v"; done
# (`cygpath -m`: con barras normales; las invertidas no sobreviven al paso a wsl.exe.)
dentro() { MSYS_NO_PATHCONV=1 wsl.exe -d "$DISTRO" -- wslpath -a "$(cygpath -m "$1")" | tr -d '\r'; }
MSYS_NO_PATHCONV=1 wsl.exe -d "$DISTRO" -- bash "$(dentro "$tmp/linux.sh")" --dentro \
  "$(dentro "$tmp/tessera.bundle")" refs/tessera/linux "$@"
