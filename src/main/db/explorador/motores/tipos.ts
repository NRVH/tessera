// =============================================================================
// Tipos del código por motor del explorador (main): la forma de una consulta de catálogo, el
// dialecto con versión y base, y el par `MotorExplorador` (catálogo + sesión) que junta
// `index.ts`. Las interfaces viven en `catalogo.ts` y `sesion.ts`, un archivo por motor cada una.
// Los archivos por motor no importan `index.ts` (regla de los ciclos, en el ADR).
// Decisiones: docs/decisiones/bd/motores-codigo-por-motor.md
// =============================================================================

import type { DbMotor } from '../../../../shared/db-ipc.ts'
import type { CatalogoExplorador } from './catalogo.ts'
import type { SesionExplorador } from './sesion.ts'

/** Motor y versión MAYOR del servidor (Oracle 11, 12, 19…; PG 12, 16…). Su clave es el MOTOR. */
export interface DialectoCatalogo {
  motor: DbMotor
  versionMayor: number
  /**
   * La BASE a la que se refiere la consulta, en una conexión con nivel «Bases» (SQL Server sin
   * base fija). Ausente = la de la sesión. Es el contexto en que se lee el catálogo, como la
   * versión; los motores sin bases la ignoran.
   */
  base?: string
}

/** Oracle: binds con nombre (`:esq`). PG: posicionales (`$1`), arrays incluidos. */
export type BindsCatalogo = Record<string, string | number | null> | Array<string | number | string[]>

export interface ConsultaCatalogo {
  sql: string
  binds: BindsCatalogo
}

export type FilaCatalogo = readonly unknown[]

/** Todo el código por motor del explorador. */
export interface MotorExplorador {
  catalogo: CatalogoExplorador
  sesion: SesionExplorador
}

export type { CatalogoExplorador, SesionExplorador }
