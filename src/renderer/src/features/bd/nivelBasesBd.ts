// =============================================================================
// nivelBasesBd — el nivel «Bases» (SQL Server sin base fija) fuera del árbol: la fuente y los
// textos del popover del «N de M» (esquemas o bases) y qué elige el selector de la consola
// (base, esquema o nada), decidido por el descriptor del motor.
// Puro (sin DOM, React ni `process`); lo fija `test-arbol-bd.mts`.
// Decisiones: docs/decisiones/bd/ui-arbol-nivel-bases.md
// =============================================================================

import { claveBd, type CargaBd } from './arbolBd.ts'
import { descriptorSql, tieneNivelBases } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'
import type { DbMotor } from '../../../../shared/db-ipc.ts'

/** Qué lista elige el popover del «N de M». */
export type NivelPopover = 'esquemas' | 'bases'

/** Dónde vive la lista del popover en la caché y cómo se pide. */
export interface FuentePopover {
  clave: string
  carga: CargaBd
}

/**
 * La clave y la carga de la lista del popover: las bases, los esquemas de UNA base (nivel
 * «Bases») o los de la conexión (lo de siempre: `claveBd.conexion`).
 */
export function fuentePopover(conexionId: string, nivel: NivelPopover, base?: string): FuentePopover {
  switch (nivel) {
    case 'bases': {
      const clave = claveBd.bases(conexionId)
      return { clave, carga: { tipo: 'bases', clave, conexionId } }
    }
    case 'esquemas': {
      if (base === undefined) {
        const clave = claveBd.conexion(conexionId)
        return { clave, carga: { tipo: 'esquemas', clave, conexionId } }
      }
      const clave = claveBd.base(conexionId, base)
      return { clave, carga: { tipo: 'esquemas', clave, conexionId, base } }
    }
    default:
      return nunca(nivel, 'fuentePopover')
  }
}

/** Los textos del popover por lista. */
export interface TextosPopover {
  /** «Esquemas de» + alias (o base). */
  cabecera: string
  /** El nombre accesible del diálogo: «Esquemas visibles de X». */
  visibles: string
  filtrar: string
  cargando: string
  lista: string
  todos: string
  ninguno: string
  /** El `title` de una fila del sistema: «X: esquema del sistema». */
  delSistema: string
}

/** Los de 'esquemas' son los de siempre, al byte (ver la cabecera). */
export const TEXTOS_POPOVER: Readonly<Record<NivelPopover, TextosPopover>> = {
  esquemas: {
    cabecera: 'Esquemas de',
    visibles: 'Esquemas visibles',
    filtrar: 'Filtrar esquemas',
    cargando: 'Cargando esquemas…',
    lista: 'Esquemas',
    todos: 'Todos los esquemas',
    ninguno: 'Ningún esquema coincide.',
    delSistema: 'esquema del sistema'
  },
  bases: {
    cabecera: 'Bases de',
    visibles: 'Bases visibles',
    filtrar: 'Filtrar bases',
    cargando: 'Cargando bases…',
    lista: 'Bases',
    todos: 'Todas las bases',
    ninguno: 'Ninguna base coincide.',
    delSistema: 'base del sistema'
  }
}

/**
 * Qué elige el selector de la consola de una conexión (ver la cabecera):
 *   - 'esquema': el esquema de la sesión (Oracle, PG, SQLite);
 *   - 'base': la BASE (`USE`), en una conexión con nivel «Bases»;
 *   - 'fija': nada (un motor cuyo cambio de «esquema» es cambiar de base, con la base
 *     fijada en la conexión): el botón no se pinta y la barra solo dice dónde está.
 */
export type NivelSelectorConsola = 'esquema' | 'base' | 'fija'

export function nivelSelectorConsola(c: { motor: DbMotor; database?: string | null }): NivelSelectorConsola {
  // Camino SOLO SQL (el selector de la consola SQL): con un motor de otra familia lanza.
  const d = descriptorSql(c.motor)
  const n = d.catalogo.nivelBases
  switch (n) {
    case 'ninguno':
      return 'esquema'
    case 'sinBaseFija':
      return tieneNivelBases(d, c) ? 'base' : 'fija'
    default:
      return nunca(n, 'nivelSelectorConsola')
  }
}

/**
 * Lo que la consola enseña como su esquema (o base) MIENTRAS no tiene sesión, la última
 * fuente de `esquemaEfectivo`: el esquema por defecto que leyó el árbol (lo de siempre),
 * la base por defecto del login (nivel «Bases», de la lista de bases si ya se cargó) o la
 * base fijada en la conexión. Sin esto, SQL Server enseñaría «dbo» donde va una base.
 */
