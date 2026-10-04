// =============================================================================
// Fachada del SQL de catálogo del explorador y mapeadores fila -> DTO que no dependen del motor.
// Cada función delega en `motorExplorador(motor).catalogo` (`motores/catalogo*.ts`); las filas se
// leen por posición y las consultas usan siempre binds. Puro: sin electron ni drivers.
// Lo usan el controlador, el smoke de lectura y `test-catalogo-sql.mts`.
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

import type { DbMotor } from '../../../shared/db-ipc.ts'
import type {
  DbBase,
  DbColumnaInfo,
  DbColumnaResultado,
  DbConteos,
  DbEsquema,
  DbFuente,
  DbIndiceInfo,
  DbIndiceNombres,
  DbObjeto,
  DbRefObjeto,
  DbRelacionesFk,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../shared/motores/index.ts'
import { citar } from '../../../shared/sql/identificadoresSql.ts'
import { TOPE_INDICE_AUTOCOMPLETADO } from './limites.ts'
import type { CatalogoExplorador } from './motores/catalogo.ts'
import { aBool, aNumero, noDisponible, texto, textoOpcional } from './motores/filasCatalogo.ts'
import { motorExplorador } from './motores/index.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './motores/tipos.ts'
import { COLUMNA_ROWID } from './sqlRejilla.ts'

// --- Tipos (mudados a `motores/tipos.ts`; aquí siguen por sus lectores) --------------

export type { BindsCatalogo, ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './motores/tipos.ts'

// --- Lo que se mudó a otro módulo y sigue saliendo de aquí -----------------------------

export { aBool, aLista, aNumero } from './motores/filasCatalogo.ts'
export {
  CLAVES_POR_CONSULTA,
  clavesReferenciablesOracle,
  filasFksOracle,
  formatearTipoOracle,
  leerFksOracle,
  mapearTipoDeObjeto,
  mapearTiposColumnas,
  paresDeFksOracle,
  RESTRICCIONES_POR_CONSULTA,
  sqlColumnasDeRestricciones,
  sqlFksEntrantesOracle,
  type TipoColumnaOracle
} from './motores/catalogoOracle.ts'

// --- Esquemas del sistema de Oracle (11.2: no hay `oracle_maintained`) ------------

/**
 * Cuentas que crea Oracle (la 11.2 no tiene `oracle_maintained`). Vive en el descriptor
 * (`shared/motores/oracle.ts`) y se re-exporta: `test-motores-explorador.mts` exige que sea la
 * misma lista.
 */
export { ESQUEMAS_SISTEMA_ORACLE, esEsquemaSistemaOracle } from '../../../shared/motores/oracle.ts'

// --- Utilidades --------------------------------------------------------------------

/** Identificador entre comillas dobles, duplicando las que contenga (alias de `citar`). */
export const citarIdent = citar

/** El catálogo de `motor`; lanza con uno que no está en el registro. */
function catalogoDe(motor: DbMotor): CatalogoExplorador {
  return motorExplorador(motor).catalogo
}

function estadoOracle(v: unknown): 'valido' | 'invalido' | undefined {
  const t = texto(v).toUpperCase()
  if (t === 'VALID') return 'valido'
  if (t === 'INVALID') return 'invalido'
  return undefined
}

// --- Esquemas ----------------------------------------------------------------------

/**
 * Filas: `[nombre, sistema]`. Oracle 12.1+ lee `oracle_maintained`; la 11.2 no lo
 * tiene y devuelve 0 (lo decide `esEsquemaSistemaOracle`).
 */
export function sqlEsquemas(d: DialectoCatalogo): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlEsquemas(d)
}

/** Las BASES del nivel «Bases» (SQL Server sin base fija), filas `[nombre, sistema, accesible]`. */
export function sqlBases(d: DialectoCatalogo): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlBases(d)
}

/**
 * Las filas de `sqlBases` como `DbBase[]`, las del sistema al final (como los esquemas).
 * `porDefecto`: la base por defecto del login (donde abre la sesión `meta`). `esVisible`: la
 * selección «N de M» de la conexión; sin ella, solo la por defecto.
 */
