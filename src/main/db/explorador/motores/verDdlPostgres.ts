// =============================================================================
// PostgreSQL: «Ver DDL» de UN objeto, generado desde el catálogo como haría `pg_dump`. Los
// generadores puros están en `../ddlCatalogo.ts`; el lector (`LectorDdl`) lo da el controlador
// y cada consulta pasa por `lector.construir`. Lo ensambla `catalogoPostgres.ts` como `leerDdl`.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

import type { DbFuente, DbRefObjeto } from '../../../../shared/db-explorador-ipc.ts'
import {
  ddlRutinaPg,
  ddlSecuenciaPg,
  ddlTablaPg,
  ddlTipoPg,
  ddlVistaPg,
  mapearRelacionPg,
  sqlRelacionPg,
  sqlSecuenciaPg,
  sqlTipoPg
} from '../ddlCatalogo.ts'
import type { LectorDdl } from './catalogo.ts'
import { mapearColumnas, mapearFuente, mapearIndices, mapearRestricciones } from './mapeoPostgres.ts'
import { sqlColumnas, sqlFuente, sqlIndices, sqlRestricciones } from './sqlPostgres.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * «Ver DDL» de PostgreSQL. Un tipo sin DDL lanza ANTES de preguntar nada (el controlador ya lo
 * filtra con `tieneDdl`; esto es la guarda).
 */
export async function leerDdlPostgres(lector: LectorDdl, ref: DbRefObjeto): Promise<DbFuente> {
  const d = lector.dialecto
  const e = ref.esquema
  const n = ref.nombre
  const leer = (fn: () => ConsultaCatalogo): Promise<readonly FilaCatalogo[]> => lector.consultar(lector.construir(fn))
  const conDdl = (texto: string | null, origen: string): DbFuente =>
    texto === null
      ? { partes: [], origen, aviso: 'No hay DDL visible: el objeto no existe o faltan privilegios para verlo.' }
      : { partes: [{ titulo: 'DDL', texto }], origen }
  switch (ref.tipo) {
    case 'tabla':
    case 'tablaForanea':
    case 'vista':
    case 'vistaMaterializada': {
      const relacion = mapearRelacionPg(await leer(() => sqlRelacionPg(e, n)))
      if (!relacion) return conDdl(null, 'pg_class')
      const columnas = mapearColumnas(await leer(() => sqlColumnas(d, e, n)))
      if (relacion.relkind === 'v' || relacion.relkind === 'm') {
        const indices = relacion.relkind === 'm' ? mapearIndices(await leer(() => sqlIndices(d, e, n))) : []
        return conDdl(ddlVistaPg({ esquema: e, nombre: n, relacion, columnas, indices }), 'pg_get_viewdef')
      }
      const restricciones = mapearRestricciones(await leer(() => sqlRestricciones(d, e, n)))
      const indices = mapearIndices(await leer(() => sqlIndices(d, e, n)))
      return conDdl(ddlTablaPg({ esquema: e, nombre: n, relacion, columnas, restricciones, indices }), 'pg_catalog')
    }
    case 'secuencia':
      return conDdl(ddlSecuenciaPg(e, n, await leer(() => sqlSecuenciaPg(e, n))), 'pg_sequence')
    case 'tipo':
      return conDdl(ddlTipoPg(e, n, await leer(() => sqlTipoPg(e, n))), 'pg_type')
    case 'rutina': {
      const fuente = mapearFuente(d, ref, await leer(() => sqlFuente(d, ref)))
      return conDdl(ddlRutinaPg(fuente), 'pg_get_functiondef')
    }
    default:
      throw lector.fallo('Ese tipo de objeto no tiene DDL en PostgreSQL.')
  }
}
