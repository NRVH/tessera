// =============================================================================
// Agentes definidos a mano: su definición (nombre, comando, cómo reanudar, instalación en
// Docker, si sirve en la terminal y de dónde sale su contexto), el id seguro que sale del nombre, la validación, la
// copia en JSON y la invocación que se lanza. Puro: sin `fs`, Electron ni `process`; lo
// usan el main, el renderer y los `test-*.mts`.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import type { AgentKind } from './agent-terminal-ipc.ts'
import { validarFuenteContexto, type FuenteContexto } from './contextoAgenteManual.ts'
import { txAgentesManuales } from './textosAgentes.ts'

/** Id de un agente manual: `m-` y un slug, porque acaba en rutas del perfil y en una línea de `sh`. */
export type IdAgenteManual = `m-${string}`

/**
 * La cuenta predeterminada de un agente manual en Docker: su carpeta del perfil, sin entrada en el
 * registro de cuentas. Las que cree el usuario sí van al registro, cada una con su carpeta.
 */
export const CUENTA_AGENTE_MANUAL = 'manual'

/** Cualquier agente de una pestaña: uno de serie o uno manual. */
export type IdAgente = AgentKind | IdAgenteManual

export interface DefinicionAgente {
  id: IdAgenteManual
  nombre: string
  /** Tal como se teclea en la terminal del proyecto; se lanza sin tocar. */
  comando: string
  /** Argumentos que se añaden al abrir para retomar la última conversación (p. ej. `--continue`). */
  reanudar?: string
  /** Solo Docker: órdenes de shell que se hornean en la capa de imagen del perfil. */
  instalacion?: string
  /** Si se ofrece también como agente de la terminal (recibe el contexto solo por `AGENTS.md`). */
  enTerminal?: boolean
  /** De dónde sale su contexto; sin ella, el pie no enseña el anillo. */
  contexto?: FuenteContexto
}

export const MAX_NOMBRE = 40
export const MAX_COMANDO = 500
export const MAX_REANUDAR = 200
export const MAX_INSTALACION = 4000

const RE_ID = /^m-[a-z0-9][a-z0-9-]{0,30}$/

/**
 * ¿Lleva caracteres de control? El tabulador vale siempre; los saltos de línea (LF y CR) solo si
 * `multilinea` (las órdenes de instalación son varias líneas; un comando o un nombre no).
 */
function tieneControl(valor: string, multilinea: boolean): boolean {
  for (let i = 0; i < valor.length; i++) {
    const c = valor.charCodeAt(i)
    if (c === 9 || (multilinea && (c === 10 || c === 13))) continue
    if (c < 32 || c === 127) return true
  }
  return false
}

export function esAgenteManual(id: string): id is IdAgenteManual {
  return RE_ID.test(id)
}

/** El id que sale del nombre: minúsculas ASCII y guiones, único entre `existentes`. */
export function idDesdeNombre(nombre: string, existentes: readonly string[]): IdAgenteManual {
  const base =
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'agente'
  let id: IdAgenteManual = `m-${base}`
  for (let n = 2; existentes.includes(id); n++) id = `m-${base}-${n}`
  return id
}

export type ResultadoDefinicion = { ok: true; valor: DefinicionAgente } | { ok: false; error: string }

type Campos = Record<string, unknown>

function texto(c: Campos, clave: string): string | undefined {
  const v = c[clave]
  return typeof v === 'string' ? v.trim() : undefined
}

/** Nombre, comando y reanudar: una línea, sin controles y con su tope. */
function errorDeLinea(
  campo: 'nombre' | 'comando' | 'reanudar',
  valor: string | undefined,
  max: number,
  obligatorio: boolean
): string | null {
  const t = txAgentesManuales()[campo]
  if (!valor) return obligatorio ? t.falta : null
  if (valor.length > max) return t.pasaDe(max)
  if (tieneControl(valor, false)) return t.unaLinea
  return null
}

function errorDeInstalacion(valor: string | undefined, docker: boolean): string | null {
  const t = txAgentesManuales()
  if (!valor) return null
  if (!docker) return t.instalacionSoloDocker
  if (valor.length > MAX_INSTALACION) return t.instalacionLarga(MAX_INSTALACION)
  if (tieneControl(valor, true)) return t.instalacionControl
  return null
}

/**
 * Valida una definición tal como llega (del modal, del disco o de un JSON pegado). `docker`
 * dice si es de un perfil con Docker, el único sitio donde caben órdenes de instalación.
 */
