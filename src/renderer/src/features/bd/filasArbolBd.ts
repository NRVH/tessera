// =============================================================================
// filasArbolBd — lo que el árbol de bases de datos HACE con sus filas, en puro: qué carga
// refresca cada una, qué ofrece un error, qué se copia, cómo se llaman las carpetas, el
// tooltip de una conexión y adónde va el cursor. `arbolBd.ts` decide QUÉ filas hay; esto,
// lo que `DbArbol.tsx` necesita de cada una. Reexporta sus piezas (sesiones, textos, ajenas y
// avisos). Sin JSX ni DOM: imports con extensión, lo cargan las pruebas con `node`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import { ALIAS_MAX, NOMBRE_ENTORNO, esEntorno } from '../../../../shared/db-ipc.ts'
import { descriptor, destinoLegible, etiquetaMotor, pideUsuarioYClave, usaOpcional } from '../../../../shared/motores/index.ts'
import { dialectoDeMotor } from '../../../../shared/sql/dialectosSql.ts'
import { citarSiHaceFalta, nombreCalificado } from '../../../../shared/sql/identificadoresSql.ts'
import { etiquetaBaseClaves } from './arbolClaves.ts'
import { cargaDeConexion, claveBd, conexionDeClave, partesDetalle } from './arbolBd.ts'
import { ordenarEsquemas } from './arbolBdReglas.ts'
import type { CargaBd, FilaBd, FilaObjeto, FilaPlaceholder } from './arbolBd.ts'
import type { FilaArbol } from './filasArbolBdAjenas.ts'
import type { DbEsquema, DbObjeto, DbParteDetalle, DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection, DbEsquemasVisibles, DriverRequerido } from '../../../../shared/db-ipc.ts'

export {
  MOTIVO_DESCONECTAR_SIN_SELECCION,
  accionDesconectarCabecera,
  avisoRevertidas,
  estadoSesionConexion,
  motivoSoloRevertir,
  nombresDeRefs,
  opcionesTxArbol,
  sesionesConCambios,
  sesionesConTx,
  soloSePuedeRevertir,
  tieneSesiones,
  type OpcionesTxArbol
} from './filasArbolBdSesiones.ts'
export { listaNatural, textoEliminarConexion } from './filasArbolBdTextos.ts'
export {
  TEXTO_AJENA,
  TEXTO_AJENA_FORMA,
  accionTeclaArbol,
  accionesDeAjena,
  ajenasMontadasPopover,
  borradoDeFila,
  causaAjena,
  componerFilasArbol,
  esContenedorArbol,
  explicacionAjena,
  filaMontajeAjena,
  motorAjeno,
  textoAjena,
  textoEliminarAjena,
  tooltipAjena,
  type BorradoDeFila,
  type FilaAjena,
  type FilaArbol
} from './filasArbolBdAjenas.ts'
export {
  MOTIVO_FORMATO_AJENO,
  NOTA_FORMATO_AJENO,
  NOTA_MONTAJE_FORMATO_AJENO,
  PISTA_SOLO_AJENAS,
  TITULO_FORMATO_AJENO,
  TITULO_SOLO_AJENAS,
  motivoSinConsola,
  motivosCabeceraArbol,
  textoVacioMontaje,
  vacioAreaSinConexiones,
  vistaPopoverMontaje
} from './filasArbolBdAvisos.ts'

// --- Errores del IPC --------------------------------------------------------------

/**
 * Mensaje limpio de un error que viene por IPC: sin el `Error invoking remote method '…':
 * Error:` con que Electron envuelve lo que lanza el main. Lo comparten el árbol y el diálogo.
 */
