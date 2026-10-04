// =============================================================================
// Pestañas de resultado de una consola SQL: «Salida» fija más una por conjunto de filas.
// Las no fijadas se sustituyen en cada ejecución (devolviendo su lector para cerrarlo), el
// lote va por número, la activación respeta la pestaña que el usuario eligió durante el
// lote y los títulos siguen la caja del motor. Modelo puro y genérico en el resultado.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-resultados.md
// =============================================================================

import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import { dialectoDeMotor } from '../../../../../shared/sql/dialectosSql.ts'
import { plegarSinComillas } from '../../../../../shared/sql/identificadoresSql.ts'

/** Id reservado de la pestaña «Salida». Ninguna pestaña de resultado lo usa. */
export const ID_SALIDA = 'salida'

/** Tope de pestañas fijadas por consola. */
export const MAX_FIJADAS = 20

export interface PestanaResultado {
  readonly id: string
  readonly titulo: string
  readonly fijada: boolean
  /** Lote que la creó: las no fijadas de otro lote se sustituyen. */
  readonly lote: number
}

/** Lo único que el modelo necesita saber de un resultado. */
export interface ResultadoConLector {
  /** Cursor abierto en el servidor (hay más filas), o null. */
  readonly lector: string | null
}

export interface EstadoResultados<R extends ResultadoConLector = ResultadoConLector> {
  readonly pestanas: readonly PestanaResultado[]
  /** `ID_SALIDA` o el id de una pestaña de `pestanas`. */
  readonly activa: string
  /** Resultado de cada pestaña, por su id. */
  readonly resultados: Readonly<Record<string, R>>
  /** Último lote aplicado (-1 = ninguno todavía). */
  readonly lote: number
  /** El usuario activó una pestaña a mano durante el lote en curso. */
  readonly eligioEnLote: boolean
  /** Contador para ids únicos (`r1`, `r2`…), que nunca se reutilizan. */
  readonly siguienteId: number
}

export interface CambioResultados<R extends ResultadoConLector = ResultadoConLector> {
  estado: EstadoResultados<R>
  /** Lectores de las pestañas que desaparecieron: hay que cerrarlos en el main. */
  lectoresPorCerrar: string[]
}

export interface NuevoResultado<R extends ResultadoConLector = ResultadoConLector> {
  /** Título base (de `tituloResultado`); el sufijo ` (2)` lo pone el modelo. */
  titulo: string
  resultado: R
}

export interface OpcionesLote {
  /** Número del lote. Si falta, es un lote nuevo (el anterior + 1). */
  lote?: number
  /** El lote terminó (o va) con error: se activa «Salida». */
  error?: boolean
  /**
   * Qué pestañas SUSTITUYE lo que llega. Por defecto, las no fijadas de otros lotes. El
   * plan pasa uno más estrecho —solo los planes
   * anteriores sin fijar—: explicar una consulta no tira los resultados que se estaban
   * mirando para compararlos con el plan, y la siguiente ejecución lo sustituye todo.
   */
  sustituir?: (p: PestanaResultado) => boolean
}

export function estadoInicialResultados<
  R extends ResultadoConLector = ResultadoConLector
>(): EstadoResultados<R> {
  return { pestanas: [], activa: ID_SALIDA, resultados: {}, lote: -1, eligioEnLote: false, siguienteId: 1 }
}

// --- Títulos ----------------------------------------------------------------

/**
 * Un identificador tal como lo guarda el motor, sin comillas. Sin comillas se pliega
 * con la regla compartida (`plegarSinComillas`: MAYÚSCULAS en Oracle; en PG solo A-Z,
 * que en una base UTF-8 deja intactas las letras no ASCII). No se usa `normalizarIdent`: acepta
 * también `U&"…"`, y aquí no se aceptaba.
 */
function identificadorVisible(id: string, dialecto: DbMotor): string {
  const t = id.trim()
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    return t.slice(1, -1).replace(/""/g, '"')
  }
  return plegarSinComillas(t, dialectoDeMotor(dialecto))
}

/**
 * Título de la pestaña de un resultado: `ESQUEMA.TABLA` si la sentencia es de una
 * sola tabla (con el esquema actual de la sesión si no lo escribió), o
 * `Resultado k` si no. Sin esquema conocido, sólo `TABLA`.
 */
