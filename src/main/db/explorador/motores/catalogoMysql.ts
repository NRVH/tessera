// =============================================================================
// El catálogo de MySQL y MariaDB: ensambla el `CatalogoExplorador` con el SQL (`sqlMysql`), el mapeo
// (`mapeoMysql`) y el «Ver DDL» (`verDdlMysql`). Las bases son el nivel de los esquemas; lo que MySQL
// no tiene (sinónimos, nivel «Bases» aparte, tipos declarados) lanza con su mensaje.
// No importa `./index.ts` ni `../catalogoSql.ts` (ciclos, ver `./tipos.ts`).
// Decisiones: docs/decisiones/bd/catalogo-motores-mysql.md
// =============================================================================

import type { CatalogoExplorador } from './catalogo.ts'
import { aBool, noDisponible } from './filasCatalogo.ts'
import { mapearColumnas, mapearFks, mapearFuente, mapearIndices, mapearRestricciones, TIPO_NOMBRE_MYSQL } from './mapeoMysql.ts'
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
} from './sqlMysql.ts'
import { leerDdlMysql, tieneDdlMysql } from './verDdlMysql.ts'

/** Lo que MySQL no lee: el tipo que da su trabajador ya es el declarado. */
const SIN_TIPOS_DECLARADOS = 'Los tipos declarados solo se leen de Oracle: los de MySQL ya llegan exactos.'

export const CATALOGO_MYSQL: CatalogoExplorador = {
  motor: 'mysql',
  // `sqlColumnas` trae `pos_pk`: no hace falta otra consulta.
  pkEnColumnas: true,
  leeTiposDeclarados: false,

  // Las bases de MySQL son sus esquemas: no hay un nivel «Bases» aparte.
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
  mapearFks,

  async leerFks(lector, esquema, objeto) {
    return mapearFks(esquema, objeto, await lector.consultar(lector.construir(() => sqlFks(lector.dialecto, esquema, objeto))))
  },

  sqlFuente,
  mapearFuente,
  tieneDdl: tieneDdlMysql,
  leerDdl: leerDdlMysql,

  sqlResolverSinonimo(d) {
    return noDisponible(d.motor, 'sinónimos')
  },

  sqlTipoDeObjeto(d) {
    return noDisponible(d.motor, 'tipo de objeto por nombre')
  },

  mapearTipoDeObjeto() {
    return noDisponible('mysql', 'tipo de objeto por nombre')
  },

  sqlNombres,

  tipoDeNombre(codigo) {
    return TIPO_NOMBRE_MYSQL[codigo.trim()]
  },

  sqlNombresPublicos() {
    return null
  }
}
