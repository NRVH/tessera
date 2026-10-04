// =============================================================================
// Decisiones puras de las pestañas de datos y de fuente (`DbRejilla`, `PildoraFilas`,
// `DbDatosPane`, `DbFuentePane`): el orden de la cabecera en posiciones de la rejilla, el
// texto de la píldora, qué se dice por cada motivo de error (con los dos botones del
// bloqueo), qué ids cancela Detener, el ancho inicial y si el paginado es estable (por el
// descriptor del motor). Puro: lo prueba `test-panes-bd.mts` con `node`.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-panes.md
// =============================================================================

import type { DbMotor } from '../../../../shared/db-ipc.ts'
import type {
  DbCelda,
  DbColumnaResultado,
  DbErrorSql,
  DbRefObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../shared/motores/index.ts'
import { dialectoDeMotor } from '../../../../shared/sql/dialectosSql.ts'
import { citarSiHaceFalta, nombreCalificado } from '../../../../shared/sql/identificadoresSql.ts'
import { formatoEntero } from './rejilla/celdasRejilla.ts'
import { formatoDuracion } from './consola/marcasConsola.ts'
import { anchoInicial, muestrasColumna, type OpcionesAncho } from './rejilla/anchoColumnas.ts'

// --- Orden por la cabecera ----------------------------------------------------

export type DirOrden = 'asc' | 'desc'

/** El orden tal como lo pinta la rejilla: por POSICIÓN de columna, con su prioridad. */
export interface OrdenRejilla {
  columna: number
  dir: DirOrden
  /** 1, 2, 3… cuando se ordena por varias columnas; null con una sola (no se pinta número). */
  prioridad: number | null
}

/**
 * El orden de la cabecera (`DbOrdenColumna[]`, por NOMBRE) traducido a
 * las posiciones de la rejilla. El nombre es el del resultado, así que se compara EXACTO
 * (no hay texto escrito a mano que plegar). Un nombre que no está, o que está dos veces, no
 * pinta flecha: sería una apuesta. La prioridad es la del orden entero, aunque alguna de
 * sus columnas no se pinte.
 */
export function ordenEnRejilla(
  orden: readonly { columna: string; dir: DirOrden }[],
  columnas: readonly { nombre: string }[]
): OrdenRejilla[] {
  const r: OrdenRejilla[] = []
  const varias = orden.length > 1
  orden.forEach((o, k) => {
    let columna = -1
    for (let i = 0; i < columnas.length; i++) {
      if (columnas[i].nombre !== o.columna) continue
      if (columna >= 0) return
      columna = i
    }
    if (columna >= 0) r.push({ columna, dir: o.dir, prioridad: varias ? k + 1 : null })
  })
  return r
}

/**
 * Las líneas del `title` de una cabecera ordenable: cómo está ordenada esa columna, si lo
 * está, y los dos gestos. Mayús se llama igual en los dos teclados (⇧ en el de Mac), y
 * Mayús+clic es el gesto de varias claves de las hojas de cálculo.
 */
export function lineasOrdenCabecera(o: Pick<OrdenRejilla, 'dir' | 'prioridad'> | null, total: number): string[] {
  const lineas: string[] = []
  if (o) {
    const sentido = o.dir === 'asc' ? 'ascendente' : 'descendente'
    lineas.push(o.prioridad === null ? `Orden: ${sentido}` : `Orden ${o.prioridad}.º de ${total}: ${sentido}`)
  }
  lineas.push('Clic: ordenar por esta columna (ascendente → descendente → sin orden)')
  lineas.push('Mayús+clic: añadirla al orden de varias columnas')
  return lineas
}

// --- Filtro -------------------------------------------------------------------

/**
 * Qué seleccionar en el campo tras un error con posición: el token que empieza ahí
 * (hasta un blanco, una coma o un paréntesis). Así el usuario ve DÓNDE se quejó el
 * servidor y puede sobrescribirlo tecleando. Una posición fuera del texto deja el
 * cursor al final, sin seleccionar nada.
 */
export function rangoError(texto: string, posicion: number): { desde: number; hasta: number } {
  const n = texto.length
  if (!Number.isFinite(posicion)) return { desde: n, hasta: n }
  const p = Math.max(0, Math.min(n, Math.floor(posicion)))
  let fin = p
  if (fin < n && !/\s/.test(texto[fin])) {
    // Un separador en la posición (el `(` que sobra, la `,` de más) es él solo el
    // token: seguir leyendo se llevaría por delante lo que va detrás.
    const separador = /[,()]/.test(texto[fin])
    fin++
    if (!separador) while (fin < n && !/[\s,()]/.test(texto[fin])) fin++
  }
  return { desde: p, hasta: fin }
}

/**
 * ¿Las páginas pueden repetir o saltarse filas? Solo en PG (LIMIT/OFFSET sin estado;
 * lo dice su descriptor, `sesion.paginasInestablesSinOrden`) y solo cuando no hay
 * orden del usuario (el de la CABECERA, `DbOrdenColumna[]`) NI clave primaria por la que
 * ordenar.
 */
export function sinOrdenEstable(
  motor: DbMotor,
  ordenAplicado: readonly { columna: string }[],
  clavePrimaria: readonly string[]
): boolean {
  return descriptorSql(motor).sesion.paginasInestablesSinOrden && ordenAplicado.length === 0 && clavePrimaria.length === 0
}

/** «Abrir consola» desde una tabla: `SELECT * FROM` el objeto, calificado. */
export function consultaParaConsola(objeto: Pick<DbRefObjeto, 'esquema' | 'nombre' | 'base'>, motor: DbMotor): string {
  const d = dialectoDeMotor(motor)
  const dos = nombreCalificado(objeto.esquema, objeto.nombre, d)
  // Con base (nivel «Bases»), el nombre de TRES partes: la consola nueva
  // abre en la base por defecto del login, que puede no ser la de la tabla.
  return `SELECT * FROM ${objeto.base !== undefined ? `${citarSiHaceFalta(objeto.base, d)}.${dos}` : dos}`
}

// --- Píldora y metadatos -------------------------------------------------------

function filas(n: number): string {
  return `${formatoEntero(n)} ${n === 1 ? 'fila' : 'filas'}`
}

export interface EstadoPildora {
  /** Filas cargadas en el renderer. */
  cargadas: number
  /** El servidor tiene más de las cargadas. */
  hayMas: boolean
  /** Total contado (o conocido por haber llegado al final), o null. */
  total: number | null
  contando: boolean
}

export interface TextoPildora {
  texto: string
  /** Se puede pulsar para contar (hay más y no se ha contado). */
  contable: boolean
  titulo: string
}

/** Lo que dice la píldora de la rejilla, y si se puede pulsar para contar. */
export function textoPildora(e: EstadoPildora): TextoPildora {
  if (e.contando) {
    return { texto: 'Contando…', contable: false, titulo: 'Contando las filas en el servidor' }
  }
  if (e.total !== null && e.hayMas) {
    // Tras contar se siguen cargando páginas: si entretanto alguien insertó filas,
    // las cargadas pueden pasar del total. No se enseña un «600 de 500».
    const total = Math.max(e.total, e.cargadas)
    return {
      texto: `${formatoEntero(e.cargadas)} de ${formatoEntero(total)}`,
      contable: false,
      titulo: `${filas(e.cargadas)} cargadas de ${formatoEntero(total)} en el servidor`
    }
  }
  if (e.hayMas) {
    return {
      texto: `${formatoEntero(e.cargadas)}+ filas`,
      contable: true,
      titulo: 'Hay más filas en el servidor. Pulsa para contarlas'
    }
  }
  return { texto: filas(e.cargadas), contable: false, titulo: 'Todas las filas están cargadas' }
}

/** Metadatos de la barra de la pestaña de datos: «500+ filas cargadas · 671 ms». */
export function metadatosDatos(cargadas: number, hayMas: boolean, ms: number | null): string {
  const n = `${formatoEntero(cargadas)}${hayMas ? '+' : ''}`
  const cuantas = cargadas === 1 && !hayMas ? `${n} fila cargada` : `${n} filas cargadas`
  return ms === null ? cuantas : `${cuantas} · ${formatoDuracion(ms)}`
}

// --- Errores ------------------------------------------------------------------

export interface DescripcionError {
  titulo: string
  sugerencia?: string
  /** El error crudo (código + mensaje), para el desplegable «Detalle técnico». */
  detalle: string
  tono: 'info' | 'error'
}

/**
 * El mensaje de un fallo del propio `invoke` (el canal, no el servidor), sin el
 * envoltorio que le pone Electron («Error invoking remote method 'x': Error: …»):
 * ese prefijo no le dice nada al usuario y empuja el mensaje útil fuera del aviso.
 */
export function mensajeDeInvoke(err: unknown): string {
  const bruto = err instanceof Error ? err.message : String(err)
  return bruto.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

/** Un fallo del canal como error del contrato (`interno`: no llegó al servidor). */
export function errorDeInvoke(err: unknown): DbErrorSql {
  return { motivo: 'interno', mensaje: mensajeDeInvoke(err) }
}

/** `[ORA-00904] mensaje`, o el mensaje solo si no hay código. */
export function textoError(e: Pick<DbErrorSql, 'codigo' | 'mensaje'>): string {
  return e.codigo ? `[${e.codigo}] ${e.mensaje}` : e.mensaje
}

/**
 * Titular y siguiente paso por cada motivo del contrato. `que` es lo que se
 * intentaba («leer la tabla», «leer la fuente»), para que el titular hable del
 * objeto y no de un canal.
 */
export function describirError(e: DbErrorSql, que: string): DescripcionError {
  const detalle = textoError(e)
  const fija = Object.prototype.hasOwnProperty.call(DESCRIPCIONES_FIJAS, e.motivo) ? DESCRIPCIONES_FIJAS[e.motivo] : undefined
  if (fija) {
    const { titulo, sugerencia, tono } = fija
    return sugerencia === undefined ? { titulo, detalle, tono } : { titulo, sugerencia, detalle, tono }
  }
  if (e.motivo === 'servidor') {
    return {
      titulo: `El servidor no pudo ${que}`,
      sugerencia: e.campo ? 'Revisa el filtro.' : undefined,
      detalle,
      tono: 'error'
    }
  }
  return { titulo: `No se pudo ${que}`, detalle, tono: 'error' }
}

/** Titular, siguiente paso y tono de los motivos que no dependen de lo que se intentaba. */
const DESCRIPCIONES_FIJAS: Partial<Record<DbErrorSql['motivo'], Omit<DescripcionError, 'detalle'>>> = {
  cancelada: { titulo: 'Consulta detenida', sugerencia: 'Pulsa Refrescar para volver a pedirla.', tono: 'info' },
  sinSecreto: {
    titulo: 'La conexión no tiene la contraseña guardada',
    sugerencia: 'Edita la conexión y vuelve a escribir la contraseña.',
    tono: 'error'
  },
  driver: {
    titulo: 'Falta el cliente de base de datos para este servidor',
    sugerencia: 'Instálalo desde la conexión (Editar conexión…) y vuelve a intentarlo.',
    tono: 'error'
  },
  limite: {
    titulo: 'Se alcanzó el límite de sesiones o de tamaño',
    sugerencia: 'Cierra alguna pestaña o consola, o afina la consulta, y vuelve a intentarlo.',
    tono: 'error'
  },
  sesionPerdida: {
    titulo: 'Se perdió la sesión con el servidor',
    sugerencia: 'Pulsa Refrescar para volver a conectar.',
    tono: 'error'
  },
  timeout: {
    titulo: 'El servidor tardó demasiado en responder',
    sugerencia: 'Afina el filtro o vuelve a intentarlo.',
    tono: 'error'
  },
  ocupada: {
    titulo: 'La sesión está ocupada con otra consulta',
    sugerencia: 'Espera a que termine o detenla, y vuelve a intentarlo.',
    tono: 'info'
  },
  noReleible: {
    titulo: 'Ya no se pueden leer más filas',
    sugerencia: 'Vuelve a ejecutar la consulta.',
    tono: 'info'
  },
  // La casilla «Solo lectura» de la conexión es de los agentes: este motivo llega de la BASE
  // (un servidor o una réplica en solo lectura, un archivo protegido), y el detalle dice cuál.
  soloLectura: { titulo: 'La base no admite escrituras', tono: 'error' },
  // Venció el tope de espera de un bloqueo (1222 en SQL Server): informa y deja elegir entre
  // los dos botones de `accionesDeError`.
  bloqueo: {
    titulo: 'La tabla está bloqueada por una transacción sin confirmar',
    sugerencia:
      'Otra sesión (quizá una consola tuya en Tx Manual) tiene cambios pendientes en ella. Confírmalos o revierte y pulsa «Reintentar», o «Leer sin esperar» para verla ya, incluidos los cambios aún sin confirmar.',
    tono: 'info'
  }
}

/**
 * Los botones del aviso de un BLOQUEO (`motivo: 'bloqueo'`): volver a
 * leer esperando otra vez, o leer SIN ESPERAR (`DbAbrirTabla.sinEsperar`, READ
 * UNCOMMITTED). Solo con ese motivo: los demás errores tienen su camino (Refrescar).
 */
export function accionesDeError(e: Pick<DbErrorSql, 'motivo'> | null): readonly ('reintentar' | 'sinEsperar')[] {
  return e !== null && e.motivo === 'bloqueo' ? ['reintentar', 'sinEsperar'] : []
}

/** Lo que dicen los botones de `accionesDeError`. */
export const ETIQUETA_ACCION_ERROR: Readonly<Record<'reintentar' | 'sinEsperar', string>> = {
  reintentar: 'Reintentar',
  sinEsperar: 'Leer sin esperar'
}

/**
 * La marca de una lectura hecha SIN ESPERAR: lo que se ve puede incluir cambios
 * que otra transacción aún no confirmó (y que quizá nunca confirme). Se pinta en la barra
 * mientras esos datos están a la vista; el siguiente Refrescar lee normal y la quita.
 */
export const MARCA_SIN_ESPERAR = 'leída sin esperar: puede incluir cambios sin confirmar'

/** Motivo de la píldora cuando ya no se pueden leer más filas. */
export function motivoSinLector(e: DbErrorSql): string {
  switch (e.motivo) {
    case 'cancelada':
      return 'Lectura detenida'
    case 'sesionPerdida':
      return 'Se perdió la sesión'
    case 'noReleible':
      return 'El cursor se cerró'
    default:
      return 'No se pudieron leer más filas'
  }
}

// --- Fuente -------------------------------------------------------------------

/**
 * Lenguaje de Monaco por motor, de su descriptor (`sql.lenguajeFuente`). `plsql` no
 * existe en Monaco: Oracle va como `sql`.
 */
export function lenguajeFuente(motor: DbMotor): 'sql' | 'pgsql' {
  return descriptorSql(motor).sql.lenguajeFuente
}

/**
 * Ruta del modelo propio de la pestaña de fuente (esquema `tessera-db`, autoridad
 * `fuente`). La `paneKey` lleva un NUL entre perfil y pestaña y JSON con comillas:
 * se codifica entera para que la URI sea una sola pieza opaca y única.
 */
export function rutaModeloFuente(paneKey: string): string {
  return '/' + encodeURIComponent(paneKey)
}

// --- Detener ----------------------------------------------------------------

/**
 * Los `peticionId` que la pestaña de datos cancela al pulsar Detener, al lanzar otra
 * consulta y al cerrarse: el de `abrirTabla` SOLO mientras carga (uno terminado ya no
 * está en ninguna cola), el de la página de «más filas» y el de «Contar», sin
 * repetidos. Cada operación lleva el SUYO porque `cancelar` de rol `datos` busca esa
 * clave en las colas de las sesiones de la conexión: un id que no está en ninguna no
 * detiene nada y no avisa.
 */
export function peticionesEnVuelo(p: {
  consulta: string | null
  cargando: boolean
  mas: string | null
  contar: string | null
}): string[] {
  const out: string[] = []
  for (const id of [p.cargando ? p.consulta : null, p.mas, p.contar]) {
    if (id && out.indexOf(id) === -1) out.push(id)
  }
  return out
}

// --- Ancho de columna --------------------------------------------------------

/**
 * Ancho de una columna midiendo la CABECERA con su fuente (UI, seminegrita, más el
 * hueco de sus iconos: la flecha de orden siempre y la llave si es de la PK) y las
 * CELDAS con la suya (monoespaciada). Las dos medidas pasan por `anchoInicial`, que
 * es quien fija la política (mínimo, máximo, relleno); el mayor de los dos manda.
 */
export function anchoColumnaRejilla(
  columna: Pick<DbColumnaResultado, 'nombre' | 'tipoLogico'>,
  indice: number,
  filasCargadas: readonly (readonly DbCelda[])[],
  limite: number,
  medirCelda: (s: string) => number,
  medirCabecera: (s: string) => number,
  esPk: boolean,
  opciones: OpcionesAncho
): number {
  const muestras = muestrasColumna(filasCargadas, indice, columna.tipoLogico, limite)
  const porCeldas = anchoInicial('', muestras, medirCelda, { ...opciones, icono: 0 })
  const porCabecera = anchoInicial(columna.nombre, [], medirCabecera, {
    ...opciones,
    icono: opciones.icono * (esPk ? 2 : 1)
  })
  return Math.max(porCeldas, porCabecera)
}
