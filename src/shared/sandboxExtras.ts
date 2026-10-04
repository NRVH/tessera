// =============================================================================
// Lógica pura de los paquetes extra horneados en la imagen del sandbox: normalizar la
// lista de Ajustes, convertirla en `--build-arg` y sellarla para detectar imagen obsoleta.
// En `shared` porque la usan el main (build) y el renderer (preset); sin Node ni React.
// Validación ESTRICTA: el valor se expande SIN comillas en el Dockerfile
// (`apt-get install -y $EXTRA_APT`), así que `;` o `$(...)` serían ejecución en el build.
// Se ORDENA para que el sello sea estable y reordenar no fuerce un rebuild.
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================

/**
 * Versión del Dockerfile del sandbox. GEMELO EXACTO del `LABEL
 * tessera.sandbox.version` de `docker/sandbox/Dockerfile`: subir los dos a la
 * vez al cambiar la imagen.
 *
 * Vive aquí, junto al sello de los extras, porque las dos mitades de la etiqueta
 * que compara `ensureImage` son un solo contrato. Y si los gemelos divergen no
 * falla nada visible —simplemente cada creación de contenedor paga un `docker
 * build` que no arregla nada, para siempre—, así que `test-sandbox-extras.mts`
 * LEE el Dockerfile y comprueba que coinciden.
 */
export const SANDBOX_IMAGE_VERSION = '4'

/** Extras que el usuario decide hornear en la imagen base del sandbox. */
export interface SandboxExtras {
  /** Paquetes apt adicionales (ya normalizados si vienen de `normalizarExtras`). */
  apt: string[]
  /**
   * ¿Se hornean también las libs de sistema que necesita Chromium, más Xvfb? Va
   * aparte de `apt` porque no es una lista de paquetes: lo resuelve `playwright
   * install-deps`, que sabe cuáles son para SU versión. Copiarlas aquí a mano
   * sería una lista que se queda vieja en silencio.
   *
   * Xvfb se añade encima porque Playwright NO lo instala y en un contenedor no hay
   * servidor gráfico: sin él, `headless: false` no arranca.
   */
  depsNavegador: boolean
}

export const EXTRAS_VACIOS: SandboxExtras = { apt: [], depsNavegador: false }

/**
 * Nombre de paquete apt aceptable. Debian permite `[a-z0-9][a-z0-9+.-]*`; se
 * admiten además mayúsculas y `_` por tolerancia, y `:` para la arquitectura
 * (`libfoo:i386`). Nada de espacios, comillas ni metacaracteres de shell.
 */
const NOMBRE_PAQUETE = /^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$/

/**
 * Convierte lo que venga (array del slice de ajustes, o el texto crudo que el
 * usuario escribió) en una lista limpia, sin duplicados y ordenada. Descarta en
 * silencio lo que no parezca un nombre de paquete: es un campo de texto libre y
 * tumbar el build por una coma de más sería peor que ignorarla.
 */
export function normalizarPaquetes(entrada: unknown): string[] {
  const crudo = Array.isArray(entrada)
    ? entrada.map((x) => (typeof x === 'string' ? x : ''))
    : typeof entrada === 'string'
      ? [entrada]
      : []
  const piezas = crudo.flatMap((s) => s.split(/[\s,]+/))
  const limpios = piezas.map((s) => s.trim()).filter((s) => s.length > 0 && NOMBRE_PAQUETE.test(s))
  return [...new Set(limpios)].sort()
}

/** Normaliza la pareja completa (lo que se guarda y lo que se sella). */
export function normalizarExtras(apt: unknown, depsNavegador: unknown): SandboxExtras {
  return { apt: normalizarPaquetes(apt), depsNavegador: depsNavegador === true }
}

/**
 * Sello con el que se etiqueta la imagen y contra el que se compara después.
 * Mismo formato que el `LABEL tessera.sandbox.extras` del Dockerfile:
 * `<paquetes separados por espacio>|<0 ó 1>`.
 */
export function selloExtras(extras: SandboxExtras): string {
  return `${extras.apt.join(' ')}|${extras.depsNavegador ? '1' : '0'}`
}

/**
 * Lee un sello (`LABEL tessera.sandbox.extras`) y devuelve lo que hay REALMENTE
 * horneado. Es la inversa de `selloExtras`.
 *
 * Hace falta porque lo configurado y lo horneado se separan con facilidad: un
 * contenedor VIVO sigue corriendo la imagen con la que nació, así que cambiar los
 * ajustes no cambia lo que ese contenedor tiene. Preguntárselo a la etiqueta (que
 * el contenedor hereda de su imagen) es la única respuesta que no puede mentir.
 *
 * Tolerante a propósito: un sello ausente o con otra forma da extras vacíos, que
 * es la respuesta prudente —no prometer herramientas que quizá no estén—.
 */
export function extrasDesdeSello(sello: string): SandboxExtras {
  const corte = sello.lastIndexOf('|')
  if (corte < 0) return EXTRAS_VACIOS
  return {
    apt: normalizarPaquetes(sello.slice(0, corte)),
    depsNavegador: sello.slice(corte + 1).trim() === '1'
  }
}

/** Argumentos `--build-arg` para `docker build`. Siempre se pasan los dos, también
 *  vacíos: así el sello de la imagen refleja el estado real y no el "no lo dije". */
export function argsBuildExtras(extras: SandboxExtras): string[] {
  return [
    '--build-arg',
    `EXTRA_APT=${extras.apt.join(' ')}`,
    '--build-arg',
    `PLAYWRIGHT_DEPS=${extras.depsNavegador ? '1' : '0'}`
  ]
}

/**
 * Preset de "Documentos (PDF/Office)". Vive aquí, y no en el renderer, porque el
 * main también lo necesita para explicarle al agente qué herramientas tiene.
 *
 * `poppler-utils` trae `pdftoppm` (PDF -> PNG, que es lo que de verdad hace falta
 * para capturar un PDF: Chromium headless NO trae visor de PDF y "abrirlo en el
 * navegador" no produce nada). LibreOffice va por componentes en vez del
 * metapaquete `libreoffice` entero para no arrastrar Base, Draw y Math.
 */
export const PRESET_DOCUMENTOS = [
  'fonts-dejavu-core',
  'fonts-liberation',
  'imagemagick',
  'libreoffice-calc',
  'libreoffice-impress',
  'libreoffice-writer',
  'poppler-utils'
]

/** ¿La lista actual contiene el preset de documentos al completo? */
export function tieneDocumentos(apt: string[]): boolean {
  const set = new Set(apt)
  return PRESET_DOCUMENTOS.every((p) => set.has(p))
}

/** La lista con el preset de documentos añadido (sin duplicar y ordenada). */
export function conDocumentos(apt: string[]): string[] {
  return [...new Set([...apt, ...PRESET_DOCUMENTOS])].sort()
}

/**
 * La lista SIN el preset de documentos. Es a la vez "desactivar el preset" y "lo
 * que el usuario escribió a mano" —son literalmente la misma operación—, y por eso
 * hay una sola función: durante un rato hubo un `otrosPaquetes` que solo delegaba
 * aquí, y dos nombres públicos para una operación obligan a abrir el módulo para
 * descubrir que no se diferencian en nada.
 *
 * Lo segundo es lo que se pinta en el campo de texto: así activar el preset no le
 * llena el campo de siete nombres que él no puso y que borraría sin querer.
 */
export function sinDocumentos(apt: string[]): string[] {
  const preset = new Set(PRESET_DOCUMENTOS)
  return apt.filter((p) => !preset.has(p))
}
