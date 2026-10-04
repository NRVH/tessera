// =============================================================================
// SQL Server: «Ver DDL» generado desde el catálogo (el servidor no tiene un GET_DDL): la tabla con
// sus columnas, restricciones e índices; la vista y la rutina con su definición tal cual la guarda
// el servidor; la secuencia, el sinónimo y el tipo desde sus vistas. Cada consulta por
// `lector.construir`. Lo ensambla `catalogoSqlserver.ts` como `leerDdl`.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

import type { DbFuente, DbRefObjeto } from '../../../../shared/db-explorador-ipc.ts'
import {
  ddlSecuenciaSqlServer,
  ddlSinonimoSqlServer,
  ddlTablaSqlServer,
  ddlTipoSqlServer,
  sqlSecuenciaSqlServer,
  sqlSinonimoSqlServer,
  sqlTipoSqlServer
} from '../ddlCatalogo.ts'
import type { LectorDdl } from './catalogo.ts'
import { columnaDdl, indicesDdl, mapearFuente, restriccionesDdl } from './mapeoSqlserver.ts'
import { sqlColumnas, sqlFuente, sqlIndices, sqlRestricciones } from './sqlSqlserver.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * «Ver DDL» de SQL Server. Un `CREATE OR ALTER` se guarda como «CREATE   PROCEDURE» y así se
 * enseña. Un tipo sin DDL lanza ANTES de preguntar nada.
 */
export async function leerDdlSqlServer(lector: LectorDdl, ref: DbRefObjeto): Promise<DbFuente> {
  const d: DialectoCatalogo = ref.base !== undefined && lector.dialecto.base === undefined ? { ...lector.dialecto, base: ref.base } : lector.dialecto
  const e = ref.esquema
  const n = ref.nombre
  const leer = (fn: () => ConsultaCatalogo): Promise<readonly FilaCatalogo[]> => lector.consultar(lector.construir(fn))
  const conDdl = (textoDdl: string | null, origen: string, aviso?: string): DbFuente =>
    textoDdl === null
      ? { partes: [], origen, aviso: aviso ?? 'No hay DDL visible: el objeto no existe o faltan privilegios para verlo.' }
      : { partes: [{ titulo: 'DDL', texto: textoDdl }], origen }
  switch (ref.tipo) {
    case 'tabla': {
      const columnas = (await leer(() => sqlColumnas(d, e, n))).map(columnaDdl)
      if (columnas.length === 0) return conDdl(null, 'sys.columns')
      const restricciones = restriccionesDdl(await leer(() => sqlRestricciones(d, e, n)))
      const indices = indicesDdl(await leer(() => sqlIndices(d, e, n)))
      return conDdl(ddlTablaSqlServer({ esquema: e, nombre: n, columnas, restricciones, indices }), 'sys.columns')
    }
    case 'vista':
    case 'rutina': {
      const fuente = mapearFuente(d, ref, await leer(() => sqlFuente(d, ref)))
      const parte = fuente.partes[0]
      return conDdl(parte ? parte.texto.trim() + '\n' : null, 'sys.sql_modules', fuente.aviso)
    }
    case 'secuencia':
      return conDdl(ddlSecuenciaSqlServer(e, n, await leer(() => sqlSecuenciaSqlServer(e, n, d.base))), 'sys.sequences')
    case 'sinonimo':
      return conDdl(ddlSinonimoSqlServer(e, n, await leer(() => sqlSinonimoSqlServer(e, n, d.base))), 'sys.synonyms')
    case 'tipo':
      return conDdl(ddlTipoSqlServer(e, n, await leer(() => sqlTipoSqlServer(e, n, d.base))), 'sys.types')
    default:
      throw lector.fallo('Ese tipo de objeto no tiene DDL en SQL Server.')
  }
}
