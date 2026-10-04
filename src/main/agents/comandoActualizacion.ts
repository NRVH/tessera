// =============================================================================
// Cómo se actualiza cada CLI de agente en este equipo, en puro (plataforma y arquitectura
// por parámetro): cómo está instalado, qué orden lo actualiza y si hay que parar sus
// sesiones antes, y por qué falló una instalación, dicho para el usuario.
// Lo usa el servicio de los agentes nativos; lo prueba `test-comando-actualizacion.mts`.
// Decisiones: docs/decisiones/agentes/nativos-orden-por-metodo.md
// =============================================================================

import type { AgentKind } from '../../shared/agent-terminal-ipc.ts'
import type { MetodoInstalacion, ProcesoBloqueador } from '../../shared/agentes-nativos-ipc.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'
import { ETIQUETA_AGENTE } from '../../shared/etiquetasAgente.ts'
import { nombresSistema } from '../../shared/nombresSistema.ts'
import type { Plataforma } from '../../shared/plataforma.ts'
import { esVersionExacta } from '../../shared/versionesCli.ts'

/** Paquetes de npm de cada CLI. */
export const PAQUETE_CODEX = '@openai/codex'
export const PAQUETE_CLAUDE = '@anthropic-ai/claude-code'

/** Lo que `ordenActualizacion` decide: orden automática, o qué decirle al usuario. */
export type OrdenActualizacion =
  | { tipo: 'auto'; orden: string; requiereParar: boolean }
  | { tipo: 'manual'; orden: string | null; motivo: string }

/** Por qué falló una instalación, para el usuario. */
export type MotivoErrorInstalacion = 'bloqueado' | 'permisos' | 'red' | 'tope' | 'fallo'

/** Resultado de `clasificarErrorInstalacion`. */
export interface ErrorInstalacionClasificado {
  motivo: MotivoErrorInstalacion
  /** Frase en español, lista para enseñar. */
  detalle: string
  /** Orden para ejecutar a mano, cuando ayuda. */
  ordenManual?: string
}

// -----------------------------------------------------------------------------
// Rutas
// -----------------------------------------------------------------------------

/** Ruta comparable: barras `/`, sin barras finales y, en Windows, en minúsculas. */
function normalizar(ruta: string, plataforma: Plataforma): string {
  const r = ruta.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return plataforma === 'windows' ? r.toLowerCase() : r
}

/** ¿Contiene la ruta normalizada esta marca? (la marca se escribe con `/`). */
function contiene(rutaNormalizada: string, marca: string, plataforma: Plataforma): boolean {
  return rutaNormalizada.includes(plataforma === 'windows' ? marca.toLowerCase() : marca)
}

/** Huellas de gestores del sistema que Tessera no maneja. */
const MARCAS_GESTOR: Record<'windows' | 'posix', string[]> = {
  windows: ['/microsoft/winget/packages/', '/winget/links/', '/scoop/apps/', '/scoop/shims/', '/chocolatey/'],
  posix: ['/mise/installs/', '/.asdf/installs/', '/nix/store/', '/opt/local/']
}

function esRutaDeGestor(rutaNormalizada: string, plataforma: Plataforma): boolean {
  const marcas = MARCAS_GESTOR[plataforma === 'windows' ? 'windows' : 'posix']
  return marcas.some((m) => contiene(rutaNormalizada, m, plataforma))
}

/** Homebrew deja sus paquetes en `Caskroom` (casks) o `Cellar` (fórmulas). */
function esRutaDeBrew(rutaNormalizada: string, plataforma: Plataforma, nombre?: string): boolean {
  if (plataforma === 'windows') return false
  const cola = nombre ? `${nombre}/` : ''
  return rutaNormalizada.includes(`/Caskroom/${cola}`) || rutaNormalizada.includes(`/Cellar/${cola}`)
}

