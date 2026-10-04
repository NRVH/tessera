// =============================================================================
// El catálogo de Oracle (11.2 y superior; thin y thick): ensambla el `CatalogoExplorador` con el
// SQL (`sqlOracle`, `sqlObjetosOracle`), el mapeo (`mapeoOracle`), las FK (`fksOracle`), la
// fuente (`fuenteOracle`) y el «Ver DDL» (`verDdlOracle`). Reexporta lo público de esas piezas
// para que `catalogoSql.ts` y las pruebas no cambien de import.
// No importa `./index.ts` ni `../catalogoSql.ts` (ciclos, ver `./tipos.ts`).
// Decisiones: docs/decisiones/bd/catalogo-motores-oracle.md
// =============================================================================

import { tieneDdlOracle } from '../ddlCatalogo.ts'
import type { CatalogoExplorador } from './catalogo.ts'
import { noDisponible } from './filasCatalogo.ts'
import {
  CLAVES_POR_CONSULTA,
  RESTRICCIONES_POR_CONSULTA,
  clavesReferenciablesOracle,
  filasFksOracle,
  leerFksOracle,
  mapearFks,
  paresDeFksOracle,
  sqlColumnasDeRestricciones,
  sqlFks,
  sqlFksEntrantesOracle
} from './fksOracle.ts'
import { mapearFuente, sqlFuente } from './fuenteOracle.ts'
import {
  TIPO_OBJETO_ORACLE,
  formatearTipoOracle,
  mapearColumnas,
  mapearIndices,
  mapearRestricciones,
  mapearTipoDeObjeto,
  mapearTiposColumnas,
  type TipoColumnaOracle
} from './mapeoOracle.ts'
import { sqlObjetos } from './sqlObjetosOracle.ts'
import {
  esSistemaDeFila,
  sqlClavePrimaria,
  sqlColumnas,
  sqlConteos,
  sqlEsquemaPorDefecto,
  sqlEsquemas,
  sqlIndices,
  sqlNombres,
  sqlNombresPublicos,
  sqlResolverSinonimo,
  sqlRestricciones,
  sqlTipoDeObjeto,
  sqlTiposColumnas
} from './sqlOracle.ts'
import { leerDdlOracle } from './verDdlOracle.ts'

export {
  CLAVES_POR_CONSULTA,
  RESTRICCIONES_POR_CONSULTA,
  clavesReferenciablesOracle,
  filasFksOracle,
  formatearTipoOracle,
  leerFksOracle,
  mapearTipoDeObjeto,
  mapearTiposColumnas,
  paresDeFksOracle,
  sqlColumnasDeRestricciones,
  sqlFksEntrantesOracle,
  type TipoColumnaOracle
}

/** El catálogo de Oracle. */
export const CATALOGO_ORACLE: CatalogoExplorador = {
  motor: 'oracle',
  // La consulta de columnas no trae la PK: va aparte (`sqlClavePrimaria`).
  pkEnColumnas: false,
  // El driver no sabe la unidad de una VARCHAR2: la cabecera enseña la del catálogo.
  leeTiposDeclarados: true,

  // Una conexión de Oracle es UNA base: sin nivel «Bases».
  sqlBases(d) {
    return noDisponible(d.motor, 'nivel «Bases»')
  },
  sqlEsquemas,
  esSistemaDeFila,
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
  sqlTiposColumnas,
  mapearTiposColumnas,
  sqlFks,
  mapearFks,
  leerFks: leerFksOracle,
  sqlFuente,
  mapearFuente,
  tieneDdl: tieneDdlOracle,
  leerDdl: leerDdlOracle,
  sqlResolverSinonimo,
  sqlTipoDeObjeto,
  mapearTipoDeObjeto,
  sqlNombres,
  tipoDeNombre(codigo) {
    return TIPO_OBJETO_ORACLE[codigo.toUpperCase()]
  },
  sqlNombresPublicos
}
