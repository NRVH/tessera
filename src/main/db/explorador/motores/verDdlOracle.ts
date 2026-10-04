// =============================================================================
// Oracle: «Ver DDL». DBMS_METADATA en UN bloque y, si falla por un motivo que el catálogo puede
// suplir o devuelve un DDL vacío, el repliegue reconstruido desde el diccionario. Los generadores
// puros están en `ddlOracle.ts` (los reexporta `../ddlCatalogo.ts`); el lector lo da el controlador.
// Lo ensambla `catalogoOracle.ts` como `leerDdl`.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

import type { DbFuente, DbRefObjeto } from '../../../../shared/db-explorador-ipc.ts'
import {
  avisoRepliegue,
  BIND_DDL,
  ddlDesdeFuenteOracle,
  ddlSecuenciaOracle,
  ddlSinonimoOracle,
  ddlTablaOracleDesdeCatalogo,
  limpiarDdlOracle,
  mapearComentario,
  motivoRepliegueDdl,
  sqlComentarioTablaOracle,
  sqlDdlOracle,
  sqlSecuenciaOracle,
  TOPE_DDL
} from '../ddlCatalogo.ts'
import { esFalloTrabajador } from '../protocoloTrabajador.ts'
import type { LectorDdl } from './catalogo.ts'
import { mapearSinonimo } from './filasCatalogo.ts'
import { mapearFuente, sqlFuente } from './fuenteOracle.ts'
import { mapearColumnas, mapearIndices, mapearRestricciones } from './mapeoOracle.ts'
import { sqlColumnas, sqlIndices, sqlResolverSinonimo, sqlRestricciones } from './sqlOracle.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

type Leer = (fn: () => ConsultaCatalogo) => Promise<readonly FilaCatalogo[]>

/** Sin DDL visible: el objeto no existe o faltan privilegios, con el motivo de DBMS_METADATA. */
function sinDdl(origen: string, motivo: string): DbFuente {
  return {
    partes: [],
    origen,
    aviso: `No hay DDL visible: el objeto no existe o faltan privilegios para verlo (DBMS_METADATA: ${motivo}).`
  }
}

/**
 * «Ver DDL» de Oracle: DBMS_METADATA y, si falla por un motivo que el catálogo puede suplir
 * (sin SELECT_CATALOG_ROLE, XDK ausente, privilegios…) o devuelve un DDL vacío, el repliegue
 * desde el catálogo. Cualquier otro fallo del servidor se relanza tal cual.
 */
export async function leerDdlOracle(lector: LectorDdl, ref: DbRefObjeto): Promise<DbFuente> {
  const b = lector.construir(() => sqlDdlOracle(ref))
  let motivo: string
  try {
    const r = await lector.bloqueTexto(b.sql, b.binds, BIND_DDL, TOPE_DDL)
    if (r !== null && r.texto.trim() !== '') {
      const fuente: DbFuente = { partes: [{ titulo: 'DDL', texto: limpiarDdlOracle(r.texto) }], origen: 'DBMS_METADATA' }
      if (r.recortado) fuente.aviso = `El DDL pasa de ${TOPE_DDL} caracteres: se enseña recortado.`
      return fuente
    }
    motivo = 'devolvió un DDL vacío'
  } catch (e) {
    if (!esFalloTrabajador(e)) throw e
    const m = motivoRepliegueDdl(e.error.codigo, e.error.mensaje)
    if (m === null) throw e
    motivo = m
  }
  return ddlOracleRepliegue(lector, ref, motivo)
}

/** Tabla: columnas y, si hay, restricciones, índices y comentario, en este orden. */
async function repliegueTabla(lector: LectorDdl, ref: DbRefObjeto, motivo: string, leer: Leer): Promise<DbFuente> {
  const d = lector.dialecto
  const e = ref.esquema
  const n = ref.nombre
  const columnas = mapearColumnas(await leer(() => sqlColumnas(d, e, n)))
  if (columnas.length === 0) return sinDdl('ALL_TAB_COLUMNS', motivo)
  const texto = ddlTablaOracleDesdeCatalogo({
    esquema: e,
    nombre: n,
    columnas,
    restricciones: mapearRestricciones(await leer(() => sqlRestricciones(d, e, n))),
    indices: mapearIndices(await leer(() => sqlIndices(d, e, n))),
    comentario: mapearComentario(await leer(() => sqlComentarioTablaOracle(e, n)))
  })
  return { partes: [{ titulo: 'DDL', texto }], origen: 'ALL_TAB_COLUMNS', aviso: avisoRepliegue(motivo, 'tabla') }
}

async function repliegueSecuencia(ref: DbRefObjeto, motivo: string, leer: Leer): Promise<DbFuente> {
  const texto = ddlSecuenciaOracle(ref.esquema, ref.nombre, await leer(() => sqlSecuenciaOracle(ref.esquema, ref.nombre)))
  if (texto === null) return sinDdl('ALL_SEQUENCES', motivo)
  return { partes: [{ titulo: 'DDL', texto }], origen: 'ALL_SEQUENCES', aviso: avisoRepliegue(motivo, 'catalogo') }
}

async function repliegueSinonimo(lector: LectorDdl, ref: DbRefObjeto, motivo: string, leer: Leer): Promise<DbFuente> {
  const d = lector.dialecto
  const filas = await leer(() => sqlResolverSinonimo(d, ref.esquema, ref.nombre))
  const texto = ddlSinonimoOracle(ref.esquema, ref.nombre, mapearSinonimo(filas))
  if (texto === null) return sinDdl('ALL_SYNONYMS', motivo)
  return { partes: [{ titulo: 'DDL', texto }], origen: 'ALL_SYNONYMS', aviso: avisoRepliegue(motivo, 'catalogo') }
}

/** Vistas y PL/SQL: la fuente que ya enseña «Ver fuente», con su terminador. */
async function repliegueFuente(lector: LectorDdl, ref: DbRefObjeto, motivo: string, leer: Leer): Promise<DbFuente> {
  const d = lector.dialecto
  const fuente = mapearFuente(d, ref, await leer(() => sqlFuente(d, ref)))
  const texto = ddlDesdeFuenteOracle(ref.tipo, fuente)
  if (texto === null) return sinDdl(fuente.origen, motivo)
  const avisos = [avisoRepliegue(motivo, 'fuente')]
  if (fuente.aviso) avisos.push(fuente.aviso)
  return { partes: [{ titulo: 'DDL', texto }], origen: fuente.origen, aviso: avisos.join(' ') }
}

/** El DDL reconstruido desde lo que el usuario sí ve, con el `aviso` de qué falta. */
async function ddlOracleRepliegue(lector: LectorDdl, ref: DbRefObjeto, motivo: string): Promise<DbFuente> {
  const leer: Leer = (fn) => lector.consultar(lector.construir(fn))
  switch (ref.tipo) {
    case 'tabla':
      return repliegueTabla(lector, ref, motivo, leer)
    case 'secuencia':
      return repliegueSecuencia(ref, motivo, leer)
    case 'sinonimo':
      return repliegueSinonimo(lector, ref, motivo, leer)
    default:
      return repliegueFuente(lector, ref, motivo, leer)
  }
}
