// =============================================================================
// La lista de conexiones SSH de un perfil, en lógica pura: el orden («Sin grupo» primero, luego
// los grupos, y dentro las conexiones), el filtro sin tildes ni mayúsculas, los grupos plegados, el
// acordeón del lanzador (un solo grupo abierto, y ninguno al abrirlo), las conexiones recientes, las
// filas que pinta el árbol, cómo se escribe el destino de una conexión y qué hace cada tecla del
// teclado (`accionTeclaLista`). Sin React ni DOM: se fija bajo `node` (`test-lista-ssh.mts`).
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import type { Plataforma } from '../../../../shared/plataforma.ts'
import type { SshConexion, SshGrupo } from '../../../../shared/ssh-ipc.ts'
import { SSH_PLEGADO_SIN_GRUPO, SSH_RECIENTES_MAX } from '../../../../shared/ajustesTerminal.ts'
import { esBorrarPestanaEnfocada, type TeclaBorrado } from '../../util/atajos.ts'

/** El id con el que los plegados nombran a «Sin grupo». */
export const ID_SIN_GRUPO = SSH_PLEGADO_SIN_GRUPO

/** El nombre visible de «Sin grupo». */
export const NOMBRE_SIN_GRUPO = 'Sin grupo'

/** Cuántas conexiones recientes enseña el lanzador. */
export const RECIENTES_MAX = SSH_RECIENTES_MAX

/** Los rótulos del lanzador: sus recientes y, en una lista sin grupos, el resto de las conexiones que vienen tras ellas. */
export const NOMBRE_RECIENTES = 'Recientes'
export const NOMBRE_CONEXIONES = 'Conexiones'

/** El puerto que no se escribe en el destino. */
const PUERTO_POR_DEFECTO = 22

/** La cabecera de un grupo (o de «Sin grupo», con `real: false`). */
export interface FilaGrupo {
  tipo: 'grupo'
  /** Clave estable de la fila: `g:<id>`. */
  clave: string
  grupoId: string
  nombre: string
  /** Las conexiones que la lista enseña bajo ella (con filtro, las que coinciden). */
  total: number
  abierto: boolean
  /** `false` en «Sin grupo»: no se renombra ni se elimina. */
  real: boolean
}

/** Un rótulo («Recientes»): no se pulsa ni se alcanza con el teclado. */
export interface FilaSeccion {
  tipo: 'seccion'
  /** Clave estable de la fila: `s:<id>`. */
  clave: string
  nombre: string
}

/** Una conexión; `nivel` 2 cuelga de una cabecera y 1 va suelta (lista plana, o bajo «Recientes»). */
export interface FilaConexion {
  tipo: 'conexion'
  clave: string
  conexion: SshConexion
  nivel: 1 | 2
  /** Sale bajo «Recientes»: la misma conexión sigue también en su grupo. */
  reciente?: true
}

export type FilaLista = FilaSeccion | FilaGrupo | FilaConexion

/** Lo que hace falta para construir la lista de un perfil. */
export interface EntradaLista {
  grupos: readonly SshGrupo[]
  conexiones: readonly SshConexion[]
  filtro: string
  /** Ids de los grupos plegados (`''` = «Sin grupo»). Con filtro se ignoran. */
  plegados: ReadonlySet<string>
  /** Las conexiones recientes que enseña el lanzador, la más reciente primero. Con filtro no salen. */
  recientes?: readonly SshConexion[]
}

/** `usuario@host`, con `:puerto` solo si no es el 22. */
export function destinoSsh(c: Pick<SshConexion, 'usuario' | 'host' | 'puerto'>): string {
  return `${c.usuario}@${c.host}${c.puerto === PUERTO_POR_DEFECTO ? '' : `:${c.puerto}`}`
}

/** El texto sin tildes ni mayúsculas, para comparar. */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Orden de nombres: sin mayúsculas ni tildes, con los números por su valor; el empate lo desata el texto crudo. */
export function compararNombres(a: string, b: string): number {
  const c = a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })
  return c !== 0 ? c : a < b ? -1 : a > b ? 1 : 0
}

/** Las palabras de un filtro, normalizadas. Vacío = sin filtro. */
function palabrasDe(filtro: string): string[] {
  return normalizarBusqueda(filtro).split(/\s+/).filter((p) => p !== '')
}

/** ¿Están todas las palabras en el texto? */
function contieneTodas(texto: string, palabras: readonly string[]): boolean {
  const t = normalizarBusqueda(texto)
  return palabras.every((p) => t.includes(p))
}

/** El grupo conocido de una conexión, o `null` (sin grupo, o uno que esta versión no conoce). */
function grupoDe(c: SshConexion, porId: ReadonlyMap<string, SshGrupo>): SshGrupo | null {
  return c.grupoId === null ? null : (porId.get(c.grupoId) ?? null)
}

