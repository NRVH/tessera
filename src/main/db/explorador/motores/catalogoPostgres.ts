// =============================================================================
// El catálogo de PostgreSQL (12 y superior): ensambla el `CatalogoExplorador` con el SQL
// (`sqlPostgres`), el mapeo (`mapeoPostgres`) y el «Ver DDL» (`verDdlPostgres`). Lo que
// PostgreSQL no tiene (sinónimos, tipos declarados, tipo por nombre) lanza con el mensaje de
// siempre. No importa `./index.ts` ni `../catalogoSql.ts` (ciclos, ver `./tipos.ts`).
// Decisiones: docs/decisiones/bd/catalogo-motores-postgres.md
// =============================================================================

import { tieneDdlPg } from '../ddlCatalogo.ts'
import type { CatalogoExplorador } from './catalogo.ts'
import { aBool, noDisponible } from './filasCatalogo.ts'
import {
  TIPO_RELKIND_PG,
  mapearColumnas,
  mapearFks,
  mapearFuente,
  mapearIndices,
  mapearRestricciones
} from './mapeoPostgres.ts'
import {
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
  sqlRestricciones
} from './sqlPostgres.ts'
import { leerDdlPostgres } from './verDdlPostgres.ts'

/** Lo que PostgreSQL no lee: los tipos que da su trabajador ya son los declarados. */
const SIN_TIPOS_DECLARADOS = 'Los tipos declarados solo se leen de Oracle: los de PostgreSQL ya llegan exactos.'

/** El catálogo de PostgreSQL. */
export const CATALOGO_POSTGRES: CatalogoExplorador = {
  motor: 'postgres',
  // `sqlColumnas` trae `pos_pk`: no hace falta otra consulta.
  pkEnColumnas: true,
  // Los tipos de su trabajador ya son los declarados ('varchar(40)', 'numeric(10,2)').
  leeTiposDeclarados: false,

  // Una conexión de PG es UNA base: sin nivel «Bases».
  sqlBases(d) {
    return noDisponible(d.motor, 'nivel «Bases»')
  },
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
  // Sin la segunda tanda de Oracle: las columnas vienen en los arrays de la única consulta.
  mapearFks,

  // La consulta va por `lector.construir`: un fallo al construirla sale con su motivo.
  async leerFks(lector, esquema, objeto) {
    return mapearFks(esquema, objeto, await lector.consultar(lector.construir(() => sqlFks(lector.dialecto, esquema, objeto))))
  },

  sqlFuente,
  mapearFuente,
  tieneDdl: tieneDdlPg,
  leerDdl: leerDdlPostgres,

  sqlResolverSinonimo(d) {
    return noDisponible(d.motor, 'sinónimos')
  },

  sqlTipoDeObjeto(d) {
    return noDisponible(d.motor, 'tipo de objeto por nombre')
  },

  mapearTipoDeObjeto() {
    return noDisponible('postgres', 'tipo de objeto por nombre')
  },

  sqlNombres,

  tipoDeNombre(codigo) {
    return TIPO_RELKIND_PG[codigo.trim()]
  },

  // PG no tiene sinónimos públicos.
  sqlNombresPublicos() {
    return null
  }
}