export function mensajeDeError(err: unknown): string {
  const bruto = err instanceof Error ? err.message : String(err)
  return bruto.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

// --- Etiquetas --------------------------------------------------------------------

/** Nombre de la carpeta de cada tipo, en minúsculas y plural. */
export const ETIQUETA_CARPETA: Record<DbTipoObjeto, string> = {
  tabla: 'tablas',
  vista: 'vistas',
  vistaMaterializada: 'vistas materializadas',
  tablaForanea: 'tablas foráneas',
  tablaVirtual: 'tablas virtuales',
  rutina: 'rutinas',
  paquete: 'paquetes',
  secuencia: 'secuencias',
  sinonimo: 'sinónimos',
  tipoObjeto: 'tipos de objeto',
  tipoColeccion: 'tipos colección',
  tipo: 'tipos',
  disparador: 'disparadores'
}

/** Nombre de cada carpeta de detalle de una tabla. */
export const ETIQUETA_PARTE: Record<DbParteDetalle, string> = {
  columnas: 'columnas',
  indices: 'índices',
  restricciones: 'restricciones'
}

// --- Conexión -----------------------------------------------------------------------

/** `user@host:port/db` o `user@host:port (SID x)`: el destino sin secreto, escrito por el descriptor. */
export function destinoConexion(c: DbConnection): string {
  return destinoLegible(c, 'conUsuario')
}

/** Tope de las notas dentro del tooltip: un tooltip no es un visor. */
const NOTAS_TOOLTIP_MAX = 600

/**
 * Tooltip de la fila de una conexión: nombre, motor y destino, entorno, solo lectura y notas.
 * El entorno va con PALABRAS: la franja y el chip son color, y el color solo no es accesible.
 */
export function tooltipConexion(c: DbConnection): string {
  const lineas = [c.alias.slice(0, ALIAS_MAX), `${etiquetaMotor(c.motor)} · ${destinoConexion(c)}`]
  if (esEntorno(c.entorno)) lineas.push(`Entorno: ${NOMBRE_ENTORNO[c.entorno]}`)
  // La casilla es de los AGENTES: lo dice, para que nadie la lea como un candado suyo.
  if (c.readonly) lineas.push('Solo lectura para los agentes')
  const notas = (c.notas ?? '').trim()
  if (notas !== '') {
    lineas.push('')
    lineas.push(notas.length > NOTAS_TOOLTIP_MAX ? `${notas.slice(0, NOTAS_TOOLTIP_MAX)}…` : notas)
  }
  return lineas.join('\n')
}

/**
 * El alias para los textos de un diálogo que CONFIRMA algo sobre la conexión: en producción,
 * `ALIAS (producción)`, para que quien pulsa un COMMIT lea que es producción. Los demás
 * entornos no se nombran.
 */
export function aliasParaConfirmar(c: Pick<DbConnection, 'alias' | 'entorno'>): string {
  return c.entorno === 'produccion' ? `${c.alias} (producción)` : c.alias
}

/**
 * El aviso de la contraseña de una conexión, o null si está bien. `almacen` es
 * `nombresSistema(plataforma).almacenSecretos`: el remedio es el mismo en las dos plataformas,
 * pero QUÉ la cifró cambia, y es lo que explica por qué pasó.
 */
export function avisoSecreto(c: DbConnection, almacen: string): string | null {
  // Un motor sin credenciales (SQLite) no guarda contraseña: no hay nada que avisar.
  if (!pideUsuarioYClave(descriptor(c.motor))) return null
  if (c.secretoIlegible) {
    return (
      'La contraseña guardada no se puede descifrar en este equipo. Se cifró con ' +
      `${almacen}, que la ata al usuario y a la máquina donde se guardó: vuelve a escribirla.`
    )
  }
  // Con el usuario OPCIONAL (MongoDB, Redis) la contraseña también lo es: un servidor sin
  // autenticación es una conexión bien dada de alta. Misma regla que `secretoOpcional` de `tdb`.
  if (!c.tieneSecreto) return usaOpcional(descriptor(c.motor), 'user') ? null : 'Sin contraseña guardada.'
  return null
}

/**
 * Subtipos que el catálogo da para marcar objetos INTERNOS del motor (las tablas de sombra de
 * una virtual y las `sqlite_*`): se atenúan como un esquema del sistema y el tooltip dice por qué.
 */
const SUBTIPO_INTERNO: Readonly<Record<string, string>> = {
  sombra: 'Tabla interna de una tabla virtual: la mantiene el motor, no se edita.',
  sistema: 'Tabla interna del motor.'
}

/** Subtipos con una explicación legible (el resto se enseña tal cual). */
const SUBTIPO_LEGIBLE: Readonly<Record<string, string>> = {
  ...SUBTIPO_INTERNO,
  sinRowid: 'WITHOUT ROWID: se identifica por su clave primaria.'
}

/** ¿Es un objeto interno del motor (se pinta atenuado)? */
export function objetoInterno(o: Pick<DbObjeto, 'subtipo'>): boolean {
  return o.subtipo !== undefined && Object.prototype.hasOwnProperty.call(SUBTIPO_INTERNO, o.subtipo)
}

/** La línea del subtipo en el tooltip de un objeto, o null si no tiene. */
export function textoSubtipo(o: Pick<DbObjeto, 'subtipo'>): string | null {
  if (!o.subtipo) return null
  return Object.prototype.hasOwnProperty.call(SUBTIPO_LEGIBLE, o.subtipo) ? SUBTIPO_LEGIBLE[o.subtipo] : o.subtipo
}

/**
 * Orden optimista tras un arrastre: la lista de `useConexionesBd` en el orden de `ids`. Lo que
 * no está en `ids` (llegó después) va al final en su orden; un id que ya no existe se ignora.
 */
export function aplicarOrden(conexiones: readonly DbConnection[], ids: readonly string[]): DbConnection[] {
  const porId = new Map(conexiones.map((c) => [c.id, c]))
  const out: DbConnection[] = []
  const puestos = new Set<string>()
  for (const id of ids) {
    const c = porId.get(id)
    if (c && !puestos.has(id)) {
      out.push(c)
      puestos.add(id)
    }
  }
  for (const c of conexiones) if (!puestos.has(c.id)) out.push(c)
  return out
}

// --- Cargas y errores ---------------------------------------------------------------

/** La carga del detalle de un objeto expandible (con su firma y su base solo si las tiene), o null. */
function cargaDeObjeto(fila: FilaObjeto): CargaBd | null {
  if (!fila.expandible) return null
  const o = fila.objeto
  const objeto: DbRefObjeto = { esquema: fila.esquema, nombre: o.nombre, tipo: o.tipo }
  if (o.firma !== undefined) objeto.firma = o.firma
  if (fila.base !== undefined) objeto.base = fila.base
  return { tipo: 'detalle', clave: fila.key, conexionId: fila.conexionId, objeto, partes: [...partesDetalle(o.tipo)] }
}

/**
 * La carga que rellena los hijos de una fila CONTENEDORA, o null si no carga nada (carpetas de
 * consolas, de detalle y de claves: sus hijos vienen con el padre). La usa el refresco de lo que
 * se ve cuando la caché marca algo obsoleto. Con nivel «Bases», lo que cuelga de una base lleva
 * su `base`, y la conexión carga su lista de bases (`cargaDeConexion`, la misma del árbol).
 */
export function cargaDeFila(fila: FilaBd): CargaBd | null {
  const b = 'base' in fila && typeof fila.base === 'string' && fila.kind !== 'base' ? { base: fila.base } : {}
  switch (fila.kind) {
    case 'conexion':
      return cargaDeConexion(fila.conexion)
    case 'doc-base':
      return { tipo: 'colecciones', clave: fila.key, conexionId: fila.conexionId, base: fila.base }
    case 'kv-base':
      // Vacía según el servidor: ni el árbol ni el refresco la recorren.
      if (fila.claves === 0) return null
      return { tipo: 'kvClaves', clave: fila.key, conexionId: fila.conexionId, base: fila.indice }
    case 'base':
      if (!fila.accesible) return null
      return { tipo: 'esquemas', clave: fila.key, conexionId: fila.conexionId, base: fila.base }
    case 'esquema':
      return { tipo: 'resumen', clave: fila.key, conexionId: fila.conexionId, esquema: fila.esquema, ...b }
    case 'carpeta':
      return {
        tipo: 'objetos',
        clave: fila.key,
        conexionId: fila.conexionId,
        esquema: fila.esquema,
        tipoObjeto: fila.tipo,
        ...b
      }
    case 'objeto':
      return cargaDeObjeto(fila)
    default:
      return null
  }
}

/** Lo que ofrece una fila de error: la acción que arregla el error, no un «Reintentar» genérico. */
export type AccionError =
  | { tipo: 'instalarCliente'; etiqueta: string; conexionId: string | null; requiereDriver: DriverRequerido }
  | { tipo: 'editarConexion'; etiqueta: string; conexionId: string }
  | { tipo: 'reintentar'; etiqueta: string; carga: CargaBd }

/**
 * La acción de una fila de error: falta el cliente > contraseña > reintentar. `conexion` es la
 * dueña del nodo (undefined si ya no está). null si no es de error o no hay nada que hacer.
 */
export function accionDeError(fila: FilaPlaceholder, conexion: DbConnection | undefined): AccionError | null {
  if (fila.variante !== 'error') return null
  const conexionId = conexion ? conexion.id : null
  if (fila.requiereDriver) {
    return { tipo: 'instalarCliente', etiqueta: 'Instalar cliente…', conexionId, requiereDriver: fila.requiereDriver }
  }
  if (conexion && (fila.motivo === 'sinSecreto' || conexion.secretoIlegible === true)) {
    return { tipo: 'editarConexion', etiqueta: 'Vuelve a escribir la contraseña', conexionId: conexion.id }
  }
  if (fila.reintentar) return { tipo: 'reintentar', etiqueta: 'Reintentar', carga: fila.reintentar }
  return null
}

// --- Qué pertenece a qué ------------------------------------------------------------

/** La conexión de la que cuelga una fila (todas las filas llevan la suya). */
export function conexionDeFila(fila: FilaBd): string | null {
  if (fila.kind === 'placeholder') return conexionDeClave(fila.padre)
  return fila.conexionId
}

/** El esquema de una fila, si tiene (para «Refrescar» de lo que cuelga de él). */
export function esquemaDeFila(fila: FilaBd): string | null {
  switch (fila.kind) {
    case 'esquema':
    case 'carpeta':
    case 'objeto':
    case 'carpeta-detalle':
    case 'columna':
    case 'indice':
    case 'restriccion':
      return fila.esquema
    default:
      return null
  }
}

/**
 * La BASE de una fila en una conexión con nivel «Bases» (la propia de una fila de base, o la de
 * lo que cuelga de ella); null en las demás. «Refrescar» y abrir una consola desde ella la usan.
 */
export function baseDeFila(fila: FilaBd): string | null {
  switch (fila.kind) {
    case 'base':
    case 'esquema':
    case 'carpeta':
    case 'objeto':
    case 'carpeta-detalle':
    case 'columna':
    case 'indice':
    case 'restriccion':
      return fila.base ?? null
    default:
      return null
  }
}

// --- Copiar ---------------------------------------------------------------------------

/** Lo que copia «Copiar nombre» (y Mod+C) sobre una fila, o null. Una AJENA no copia nada. */
export function nombreDeFila(fila: FilaArbol): string | null {
  switch (fila.kind) {
    case 'conexion':
      return fila.conexion.alias
    case 'consola':
      return fila.consola.nombre
    case 'base':
      return fila.base
    case 'esquema':
      return fila.esquema
    case 'objeto':
      return fila.objeto.nombre
    case 'columna':
      return fila.columna.nombre
    case 'indice':
      return fila.indice.nombre
    case 'restriccion':
      return fila.restriccion.nombre
    case 'doc-base':
      return fila.base
    case 'coleccion':
      return fila.coleccion.nombre
    case 'kv-base':
      return etiquetaBaseClaves(fila.indice)
    case 'kv-clave':
      return fila.nombre
    // Una carpeta de claves copia su PREFIJO (`usuario:1:`): lo que se pega en un MATCH o en «Filtrar claves…».
    case 'kv-carpeta':
      return fila.prefijo
    default:
      return null
  }
}

/**
 * «Copiar nombre cualificado» de un objeto, citado con las reglas del motor: `ESQUEMA.OBJETO`,
 * o con base (nivel «Bases») `BASE.ESQUEMA.OBJETO`, el que funciona desde una consola en otra base.
 */
export function nombreCualificadoDeFila(fila: FilaBd, motor: DbConnection['motor']): string | null {
  if (fila.kind !== 'objeto') return null
  const dos = nombreCalificado(fila.esquema, fila.objeto.nombre, dialectoDeMotor(motor))
  return fila.base !== undefined ? `${citarSiHaceFalta(fila.base, dialectoDeMotor(motor))}.${dos}` : dos
}

// --- Navegación con teclado -----------------------------------------------------------

/** ¿Se puede posar el cursor en esta fila? Todo menos «Cargando…» y «Vacío»; una AJENA sí. */
export function esNavegable(fila: FilaArbol): boolean {
  return fila.kind !== 'placeholder' || fila.variante === 'error'
}

/**
 * Siguiente fila navegable desde `desde` (exclusivo) en la dirección `dir`; si no hay, la propia
 * `desde` si era válida, o -1. `desde` puede estar fuera (-1 o `filas.length`) para entrar por un extremo.
 */
export function siguienteNavegable(filas: readonly FilaArbol[], desde: number, dir: 1 | -1): number {
  for (let i = desde + dir; i >= 0 && i < filas.length; i += dir) if (esNavegable(filas[i])) return i
  return desde >= 0 && desde < filas.length ? desde : -1
}

/** Salto de página: `paso` filas navegables en `dir`, sin salirse de la lista. */
export function saltoNavegable(filas: readonly FilaArbol[], desde: number, dir: 1 | -1, paso: number): number {
  let actual = desde
  for (let n = 0; n < Math.max(1, paso); n++) {
    const sig = siguienteNavegable(filas, actual, dir)
    if (sig === actual || sig === -1) break
    actual = sig
  }
  return actual
}

/** Índice de la primera fila que coincide con la búsqueda, o -1. */
export function primeraCoincidencia(filas: readonly FilaArbol[]): number {
  for (let i = 0; i < filas.length; i++) if (filas[i].coincidencia !== undefined) return i
  return -1
}

/** Cuántas filas coinciden con la búsqueda. */
export function contarCoincidencias(filas: readonly FilaArbol[]): number {
  let n = 0
  for (const f of filas) if (f.coincidencia !== undefined) n++
  return n
}

/** Clave de la fila de una conexión (para seleccionarla tras crearla). */
export function claveConexion(conexionId: string): string {
  return claveBd.conexion(conexionId)
}

// --- Popover de esquemas --------------------------------------------------------------

/** Normales, luego los de sistema y al final el pseudo-esquema; estable dentro de cada grupo. */
export function ordenarEsquemasPopover(lista: readonly DbEsquema[]): DbEsquema[] {
  return ordenarEsquemas(lista)
}

/** Filtro del popover: subcadena sin distinguir mayúsculas. */
export function filtrarEsquemas(lista: readonly DbEsquema[], texto: string): DbEsquema[] {
  const f = texto.trim().toLowerCase()
  if (f === '') return [...lista]
  return lista.filter((x) => x.nombre.toLowerCase().indexOf(f) !== -1)
}

/**
 * ¿Dos configuraciones dicen lo mismo? El orden no importa (es un conjunto). Evita escribir en
 * disco —e invalidar el índice de nombres— al cerrar el popover sin cambiar nada.
 */
export function mismaConfigEsquemas(a: DbEsquemasVisibles, b: DbEsquemasVisibles): boolean {
  if (a.modo !== b.modo) return false
  if (a.modo === 'todos' || b.modo === 'todos') return true
  if (a.porDefecto !== b.porDefecto) return false
  const sa = new Set(a.esquemas)
  const sb = new Set(b.esquemas)
  if (sa.size !== sb.size) return false
  for (const e of sa) if (!sb.has(e)) return false
  return true
}
