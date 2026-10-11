// =============================================================================
// Gancho `afterPack` de electron-builder para Linux: el ejecutable `tessera` pasa a ser un guion
// `sh` que lanza el binario real (`tessera-bin`) y solo le añade `--no-sandbox` donde Chromium no
// podría arrancar su sandbox: el sistema restringe los espacios de nombres sin privilegios (con
// AppArmor, en algunas distribuciones) o los tiene apagados, y `chrome-sandbox` no es SUID de root (un AppImage no
// puede serlo). En cualquier otro Linux, el sandbox completo. Fuera de Linux no hace nada.
// Decisiones: docs/decisiones/despliegue/sandbox-de-chromium-en-linux.md
// =============================================================================
import { chmodSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** El binario real, junto al guion que ocupa su nombre. */
export const BINARIO_REAL = 'tessera-bin'

/**
 * Los interruptores del núcleo que deciden si un proceso sin privilegios puede crear espacios de
 * nombres: la restricción de AppArmor, el de Debian y el tope de espacios de usuario (a 0, ninguno).
 */
export const RUTAS_NUCLEO = {
  restringidoAppArmor: '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  clonarSinPrivilegios: '/proc/sys/kernel/unprivileged_userns_clone',
  maximoEspaciosUsuario: '/proc/sys/user/max_user_namespaces'
}

/**
 * El guion del lanzador. Las rutas del núcleo entran por parámetro para que el test las
 * sustituya por archivos suyos; en el paquete van las de `RUTAS_NUCLEO`.
 */
export function guionLanzador(rutas = RUTAS_NUCLEO) {
  return `#!/bin/sh
# Lanzador de Tessera: el binario real es ${BINARIO_REAL}. Sin sandbox SOLO si Chromium no podría
# crear el suyo (espacios de nombres restringidos o apagados y chrome-sandbox sin SUID de root).
DIR="$(dirname "$(readlink -f "$0")")"
sin_espacios=0
[ "$(cat '${rutas.restringidoAppArmor}' 2>/dev/null)" = "1" ] && sin_espacios=1
[ "$(cat '${rutas.clonarSinPrivilegios}' 2>/dev/null)" = "0" ] && sin_espacios=1
[ "$(cat '${rutas.maximoEspaciosUsuario}' 2>/dev/null)" = "0" ] && sin_espacios=1
if [ "$sin_espacios" = "1" ] && ! { [ -u "$DIR/chrome-sandbox" ] && [ "$(stat -c %u "$DIR/chrome-sandbox" 2>/dev/null)" = "0" ]; }; then
  exec "$DIR/${BINARIO_REAL}" --no-sandbox "$@"
fi
exec "$DIR/${BINARIO_REAL}" "$@"
`
}

/** El gancho: renombra el binario y escribe el guion en su lugar. */
export default async function lanzadorLinux(contexto) {
  if (contexto.electronPlatformName !== 'linux') return
  const nombre = contexto.packager.executableName
  const real = join(contexto.appOutDir, BINARIO_REAL)
  const lanzador = join(contexto.appOutDir, nombre)
  renameSync(lanzador, real)
  writeFileSync(lanzador, guionLanzador())
  chmodSync(lanzador, 0o755)
}