export function mapearBases(
  filas: readonly FilaCatalogo[],
  porDefecto: string,
  esVisible?: (nombre: string) => boolean
): DbBase[] {
  const visible = esVisible ?? ((nombre: string): boolean => nombre === porDefecto)
  const propias: DbBase[] = []
  const delSistema: DbBase[] = []
  const vistas = new Set<string>()
  for (const f of filas) {
    const nombre = texto(f[0])
    if (nombre === '' || vistas.has(nombre)) continue
    vistas.add(nombre)
    const b: DbBase = {
      nombre,
      sistema: aBool(f[1]),
      visible: visible(nombre),
      porDefecto: nombre === porDefecto,
      accesible: aBool(f[2])
    }
    if (b.sistema) delSistema.push(b)
    else propias.push(b)
  }
  return propias.concat(delSistema)
}

/** Filas: `[esquema, usuario]`. */
export function sqlEsquemaPorDefecto(d: DialectoCatalogo): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlEsquemaPorDefecto(d)
}

export function mapearEsquemaPorDefecto(filas: readonly FilaCatalogo[]): { esquema: string; usuario: string } {
  const f = filas[0]
  if (!f) return { esquema: '', usuario: '' }
  return { esquema: texto(f[0]), usuario: texto(f[1]) }
}

/**
 * `DbEsquema[]` en el orden en que se pintan: los del usuario, luego los del
 * sistema (atenuados) y, en un motor con pseudo-esquema de sinónimos públicos (Oracle:
 * PUBLIC, `catalogo.pseudoEsquemaPublico` de su descriptor), ese al final (cuenta en la
 * M de "N de M" pero no se marca por defecto). Si el diccionario lo devuelve como
 * esquema real, se salta: sale una vez, como pseudo.
 *
 * `esVisible` decide la casilla; por defecto, solo el esquema por defecto. El cálculo con la
 * configuración guardada vive en `shared/dbEsquemas.ts`.
 */
export function mapearEsquemas(
  d: DialectoCatalogo,
  filas: readonly FilaCatalogo[],
  porDefecto: string,
  esVisible?: (e: { nombre: string; sistema: boolean; pseudo: boolean }) => boolean
): DbEsquema[] {
  const catalogo = catalogoDe(d.motor)
  const pseudo = descriptorSql(d.motor).catalogo.pseudoEsquemaPublico
  const visible = esVisible ?? ((e: { nombre: string }): boolean => e.nombre === porDefecto)
  const vistos = new Set<string>()
  const propios: DbEsquema[] = []
  const delSistema: DbEsquema[] = []
  for (const f of filas) {
    const nombre = texto(f[0])
    if (nombre === '' || vistos.has(nombre)) continue
    if (pseudo !== null && nombre === pseudo) continue
    vistos.add(nombre)
    const sistema = catalogo.esSistemaDeFila(d, nombre, f)
    const e: DbEsquema = {
      nombre,
      sistema,
      visible: visible({ nombre, sistema, pseudo: false }),
      porDefecto: nombre === porDefecto
    }
    if (sistema) delSistema.push(e)
    else propios.push(e)
  }
  const todos = propios.concat(delSistema)
  if (pseudo !== null) {
    todos.push({
      nombre: pseudo,
      sistema: false,
      visible: visible({ nombre: pseudo, sistema: false, pseudo: true }),
      porDefecto: false,
      pseudo: true
    })
  }
  return todos
}

// --- Conteos (un solo viaje) -------------------------------------------------------

/** Filas: `[tipo, n]`, con `tipo` un `DbTipoObjeto`. */
export function sqlConteos(d: DialectoCatalogo, esquema: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlConteos(d, esquema)
}

/**
 * Todas las carpetas del motor, con 0 las que no vinieron (la UI omite las vacías). Salen de
 * `descriptorSql`, que lanza con un motor desconocido.
 */
export function mapearConteos(motor: DbMotor, filas: readonly FilaCatalogo[]): DbConteos {
  const carpetas = descriptorSql(motor).catalogo.carpetas
  const conteos: DbConteos = {}
  for (const tipo of carpetas) conteos[tipo] = 0
  for (const f of filas) {
    const tipo = texto(f[0]) as DbTipoObjeto
    if (carpetas.indexOf(tipo) < 0) continue
    conteos[tipo] = (conteos[tipo] ?? 0) + (aNumero(f[1]) ?? 0)
  }
  return conteos
}