export function porDefectoSelector(
  nivel: NivelSelectorConsola,
  c: { database?: string | null; introspeccion?: { esquemaPorDefecto?: string | null } | null },
  basePorDefecto: string | null
): string | null {
  switch (nivel) {
    case 'esquema':
      return c.introspeccion?.esquemaPorDefecto ?? null
    case 'base':
      return basePorDefecto
    case 'fija':
      return typeof c.database === 'string' && c.database.trim() !== '' ? c.database.trim() : null
    default:
      return nunca(nivel, 'porDefectoSelector')
  }
}

/**
 * ¿El «esquema» que la sesión de una consola de este motor relee es en realidad su BASE?
 * (SQL Server: `DB_NAME()`, que cambia con `USE`.) Entonces NO sirve para calificar una
 * tabla sin esquema: el título de un resultado sería `pruebas.t` (base.tabla) y el valor
 * completo de una celda buscaría la tabla `t` en un esquema llamado `pruebas`. Quien lo usa
 * como esquema pregunta esto antes. Del descriptor, con `nunca`.
 */
export function sesionEsBase(motor: DbMotor): boolean {
  const n = descriptorSql(motor).catalogo.nivelBases
  switch (n) {
    case 'ninguno':
      return false
    case 'sinBaseFija':
      return true
    default:
      return nunca(n, 'sesionEsBase')
  }
}

/** Los textos del selector de la consola y de su botón, por lo que elige. */
export interface TextosSelectorConsola {
  /** La primera opción: «Esquema de la conexión (X)». */
  deLaConexion: (porDefecto: string | null) => string
  /** La cabecera del popover: «Esquema de la consola en» + alias. */
  cabecera: string
  filtrar: string
  cargando: string
  lista: string
  ninguno: string
  delSistema: string
  /** «Esquema: X. Pulsa para cambiar». */
  tituloBoton: (actual: string | null, ejecutando: boolean) => string
  /** «Esquema actual: X» (el dato de la barra). */
  datoActual: (actual: string) => string
  /** «Cambiando el esquema…». */
  cambiando: string
  /** El nombre accesible del botón. */
  etiquetaBoton: (actual: string | null) => string
}

/**
 * Los textos del selector. Los de 'esquema' son los de siempre (los mismos que tenía
 * `esquemaConsola.ts`, que los sigue exportando); 'fija' usa los de 'base' (la barra dice
 * «Base actual: X»).
 */
export function textosSelectorConsola(nivel: NivelSelectorConsola): TextosSelectorConsola {
  if (nivel === 'esquema') {
    return {
      deLaConexion: (p) => (p ? `Esquema de la conexión (${p})` : 'Esquema de la conexión'),
      cabecera: 'Esquema de la consola en',
      filtrar: 'Filtrar esquemas',
      cargando: 'Cargando esquemas…',
      lista: 'Esquemas',
      ninguno: 'Ningún esquema coincide.',
      delSistema: 'esquema del sistema',
      tituloBoton: (actual, ejecutando) =>
        ejecutando
          ? 'Espera a que termine la ejecución para cambiar el esquema'
          : actual
            ? `Esquema: ${actual}. Pulsa para cambiar`
            : 'Esquema de la consola. Pulsa para cambiar',
      datoActual: (a) => `Esquema actual: ${a}`,
      cambiando: 'Cambiando el esquema…',
      etiquetaBoton: (a) => (a ? `Esquema de la consola: ${a}` : 'Esquema de la consola')
    }
  }
  return {
    deLaConexion: (p) => (p ? `Base de la conexión (${p})` : 'Base de la conexión'),
    cabecera: 'Base de la consola en',
    filtrar: 'Filtrar bases',
    cargando: 'Cargando bases…',
    lista: 'Bases',
    ninguno: 'Ninguna base coincide.',
    delSistema: 'base del sistema',
    tituloBoton: (actual, ejecutando) =>
      ejecutando
        ? 'Espera a que termine la ejecución para cambiar de base'
        : actual
          ? `Base: ${actual}. Pulsa para cambiar (USE)`
          : 'Base de la consola. Pulsa para cambiar (USE)',
    datoActual: (a) => `Base actual: ${a}`,
    cambiando: 'Cambiando de base…',
    etiquetaBoton: (a) => (a ? `Base de la consola: ${a}` : 'Base de la consola')
  }
}
