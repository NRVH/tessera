// =============================================================================
// El catálogo de SQL Server (2012 y superior): ensambla el `CatalogoExplorador` con el SQL
// (`sqlSqlserver`), el mapeo (`mapeoSqlserver`) y el «Ver DDL» (`verDdlSqlserver`). Solo este
// motor tiene el nivel «Bases» (`sqlBasesSqlServer`, fuera de la interfaz).
// No importa `./index.ts` ni `../catalogoSql.ts` (ciclos, ver `./tipos.ts`).
// Decisiones: docs/decisiones/bd/catalogo-motores-sqlserver.md
// =============================================================================

import { tieneDdlSqlServer } from '../ddlCatalogo.ts'
import type { CatalogoExplorador } from './catalogo.ts'
import { aBool } from './filasCatalogo.ts'
import {
  mapearColumnas,
  mapearFks,
  mapearFuente,
  mapearIndices,
  mapearRestricciones,
  mapearTipoDeObjeto
} from './mapeoSqlserver.ts'
import {
  CARPETA_DE_TIPO,
  sqlBasesSqlServer,
  sqlClavePrimaria,
  sqlColumnas,
  sqlConteos,
  sqlEsquemaPorDefecto,
  sqlEsquemas,
  sqlFks,
  sqlFuente,
  sqlIndices,
  sqlNombres,
  sqlObjetos,
  sqlResolverSinonimo,
  sqlRestricciones,
  sqlTipoDeObjeto
} from './sqlSqlserver.ts'
import { leerDdlSqlServer } from './verDdlSqlserver.ts'

export { sqlBasesSqlServer }

/** Lo que SQL Server no lee: los tipos que da su trabajador ya son los declarados. */
const SIN_TIPOS_DECLARADOS = 'Los tipos declarados solo se leen de Oracle: los de SQL Server ya llegan exactos.'

/** El catálogo de SQL Server. */
export const CATALOGO_SQLSERVER: CatalogoExplorador = {
  motor: 'sqlserver',
  // `sqlColumnas` trae la posición en el índice de la PK: no hace falta otra consulta.
  pkEnColumnas: true,
  // Los tipos que da tedious (nombre, longitud, precisión y escala) ya son los declarados.
  leeTiposDeclarados: false,

  sqlBases: sqlBasesSqlServer,
  sqlEsquemas,
  esSistemaDeFila(_d, _nombre, fila) {
    return aBool(fila[1])
  },
  sqlEsquemaPorDefecto,
  sqlConteos,
  sqlObjetos,
  sqlColumnas,
  mapearColumnas,
  sqlClavePrimaria,
  sqlRestricciones,
  mapearRestricciones,
  sqlIndices,
  mapearIndices,

  sqlTiposColumnas() {
    throw new Error(SIN_TIPOS_DECLARADOS)
  },

  mapearTiposColumnas() {
    throw new Error(SIN_TIPOS_DECLARADOS)
  },

  sqlFks,
  mapearFks,

  async leerFks(lector, esquema, objeto) {
    return mapearFks(esquema, objeto, await lector.consultar(lector.construir(() => sqlFks(lector.dialecto, esquema, objeto))))
  },

  sqlFuente,
  mapearFuente,
  tieneDdl: tieneDdlSqlServer,
  leerDdl: leerDdlSqlServer,
  sqlResolverSinonimo,
  sqlTipoDeObjeto,
  mapearTipoDeObjeto,
  sqlNombres,

  tipoDeNombre(codigo) {
    return CARPETA_DE_TIPO[codigo.trim()]
  },

  // SQL Server no tiene sinónimos públicos (los sinónimos son de un esquema).
  sqlNombresPublicos() {
    return null
  }
}