export function tituloResultado(
  tablaUnica: { esquema: string | null; nombre: string } | null,
  esquemaActual: string | null,
  dialecto: DbMotor,
  k: number
): string {
  if (!tablaUnica || tablaUnica.nombre.trim() === '') return `Resultado ${k}`
  const nombre = identificadorVisible(tablaUnica.nombre, dialecto)
  const esquema =
    tablaUnica.esquema !== null && tablaUnica.esquema.trim() !== ''
      ? identificadorVisible(tablaUnica.esquema, dialecto)
      : esquemaActual
  return esquema ? `${esquema}.${nombre}` : nombre
}

/** `base`, o `base (n)` con el menor n >= 2 libre. */
export function tituloSinRepetir(base: string, ocupados: ReadonlySet<string>): string {
  if (!ocupados.has(base)) return base
  let n = 2
  while (ocupados.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

// --- Internos ---------------------------------------------------------------

function existe(pestanas: readonly PestanaResultado[], id: string): boolean {
  return id === ID_SALIDA || pestanas.some((p) => p.id === id)
}

/** Fijadas primero, conservando el orden relativo dentro de cada grupo. */
function ordenar(pestanas: readonly PestanaResultado[]): PestanaResultado[] {
  return pestanas.filter((p) => p.fijada).concat(pestanas.filter((p) => !p.fijada))
}

/**
 * Quita las pestañas que cumplan `quitar`, devuelve sus lectores y recoloca la
 * activa si desapareció: en `preferida` si sigue, si no la vecina de la derecha,
 * luego la de la izquierda, y si no queda ninguna, «Salida».
 */
function quitarPestanas<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  quitar: (p: PestanaResultado) => boolean,
  preferida?: string
): CambioResultados<R> {
  const quedan: PestanaResultado[] = []
  const lectores: string[] = []
  const resultados: Record<string, R> = { ...estado.resultados }
  let hubo = false
  let indiceActiva = -1
  estado.pestanas.forEach((p) => {
    if (p.id === estado.activa) indiceActiva = quedan.length
    if (quitar(p)) {
      hubo = true
      const lector = resultados[p.id]?.lector
      if (lector) lectores.push(lector)
      delete resultados[p.id]
    } else {
      quedan.push(p)
    }
  })
  if (!hubo) return { estado, lectoresPorCerrar: [] }

  let activa = estado.activa
  if (!existe(quedan, activa)) {
    if (preferida !== undefined && existe(quedan, preferida)) activa = preferida
    else if (indiceActiva >= 0 && indiceActiva < quedan.length) activa = quedan[indiceActiva].id
    else if (indiceActiva > 0 && quedan.length > 0) activa = quedan[quedan.length - 1].id
    else activa = ID_SALIDA
  }
  return { estado: { ...estado, pestanas: quedan, resultados, activa }, lectoresPorCerrar: lectores }
}

// --- Operaciones ------------------------------------------------------------

/**
 * Marca el principio de un lote ANTES de que llegue su primer resultado, para que
 * un clic del usuario mientras corre la primera sentencia cuente como elección.
 * Opcional: `aplicarLote` con un número nuevo hace lo mismo.
 */
export function empezarLote<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  lote: number
): EstadoResultados<R> {
  if (estado.lote === lote) return estado
  return { ...estado, lote, eligioEnLote: false }
}

/**
 * Aplica resultados nuevos de un lote: sustituye las no fijadas de OTROS lotes,
 * añade las nuevas al final con su sufijo ` (n)` y decide la activa.
 */
export function aplicarLote<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  nuevos: readonly NuevoResultado<R>[],
  opciones: OpcionesLote = {}
): CambioResultados<R> {
  const lote = opciones.lote ?? estado.lote + 1
  const base = empezarLote(estado, lote)
  // Si la activa era una de las sustituidas, NO se salta a una vecina (sería una
  // fijada cualquiera): queda «Salida» y, abajo, la última nueva si la hay.
  const { estado: limpio, lectoresPorCerrar } = quitarPestanas(
    base,
    opciones.sustituir ?? ((p) => !p.fijada && p.lote !== lote),
    ID_SALIDA
  )
  const activaSustituida = limpio.activa !== base.activa

  const ocupados = new Set(limpio.pestanas.map((p) => p.titulo))
  const resultados: Record<string, R> = { ...limpio.resultados }
  const nuevas: PestanaResultado[] = []
  let siguienteId = limpio.siguienteId
  for (const n of nuevos) {
    const id = `r${siguienteId++}`
    const titulo = tituloSinRepetir(n.titulo, ocupados)
    ocupados.add(titulo)
    nuevas.push({ id, titulo, fijada: false, lote })
    resultados[id] = n.resultado
  }
  const pestanas = ordenar(limpio.pestanas.concat(nuevas))

  // La elección del usuario sólo protege la pestaña que eligió MIENTRAS exista: si
  // la sustituyó este mismo lote, su elección ya no apunta a nada.
  let activa = limpio.activa
  const ultima = nuevas.length > 0 ? nuevas[nuevas.length - 1].id : null
  if (opciones.error) activa = ID_SALIDA
  else if (ultima && (!limpio.eligioEnLote || activaSustituida)) activa = ultima

  return {
    estado: { ...limpio, pestanas, resultados, activa, siguienteId },
    lectoresPorCerrar
  }
}