/** Alias, host, usuario y nombre del grupo: nunca el puerto ni el id. */
function pajar(c: SshConexion, grupo: SshGrupo | null): string {
  return `${c.alias} ${c.host} ${c.usuario} ${grupo?.nombre ?? ''}`
}

function porAlias(a: SshConexion, b: SshConexion): number {
  return compararNombres(a.alias, b.alias)
}

/** Las conexiones de cada grupo (`''` = sin grupo) que pasan el filtro, ya ordenadas. */
function repartir(e: EntradaLista, palabras: readonly string[], porId: ReadonlyMap<string, SshGrupo>): Map<string, SshConexion[]> {
  const reparto = new Map<string, SshConexion[]>()
  for (const c of e.conexiones) {
    const grupo = grupoDe(c, porId)
    if (palabras.length > 0 && !contieneTodas(pajar(c, grupo), palabras)) continue
    const id = grupo?.id ?? ID_SIN_GRUPO
    const lista = reparto.get(id)
    if (lista) lista.push(c)
    else reparto.set(id, [c])
  }
  for (const lista of reparto.values()) lista.sort(porAlias)
  return reparto
}

/** La fila de una conexión; la de «Recientes» lleva otra clave, porque la misma conexión sale también en su grupo. */
function filaConexion(c: SshConexion, nivel: 1 | 2, reciente = false): FilaConexion {
  return reciente
    ? { tipo: 'conexion', clave: `r:${c.id}`, conexion: c, nivel, reciente: true }
    : { tipo: 'conexion', clave: `c:${c.id}`, conexion: c, nivel }
}

function filaSeccion(id: string, nombre: string): FilaSeccion {
  return { tipo: 'seccion', clave: `s:${id}`, nombre }
}

/** La cabecera y, si está abierta, sus conexiones. */
function bloqueDeGrupo(
  g: { id: string; nombre: string; real: boolean },
  conexiones: readonly SshConexion[],
  abierto: boolean
): FilaLista[] {
  const cabecera: FilaGrupo = {
    tipo: 'grupo',
    clave: `g:${g.id}`,
    grupoId: g.id,
    nombre: g.nombre,
    total: conexiones.length,
    abierto,
    real: g.real
  }
  return abierto ? [cabecera, ...conexiones.map((c) => filaConexion(c, 2))] : [cabecera]
}

/** El árbol de grupos y conexiones, sin las recientes. */
function filasDelArbol(e: EntradaLista, palabras: readonly string[]): FilaLista[] {
  const porId = new Map(e.grupos.map((g) => [g.id, g]))
  const reparto = repartir(e, palabras, porId)
  const abierto = (id: string): boolean => palabras.length > 0 || !e.plegados.has(id)
  if (e.grupos.length === 0) return (reparto.get(ID_SIN_GRUPO) ?? []).map((c) => filaConexion(c, 1))
  const filas: FilaLista[] = []
  const sueltas = reparto.get(ID_SIN_GRUPO) ?? []
  if (sueltas.length > 0) {
    filas.push(...bloqueDeGrupo({ id: ID_SIN_GRUPO, nombre: NOMBRE_SIN_GRUPO, real: false }, sueltas, abierto(ID_SIN_GRUPO)))
  }
  for (const g of [...e.grupos].sort((a, b) => compararNombres(a.nombre, b.nombre))) {
    const suyas = reparto.get(g.id) ?? []
    const casa = palabras.length === 0 || contieneTodas(g.nombre, palabras)
    if (suyas.length === 0 && !casa) continue
    filas.push(...bloqueDeGrupo({ id: g.id, nombre: g.nombre, real: true }, suyas, abierto(g.id)))
  }
  return filas
}

/**
 * Las filas del árbol. Sin ningún grupo en el perfil es una lista plana, sin cabeceras. Con grupos:
 * «Sin grupo» primero y solo si tiene conexiones, luego los grupos por nombre. Con filtro se
 * ignoran los plegados, los grupos sin coincidencias desaparecen y uno cuyo nombre casa trae todas
 * sus conexiones (el nombre del grupo está en lo que se busca). Delante van las recientes, solo sin
 * filtro: un rótulo y sus conexiones, que siguen también en su grupo; la lista plana, que no tiene
 * cabeceras, lleva otro rótulo detrás para que no se lea como una repetición.
 */
