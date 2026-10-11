// =============================================================================
// MySQL y MariaDB: «Ver DDL» con el `SHOW CREATE …` del propio servidor (tabla, vista, rutina,
// disparador y evento), que da la sentencia exacta. Una rutina pregunta antes si es PROCEDURE o
// FUNCTION por su nombre y firma. Cada consulta por `lector.construir`. Lo ensambla `catalogoMysql.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-mysql.md
// =============================================================================

import type { DbFuente, DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import type { LectorDdl } from './catalogo.ts'
import { texto, textoOpcional } from './filasCatalogo.ts'
import { citarMysql } from './mapeoMysql.ts'
import { my, sqlTipoDeRutina } from './sqlMysql.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/** Los tipos con «Ver DDL» en MySQL. */
const CON_DDL: readonly DbTipoObjeto[] = ['tabla', 'vista', 'rutina', 'disparador', 'evento']

export function tieneDdlMysql(tipo: DbTipoObjeto): boolean {
  return CON_DDL.indexOf(tipo) >= 0
}

/**
 * El `SHOW CREATE` de cada tipo y la COLUMNA de su fila con la sentencia: TABLE y VIEW la dan en
 * la segunda; PROCEDURE, FUNCTION y TRIGGER, en la tercera (tras el sql_mode); EVENT, en la cuarta.
 */
function showCreate(clase: string, nombre: string): { consulta: ConsultaCatalogo; columna: number } {
  const columna = clase === 'TABLE' || clase === 'VIEW' ? 1 : clase === 'EVENT' ? 3 : 2
  return { consulta: my([`SHOW CREATE ${clase} ${nombre}`]), columna }
}

/** La clase de SHOW CREATE de un tipo que no es rutina. */
const CLASE: Partial<Record<DbTipoObjeto, string>> = { tabla: 'TABLE', vista: 'VIEW', disparador: 'TRIGGER', evento: 'EVENT' }

/** «Ver DDL» de MySQL. Un tipo sin DDL lanza ANTES de preguntar nada. */
export async function leerDdlMysql(lector: LectorDdl, ref: DbRefObjeto): Promise<DbFuente> {
  if (!tieneDdlMysql(ref.tipo)) throw lector.fallo('Ese tipo de objeto no tiene DDL en MySQL.')
  const leer = (fn: () => ConsultaCatalogo): Promise<readonly FilaCatalogo[]> => lector.consultar(lector.construir(fn))
  let clase = CLASE[ref.tipo]
  if (ref.tipo === 'rutina') {
    const filas = await leer(() => sqlTipoDeRutina(ref))
    clase = filas[0] ? texto(filas[0][0]).trim().toUpperCase() : undefined
    if (clase !== 'PROCEDURE' && clase !== 'FUNCTION') {
      return { partes: [], origen: 'SHOW CREATE', aviso: 'No hay DDL visible: la rutina no existe o faltan privilegios para verla.' }
    }
  }
  const s = showCreate(clase as string, `${citarMysql(ref.esquema)}.${citarMysql(ref.nombre)}`)
  const filas = await leer(() => s.consulta)
  const ddl = filas[0] ? textoOpcional(filas[0][s.columna]) : undefined
  const origen = `SHOW CREATE ${clase as string}`
  // Sin el privilegio para ver el cuerpo, el servidor devuelve la fila con la sentencia en NULL.
  if (ddl === undefined) return { partes: [], origen, aviso: 'No hay DDL visible: el objeto no existe o faltan privilegios para verlo.' }
  return { partes: [{ titulo: 'DDL', texto: ddl.trimEnd() + ';\n' }], origen }
}