/** Clic del usuario en una pestaña (o en «Salida»). Cuenta como elección en el lote. */
export function activar<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id: string
): EstadoResultados<R> {
  if (!existe(estado.pestanas, id)) return estado
  if (estado.activa === id && estado.eligioEnLote) return estado
  return { ...estado, activa: id, eligioEnLote: true }
}

/** ¿Se puede fijar una más? */
export function puedeFijar<R extends ResultadoConLector>(estado: EstadoResultados<R>): boolean {
  return estado.pestanas.filter((p) => p.fijada).length < MAX_FIJADAS
}

function conFijada<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id: string,
  fijada: boolean
): EstadoResultados<R> {
  const p = estado.pestanas.find((x) => x.id === id)
  if (!p || p.fijada === fijada) return estado
  if (fijada && !puedeFijar(estado)) return estado
  const pestanas = ordenar(estado.pestanas.map((x) => (x.id === id ? { ...x, fijada } : x)))
  return { ...estado, pestanas }
}

/**
 * Fija una pestaña: sobrevive a las ejecuciones siguientes y pasa al FINAL del grupo
 * de fijadas (las fijadas quedan en el orden en que se fijaron).
 */
export function fijar<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id: string
): EstadoResultados<R> {
  return conFijada(estado, id, true)
}

/**
 * Desfija una pestaña: vuelve al grupo de las no fijadas (la primera de ellas) y la
 * próxima ejecución la sustituirá.
 */
export function desfijar<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id: string
): EstadoResultados<R> {
  return conFijada(estado, id, false)
}

/** Cierra una pestaña (fijada o no). «Salida» no se cierra. */
export function cerrar<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id: string
): CambioResultados<R> {
  if (id === ID_SALIDA) return { estado, lectoresPorCerrar: [] }
  return quitarPestanas(estado, (p) => p.id === id)
}

/**
 * «Cerrar las demás sin fijar»: cierra todas las no fijadas salvo `id` (si se da).
 * Las fijadas se quedan: para eso se fijaron.
 */
export function cerrarOtrasNoFijadas<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id?: string
): CambioResultados<R> {
  return quitarPestanas(estado, (p) => !p.fijada && p.id !== id, id)
}

/** «Cerrar todos los resultados»: fijadas incluidas. Queda «Salida». */
export function cerrarTodas<R extends ResultadoConLector>(
  estado: EstadoResultados<R>
): CambioResultados<R> {
  return quitarPestanas(estado, () => true, ID_SALIDA)
}

/** Sustituye el resultado de una pestaña (llegó otra página, se cerró su lector). */
export function actualizarResultado<R extends ResultadoConLector>(
  estado: EstadoResultados<R>,
  id: string,
  resultado: R
): EstadoResultados<R> {
  if (!(id in estado.resultados) || estado.resultados[id] === resultado) return estado
  return { ...estado, resultados: { ...estado.resultados, [id]: resultado } }
}

/** La pestaña activa, o `null` si es «Salida». */
export function pestanaActiva<R extends ResultadoConLector>(
  estado: EstadoResultados<R>
): PestanaResultado | null {
  return estado.pestanas.find((p) => p.id === estado.activa) ?? null
}

/** Todos los lectores abiertos (al cerrar la consola hay que cerrarlos todos). */
export function lectoresAbiertos<R extends ResultadoConLector>(estado: EstadoResultados<R>): string[] {
  const out: string[] = []
  for (const p of estado.pestanas) {
    const lector = estado.resultados[p.id]?.lector
    if (lector) out.push(lector)
  }
  return out
}
