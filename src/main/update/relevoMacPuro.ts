// =============================================================================
// El relevo de macOS, la parte PURA (sin electron ni `fs`): el texto del guion `sh` que
// sustituye el `.app` (desempaquetar, buscar, verificar, APARTAR el viejo, poner el nuevo),
// de dónde sale el bundle a partir del ejecutable y cómo se lee el desenlace que deja.
// Separado de `relevoMac.ts` para que `test-relevo-mac.mts` EJECUTE el guion de verdad con
// `node` a secas: un fallo aquí deja a un usuario sin aplicación.
// Decisiones: docs/decisiones/actualizacion/relevo-de-macos.md
// =============================================================================

import path from 'node:path'
import { citarSh } from '../../shared/citarShell'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'

/** Cuánto se espera, por defecto, a que el proceso de Tessera desaparezca. */
export const ESPERA_CIERRE_SEGUNDOS = 60

export interface OpcionesGuionRelevo {
  /** pid del proceso de Tessera al que hay que esperar antes de tocar nada. */
  pid: number
  /** El `.zip` ya descargado y verificado (sha512 del feed). */
  zip: string
  /** El `.app` que se sustituye. */
  destino: string
  /** Archivo de una línea con el desenlace, que el arranque siguiente consume. */
  marca: string
  /** Registro del guion. Su carpeta tiene que existir o el `exec` inicial falla. */
  traza: string
  /** Volver a abrir la app al terminar (el botón sí; cerrar Tessera no). */
  relanzar: boolean
  /** Argumentos con los que relanzar (`--user-data-dir=…`). */
  argumentos?: readonly string[]
  /** Cuánto se espera a que el pid muera. Agotado, NO se toca el destino. */
  esperaSegundos?: number
  /**
   * Carpeta de trabajo. Por defecto cuelga del CONTENEDOR del destino, que es lo
   * correcto en producción: así el paso final es un rename dentro de un mismo
   * directorio y no puede quedarse a medias copiando ~250 MB entre volúmenes.
   *
   * Es parámetro porque es la única forma de que el test ejercite la DEVOLUCIÓN de la
   * versión anterior sin trucar el guion: poniendo `stage` en otro volumen, el `mv`
   * final degrada a copia y se le puede hacer fallar de verdad (ENOSPC contra una
   * imagen de disco pequeña). Un camino de recuperación que no se puede ejecutar es
   * un camino que no existe.
   */
  stage?: string
}

/**
 * El texto del guion `sh` que hace el relevo. PURA: no toca disco ni Electron, para
 * que el test pueda leerla y —sobre todo— EJECUTARLA contra un destino de mentira.
 *
 * Todo argumento va por `citarSh`: las rutas de macOS llevan espacios como norma
 * (`~/Library/Application Support`) y pueden llevar apóstrofos (`/Users/O'Brien`) o
 * `$`, que son legales en un nombre de carpeta.
 */