const RE_VITE_PLUS = /\/packages\/@openai\/codex(?:#[^/]*)?(?:\/[^/]+)?\/(?:lib\/)?node_modules\/@openai\/codex$/i

// -----------------------------------------------------------------------------
// 1. ¿Cómo está instalado?
// -----------------------------------------------------------------------------

/**
 * Método de instalación de Codex a partir de su raíz REAL (`CODEX_MANAGED_PACKAGE_ROOT`
 * o el `realpath` del binario), con las marcas del shim en su orden.
 *
 * @param prefijoNpm  Lo que responde `npm prefix -g` en la shell de las sesiones; null
 *                    si npm no está (entonces nunca es 'npm').
 */
export function detectarMetodoCodex(e: {
  raizPaquete: string | null
  prefijoNpm: string | null
  plataforma: Plataforma
}): MetodoInstalacion {
  const { plataforma } = e
  if (!e.raizPaquete || !e.raizPaquete.trim()) return 'desconocido'
  const raiz = normalizar(e.raizPaquete, plataforma)

  // Vite+ y pnpm antes que bun, como en el shim.
  if (RE_VITE_PLUS.test(raiz)) return 'vite-plus'
  if (contiene(raiz, '/node_modules/.pnpm/', plataforma) || contiene(raiz, '/pnpm/global/', plataforma)) {
    return 'pnpm'
  }
  if (contiene(raiz, '/.bun/install/global/', plataforma)) return 'bun'

  if (e.prefijoNpm && e.prefijoNpm.trim()) {
    const prefijo = normalizar(e.prefijoNpm, plataforma)
    const esperada = plataforma === 'windows' ? `${prefijo}/node_modules/@openai/codex` : `${prefijo}/lib/node_modules/@openai/codex`
    if (raiz === normalizar(esperada, plataforma)) return 'npm'
  }

  if (esRutaDeBrew(raiz, plataforma, 'codex')) return 'brew'
  if (esRutaDeGestor(raiz, plataforma)) return 'gestor'
  return 'desconocido'
}

/** ¿Es la huella del instalador nativo de Claude (`~/.local/share/claude/versions/`, `~/.local/bin/claude`)? */
function esHuellaNativaClaude(ruta: string, plataforma: Plataforma): boolean {
  return contiene(ruta, '/.local/share/claude/versions/', plataforma) || /\/\.local\/bin\/claude(\.exe)?$/i.test(ruta)
}

/**
 * Método de instalación de Claude Code: la ruta física (Homebrew, gestores) manda sobre
 * `installMethod`, y la huella del instalador nativo solo cuenta sin configuración.
 *
 * @param installMethod  El campo `installMethod` de `.claude.json` (`native`, `npm-global`…).
 * @param rutaBinario    Ruta del `claude` del PATH, RESUELTA (`realpath`).
 */
export function detectarMetodoClaude(e: {
  installMethod: string | null
  rutaBinario: string | null
  plataforma: Plataforma
}): MetodoInstalacion {
  const { plataforma } = e
  const ruta = e.rutaBinario && e.rutaBinario.trim() ? normalizar(e.rutaBinario, plataforma) : null

  if (ruta !== null && esRutaDeBrew(ruta, plataforma)) return 'brew'
  if (ruta !== null && esRutaDeGestor(ruta, plataforma)) return 'gestor'

  const metodo = (e.installMethod ?? '').trim().toLowerCase()
  if (metodo === 'native') return 'nativo'
  if (metodo === 'npm-global' || metodo === 'global' || metodo === 'npm') return 'npm'

  if (ruta !== null && !metodo && esHuellaNativaClaude(ruta, plataforma)) return 'nativo'
  return 'desconocido'
}

// -----------------------------------------------------------------------------
// 2. ¿Qué orden lo actualiza?
// -----------------------------------------------------------------------------

/** Cita un argumento para la shell que va a RECIBIR la línea en esta plataforma. */
function citar(valor: string, plataforma: Plataforma): string {
  return plataforma === 'windows' ? citarPowerShell(valor) : citarSh(valor)
}

/** La orden de un gestor de paquetes JS para instalar `paquete@version` global. */
function ordenGestorJs(
  metodo: 'npm' | 'pnpm' | 'bun' | 'vite-plus',
  paquete: string,
  version: string,
  plataforma: Plataforma
): string {
  const especificacion = citar(`${paquete}@${version}`, plataforma)
  switch (metodo) {
    case 'npm':
      return `npm install -g ${especificacion}`
    case 'pnpm':
      return `pnpm add -g ${especificacion}`
    case 'bun':
      return `bun add -g ${especificacion}`
    case 'vite-plus':
      return `vp install -g ${especificacion}`
  }
}

const SIN_VERSION = 'Sin versión exacta: no se sabe qué versión instalar'

type EntradaOrden = { metodo: MetodoInstalacion; plataforma: Plataforma; version: string | null }

function ordenClaude({ metodo, plataforma, version }: EntradaOrden): OrdenActualizacion {
  switch (metodo) {
    case 'nativo':
      return { tipo: 'auto', orden: 'claude update', requiereParar: false }
    case 'npm':
      if (!esVersionExacta(version)) return { tipo: 'manual', orden: null, motivo: SIN_VERSION }
      return { tipo: 'auto', orden: ordenGestorJs('npm', PAQUETE_CLAUDE, version, plataforma), requiereParar: plataforma === 'windows' }
    case 'pnpm':
    case 'bun':
    case 'vite-plus':
      // Claude no los declara, pero si llegan se sugiere la orden de su gestor.
      return {
        tipo: 'manual',
        orden: esVersionExacta(version) ? ordenGestorJs(metodo, PAQUETE_CLAUDE, version, plataforma) : null,
        motivo: `Claude Code está instalado con ${metodo}: Tessera sólo lo actualiza por su cuenta si viene de npm o de su instalador`
      }
    case 'brew':
      return {
        tipo: 'manual',
        orden: 'brew upgrade claude-code',
        motivo: 'Claude Code está instalado con Homebrew: se actualiza con brew'
      }
    case 'gestor':
      return {
        tipo: 'manual',
        orden: null,
        motivo: 'Claude Code está instalado con un gestor de paquetes del sistema: actualízalo con ese gestor'
      }
    case 'desconocido':
      return {
        tipo: 'manual',
        orden: 'claude update',
        motivo: 'No se reconoce cómo está instalado Claude Code; su propio actualizador puede saberlo'
      }
  }
}

/** Codex en Windows: nunca `codex update` (el `codex.exe` vivo se bloquearía a sí mismo). */
function ordenCodexWindows({ metodo, plataforma, version }: EntradaOrden): OrdenActualizacion {
  switch (metodo) {
    case 'npm':
    case 'pnpm':
    case 'bun':
      if (!esVersionExacta(version)) return { tipo: 'manual', orden: null, motivo: SIN_VERSION }
      return { tipo: 'auto', orden: ordenGestorJs(metodo, PAQUETE_CODEX, version, plataforma), requiereParar: true }
    case 'vite-plus':
      return {
        tipo: 'manual',
        orden: esVersionExacta(version) ? ordenGestorJs('vite-plus', PAQUETE_CODEX, version, plataforma) : null,
        motivo: 'Codex está instalado con Vite+: ciérralo en todas partes y actualízalo con vp'
      }
    case 'gestor':
      return {
        tipo: 'manual',
        orden: null,
        motivo: 'Codex está instalado con un gestor de paquetes del sistema: actualízalo con ese gestor'
      }
    case 'nativo':
    case 'brew':
    case 'desconocido':
      return {
        tipo: 'manual',
        orden: null,
        motivo: 'No se reconoce cómo está instalado Codex; Tessera sólo lo actualiza si viene de npm, pnpm o bun'
      }
  }
}

/**
 * La orden que actualiza `agente` instalado con `metodo` en `plataforma`, o por qué no
 * hay orden automática. `version` solo se exige exacta cuando la orden la lleva.
 */
export function ordenActualizacion(e: {
  agente: AgentKind
  metodo: MetodoInstalacion
  plataforma: Plataforma
  version: string | null
}): OrdenActualizacion {
  if (e.agente === 'claude-code') return ordenClaude(e)
  // POSIX no bloquea un ejecutable en uso y Codex conoce su gestor: `codex update` sin parar.
  if (e.plataforma !== 'windows') return { tipo: 'auto', orden: 'codex update', requiereParar: false }
  return ordenCodexWindows(e)
}

/**
 * ¿Está publicado el binario de Codex de ESTA plataforma para `version`? npm publica
 * `latest` minutos antes que los paquetes de plataforma: sí solo si el dist-tag
 * `<so>-<arch>` apunta exactamente a `<version>-<so>-<arch>`.
 *
 * @param arch  La de Node (`x64`, `arm64`).
 */
export function binarioCodexPublicado(
  distTags: Record<string, string>,
  version: string,
  plataforma: Plataforma,
  arch: string
): boolean {
  if (!esVersionExacta(version)) return false
  const so = plataforma === 'windows' ? 'win32' : plataforma === 'mac' ? 'darwin' : 'linux'
  const clave = `${so}-${arch}`
  return Object.prototype.hasOwnProperty.call(distTags, clave) && distTags[clave] === `${version}-${clave}`
}

// -----------------------------------------------------------------------------
// 3. ¿Por qué falló?
// -----------------------------------------------------------------------------

// EPERM no es bloqueo por sí solo: en Windows también es un permiso denegado (un prefijo
// protegido). Lo desempatan los bloqueadores (ver `clasificarErrorInstalacion`).
const RE_BLOQUEO = /\bEBUSY\b|resource busy|being used by another process|siendo utilizado por otro proceso/i
const RE_EPERM = /\bEPERM\b/
const RE_PERMISOS = /\bEACCES\b|permission denied|permiso denegado/i
const RE_RED =
  /\bENOTFOUND\b|\bETIMEDOUT\b|\bECONNRESET\b|\bECONNREFUSED\b|\bEAI_AGAIN\b|\bERR_SOCKET\w*|\bnpm (?:ERR!|error) network\b/i

/** El nombre del agente para la frase; sin agente, «el agente». */
function nombreAgente(agente: AgentKind | undefined): string {
  return agente ? ETIQUETA_AGENTE[agente] : 'el agente'
}

/** La última línea con contenido de la salida, recortada, para no enseñar un volcado. */
function ultimaLinea(salida: string): string {
  const lineas = salida
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const l = lineas[lineas.length - 1] ?? ''
  return l.length > 300 ? l.slice(0, 297) + '…' : l
}

type EntradaClasificar = {
  salida: string
  codigo: number | null
  tope: boolean
  plataforma: Plataforma
  bloqueadores: readonly ProcesoBloqueador[]
  agente?: AgentKind
  orden?: string
}

function detalleBloqueado(nombre: string, bloqueadores: readonly ProcesoBloqueador[]): string {
  const quienes =
    bloqueadores.length > 0
      ? ' Siguen abiertos: ' +
        bloqueadores.map((b) => `${b.nombre} (pid ${b.pid}${b.esDemonio ? ', el servicio app-server' : ''})`).join(', ') +
        '.'
      : ''
  return (
    `Algún programa tiene abiertos archivos de ${nombre}: probablemente un ${nombre} abierto fuera de ` +
    `Tessera (tu editor u otra terminal). Ciérralo y vuelve a intentarlo.${quienes}`
  )
}

/** EPERM en Windows sin nadie con la carpeta abierta: prefijo protegido o un antivirus. */
function detallePermisosWindows(e: EntradaClasificar, nombre: string): string {
  const { sistema } = nombresSistema(e.plataforma)
  const elevar = e.orden
    ? `ejecuta en una terminal abierta como administrador: ${e.orden}.`
    : 'actualízalo desde una terminal abierta como administrador.'
  return (
    `${sistema} no dejó escribir donde está instalado ${nombre}. Si es una carpeta ` +
    `protegida (por ejemplo, dentro de Program Files), ${elevar} Si no, puede que un antivirus ` +
    'u otro programa tenga abiertos sus archivos: vuelve a intentarlo.'
  )
}

function detallePermisos(e: EntradaClasificar, nombre: string): string {
  const { tuEquipo } = nombresSistema(e.plataforma)
  // En Windows, sin elevar se repetiría el mismo EACCES.
  const terminal =
    e.plataforma === 'windows' ? `una terminal de ${tuEquipo} abierta como administrador` : `una terminal de ${tuEquipo}`
  return e.orden
    ? `No hay permiso para escribir donde está instalado ${nombre}. Ejecuta esta orden en ${terminal}: ${e.orden}`
    : `No hay permiso para escribir donde está instalado ${nombre}.`
}

/** Motivo y frase de un fallo que no es tope, en orden: bloqueo, permisos, red y genérico. */
function motivoYDetalle(e: EntradaClasificar, nombre: string): { motivo: MotivoErrorInstalacion; detalle: string } {
  const { salida, plataforma } = e
  const eperm = RE_EPERM.test(salida)
  if (plataforma === 'windows' && (RE_BLOQUEO.test(salida) || (eperm && e.bloqueadores.length > 0))) {
    return { motivo: 'bloqueado', detalle: detalleBloqueado(nombre, e.bloqueadores) }
  }
  if (plataforma === 'windows' && eperm) return { motivo: 'permisos', detalle: detallePermisosWindows(e, nombre) }
  if (RE_PERMISOS.test(salida) || (plataforma !== 'windows' && eperm)) {
    return { motivo: 'permisos', detalle: detallePermisos(e, nombre) }
  }
  if (RE_RED.test(salida)) {
    return {
      motivo: 'red',
      detalle: `No se pudo descargar ${nombre}: falló la conexión. Comprueba la red y vuelve a intentarlo.`
    }
  }
  const ultima = ultimaLinea(salida)
  const codigo = e.codigo === null ? '' : ` (código ${e.codigo})`
  return { motivo: 'fallo', detalle: `La instalación de ${nombre} falló${codigo}${ultima ? `: ${ultima}` : '.'}` }
}

/**
 * Traduce una instalación FALLIDA (código ≠ 0 o tope) a un motivo y una frase.
 *
 * @param bloqueadores  Los que se ven bajo la carpeta del paquete al fallar (Windows): se
 *                      nombran, y con un EPERM deciden entre «bloqueado» y «permisos».
 * @param agente        Para nombrarlo en la frase; sin él se dice «el agente».
 * @param orden         La orden que falló; se devuelve como `ordenManual` salvo en «red».
 */
export function clasificarErrorInstalacion(e: EntradaClasificar): ErrorInstalacionClasificado {
  const nombre = nombreAgente(e.agente)
  const conOrden = (r: ErrorInstalacionClasificado): ErrorInstalacionClasificado =>
    e.orden ? { ...r, ordenManual: e.orden } : r
  if (e.tope) {
    return conOrden({
      motivo: 'tope',
      detalle: `La instalación de ${nombre} tardó demasiado y se detuvo. Puede que la red vaya lenta: vuelve a intentarlo.`
    })
  }
  const r = motivoYDetalle(e, nombre)
  return r.motivo === 'red' ? r : conOrden(r)
}
