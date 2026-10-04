// =============================================================================
// filasArbolBdAjenas — las conexiones AJENAS (que esta versión no sabe abrir) en el lateral de
// BD: su causa, sus filas detrás de las del árbol, qué hacen las teclas sobre ellas y UN SOLO
// criterio para todo texto que las explica (fila, tooltip, diálogo de eliminar, montaje).
// Puro; lo reexporta `filasArbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import { ALIAS_MAX } from '../../../../shared/db-ipc.ts'
import { esMotor } from '../../../../shared/motores/index.ts'
import { accionTecla, claveBd, coincidenciaDe, esContenedor, normalizarBusqueda } from './arbolBd.ts'
import { fraseConsolas, listaNatural } from './filasArbolBdTextos.ts'
import type { AccionTeclaBd, Coincidencia, FilaBd } from './arbolBd.ts'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc.ts'
import type { DbComparteId, DbConexionAjena, DbConnection } from '../../../../shared/db-ipc.ts'

/** Por qué esta versión no sabe usar una ajena: motor desconocido, forma que no reconoce o id repetido. */
export type CausaAjena = 'motor' | 'forma' | 'idRepetido'

/**
 * La causa: el id repetido si el main lo dice; si no, por el motor (`esMotor`, que usa
 * `hasOwnProperty`: un motor «toString» no es conocido): si lo conoce, lo que no reconoce es su forma.
 */
export function causaAjena(a: Pick<DbConexionAjena, 'motor' | 'idRepetido'>): CausaAjena {
  if (a.idRepetido !== undefined) return 'idRepetido'
  return esMotor(a.motor) ? 'forma' : 'motor'
}

/** Lo que dice la fila de una ajena de motor desconocido, detrás de su alias y su motor. */
export const TEXTO_AJENA = 'Requiere una versión más nueva de Tessera'

/**
 * Lo que dice la fila de una ajena de un motor conocido guardada de una forma que no reconoce.
 * No afirma ninguna de las dos posibilidades (versión más nueva o edición a mano).
 */
export const TEXTO_AJENA_FORMA = 'Esta versión no reconoce cómo está guardada'

/** Con quién comparte el id una ajena por id repetido: «A», «una conexión de otro perfil» o null si ya no queda. */
function otraDelId(c: DbComparteId): string | null {
  if (c.tipo === 'conexion') return `«${c.alias.slice(0, ALIAS_MAX)}»`
  return c.tipo === 'otroPerfil' ? 'una conexión de otro perfil' : null
}

/** El aviso corto de una ajena: el de la fila del árbol y el del popover de montaje. */
export function textoAjena(a: DbConexionAjena): string {
  if (a.idRepetido !== undefined) {
    const otra = otraDelId(a.idRepetido)
    return otra === null ? 'Compartía el identificador con una conexión eliminada' : `Comparte el identificador con ${otra}`
  }
  return causaAjena(a) === 'motor' ? TEXTO_AJENA : TEXTO_AJENA_FORMA
}

/**
 * El PORQUÉ entero de una ajena, con la salida de quien quiere USARLA. Es la misma frase en el
 * tooltip, en el diálogo de eliminar y en el popover de montaje; lo que cambia de un sitio a
 * otro (desmontar, eliminar) lo añade cada uno detrás.
 */
export function explicacionAjena(a: Pick<DbConexionAjena, 'motor' | 'idRepetido'>): string {
  if (a.idRepetido !== undefined) {
    const otra = otraDelId(a.idRepetido)
    if (otra === null) {
      return (
        'Compartía el identificador con una conexión eliminada: Tessera lee las conexiones al ' +
        'arrancar y hasta entonces la sigue tratando como repetida, así que reinicia Tessera para ' +
        'usarla. Se conserva tal cual.'
      )
    }
    return (
      `Comparte el identificador con ${otra}: esta versión no puede distinguirlas, y todo lo que se ` +
      `hace por ese identificador llega a la otra. Se conserva tal cual; elimínala si sobra.`
    )
  }
  return causaAjena(a) === 'motor'
    ? `${TEXTO_AJENA}: la creó una versión más nueva, y esta no conoce su motor ni sabe ` +
        'abrirla. Se conserva tal cual; actualiza Tessera para usarla.'
    : `${TEXTO_AJENA_FORMA}: puede venir de una versión más nueva de Tessera (actualiza ` +
        'para usarla) o de una edición a mano del archivo. Se conserva tal cual, sin tocarla.'
}

/**
 * La fila de una conexión ajena: profundidad 0, hermana de las conexiones. Su clave
 * (`claveBd.ajena`) lleva el id en la misma posición que las demás, así que la poda por
 * conexión la trata como a cualquier otra.
 */
export interface FilaAjena {
  kind: 'ajena'
  key: string
  depth: 0
  conexionId: string
  ajena: DbConexionAjena
  /** Solo con búsqueda: dónde coincide el alias. */
  coincidencia?: Coincidencia
}

