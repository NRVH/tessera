#!/usr/bin/env node
// =============================================================================
// Sonda de los contratos con Claude Code y Codex: pasa los transcripts reales más recientes de
// esta máquina por los MISMOS lectores de Tessera (historial, cabecera de turnos, marcas de
// turno, anillo de contexto, uso) y dice qué sigue entendiendo. Solo lectura: no ejecuta los
// CLIs, no gasta tokens y no imprime contenido de las conversaciones.
// Dice también cuántos días lleva sin revisarse lo que traen las versiones nuevas.
// Uso: npm run sonda:agentes. Sale con 1 si algún contrato no se entiende en ningún transcript.
// Decisiones: docs/decisiones/agentes/contratos-con-los-cli.md
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { esMac, esWindows } from '../../src/shared/plataforma.ts'
import { ConversationsReader } from '../../src/main/conversations/ConversationsReader.ts'
import { conFechas, rolloutsCodex, transcriptsClaude } from '../../src/main/transcripts/listadoTranscripts.ts'
import { leerCabezaParseada } from '../../src/main/transcripts/cabezaJsonl.ts'
import { metaDeCabecera } from '../../src/main/transcripts/formatoTranscript.ts'
import { ultimaMarca, type AgenteTranscript } from '../../src/main/transcripts/marcasTurno.ts'
import { TAMANO_SOSPECHOSO, versionDeLinea } from '../../src/main/transcripts/vigiaContratos.ts'
import { leerLineasJsonl } from '../../src/main/util/jsonlCola.ts'
import { CABEZA_TURNO, COLA_TURNO_BYTES } from '../../src/main/agents/TurnWatcher.ts'
import { measureClaude, measureCodex } from '../../src/main/context/ContextReader.ts'
import { readCodexRollout } from '../../src/main/usage/UsageReader.ts'

/** Transcripts por CLI que se pasan por los lectores: los más recientes con chicha. */
const MUESTRA = 6
/** Cada cuánto se leen las notas de versión de los dos CLIs. */
const DIAS_REVISION = 14
/** Donde se anota la última lectura de las notas de versión (privado: es proceso, no producto). */
const REGISTRO = join(import.meta.dirname, '..', '..', 'docs', 'TESSERA_DESPLIEGUE.md')

type Veredicto = 'ok' | 'aviso' | 'falla'

interface Comprobacion {
  contrato: string
  /** Qué deja de funcionar en Tessera si falla. */
  efecto: string
  prueba: (file: string, size: number) => Promise<boolean>
}

function datosTessera(): string {
  if (esWindows()) return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Tessera')
  if (esMac()) return join(homedir(), 'Library', 'Application Support', 'Tessera')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Tessera')
}

