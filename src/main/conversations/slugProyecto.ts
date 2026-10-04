// =============================================================================
// Criba de las carpetas de proyecto de Claude Code por nombre: decide si una carpeta puede contener
// las conversaciones de un proyecto, sin abrir un solo fichero.
// Claude Code codifica el `cwd` en el nombre de la carpeta (todo lo no alfanumérico pasa a `-`).
// Es un superconjunto a propósito, sin distinguir mayúsculas y con marcha atrás si nada casa;
// `esDelProyecto` es el filtro exacto. Puro.
// Decisiones: docs/decisiones/agentes/conversaciones-criba-por-carpeta.md
// =============================================================================

/**
 * Codifica un segmento de ruta como lo hace Claude Code al nombrar la carpeta del
 * proyecto: todo lo que no es `[A-Za-z0-9]` pasa a `-`. Se aplica al NOMBRE del
 * proyecto (no a la ruta entera) porque es la única parte que se compara.
 */
export function normalizarNombre(nombre: string): string {
  return nombre.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * ¿Puede esta carpeta de `projects/` contener conversaciones del proyecto
 * `nombreProyecto` (el basename de su ruta)?
 *
 * Casa si el nombre de la carpeta ES el proyecto (proyecto en la raíz de una
 * unidad, p.ej. `tessera`) o si TERMINA en `-<proyecto>`, que es el caso normal:
 * el nombre de la carpeta es la ruta completa codificada y el proyecto es su
 * último segmento.
 */
export function carpetaPuedeSerDe(carpeta: string, nombreProyecto: string): boolean {
  const norm = normalizarNombre(nombreProyecto)
  if (!norm) return false
  const a = carpeta.toLowerCase()
  const b = norm.toLowerCase()
  return a === b || a.endsWith('-' + b)
}

/**
 * Último segmento de una ruta, tratando `/` y `\` por igual. Hace falta porque el
 * `cwd` de un transcript puede venir de dentro del contenedor (`/workspace/tessera`)
 * o de Windows (`D:\…\tessera`) y hay que compararlos con el mismo criterio.
 *
 * Vive aquí porque es el filtro que decide de qué proyecto es una conversación y lo aplican
 * dos sitios (el lector y el servicio): con dos copias, una se cambiaría y el agente
 * arrancaría sin reanudar sin ningún error.
 */
export function basenameSuelto(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * Normaliza una ruta para compararla: separadores a `/`, sin barra final y en minúsculas.
 * La caja importa: Claude Code escribe a veces `D--…` y a veces `d--…` para la misma unidad.
 */
export function normalizarRuta(p: string): string {
  return p
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * Raíz donde el contenedor monta los proyectos. Copia deliberada de
 * `SandboxManager.WORKSPACE_ROOT`: este módulo es puro y lo importan los tests,
 * que no pueden arrastrar el SandboxManager (ni Electron con él).
 */
const RAIZ_CONTENEDOR = '/workspace'

/**
 * ¿El `cwd` de un transcript pertenece a un proyecto que corre dentro del contenedor? Se exige
 * el prefijo `/workspace`, donde SandboxManager monta todos los proyectos, y no un simple `/`
 * inicial: este predicado elige entre comparar rutas enteras (exacto) y el último segmento
 * (ambiguo), y un `cwd` POSIX que no venga del contenedor no debe renunciar al filtro exacto.
 */
export function esRutaDeContenedor(cwd: string): boolean {
  return cwd === RAIZ_CONTENEDOR || cwd.startsWith(`${RAIZ_CONTENEDOR}/`)
}

/**
 * ¿Esta conversación es de este proyecto? Filtro exacto (la criba `carpetaPuedeSerDe` es un
 * superconjunto barato). El basename no identifica un proyecto: dos carpetas con el mismo
 * nombre en el mismo perfil mezclaban sus historiales. En modo nativo el `cwd` es la ruta real
 * y se compara entera; en modo contenedor es `/workspace/<nombre>` y se compara el último
 * segmento, que es seguro porque `SandboxManager.addProject` ya resuelve las colisiones de
 * nombre. Por qué no se traduce a la ruta host, en el ADR.
 */
export function esDelProyecto(cwdTranscript: string, proyectoHostPath: string): boolean {
  if (!cwdTranscript || !proyectoHostPath) return false
  if (esRutaDeContenedor(cwdTranscript)) {
    return (
      basenameSuelto(cwdTranscript).toLowerCase() ===
      basenameSuelto(proyectoHostPath).toLowerCase()
    )
  }
  return normalizarRuta(cwdTranscript) === normalizarRuta(proyectoHostPath)
}