// --- Objetos por tipo --------------------------------------------------------------

/**
 * Filas (TODAS las variantes): `[nombre, subtipo, estado, comentario, firma, tabla]`.
 * `ORDER BY 1` y los mismos filtros que `sqlConteos`, para que el número de la carpeta y su
 * contenido no discrepen. Un tipo que no es carpeta del motor lanza aquí.
 */
export function sqlObjetos(d: DialectoCatalogo, esquema: string, tipo: DbTipoObjeto): ConsultaCatalogo {
  if (descriptorSql(d.motor).catalogo.carpetas.indexOf(tipo) < 0) noDisponible(d.motor, tipo)
  return catalogoDe(d.motor).sqlObjetos(d, esquema, tipo)
}

export function mapearObjetos(esquema: string, tipo: DbTipoObjeto, filas: readonly FilaCatalogo[]): DbObjeto[] {
  const objetos: DbObjeto[] = []
  for (const f of filas) {
    const nombre = texto(f[0])
    if (nombre === '') continue
    const o: DbObjeto = { esquema, nombre, tipo }
    const subtipo = textoOpcional(f[1])
    const estado = estadoOracle(f[2])
    const comentario = textoOpcional(f[3])
    // La firma vacía es legítima (función sin argumentos): se conserva como ''.
    const firma = f[4] === null || f[4] === undefined ? undefined : texto(f[4])
    const tabla = textoOpcional(f[5])
    if (subtipo !== undefined) o.subtipo = subtipo
    if (estado !== undefined) o.estado = estado
    if (comentario !== undefined) o.comentario = comentario
    if (firma !== undefined) o.firma = firma
    if (tabla !== undefined) o.tabla = tabla
    objetos.push(o)
  }
  return objetos
}

// --- Columnas ----------------------------------------------------------------------

/**
 * La forma de las filas es la de cada motor (escrita junto a su consulta). En Oracle la
 * PK no sale de aquí: la pone `aplicarPosicionesPk` con `sqlClavePrimaria`
 * (`catalogo.pkEnColumnas`). En PG viene en la última columna (`pos_pk`).
 */
export function sqlColumnas(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlColumnas(d, esquema, objeto)
}

// --- Tipos DECLARADOS de las columnas (la cabecera de la pestaña de datos) ----------------

/**
 * El tipo DECLARADO de cada columna de una tabla o vista de Oracle ('VARCHAR2(40 CHAR)',
 * 'NUMBER(*,0)'), para la cabecera de su pestaña de datos: el driver no da el tamaño de una
 * VARCHAR2 con unidad. Consulta propia y corta, por owner y table_name; solo en un motor con
 * `catalogo.leeTiposDeclarados`.
 *
 * Filas: `[column_name, data_type, data_length, char_length, char_used, data_precision,
 * data_scale, data_type_owner]`; las lee `mapearTiposColumnas`.
 */
export function sqlTiposColumnas(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlTiposColumnas(d, esquema, objeto)
}

/**
 * Las columnas del resultado de una pestaña de tabla con su `tipoDeclarado`, por nombre. La
 * que el catálogo no conoce (la columna oculta del ROWID, o una añadida FUERA de Tessera
 * después de leerlo) se queda sin él, y la cabecera enseña la del trabajador. No muta.
 */
export function conTiposDeclarados(
  columnas: readonly DbColumnaResultado[],
  tipos: ReadonlyMap<string, string>
): DbColumnaResultado[] {
  return columnas.map((c) => {
    const t = tipos.get(c.nombre)
    return t === undefined ? c : { ...c, tipoDeclarado: t }
  })
}

/**
 * ¿Hay columnas leídas que el catálogo de tipos no conoce? Es la señal de un DDL hecho fuera
 * de Tessera con el catálogo en caché, y entonces se relee una vez, como el de edición
 * (`columnasFueraDelCatalogo`). La columna oculta del ROWID no cuenta: no es de la tabla, y
 * contarla releería el catálogo en cada apertura de una tabla sin clave.
 */
export function faltanTiposDeclarados(
  columnas: readonly DbColumnaResultado[],
  tipos: ReadonlyMap<string, string>
): boolean {
  return columnas.some((c) => c.nombre !== COLUMNA_ROWID && !tipos.has(c.nombre))
}

