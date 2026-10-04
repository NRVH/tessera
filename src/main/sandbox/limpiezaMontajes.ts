// =============================================================================
// El fragmento de `sh` que desmonta lo que cuelga de una raíz gestionada y la borra SOLO
// cuando awk AFIRMA que no queda nada montado debajo. Puro: produce cadenas que el helper
// privilegiado ejecuta como root en el namespace del daemon (busybox en la VM de Mac, la
// distro de WSL2 en Windows). Ni un byte cambia sin pasar `test:limpieza-montajes`.
// Las partes de awk van en `String.raw`: `\\040` le llega a awk tal cual.
// Decisiones: docs/decisiones/sandbox/limpieza-de-montajes.md
// =============================================================================

import { citarSh } from '../../shared/citarShell.ts'

/** Opciones del fragmento. */
export interface OpcionesLimpieza {
  /**
   * Tabla de montajes a leer. Por defecto `/proc/self/mountinfo`, que dentro del
   * helper privilegiado (`nsenter -t 1 -m`) es la del namespace del daemon. Es un
   * parámetro para que el test la apunte a un fixture.
   */
  mountinfo?: string
}

const MOUNTINFO_POR_DEFECTO = '/proc/self/mountinfo'

/**
 * Cuerpo awk que deja en `mp` el punto de montaje DECODIFICADO (campo 5 de mountinfo)
 * y en `casa` si es la base (`ENVIRON["b"]`) o un descendiente suyo. El orden
 * importa: `\134` (barra invertida) va la última, y con `split` + concatenación, no con
 * `gsub` (cada awk interpreta a su manera las barras del reemplazo; ver el ADR).
 */
const AWK_DECODIFICAR = String.raw`mp = $5; gsub(/\\040/, " ", mp); gsub(/\\011/, "\t", mp); gsub(/\\012/, "\n", mp); n = split(mp, tr, /\\134/); mp = tr[1]; for (i = 2; i <= n; i++) mp = mp "\\" tr[i]; casa = (mp == ENVIRON["b"] || index(mp, ENVIRON["b"] "/") == 1)`

/** Programa awk: imprime, una por línea, las rutas montadas bajo la base. */
const AWK_LISTAR = `{ ${AWK_DECODIFICAR}; if (casa) print mp }`

/**
 * Programa awk: imprime `ocupado` si queda algo montado bajo la base y `libre` si
 * no. Es un token POSITIVO a propósito: si awk no llega al END (no pudo abrir la
 * tabla), no imprime nada, y "nada" no es `libre`.
 */
const AWK_ESTADO = `{ ${AWK_DECODIFICAR}; if (casa) ocupado = 1 } END { if (ocupado) print "ocupado"; else print "libre" }`

/**
 * El cuerpo de la limpieza para una base dada como PALABRA de shell ya entrecomillada:
 * un literal `'…'` (salida de `citarSh`) o `"$base"` dentro de un bucle. Se guarda en
 * `$orig` para poder nombrarla en el aviso; todo el trabajo va sobre `$b`, la ruta
 * canónica, que se calcula UNA vez y sin la cual no se desmonta ni se borra nada.
 */
function cuerpo(palabraBase: string, mountinfo: string): string {
  const tabla = citarSh(mountinfo)
  const trabajo = [
    `b="$b" awk ${citarSh(AWK_LISTAR)} ${tabla} | LC_ALL=C sort -r | ` +
      `while IFS= read -r mp; do umount -l "$mp" 2>/dev/null; done`,
    `estado=$(b="$b" awk ${citarSh(AWK_ESTADO)} ${tabla})`,
    `case "$estado" in ` +
      `libre) rm -rf "$b" 2>/dev/null ;; ` +
      `ocupado) echo "AVISO: montajes residuales bajo $b, no se borra" ;; ` +
      `*) echo "AVISO: no se pudo leer la tabla de montajes, no se borra $b" ;; ` +
      `esac`
  ].join('; ')
  return [
    `orig=${palabraBase}`,
    `b=$(readlink -f "$orig" 2>/dev/null || true)`,
    `if [ -n "$b" ] && [ -e "$b" ]; then ${trabajo}; ` +
      // La ruta está ahí pero no se ha podido resolver: comparar sin canonizar es el
      // bug de pérdida de datos, así que se avisa y se deja intacta (ver el ADR).
      `elif [ -e "$orig" ]; then ` +
      `echo "AVISO: no se pudo canonicalizar $orig, no se desmonta ni se borra"; ` +
      `fi`
  ].join('; ')
}

/**
 * Fragmento de `sh` que desmonta cuanto cuelgue de `base` (ella incluida) y la borra
 * sólo si después no queda ningún montaje debajo. No termina en `true`: el llamador
 * decide si el estado de salida le importa.
 */
export function fragmentoDesmontarYBorrar(base: string, opts: OpcionesLimpieza = {}): string {
  return cuerpo(citarSh(base), opts.mountinfo ?? MOUNTINFO_POR_DEFECTO)
}

/**
 * Lo mismo para VARIAS bases, en un solo script. Termina en `true` para que el helper
 * privilegiado salga con 0 aunque la última orden fallara (es limpieza best-effort).
 * `set --` con cada base entrecomillada: un `for` sobre las rutas de macOS (con espacio)
 * las partiría en palabras y pasaría fragmentos de ruta al `rm -rf`.
 */
export function fragmentoDesmontarYBorrarVarias(bases: readonly string[], opts: OpcionesLimpieza = {}): string {
  const tabla = opts.mountinfo ?? MOUNTINFO_POR_DEFECTO
  return `set -- ${bases.map(citarSh).join(' ')}; for base in "$@"; do ${cuerpo('"$base"', tabla)}; done; true`
}