/** Cualquier fila del lateral: las del árbol y, detrás, las ajenas. */
export type FilaArbol = FilaBd | FilaAjena

/**
 * Las filas de las ajenas, en el orden en que LLEGAN del main (el que tenían en la versión que
 * sabe usarlas). Con `filtro`, solo las que coinciden por el alias, con la regla del aplanador.
 */
export function filasAjenas(ajenas: readonly DbConexionAjena[], filtro = ''): FilaAjena[] {
  const f = normalizarBusqueda(filtro)
  const out: FilaAjena[] = []
  // Cuántas van ya de cada id (la segunda lleva otra clave). Se cuenta ANTES de filtrar, para
  // que la clave de una fila no cambie según lo que se busca: la selección se guarda por clave.
  const vistas = new Map<string, number>()
  for (const a of ajenas) {
    const n = (vistas.get(a.id) ?? 0) + 1
    vistas.set(a.id, n)
    const fila: FilaAjena = { kind: 'ajena', key: claveBd.ajena(a.id, n), depth: 0, conexionId: a.id, ajena: a }
    if (f !== '') {
      const c = coincidenciaDe(a.alias, f)
      if (c === null) continue
      fila.coincidencia = c
    }
    out.push(fila)
  }
  return out
}

/**
 * El lateral entero: las filas del árbol TAL CUAL (mismos objetos en los mismos índices, así
 * `indicePadre` sigue valiendo) y, detrás, las ajenas. Sin ajenas que pintar devuelve la MISMA
 * lista: su identidad decide si la lista virtual recoloca.
 */
export function componerFilasArbol(
  filas: readonly FilaBd[],
  ajenas: readonly DbConexionAjena[],
  filtro = ''
): readonly FilaArbol[] {
  if (ajenas.length === 0) return filas
  const detras = filasAjenas(ajenas, filtro)
  return detras.length === 0 ? filas : [...filas, ...detras]
}

/** Qué hace una tecla sobre cualquier fila (`accionTecla`); sobre una ajena, nada. */
export function accionTeclaArbol(fila: FilaArbol, tecla: 'izq' | 'dcha' | 'abrir'): AccionTeclaBd {
  return fila.kind === 'ajena' ? 'nada' : accionTecla(fila, tecla)
}

/** ¿La fila se despliega? Una ajena, nunca: no hay nada que esta versión sepa leer de ella. */
export function esContenedorArbol(fila: FilaArbol): boolean {
  return fila.kind !== 'ajena' && esContenedor(fila)
}

/** Lo que borraría Supr / ⌘⌫ sobre una fila (y lo que su confirmación nombra). */
export type BorradoDeFila =
  | { tipo: 'conexion'; conexion: DbConnection }
  | { tipo: 'consola'; consola: DbConsolaInfo }
  | { tipo: 'ajena'; ajena: DbConexionAjena }

/** Qué borra la tecla de borrado sobre la fila, o null (esquemas, objetos y carpetas no se borran). */
export function borradoDeFila(fila: FilaArbol): BorradoDeFila | null {
  switch (fila.kind) {
    case 'conexion':
      return { tipo: 'conexion', conexion: fila.conexion }
    case 'consola':
      return { tipo: 'consola', consola: fila.consola }
    case 'ajena':
      return { tipo: 'ajena', ajena: fila.ajena }
    default:
      return null
  }
}

/** Una entrada del menú contextual de una ajena. */
export interface AccionAjena {
  accion: 'eliminar'
  etiqueta: string
}

/** El menú de una ajena: SOLO eliminar, lo único que se puede hacer sin entender el registro. */
export function accionesDeAjena(): readonly AccionAjena[] {
  return [{ accion: 'eliminar', etiqueta: 'Eliminar conexión…' }]
}

/** Tope del motor tal como se enseña: lo escribió otra versión (o alguien a mano). */
const MOTOR_AJENO_MAX = 32

/** El motor de una ajena tal como se enseña: el del registro, recortado. */
export function motorAjeno(a: Pick<DbConexionAjena, 'motor'>): string {
  return a.motor.length > MOTOR_AJENO_MAX ? `${a.motor.slice(0, MOTOR_AJENO_MAX)}…` : a.motor
}

/**
 * Tooltip de una ajena: el alias, el motor recortado y POR QUÉ no se puede abrir, con la salida
 * de DONDE se enseña: en el árbol, eliminarla; en el popover de montaje, desmontarla.
 */
export function tooltipAjena(a: DbConexionAjena, donde: 'arbol' | 'montaje' = 'arbol'): string {
  return [
    a.alias.slice(0, ALIAS_MAX),
    `Motor: ${motorAjeno(a)}`,
    '',
    explicacionAjena(a),
    donde === 'montaje'
      ? 'El agente no puede usarla con esta versión; aquí solo se puede desmontar.'
      : salidaArbolAjena(a)
  ].join('\n')
}