export function guionRelevoMac(o: OpcionesGuionRelevo): string {
  const stage = o.stage ?? path.posix.join(path.posix.dirname(o.destino), '.tessera-relevo')
  const apartado = `${o.destino}.anterior`
  const vueltas = Math.max(1, Math.round((o.esperaSegundos ?? ESPERA_CIERRE_SEGUNDOS) * 2))
  const args = (o.argumentos ?? []).map(citarSh).join(' ')
  const relanzar = o.relanzar
    ? `open -n ${citarSh(o.destino)}${args.length > 0 ? ' --args ' + args : ''} || true`
    : '# no se relanza: el usuario pidió CERRAR Tessera, no reabrirla.'

  return `#!/bin/sh
# Relevo de actualización de Tessera para macOS.
# Lo GENERA \`guionRelevoMac\` (src/main/update/relevoMacPuro.ts) en cada intento; no
# se edita a mano y no sobrevive al intento siguiente.
set -u

pid=${citarSh(String(o.pid))}
zip=${citarSh(o.zip)}
destino=${citarSh(o.destino)}
apartado=${citarSh(apartado)}
stage=${citarSh(stage)}
marca=${citarSh(o.marca)}
traza=${citarSh(o.traza)}
vueltas=${citarSh(String(vueltas))}

# Todo queda registrado. El que falla aquí es un proceso al que ya no mira nadie: sin
# traza, el fallo sería mudo, que es justo lo que el invariante 2 del updater prohíbe.
exec >> "$traza" 2>&1
set -x

# El desenlace, en una línea que el arranque siguiente sabe leer.
anotar() { echo "$1" > "$marca" 2>/dev/null || true; }

# Fracaso ANTES de tocar el destino: la app del usuario sigue entera donde estaba, así
# que sí se puede limpiar el material de trabajo.
fracaso_limpio() { anotar "fallo: $1"; rm -rf "$stage"; exit 1; }

# Fracaso DESPUÉS de tocar el destino. Aquí NO se borra nada: la única copia buena de
# la app puede estar en "$stage" o en "$apartado", y limpiar por pulcritud es
# exactamente el fallo que dejó al usuario sin app en la primera sonda.
fracaso_sucio() { anotar "fallo: $1"; exit 1; }

# 1. Esperar a que Tessera desaparezca. Mientras el proceso viva, sus dylib siguen
#    mapeadas desde el bundle que hay que sustituir. Si no muere, NO se toca nada:
#    ante la duda, el usuario se queda con la versión que ya tenía.
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge "$vueltas" ]; then
    anotar "fallo: la aplicación no llegó a cerrarse"
    exit 1
  fi
  sleep 0.5
done

# 2. Desempaquetar en la carpeta de trabajo (misma unidad que el destino en
#    producción: ver \`stage\` en las opciones).
rm -rf "$stage"
mkdir -p "$stage" || fracaso_limpio "no se pudo crear la carpeta de trabajo"
ditto -x -k "$zip" "$stage" || fracaso_limpio "el paquete descargado no se pudo desempaquetar"

# 3. BUSCAR el .app; no suponer su nombre. La primera sonda lo supuso, el mv falló y
#    —como entonces el borrado iba antes— el usuario se quedó SIN app.
nueva=$(find "$stage" -maxdepth 1 -name '*.app' -print -quit)
[ -n "$nueva" ] || fracaso_limpio "el paquete no contiene ninguna aplicación"

# 4. Verificar la firma de lo que se va a instalar. Es lo último que se comprueba
#    antes de tocar el destino.
codesign --verify --deep --strict "$nueva" || fracaso_limpio "la firma del paquete no es válida"

# 5. APARTAR la versión vieja con un rename; NO borrarla. Es la que hay que poder
#    devolver si el paso 6 sale mal.
rm -rf "$apartado"
mv "$destino" "$apartado" || fracaso_limpio "no se pudo apartar la versión anterior"

# 6. Poner la nueva. Si falla, se DEVUELVE la anterior. El \`rm -rf\` del destino en la
#    devolución no es adorno: un mv entre volúmenes puede dejar una copia a medias ahí,
#    y sin borrarla el mv de vuelta metería la app buena DENTRO de la rota.
if ! mv "$nueva" "$destino"; then
  rm -rf "$destino"
  if mv "$apartado" "$destino" || ditto "$apartado" "$destino"; then
    fracaso_sucio "no se pudo instalar la versión nueva; se ha devuelto la anterior"
  fi
  fracaso_sucio "no se pudo instalar la versión nueva NI devolver la anterior; la anterior está en $apartado"
fi

# 7. A partir de aquí ya no hay vuelta atrás que dar, así que se limpia.
rm -rf "$apartado"
rm -rf "$stage"

# El "ok" va ANTES de relanzar: la app que arranca tiene que poder leerlo.
anotar ok
${relanzar}
exit 0
`
}

/**
 * De la ruta del ejecutable al `.app` que lo contiene, o `null` si no cuelga de
 * ninguno (desarrollo, o un binario suelto). PURA, y con la plataforma como parámetro
 * para que el test fije las dos desde una sola.
 *
 * `Tessera.app/Contents/MacOS/Tessera` -> tres niveles arriba. Se usa `path.posix` a
 * propósito: las rutas de macOS son POSIX y así la función da el mismo resultado
 * ejecutada desde Windows, que es lo que hace que se pueda probar allí.
 */
export function bundleDesdeExe(
  exe: string,
  plataforma: Plataforma = plataformaActual()
): string | null {
  if (plataforma !== 'mac') return null
  if (typeof exe !== 'string' || exe.trim().length === 0) return null
  const bundle = path.posix.dirname(path.posix.dirname(path.posix.dirname(exe)))
  if (!bundle.toLowerCase().endsWith('.app')) return null
  // `.app` a secas, o `/.app`, no son un bundle: son el resultado de subir de más.
  if (path.posix.basename(bundle).length <= '.app'.length) return null
  return bundle
}

/** El desenlace que dejó el guion del relevo. */
export type ResultadoRelevo = { clase: 'ok' } | { clase: 'fallo'; motivo: string }

/**
 * Interpreta la línea que el guion escribió. PURA. Devuelve `null` para cualquier cosa
 * que no reconozca: un archivo a medias, vacío, o de un esquema futuro tiene que
 * degradarse a "no se sabe", nunca a un desenlace inventado.
 */
export function interpretarMarcaRelevo(texto: string): ResultadoRelevo | null {
  const linea = texto.split('\n')[0].replace(/\r$/, '').trim()
  if (linea === 'ok') return { clase: 'ok' }
  const m = /^fallo\s*:\s*(.+)$/.exec(linea)
  if (m === null) return null
  const motivo = m[1].trim()
  return motivo.length > 0 ? { clase: 'fallo', motivo } : null
}
