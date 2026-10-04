// =============================================================================
// Salida de la consola SQL: las entradas de la pestaña fija «Salida», con su texto EXACTO
// (cada frase sale de una función de aquí: son contrato del e2e), sus enlaces y acciones
// aparte del texto, el anillo de 1000 entradas y lo que dicen el servidor y el
// compilador. La hora llega por parámetro: el módulo no lee el reloj.
// Decisiones: docs/decisiones/bd/ui-consola-formato-y-salida.md
// =============================================================================

import type {
  DbAvisoSesion,
  DbErrorCompilacion,
  DbErrorSql,
  DbLineaSalida,
  DbResultadoError,
  DbTiempos
} from '../../../../../shared/db-explorador-ipc.ts'
import { nunca } from '../../../../../shared/nunca.ts'
import { reglasDeMotor, type DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { formatoEntero } from '../rejilla/celdasRejilla.ts'
import { formatoDuracion } from './marcasConsola.ts'

/** Entradas que guarda la Salida como mucho (las más viejas se descartan). */
export const MAX_ENTRADAS_SALIDA = 1000

/** Largo máximo del eco de una sentencia. */
export const MAX_ECO = 120

export type TipoSalida =
  | 'eco'
  | 'filas'
  | 'afectadas'
  | 'completado'
  | 'error'
  | 'aviso'
  | 'info'
  | 'tx'
  /** Una línea de DBMS_OUTPUT o un NOTICE/INFO de PG. */
  | 'servidor'
  /** Un WARNING de PG. */
  | 'servidorAviso'

/** Máximo de líneas del servidor por sentencia: un bucle de PUT_LINE vaciaría el anillo. */
export const MAX_LINEAS_SERVIDOR = 500

/** Enlace a una posición de una sentencia de un lote. */
export interface IrAPosicion {
  loteId: number
  /** Posición de la sentencia DENTRO del lote (0-based). */
  sentencia: number
  /** UTF-16, relativo al inicio de la sentencia en el modelo. */
  desplazamiento: number
  /** Texto del enlace: «ir a la posición (línea 3, columna 15)». */
  etiqueta: string
  /**
   * `desplazamiento` es una posición EXACTA del servidor (la de un error de
   * compilación): el enlace lleva ahí aunque la sentencia del lote no guarde
   * `posicion` (un ORA-24344 no la trae). Sin ella decide la sentencia del lote.
   */
  exacta?: boolean
}

/** Lo que hace el botón de acción de una línea de la Salida. */
export type AccionSalida =
  /** Continúa un lote detenido desde `desde` (las omitidas). */
  | { tipo: 'ejecutarRestantes'; loteId: number; desde: number; etiqueta: string }
  /** El servidor no responde al Stop: matar el proceso de la conexión. */
  | { tipo: 'forzar'; etiqueta: string }

/** Una línea de la Salida, ya numerada y con su hora. */
export interface EntradaSalida {
  readonly id: number
  /** `hh:mm:ss`, hora local. */
  readonly hora: string
  readonly tipo: TipoSalida
  readonly texto: string
  readonly ir?: IrAPosicion
  readonly accion?: AccionSalida
  /** Detalle de la línea de arriba (salida del servidor, errores de compilación): sangrada. */
  readonly anidada?: boolean
}

/** Una entrada antes de numerarla y ponerle hora. */
export interface NuevaEntrada {
  tipo: TipoSalida
  texto: string
  ir?: IrAPosicion
  accion?: AccionSalida
  anidada?: boolean
}

/** El contenido de la pestaña «Salida»: el anillo de entradas y el próximo id. */
export interface SalidaConsola {
  readonly entradas: readonly EntradaSalida[]
  /** Próximo id; nunca se reutiliza, ni tras limpiar. */
  readonly siguienteId: number
}

/** Una Salida sin entradas. */
export function salidaVacia(): SalidaConsola {
  return { entradas: [], siguienteId: 1 }
}

// --- Anillo ------------------------------------------------------------------

function dosCifras(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** `hh:mm:ss` en hora local. */
export function horaDe(ahora: number): string {
  const d = new Date(ahora)
  return `${dosCifras(d.getHours())}:${dosCifras(d.getMinutes())}:${dosCifras(d.getSeconds())}`
}

/** Añade entradas al final, numeradas y con hora, conservando las 1000 últimas. */
export function agregarSalida(
  salida: SalidaConsola,
  nuevas: readonly NuevaEntrada[],
  ahora: number
): SalidaConsola {
  if (nuevas.length === 0) return salida
  const hora = horaDe(ahora)
  let id = salida.siguienteId
  const hechas: EntradaSalida[] = nuevas.map((n) => {
    const e: EntradaSalida = { id: id++, hora, tipo: n.tipo, texto: n.texto }
    return n.ir || n.accion || n.anidada
      ? {
          ...e,
          ...(n.ir ? { ir: n.ir } : {}),
          ...(n.accion ? { accion: n.accion } : {}),
          ...(n.anidada ? { anidada: true } : {})
        }
      : e
  })
  let entradas = salida.entradas.concat(hechas)
  if (entradas.length > MAX_ENTRADAS_SALIDA) entradas = entradas.slice(entradas.length - MAX_ENTRADAS_SALIDA)
  return { entradas, siguienteId: id }
}

/** «Limpiar salida». Los ids siguen contando. */
export function limpiarSalida(salida: SalidaConsola): SalidaConsola {
  if (salida.entradas.length === 0) return salida
  return { entradas: [], siguienteId: salida.siguienteId }
}

/** Margen, en px, para dar una lista de salida por pegada al fondo. */
const HOLGURA_FONDO = 8

/** Medidas de desplazamiento de una lista (las cumple el elemento del DOM). */
export interface MedidasDesplazamiento {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

/** ¿La lista de salida sigue pegada al fondo tras desplazarla el usuario? */
export function pegadoAlFondo(m: MedidasDesplazamiento): boolean {
  return m.scrollTop + m.clientHeight >= m.scrollHeight - HOLGURA_FONDO
}

/**
 * ¿Sigue el autodesplazamiento tras un cambio de las entradas? Vaciar la salida (limpiar)
 * lo reengancha: la lista se desmontó con lo que el usuario estaba leyendo, y la que nace
 * con la salida nueva no ha recibido ningún desplazamiento que diga que sigue arriba.
 */
export function sigueAlFondo(pegado: boolean, entradas: number): boolean {
  return entradas === 0 ? true : pegado
}

/** La línea completa tal como se lee: texto, enlace y acción separados por « · ». */
export function textoEntrada(e: { texto: string; ir?: IrAPosicion; accion?: AccionSalida }): string {
  let t = e.texto
  if (e.ir && e.ir.etiqueta) t += ` · ${e.ir.etiqueta}`
  if (e.accion) t += ` · ${e.accion.etiqueta}`
  return t
}

// --- Textos ------------------------------------------------------------------

/** `1 fila`, `2 filas`, `12 345 filas`. */
export function cantidad(n: number, singular: string, plural: string): string {
  return `${formatoEntero(n)} ${n === 1 ? singular : plural}`
}

/** `ESQUEMA> primera línea`, con « …» si la sentencia sigue y recortada a 120. */
export function textoEco(esquema: string | null, sql: string): string {
  const prefijo = esquema ? `${esquema}> ` : '> '
  const m = /\r\n|\n|\r/.exec(sql)
  const primera = (m ? sql.slice(0, m.index) : sql).replace(/\s+$/, '')
  const sigue = m !== null && sql.slice(m.index).trim() !== ''
  const linea = prefijo + primera + (sigue ? ' …' : '')
  return linea.length <= MAX_ECO ? linea : linea.slice(0, MAX_ECO - 1) + '…'
}

/**
 * El eco de un «Explicar plan»: lo que de verdad pide el main al servidor, para que en
 * la Salida no se lea como si la sentencia hubiera corrido. Oracle `EXPLAIN PLAN FOR`,
 * PG `EXPLAIN` (el main añade `(FORMAT JSON)`, que aquí solo sería ruido).
 */
export function textoEcoPlan(esquema: string | null, sql: string, dialecto: DialectoSql): string {
  return textoEco(esquema, `${verboExplicar(dialecto)} ${sql.replace(/^\s+/, '')}`)
}

/**
 * Cómo empieza el EXPLAIN que manda el main, según la forma del dialecto (`explain` de sus
 * reglas). Por `reglasDeMotor(d)`, que valida: con un dialecto fuera del registro,
 * «Motor desconocido» y no un TypeError anónimo.
 */
function verboExplicar(dialecto: DialectoSql): string {
  const forma = reglasDeMotor(dialecto).explain
  switch (forma) {
    case 'planFor':
      return 'EXPLAIN PLAN FOR'
    case 'conOpciones':
      return 'EXPLAIN'
    case 'queryPlan':
      return 'EXPLAIN QUERY PLAN'
    case 'showplan':
      // SQL Server: el plan lo pide la sesión con `SET SHOWPLAN_XML ON` en su propio
      // lote y la sentencia detrás (sin ejecutarla); el `;` hace que el eco se lea como las
      // dos cosas que son y no como una sentencia inventada.
      return 'SET SHOWPLAN_XML ON;'
    default:
      return nunca(forma, 'verboExplicar')
  }
}

/** `Plan de ejecución: 4 pasos en 12 ms (la sentencia no se ejecutó)`. */
export function textoPlan(pasos: number, ms: number): string {
  return `Plan de ejecución: ${cantidad(pasos, 'paso', 'pasos')} en ${formatoDuracion(ms)} (la sentencia no se ejecutó)`
}

/** Tooltip de la marca de un plan que llegó bien. */
export function detallePlan(pasos: number): string {
  return `Plan de ejecución (${cantidad(pasos, 'paso', 'pasos')}): la sentencia NO se ejecutó`
}

/**
 * El ✗ de una sentencia que el main NO ENVIÓ por sus parámetros (`parametros`): que no
 * llegó al servidor es lo primero que hay que saber (nada cambió), y luego qué faltaba,
 * con las palabras del main.
 */
export function textoErrorParametros(error: Pick<DbErrorSql, 'codigo' | 'mensaje'>): string {
  return `No se envió: ${textoError(error)}`
}

function tiemposDetalle(t: DbTiempos): string {
  return `${formatoDuracion(t.totalMs)} (ejecución ${formatoDuracion(t.ejecucionMs)}, lectura ${formatoDuracion(t.lecturaMs)})`
}

/** `N filas en X (ejecución A, lectura B)`; con `hayMas`, `500 filas (hay más) en …`. */
export function textoFilas(n: number, hayMas: boolean, t: DbTiempos): string {
  return `${cantidad(n, 'fila', 'filas')}${hayMas ? ' (hay más)' : ''} en ${tiemposDetalle(t)}`
}

/** `N filas afectadas en X`, y `; M devueltas` si hubo RETURNING. */
export function textoAfectadas(n: number, ms: number, devueltas?: number): string {
  const base = `${cantidad(n, 'fila afectada', 'filas afectadas')} en ${formatoDuracion(ms)}`
  return devueltas !== undefined ? `${base}; ${cantidad(devueltas, 'devuelta', 'devueltas')}` : base
}

/**
 * DDL y demás sentencias sin filas: `completado en X`. Con avisos de compilación (un
 * CREATE de PL/SQL que compiló con PLSQL_WARNINGS): `completado en X, con 1 aviso de
 * compilación`.
 */
export function textoCompletado(ms: number, avisosCompilacion: number = 0): string {
  const base = `completado en ${formatoDuracion(ms)}`
  return avisosCompilacion > 0
    ? `${base}, con ${cantidad(avisosCompilacion, 'aviso', 'avisos')} de compilación`
    : base
}

// --- Salida del servidor y compilación ---------------------------------------------

/**
 * Las líneas de salida del servidor de una sentencia, anidadas bajo ella: `servidor`
 * o `servidorAviso` (WARNING de PG). Una línea vacía se conserva (un PUT_LINE('') es
 * un separador que el usuario escribió a propósito); se quita solo el fin de línea
 * final. Más de `MAX_LINEAS_SERVIDOR`: se cortan y una línea `info` dice cuántas.
 */
export function entradasServidor(salida: readonly DbLineaSalida[] | undefined): NuevaEntrada[] {
  if (!salida || salida.length === 0) return []
  const out: NuevaEntrada[] = []
  const n = Math.min(salida.length, MAX_LINEAS_SERVIDOR)
  for (let i = 0; i < n; i++) {
    const l = salida[i]
    out.push({
      tipo: l.aviso ? 'servidorAviso' : 'servidor',
      texto: (l.texto ?? '').replace(/(\r\n|\n|\r)$/, ''),
      anidada: true
    })
  }
  const resto = salida.length - n
  if (resto > 0) {
    out.push({
      tipo: 'info',
      texto: `… y ${cantidad(resto, 'línea', 'líneas')} más de salida del servidor que no se muestran`,
      anidada: true
    })
  }
  return out
}

/** Errores y avisos de una lista de compilación. */
export function contarCompilacion(lista: readonly DbErrorCompilacion[] | undefined): { errores: number; avisos: number } {
  let errores = 0
  let avisos = 0
  for (const e of lista ?? []) {
    if (e.esAviso) avisos++
    else errores++
  }
  return { errores, avisos }
}

/** `línea 3, columna 5: PLS-00201: identifier 'X' must be declared` (coordenadas del servidor). */
export function textoLineaCompilacion(e: Pick<DbErrorCompilacion, 'linea' | 'columna' | 'mensaje'>): string {
  return `línea ${e.linea}, columna ${e.columna}: ${(e.mensaje || '').trim()}`
}

/** ¿La posición de un error de compilación se puede usar como enlace exacto? */
function posicionUsable(p: number | undefined): p is number {
  return typeof p === 'number' && Number.isFinite(p) && p >= 0
}

/**
 * Una entrada anidada por error o aviso de compilación, en el orden del servidor,
 * con «ir a la posición» exacta si el main la situó y, si no, a la sentencia.
 */
export function entradasCompilacion(
  lista: readonly DbErrorCompilacion[] | undefined,
  loteId: number,
  sentencia: number
): NuevaEntrada[] {
  if (!lista || lista.length === 0) return []
  return lista.map((e) => ({
    tipo: e.esAviso ? ('aviso' as const) : ('error' as const),
    texto: textoLineaCompilacion(e),
    anidada: true,
    ir: posicionUsable(e.posicion)
      ? { loteId, sentencia, desplazamiento: e.posicion, etiqueta: etiquetaPosicion(null), exacta: true }
      : { loteId, sentencia, desplazamiento: 0, etiqueta: etiquetaSentencia(sentencia + 1) }
  }))
}

/** La primera posición situada de una lista de compilación (prefiere errores a avisos). */
export function primeraPosicionCompilacion(lista: readonly DbErrorCompilacion[] | undefined): number | null {
  if (!lista) return null
  for (const e of lista) if (!e.esAviso && posicionUsable(e.posicion)) return e.posicion
  for (const e of lista) if (posicionUsable(e.posicion)) return e.posicion
  return null
}

/** Lo que el clasificador sabe del objeto que crea una sentencia (`Sentencia.objetoCreado`). */
export interface ObjetoCompilado {
  /** `PROCEDURE`, `PACKAGE BODY`… tal como lo clasificó `clasificarSql`. */
  tipo: string
  esquema: string | null
  nombre: string
}

/**
 * Resumen de una unidad que quedó INVÁLIDA: `PROCEDURE HR.P creado con 2 errores de
 * compilación y 1 aviso`. Sin objeto conocido, `Creado con 2 errores de compilación`.
 */
export function textoCompilacionInvalida(objeto: ObjetoCompilado | null, errores: number, avisos: number): string {
  const quien = objeto
    ? `${objeto.tipo} ${objeto.esquema ? `${objeto.esquema}.` : ''}${objeto.nombre} creado`
    : 'Creado'
  const e = errores > 0 ? cantidad(errores, 'error', 'errores') : 'errores'
  const a = avisos > 0 ? ` y ${cantidad(avisos, 'aviso', 'avisos')}` : ''
  return `${quien} con ${e} de compilación${a}`
}

/**
 * El texto de un ✗ de sentencia: el del servidor (`textoError`) o, si el CREATE dejó
 * la unidad inválida con su lista de ALL_ERRORS, el resumen de arriba conservando el
 * código (`[ORA-24344] PROCEDURE P creado con 2 errores de compilación`).
 */
export function textoErrorResultado(r: Pick<DbResultadoError, 'error' | 'compilacion'>, objeto: ObjetoCompilado | null): string {
  const c = contarCompilacion(r.compilacion)
  if (c.errores + c.avisos === 0) return textoError(r.error)
  return textoError({ codigo: r.error.codigo, mensaje: textoCompilacionInvalida(objeto, c.errores, c.avisos) })
}

/**
 * `[CÓDIGO] mensaje`, o solo el mensaje si no hay código. Si el mensaje ya empieza
 * por el código (`ORA-00933: SQL command…`, lo normal en Oracle), no se repite.
 * Con `objeto` (SQL Server: el error ocurrió DENTRO de un procedimiento
 * llamado con EXEC, y su línea es la del cuerpo, sin posición en la consola) se dice dónde:
 * `… (en dbo.p_err)`. Oracle, PG y SQLite no lo mandan nunca: su texto no cambia.
 */
export function textoError(error: Pick<DbErrorSql, 'codigo' | 'mensaje' | 'objeto'>): string {
  let m = (error.mensaje || '').trim()
  const c = error.codigo ? error.codigo.trim() : ''
  const donde = error.objeto ? ` (en ${error.objeto})` : ''
  if (!c) return (m || 'Error desconocido') + donde
  if (m.slice(0, c.length).toUpperCase() === c.toUpperCase()) m = m.slice(c.length).replace(/^[\s:.-]+/, '')
  return (m ? `[${c}] ${m}` : `[${c}]`) + donde
}

/** Etiqueta del enlace a la posición de un error. */
export function etiquetaPosicion(pos?: { linea: number; columna: number } | null): string {
  return pos ? `ir a la posición (línea ${pos.linea}, columna ${pos.columna})` : 'ir a la posición'
}

/** Etiqueta del enlace a una sentencia sin posición concreta. */
export function etiquetaSentencia(numero: number): string {
  return `ir a la sentencia ${numero}`
}

/** `Lote detenido: 2 de 5` (sentencias que terminaron bien, de las del lote). */
export function textoLoteDetenido(ejecutadas: number, total: number): string {
  return `Lote detenido: ${formatoEntero(ejecutadas)} de ${formatoEntero(total)}`
}

/** `Ejecutar la restante` / `Ejecutar las 3 restantes`. */
export function etiquetaRestantes(n: number): string {
  return n === 1 ? 'Ejecutar la restante' : `Ejecutar las ${formatoEntero(n)} restantes`
}

/** `Cancelada tras 3 s 120 ms`. */
export function textoCancelada(ms: number): string {
  return `Cancelada tras ${formatoDuracion(ms)}`
}

export const TEXTO_SESION_PERDIDA = 'Sesión perdida; el servidor revirtió la transacción'

export const TEXTO_CLIENTE = 'Comando del cliente: no se envía al servidor'

/** Línea de la Salida cuando el servidor no atiende el Stop. */
export const TEXTO_SIN_RESPUESTA_STOP ='El servidor no responde a la cancelación'

export const ETIQUETA_FORZAR = 'Forzar (cierra la conexión y revierte sus transacciones)'

/**
 * Motor con un proceso por consola (SQLite): el Stop no llega a matar
 * porque la consola tiene cambios sin confirmar, que no se pierden sin preguntar.
 */
export const TEXTO_STOP_CON_CAMBIOS =
  'No se puede parar sin cerrar la sesión de esta consola, y tiene cambios sin confirmar'

export const ETIQUETA_FORZAR_CONSOLA = 'Forzar (cierra la sesión de esta consola y revierte su transacción)'

/** `Confirmado (Commit) en X` / `Revertido (Rollback) en X`. */
export function textoTx(op: 'commit' | 'rollback', ms: number): string {
  return op === 'commit'
    ? `Confirmado (Commit) en ${formatoDuracion(ms)}`
    : `Revertido (Rollback) en ${formatoDuracion(ms)}`
}

/** `1, 2 y 5` */
function listaNumeros(ns: readonly number[]): string {
  if (ns.length <= 1) return ns.join('')
  return ns.slice(0, -1).join(', ') + ' y ' + ns[ns.length - 1]
}

/**
 * El prevuelo de solo lectura rechazó el lote (todo o nada):
 * `No se ejecutó nada: la sentencia 3 escribe y la conexión es de solo lectura`.
 * `numeros` son 1-based (posición en el lote); con un lote de UNA sentencia no se
 * numera («la sentencia 1» de una sola sería ruido).
 */
export function textoNadaEjecutado(numeros: readonly number[], total: number): string {
  const quien =
    total === 1
      ? 'la sentencia escribe'
      : numeros.length === 1
        ? `la sentencia ${numeros[0]} escribe`
        : `las sentencias ${listaNumeros(numeros)} escriben`
  return `No se ejecutó nada: ${quien} y la conexión es de solo lectura`
}

/**
 * Texto de un aviso de sesión del main. Si el servidor revirtió una transacción
 * pendiente, la frase fija del plan (es lo único que el usuario NO puede ignorar);
 * si no, el mensaje del main, con un respaldo por tipo si llegara vacío.
 */
export function textoAvisoSesion(aviso: Pick<DbAvisoSesion, 'tipo' | 'txPerdida' | 'mensaje'>): string {
  if (aviso.txPerdida && (aviso.tipo === 'perdida' || aviso.tipo === 'caida')) return TEXTO_SESION_PERDIDA
  const m = (aviso.mensaje || '').trim()
  if (m) return m
  switch (aviso.tipo) {
    case 'perdida':
    case 'caida':
      return 'Sesión perdida; se abrirá otra en la próxima ejecución'
    case 'inactividad':
      return 'Sesión cerrada por inactividad; se perdieron los ALTER SESSION y SET de esta consola'
    case 'editada':
      return 'La conexión se editó; se abrirá una sesión nueva en la próxima ejecución'
    case 'expulsada':
      return 'Sesión cerrada para dejar sitio a otra; se abrirá de nuevo en la próxima ejecución'
  }
}