/** La salida en el ÁRBOL; la del id repetido dice además que eliminarla no toca la otra. */
function salidaArbolAjena(a: DbConexionAjena): string {
  if (a.idRepetido === undefined) return 'Si ya no la quieres, elimínala: es lo único que esta versión puede hacer con ella.'
  const otra = otraDelId(a.idRepetido)
  return otra === null
    ? 'Si ya no la quieres, elimínala.'
    : `Eliminarla no toca ${otra}: ni sus montajes ni sus consolas.`
}

/** Lo que enseña la fila de una ajena MONTADA en el popover de montaje del agente. */
export interface FilaMontajeAjena {
  /** El motor recortado (`motorAjeno`): el `title` de su icono. */
  motor: string
  /** «motor · aviso»: el MISMO aviso corto que la fila del árbol (`textoAjena`). */
  destino: string
  /** El tooltip de la fila entera, con la salida de allí (desmontar). */
  tooltip: string
}

/** La fila de una ajena montada en el popover de montaje del agente, con los mismos textos que el árbol. */
export function filaMontajeAjena(a: DbConexionAjena): FilaMontajeAjena {
  const motor = motorAjeno(a)
  return { motor, destino: `${motor} · ${textoAjena(a)}`, tooltip: tooltipAjena(a, 'montaje') }
}

/**
 * Las ajenas que el popover de montaje lista como MONTADAS: las del perfil con el id montado,
 * salvo que una CONOCIDA use ese id (el montaje es de ella, y desmontar la ajena la desmontaría).
 */
export function ajenasMontadasPopover(
  ajenas: readonly DbConexionAjena[],
  montadas: readonly string[],
  conexiones: readonly { id: string }[]
): DbConexionAjena[] {
  const deConocidas = new Set(conexiones.map((c) => c.id))
  return ajenas.filter((a) => montadas.includes(a.id) && !deConocidas.has(a.id))
}

/** Lo que dice el diálogo de eliminar según con quién comparte el id: `null` si no hay nada que añadir. */
function partesCompartida(
  p: { proyectos: readonly string[] | null; consolas: readonly string[]; compartidaCon?: string | null; idRepetido?: DbComparteId }
): string[] | null {
  if (typeof p.compartidaCon === 'string') {
    const otra = p.compartidaCon.slice(0, ALIAS_MAX)
    return [`«${otra}» comparte su identificador y no se toca: sus montajes y sus consolas siguen.`]
  }
  // La de OTRO perfil conserva lo suyo; lo de ESTE perfil (montajes y consolas de aquí) sí se va.
  if (p.idRepetido?.tipo !== 'otroPerfil') return null
  const partes: string[] = []
  if (p.proyectos === null) partes.push('Se desmontará de los proyectos de este perfil donde la tuvieras.')
  else if (p.proyectos.length > 0) partes.push(`Se desmontará de ${listaNatural(p.proyectos)}.`)
  const consolasAqui = fraseConsolas(p.consolas)
  if (consolasAqui !== null) partes.push(consolasAqui)
  partes.push('La conexión de otro perfil que comparte su identificador no se toca: ni sus montajes ni sus consolas.')
  return partes
}

/**
 * El mensaje de eliminar una ajena: lo que se pierde (irreversible), dónde estaba montada y qué
 * consolas van a la papelera, y POR QUÉ esta versión no la abre (`explicacionAjena`).
 * `compartidaCon`: el alias de una CONOCIDA con el mismo id; entonces lo que cuelga del id es
 * de ella y sigue, y el mensaje no lo anuncia como perdido.
 */
export function textoEliminarAjena(p: {
  alias: string
  motor: string
  proyectos: readonly string[] | null
  consolas: readonly string[]
  compartidaCon?: string | null
  /** La del id repetido: con quién lo comparte, como la fila. */
  idRepetido?: DbComparteId
}): string {
  const alias = p.alias.slice(0, ALIAS_MAX)
  const partes = [
    `Se eliminará «${alias}» y su contraseña guardada, si tiene. No se puede deshacer; la base de datos no se toca.`,
    // La del id repetido ya dice que se elimine si sobra: repetirlo sonaba a eco.
    p.idRepetido === undefined
      ? `Es una conexión de ${motorAjeno(p)}. ${explicacionAjena(p)} Eliminarla solo hace falta si ya no la quieres.`
      : `Es una conexión de ${motorAjeno(p)}. ${explicacionAjena(p)}`
  ]
  const compartida = partesCompartida(p)
  if (compartida !== null) return [...partes, ...compartida].join('\n\n')
  if (p.proyectos === null) partes.push('Se desmontará de todos los proyectos donde la tuvieras.')
  else if (p.proyectos.length > 0) partes.push(`Se desmontará de ${listaNatural(p.proyectos)}.`)
  const consolas = fraseConsolas(p.consolas)
  if (consolas !== null) partes.push(consolas)
  return partes.join('\n\n')
}