/** Carpetas de credenciales de un CLI: la del sistema y las de cada cuenta de cada perfil de Tessera. */
function bases(carpeta: 'claude' | 'codex'): string[] {
  const delSistema =
    carpeta === 'claude'
      ? (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'))
      : (process.env.CODEX_HOME ?? join(homedir(), '.codex'))
  const out = [delSistema]
  const perfiles = join(datosTessera(), '.tessera', 'perfiles')
  if (!existsSync(perfiles)) return out
  for (const perfil of readdirSync(perfiles)) {
    const dir = join(perfiles, perfil, carpeta)
    if (!existsSync(dir)) continue
    for (const cuenta of readdirSync(dir)) out.push(join(dir, cuenta))
  }
  return out
}

async function muestra(agente: AgenteTranscript): Promise<Array<{ archivo: string; size: number }>> {
  const archivos: string[] = []
  for (const base of bases(agente === 'codex' ? 'codex' : 'claude')) {
    archivos.push(...(agente === 'codex' ? await rolloutsCodex(base) : await transcriptsClaude(base, { respaldo: 'todas' })))
  }
  const conFecha = (await conFechas(archivos)).filter((a) => a.st.size >= TAMANO_SOSPECHOSO)
  conFecha.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
  return conFecha.slice(0, MUESTRA).map((a) => ({ archivo: a.archivo, size: a.st.size }))
}

const lector = new ConversationsReader()

function comprobaciones(agente: AgenteTranscript): Comprobacion[] {
  const lista: Comprobacion[] = [
    {
      contrato: 'mensajes y título',
      efecto: 'el historial sale vacío y abrir el agente no reanuda su última conversación',
      prueba: async (f) => (await lector.resumenDe(f, agente)) !== null
    },
    {
      contrato: 'cabecera (cwd)',
      efecto: 'los turnos no se atribuyen al proyecto: el punto de estado no ve el fin de turno',
      prueba: async (f) => metaDeCabecera(agente, await leerCabezaParseada(f, CABEZA_TURNO)).cwd !== null
    },
    {
      contrato: 'marcas de turno',
      efecto: 'el fin de turno se deduce solo por silencio: el punto tarda en cambiar',
      prueba: async (f, size) => ultimaMarca(agente, await leerLineasJsonl(f, size, COLA_TURNO_BYTES, 'tail')) !== null
    },
    {
      contrato: 'contexto ocupado',
      efecto: 'el anillo de contexto se queda vacío',
      prueba: async (f, size) => ((await (agente === 'codex' ? measureCodex : measureClaude)(f, size))?.usedTokens ?? 0) > 0
    }
  ]
  if (agente === 'codex') {
    lista.push({
      contrato: 'uso de la cuenta',
      efecto: 'las barras de uso de Codex no se pintan',
      prueba: async (f, size) => (await readCodexRollout(f, size)) !== null
    })
  }
  return lista
}

/**
 * Versiones del CLI que escribieron la muestra, de la más vieja a la más nueva. Claude Code la
 * pone en cada línea (cuenta la última); Codex, solo en la cabecera.
 */
async function versiones(agente: AgenteTranscript, archivos: Array<{ archivo: string; size: number }>): Promise<string[]> {
  const vistas = new Set<string>()
  for (const { archivo, size } of archivos) {
    const lineas =
      agente === 'codex'
        ? await leerCabezaParseada(archivo, CABEZA_TURNO)
        : (await leerLineasJsonl(archivo, size, COLA_TURNO_BYTES, 'tail')).reverse()
    const v = lineas.map(versionDeLinea).find((x) => x !== undefined)
    if (v) vistas.add(v)
  }
  return [...vistas].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** El binario nativo más nuevo de Claude Code, o `null` si la instalación no lo tiene. */
function binarioClaude(): string | null {
  const dir = join(homedir(), '.local', 'share', 'claude', 'versions')
  const instaladas = existsSync(dir)
    ? readdirSync(dir).filter((n) => /^\d+\.\d+\.\d+/.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    : []
  if (instaladas.length === 0) return null
  console.log(`  binario nativo: ${instaladas.at(-1)}`)
  return join(dir, instaladas.at(-1) as string)
}

/** El binario de Codex de la instalación global de npm, o `null` si no está ahí. */
function binarioCodex(): string | null {
  let raiz: string
  try {
    raiz = execSync('npm root -g', { encoding: 'utf8', timeout: 30_000 }).trim()
  } catch {
    return null
  }
  const paquetes = join(raiz, '@openai', 'codex', 'node_modules', '@openai')
  if (!existsSync(paquetes)) return null
  for (const p of readdirSync(paquetes).filter((n) => n.startsWith('codex-'))) {
    const vendor = join(paquetes, p, 'vendor')
    if (!existsSync(vendor)) continue
    for (const destino of readdirSync(vendor)) {
      const ruta = join(vendor, destino, 'bin', esWindows() ? 'codex.exe' : 'codex')
      if (existsSync(ruta)) return ruta
    }
  }
  return null
}

/**
 * ¿Sigue el binario hablando el protocolo de estado (OSC 7501)? Se busca un texto que el binario
 * lleva solo si lo emite: Claude Code lo nombra en su sonda; Codex escribe su `app` en cada aviso.
 */
function estadoInformado(agente: AgenteTranscript): string {
  const ruta = agente === 'claude-code' ? binarioClaude() : binarioCodex()
  if (ruta === null) return 'instalación sin binario localizable: no comprobado'
  const aguja = Buffer.from(agente === 'claude-code' ? 'OSC 7501' : ':app=codex')
  const fd = openSync(ruta, 'r')
  try {
    const trozo = Buffer.alloc(4 * 1024 * 1024)
    let pos = 0
    let previo = Buffer.alloc(0)
    const total = statSync(ruta).size
    while (pos < total) {
      const n = readSync(fd, trozo, 0, trozo.length, pos)
      if (n <= 0) break
      const ventana = Buffer.concat([previo, trozo.subarray(0, n)])
      if (ventana.includes(aguja)) return 'ok'
      previo = ventana.subarray(Math.max(0, ventana.length - aguja.length))
      pos += n
    }
    return 'FALLA: el binario ya no emite OSC 7501; el punto vuelve a deducir el estado'
  } finally {
    closeSync(fd)
  }
}

function diasDesdeRevision(): { dias: number | null; linea: string } {
  // Sin el runbook (un clon del repo público) no hay nada que recordar.
  if (!existsSync(REGISTRO)) return { dias: null, linea: '' }
  const m = readFileSync(REGISTRO, 'utf8').match(/Última revisión de las notas de versión:\*{0,2}\s*(\d{4}-\d{2}-\d{2})[^\n]*/)
  if (!m) return { dias: null, linea: 'Las notas de versión de los CLIs no se han revisado nunca.' }
  return { dias: Math.floor((Date.now() - Date.parse(m[1])) / 86_400_000), linea: m[0].replace(/\*/g, '') }
}

async function sondear(agente: AgenteTranscript, nombre: string): Promise<boolean> {
  const archivos = await muestra(agente)
  console.log(`\n${nombre}`)
  if (archivos.length === 0) {
    console.log('  sin transcripts de este CLI en esta máquina: nada que comprobar')
    return true
  }
  const vers = await versiones(agente, archivos)
  console.log(`  ${archivos.length} transcripts recientes, versiones ${vers.join(', ') || 'desconocidas'}`)
  let bien = true
  for (const c of comprobaciones(agente)) {
    let pasan = 0
    for (const { archivo, size } of archivos) if (await c.prueba(archivo, size).catch(() => false)) pasan++
    const v: Veredicto = pasan === archivos.length ? 'ok' : pasan === 0 ? 'falla' : 'aviso'
    if (v === 'falla') bien = false
    console.log(`  ${MARCA[v]} ${c.contrato}: ${pasan}/${archivos.length}${v === 'ok' ? '' : ` (si falla, ${c.efecto})`}`)
  }
  if (!sondearEstadoInformado(agente)) bien = false
  return bien
}

const MARCA: Record<Veredicto, string> = { ok: 'ok   ', aviso: 'aviso', falla: 'FALLA' }

function sondearEstadoInformado(agente: AgenteTranscript): boolean {
  const estado = estadoInformado(agente)
  const v: Veredicto = estado === 'ok' ? 'ok' : estado.startsWith('FALLA') ? 'falla' : 'aviso'
  console.log(`  ${MARCA[v]} estado informado (OSC 7501): ${estado}`)
  return v !== 'falla'
}

const okClaude = await sondear('claude-code', 'Claude Code')
const okCodex = await sondear('codex', 'Codex')

const { dias, linea } = diasDesdeRevision()
if (linea) {
  console.log(`\n${linea}`)
  if (dias === null || dias >= DIAS_REVISION) {
    console.log(`Toca leer las notas de versión de los dos CLIs (cada ${DIAS_REVISION} días; ver §3.2 de TESSERA_DESPLIEGUE.md).`)
  } else {
    console.log(`Notas de versión al día: faltan ${DIAS_REVISION - dias} días para la siguiente lectura.`)
  }
}

console.log(
  okClaude && okCodex
    ? '\nVEREDICTO: los lectores de Tessera entienden lo que escriben los CLIs instalados.'
    : '\nVEREDICTO: hay contratos rotos; ver el ADR de contratos antes de publicar.'
)
process.exit(okClaude && okCodex ? 0 : 1)