export function mapearColumnas(motor: DbMotor, filas: readonly FilaCatalogo[]): DbColumnaInfo[] {
  return catalogoDe(motor).mapearColumnas(filas)
}

/** Filas: `[columna]` en el orden de la clave primaria (vacío si no hay PK). */
export function sqlClavePrimaria(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlClavePrimaria(d, esquema, objeto)
}

export function mapearClavePrimaria(filas: readonly FilaCatalogo[]): string[] {
  return filas.map((f) => texto(f[0])).filter((n) => n !== '')
}

/** Pone en cada columna su posición dentro de la PK (1..n) o `null`. No muta. */
export function aplicarPosicionesPk(columnas: readonly DbColumnaInfo[], pk: readonly string[]): DbColumnaInfo[] {
  return columnas.map((c) => {
    const i = pk.indexOf(c.nombre)
    return { ...c, pk: i >= 0 ? i + 1 : null }
  })
}

// --- Restricciones -----------------------------------------------------------------

/**
 * Oracle, una fila por columna y solo P/U/R (las C de Oracle incluyen un NOT NULL por
 * columna y ahogarían la lista). PG, una fila por restricción, con sus columnas en
 * arrays. La forma exacta, junto a cada consulta.
 */
export function sqlRestricciones(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlRestricciones(d, esquema, objeto)
}

export function mapearRestricciones(motor: DbMotor, filas: readonly FilaCatalogo[]): DbRestriccionInfo[] {
  return catalogoDe(motor).mapearRestricciones(filas)
}

// --- Claves ajenas (autocompletado de JOIN … ON) ----------------------------------

/**
 * Las FK que SALEN de la tabla y las que ENTRAN en ella (apuntan a su PK o a una de sus
 * UNIQUE), con sus columnas en orden de posición: la PRIMERA consulta. Oracle hace tres
 * consultas cortas (`leerFksOracle`); PG, una. Quien las lee enteras es `catalogo.leerFks`.
 */
export function sqlFks(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlFks(d, esquema, objeto)
}

/**
 * Filas -> relaciones. Oracle necesita las dos tandas (`columnas` son las filas de
 * `sqlColumnasDeRestricciones`, todas juntas); PG solo la primera.
 */
export function mapearFks(
  motor: DbMotor,
  esquema: string,
  objeto: string,
  filas: readonly FilaCatalogo[],
  columnas: readonly FilaCatalogo[] = []
): DbRelacionesFk {
  return catalogoDe(motor).mapearFks(esquema, objeto, filas, columnas)
}

// --- Índices -----------------------------------------------------------------------

/**
 * Oracle, una fila por columna (un índice funcional enseña `SYS_NC…$`). PG, una por
 * índice, con cada columna como la escribe `pg_get_indexdef` y la definición entera
 * (`CREATE INDEX …`), que es lo que usa «Ver DDL».
 */
export function sqlIndices(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlIndices(d, esquema, objeto)
}

export function mapearIndices(motor: DbMotor, filas: readonly FilaCatalogo[]): DbIndiceInfo[] {
  return catalogoDe(motor).mapearIndices(filas)
}

// --- Fuente ------------------------------------------------------------------------

/**
 * Oracle ALL_SOURCE, filas: `[type, line, text]`. Vista: `[text]` (LONG). Vista
 * materializada: `[query]`. PG, filas: `[definición]`.
 * Una rutina de PG se busca por nombre Y firma: las sobrecargas comparten nombre.
 */
export function sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlFuente(d, ref)
}

export function mapearFuente(d: DialectoCatalogo, ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  return catalogoDe(d.motor).mapearFuente(d, ref, filas)
}

// --- Sinónimos (hoy, solo Oracle) ---------------------------------------------------

/**
 * Filas: `[table_owner, table_name, db_link]`. Un salto; el llamador encadena hasta 3.
 * Lanza en un motor sin sinónimos (`descriptor(m).catalogo.tieneSinonimos`).
 */
export function sqlResolverSinonimo(d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlResolverSinonimo(d, esquema, nombre)
}