export function construirFilas(e: EntradaLista): FilaLista[] {
  const palabras = palabrasDe(e.filtro)
  const arbol = filasDelArbol(e, palabras)
  const recientes = palabras.length === 0 ? (e.recientes ?? []) : []
  if (recientes.length === 0) return arbol
  const resto = e.grupos.length === 0 ? [filaSeccion('conexiones', NOMBRE_CONEXIONES)] : []
  return [filaSeccion('recientes', NOMBRE_RECIENTES), ...recientes.map((c) => filaConexion(c, 1, true)), ...resto, ...arbol]
}

// ---------------------------------------------------------------------------
// El lanzador: un solo grupo abierto y las conexiones recientes
// ---------------------------------------------------------------------------

/**
 * Los grupos que se pliegan cuando solo puede haber UNO abierto (el lanzador): todos menos `abierto`, que
 * al abrirlo es `null` (todos plegados). «Sin grupo» cuenta como uno más (su id es `''`), y un id que no
 * es de ningún grupo tampoco deja ninguno abierto.
 */
export function plegadosDeAcordeon(grupos: readonly SshGrupo[], abierto: string | null): Set<string> {
  const plegados = new Set<string>([ID_SIN_GRUPO, ...grupos.map((g) => g.id)])
  if (abierto !== null) plegados.delete(abierto)
  return plegados
}

/**
 * Qué grupo queda abierto tras pedir plegar o desplegar `grupoId` cuando solo puede haber uno: desplegarlo
 * cierra el que hubiera, y plegarlo no deja ninguno si era el abierto.
 */
export function siguienteGrupoAbierto(abierto: string | null, grupoId: string, plegar: boolean): string | null {
  if (!plegar) return grupoId
  return abierto === grupoId ? null : abierto
}

/** Las conexiones recientes de un perfil: las que siguen existiendo, en su orden y hasta `RECIENTES_MAX`. */
export function recientesDe(ids: readonly string[] | undefined, conexiones: readonly SshConexion[]): SshConexion[] {
  const porId = new Map(conexiones.map((c) => [c.id, c]))
  const out: SshConexion[] = []
  for (const id of ids ?? []) {
    const c = porId.get(id)
    if (c && !out.includes(c)) out.push(c)
    if (out.length >= RECIENTES_MAX) break
  }
  return out
}

/** El índice de la primera conexión (donde nace el cursor), o 0 si solo hay cabeceras, o -1 si no hay filas. */
export function primeraConexion(filas: readonly FilaLista[]): number {
  if (filas.length === 0) return -1
  const i = filas.findIndex((f) => f.tipo === 'conexion')
  return i === -1 ? 0 : i
}

/** El índice de la cabecera de la que cuelga la fila `indice`, o -1 si va suelta o es ella misma. */
export function cabeceraDe(filas: readonly FilaLista[], indice: number): number {
  const f = filas[indice]
  if (f?.tipo !== 'conexion' || f.nivel === 1) return -1
  for (let i = indice - 1; i >= 0; i--) if (filas[i].tipo === 'grupo') return i
  return -1
}

/** El texto del estado «el filtro no casa con nada». */
export function textoSinCoincidencias(filtro: string): string {
  return `Ninguna conexión coincide con "${filtro.trim()}"`
}

// ---------------------------------------------------------------------------
// Teclado
// ---------------------------------------------------------------------------

/** Lo que hace falta de un evento de teclado para decidir (lo cumple el `KeyboardEvent` de React). */
export type TeclaLista = TeclaBorrado

/** Lo que la lista sabe en el momento de la tecla. */
export interface ContextoTeclaLista {
  filas: readonly FilaLista[]
  /** Índice de la fila activa, o -1 si no hay. */
  activo: number
  /** Con texto en el filtro las flechas laterales, Inicio, Fin y Supr son del campo, no de la lista. */
  filtroVacio: boolean
}

/** Qué pide una tecla sobre la lista. */
export type AccionLista =
  | { tipo: 'mover'; indice: number }
  | { tipo: 'plegar'; grupoId: string; plegar: boolean }
  | { tipo: 'conectar'; conexionId: string }
  | { tipo: 'editar'; conexionId: string }
  | { tipo: 'renombrarGrupo'; grupoId: string }
  | { tipo: 'eliminarConexion'; conexionId: string }
  | { tipo: 'eliminarGrupo'; grupoId: string }
  | { tipo: 'menu'; indice: number }

function sinModificadores(e: TeclaLista): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}

/** La fila activa, si es de las que se alcanzan con el teclado (un rótulo no lo es). */
function filaActiva(c: ContextoTeclaLista): FilaGrupo | FilaConexion | undefined {
  const fila = c.filas[c.activo]
  return fila?.tipo === 'seccion' ? undefined : fila
}

/** El índice de la fila alcanzable más cercana a `desde` en la dirección `paso`, o `null` si no queda ninguna. */
function vecina(filas: readonly FilaLista[], desde: number, paso: 1 | -1): number | null {
  for (let i = desde + paso; i >= 0 && i < filas.length; i += paso) if (filas[i].tipo !== 'seccion') return i
  return null
}

