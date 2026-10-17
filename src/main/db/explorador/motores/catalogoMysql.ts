// =============================================================================
// El catálogo de MySQL y MariaDB: ensambla el `CatalogoExplorador` con el SQL (`sqlMysql`), el mapeo
// (`mapeoMysql`) y el «Ver DDL» (`verDdlMysql`). Las bases son el nivel de los esquemas; lo que MySQL
// no tiene (sinónimos, nivel «Bases» aparte, tipos declarados) lanza con su mensaje.
// No importa `./index.ts` ni `../catalogoSql.ts` (ciclos, ver `./tipos.ts`).
// Decisiones: docs/decisiones/bd/catalogo-motores-mysql.md
// =============================================================================

import type { CatalogoExplorador } from './catalogo.ts'
import { aBool, noDisponible, queFalta } from './filasCatalogo.ts'
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
import { txMotores } from './textosMotores.ts'
import { leerDdlMysql, tieneDdlMysql } from './verDdlMysql.ts'

/** Lo que MySQL no lee: el tipo que da su trabajador ya es el declarado. */
const sinTiposDeclarados = (): string => txMotores().sinTiposDeclarados('MySQL')

export const CATALOGO_MYSQL: CatalogoExplorador = {
  motor: 'mysql',
  // `sqlColumnas` trae `pos_pk`: no hace falta otra consulta.
  pkEnColumnas: true,
  leeTiposDeclarados: false,

  // Las bases de MySQL son sus esquemas: no hay un nivel «Bases» aparte.
  sqlBases(d) {
    return noDisponible(d.motor, queFalta.nivelBases())
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
    throw new Error(sinTiposDeclarados())
  },

  mapearTiposColumnas() {
    throw new Error(sinTiposDeclarados())
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
    return noDisponible(d.motor, queFalta.sinonimos())
  },

  sqlTipoDeObjeto(d) {
    return noDisponible(d.motor, queFalta.tipoPorNombre())
  },

  mapearTipoDeObjeto() {
    return noDisponible('mysql', queFalta.tipoPorNombre())
  },

  sqlNombres,

  tipoDeNombre(codigo) {
    return TIPO_NOMBRE_MYSQL[codigo.trim()]
  },

  sqlNombresPublicos() {
    return null
  }
}