// `mapearSinonimo` vive en la hoja `motores/filasCatalogo.ts`: también lo lee el «Ver DDL» de Oracle.
export { mapearSinonimo, type DestinoSinonimo } from './motores/filasCatalogo.ts'

/**
 * Filas: `[object_type]`. Para saber qué es el destino de un sinónimo; lo lee
 * `catalogo.mapearTipoDeObjeto` del motor (el de Oracle se re-exporta arriba con su
 * nombre de siempre).
 */
export function sqlTipoDeObjeto(d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo {
  return catalogoDe(d.motor).sqlTipoDeObjeto(d, esquema, nombre)
}

// --- Índice de autocompletado ------------------------------------------------------

/**
 * Filas: `[esquema, nombre, código]`: `object_type` en Oracle; relkind o `'F'`
 * (rutina) en PG. Oracle trocea la lista de esquemas en `IN (…)` de hasta
 * `MAX_ELEMENTOS_LISTA_IN` binds (ORA-01795); PG la pasa entera como `text[]`.
 * Normalmente se pide UN esquema por llamada, para que las peticiones del árbol se
 * intercalen entre trozos en la cola de `meta`.
 */
export function sqlNombres(d: DialectoCatalogo, esquemas: readonly string[]): ConsultaCatalogo[] {
  if (esquemas.length === 0) return []
  return catalogoDe(d.motor).sqlNombres(d, esquemas)
}

/**
 * Añade filas de `sqlNombres` a un índice (o crea uno). Sin duplicados por
 * (esquema, nombre): gana la vista materializada sobre su tabla contenedora, y la
 * primera sobrecarga de una función de PG. Al llegar a `tope` se corta y se marca
 * `truncado`. No muta `base`. El código de cada fila lo traduce el catálogo del motor
 * (`catalogo.tipoDeNombre`).
 */
export function mapearNombres(
  motor: DbMotor,
  filas: readonly FilaCatalogo[],
  porDefecto: string,
  tope: number = TOPE_INDICE_AUTOCOMPLETADO,
  base?: DbIndiceNombres
): DbIndiceNombres {
  const catalogo = catalogoDe(motor)
  const esquemas = base ? base.esquemas.slice() : []
  const objetos: DbIndiceNombres['objetos'] = base ? base.objetos.slice() : []
  let truncado = base?.truncado === true
  const indiceEsquema = new Map<string, number>()
  esquemas.forEach((e, i) => indiceEsquema.set(e, i))
  const posicion = new Map<string, number>()
  objetos.forEach((o, i) => posicion.set(`${o[1]}:${o[0]}`, i))
  for (const f of filas) {
    const esquema = texto(f[0])
    const nombre = texto(f[1])
    const codigo = texto(f[2])
    const tipo = catalogo.tipoDeNombre(codigo)
    if (!tipo || nombre === '') continue
    let iEsquema = indiceEsquema.get(esquema)
    if (iEsquema === undefined) {
      iEsquema = esquemas.length
      esquemas.push(esquema)
      indiceEsquema.set(esquema, iEsquema)
    }
    const clave = `${iEsquema}:${nombre}`
    const previo = posicion.get(clave)
    if (previo !== undefined) {
      if (tipo === 'vistaMaterializada') objetos[previo] = [nombre, iEsquema, tipo]
      continue
    }
    if (objetos.length >= tope) {
      truncado = true
      continue
    }
    posicion.set(clave, objetos.length)
    objetos.push([nombre, iEsquema, tipo])
  }
  const indice: DbIndiceNombres = { esquemas, objetos, porDefecto }
  if (truncado) indice.truncado = true
  return indice
}

/**
 * Sinónimos PUBLIC (solo Oracle): capa aparte, perezosa y cacheada; en una 11g
 * con muchas opciones instaladas son del orden de 30 000 nombres. PG no tiene: null.
 * Filas: `[object_name]`.
 */
export function sqlNombresPublicos(d: DialectoCatalogo): ConsultaCatalogo | null {
  return catalogoDe(d.motor).sqlNombresPublicos(d)
}

export function mapearNombresPublicos(filas: readonly FilaCatalogo[]): string[] {
  const vistos = new Set<string>()
  for (const f of filas) {
    const n = texto(f[0])
    if (n !== '') vistos.add(n)
  }
  return Array.from(vistos).sort()
}