export function validarDefinicion(raw: unknown, docker: boolean): ResultadoDefinicion {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: txAgentesManuales().noEsObjeto }
  const c = raw as Campos
  const id = typeof c.id === 'string' ? c.id : ''
  if (!esAgenteManual(id)) return { ok: false, error: txAgentesManuales().idNoValido }
  const nombre = texto(c, 'nombre')
  const comando = texto(c, 'comando')
  const reanudar = texto(c, 'reanudar')
  const instalacion = typeof c.instalacion === 'string' ? c.instalacion.replace(/\r\n/g, '\n').trim() : undefined
  const error =
    errorDeLinea('nombre', nombre, MAX_NOMBRE, true) ??
    errorDeLinea('comando', comando, MAX_COMANDO, true) ??
    errorDeLinea('reanudar', reanudar, MAX_REANUDAR, false) ??
    errorDeInstalacion(instalacion, docker)
  if (error) return { ok: false, error }
  const contexto = validarFuenteContexto(c.contexto)
  if (!contexto.ok) return contexto
  const valor: DefinicionAgente = { id, nombre: nombre!, comando: comando! }
  if (reanudar) valor.reanudar = reanudar
  if (instalacion) valor.instalacion = instalacion
  if (c.enTerminal === true) valor.enTerminal = true
  if (contexto.valor) valor.contexto = contexto.valor
  return { ok: true, valor }
}

/** Las definiciones válidas de una lista leída del disco, sin ids repetidos; lo demás se descarta. */
export function normalizarDefiniciones(raw: unknown, docker: boolean): DefinicionAgente[] {
  if (!Array.isArray(raw)) return []
  const vistos = new Set<string>()
  const fuera: DefinicionAgente[] = []
  for (const item of raw) {
    const r = validarDefinicion(item, docker)
    if (!r.ok || vistos.has(r.valor.id)) continue
    vistos.add(r.valor.id)
    fuera.push(r.valor)
  }
  return fuera
}

/** ¿Es el id de un agente, de serie o manual? */
export function esIdAgente(id: unknown): id is IdAgente {
  return id === 'claude-code' || id === 'codex' || (typeof id === 'string' && esAgenteManual(id))
}

/**
 * Listas de ids de agente por perfil leídas del disco (los ocultos y el orden): solo ids
 * válidos, sin repetir y sin listas vacías. Acepta las de antes, que solo traían de serie.
 */
export function normalizarIdsAgentePorPerfil(raw: unknown): Record<string, IdAgente[]> {
  const fuera: Record<string, IdAgente[]> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fuera
  for (const [perfil, lista] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue
    const ids = [...new Set(lista.filter(esIdAgente))]
    if (ids.length > 0) fuera[perfil] = ids
  }
  return fuera
}

/** Cómo se elige el agente en la cabecera: pestañas o un desplegable. */
export type SelectorAgentes = 'pestanas' | 'lista'

/** El selector leído del disco; cualquier otra cosa, pestañas. */
export function normalizarSelectorAgentes(raw: unknown): SelectorAgentes {
  return raw === 'lista' ? 'lista' : 'pestanas'
}

/** Versión del formato de copia; una Tessera más vieja que el texto pegado no lo acepta. */
export const VERSION_JSON_AGENTE = 1

/** La definición como texto para copiar: sin el id, que lo pone quien la pega. */
export function definicionComoJson(d: DefinicionAgente): string {
  const copia: Campos = { tessera: 'agente', version: VERSION_JSON_AGENTE, nombre: d.nombre, comando: d.comando }
  if (d.reanudar) copia.reanudar = d.reanudar
  if (d.instalacion) copia.instalacion = d.instalacion
  if (d.enTerminal) copia.enTerminal = true
  if (d.contexto) copia.contexto = d.contexto
  return JSON.stringify(copia, null, 2)
}

/**
 * Una definición pegada como JSON, con un id nuevo que no choca con `existentes`. Las órdenes
 * de instalación se descartan si el destino es nativo, donde no tienen sentido.
 */
export function definicionDesdeJson(textoPegado: string, existentes: readonly string[], docker: boolean): ResultadoDefinicion {
  let c: unknown
  try {
    c = JSON.parse(textoPegado)
  } catch {
    return { ok: false, error: txAgentesManuales().noEsJson }
  }
  if (typeof c !== 'object' || c === null || (c as Campos).tessera !== 'agente') {
    return { ok: false, error: txAgentesManuales().noEsAgente }
  }
  const campos = c as Campos
  if (typeof campos.version !== 'number' || campos.version > VERSION_JSON_AGENTE) {
    return { ok: false, error: txAgentesManuales().masNueva }
  }
  const nombre = typeof campos.nombre === 'string' ? campos.nombre : ''
  const candidata = { ...campos, id: idDesdeNombre(nombre, existentes), instalacion: docker ? campos.instalacion : undefined }
  return validarDefinicion(candidata, docker)
}

/** El programa que se busca en el PATH o en la imagen: la primera palabra del comando, sin comillas. */
export function programaDelComando(comando: string): string {
  const t = comando.trim()
  const cita = t[0] === '"' || t[0] === "'" ? t[0] : null
  if (cita) {
    const fin = t.indexOf(cita, 1)
    return fin > 0 ? t.slice(1, fin) : t.slice(1)
  }
  return t.split(/\s+/)[0] ?? ''
}

/** Lo que se lanza: el comando tal cual y, si se reanuda y hay cómo, sus argumentos detrás. */
export function invocacionAgenteManual(d: DefinicionAgente, reanudar: boolean): string {
  return reanudar && d.reanudar ? `${d.comando} ${d.reanudar}` : d.comando
}