/** ↑ y ↓ (y Inicio y Fin con el filtro vacío): se queda en los extremos, no da la vuelta, y salta los rótulos. */
function teclaDeMovimiento(e: TeclaLista, c: ContextoTeclaLista): AccionLista | null {
  const primera = vecina(c.filas, -1, 1)
  const ultima = vecina(c.filas, c.filas.length, -1)
  if (primera === null || ultima === null || !sinModificadores(e)) return null
  if (e.key === 'ArrowDown') return { tipo: 'mover', indice: c.activo < 0 ? primera : (vecina(c.filas, c.activo, 1) ?? c.activo) }
  if (e.key === 'ArrowUp') return { tipo: 'mover', indice: c.activo < 0 ? primera : (vecina(c.filas, c.activo, -1) ?? c.activo) }
  if (!c.filtroVacio) return null
  if (e.key === 'Home') return { tipo: 'mover', indice: primera }
  if (e.key === 'End') return { tipo: 'mover', indice: ultima }
  return null
}

/** ← pliega (o sube a la cabecera) y → despliega (o baja a la primera conexión), solo con el filtro vacío. */
function teclaLateral(e: TeclaLista, c: ContextoTeclaLista): AccionLista | null {
  const fila = filaActiva(c)
  if (!c.filtroVacio || !fila || !sinModificadores(e)) return null
  if (e.key === 'ArrowLeft') {
    if (fila.tipo === 'grupo') return fila.abierto ? { tipo: 'plegar', grupoId: fila.grupoId, plegar: true } : null
    const cabecera = cabeceraDe(c.filas, c.activo)
    return cabecera === -1 ? null : { tipo: 'mover', indice: cabecera }
  }
  if (e.key !== 'ArrowRight' || fila.tipo !== 'grupo') return null
  if (!fila.abierto) return { tipo: 'plegar', grupoId: fila.grupoId, plegar: false }
  return c.filas[c.activo + 1]?.tipo === 'conexion' ? { tipo: 'mover', indice: c.activo + 1 } : null
}

/** Intro conecta (o pliega una cabecera, si no hay filtro) y F2 edita o renombra. */
function teclaDeAccion(e: TeclaLista, c: ContextoTeclaLista): AccionLista | null {
  const fila = filaActiva(c)
  if (!fila || !sinModificadores(e)) return null
  if (e.key === 'Enter') {
    if (fila.tipo === 'conexion') return { tipo: 'conectar', conexionId: fila.conexion.id }
    return c.filtroVacio ? { tipo: 'plegar', grupoId: fila.grupoId, plegar: fila.abierto } : null
  }
  if (e.key !== 'F2') return null
  if (fila.tipo === 'conexion') return { tipo: 'editar', conexionId: fila.conexion.id }
  return fila.real ? { tipo: 'renombrarGrupo', grupoId: fila.grupoId } : null
}

/** Supr (⌘⌫ en Mac) elimina lo activo, con confirmación del que llama; con texto en el filtro es del campo. */
function teclaDeBorrado(e: TeclaLista, c: ContextoTeclaLista, plataforma: Plataforma): AccionLista | null {
  const fila = filaActiva(c)
  if (!fila || !c.filtroVacio || !esBorrarPestanaEnfocada(e, plataforma)) return null
  if (fila.tipo === 'conexion') return { tipo: 'eliminarConexion', conexionId: fila.conexion.id }
  return fila.real ? { tipo: 'eliminarGrupo', grupoId: fila.grupoId } : null
}

/** Mayús+F10 o la tecla de menú abren el menú de la fila activa. */
function teclaDeMenu(e: TeclaLista, c: ContextoTeclaLista): AccionLista | null {
  if (filaActiva(c) === undefined) return null
  const mayusF10 = e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
  const teclaMenu = e.key === 'ContextMenu' && !e.ctrlKey && !e.metaKey && !e.altKey
  return mayusF10 || teclaMenu ? { tipo: 'menu', indice: c.activo } : null
}

/**
 * Qué pide una tecla sobre la lista, o `null` si no es suya. La plataforma es un PARÁMETRO: el
 * gesto de borrar cambia de tecla entre sistemas y los dos se fijan en `test-lista-ssh.mts`.
 */
export function accionTeclaLista(e: TeclaLista, c: ContextoTeclaLista, plataforma: Plataforma): AccionLista | null {
  return (
    teclaDeMovimiento(e, c) ??
    teclaLateral(e, c) ??
    teclaDeAccion(e, c) ??
    teclaDeBorrado(e, c, plataforma) ??
    teclaDeMenu(e, c)
  )
}
