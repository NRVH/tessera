// =============================================================================
// arbolBdPanes — de fila a pestaña y de pestaña a fila en el árbol de BD: qué abre cada fila
// (datos, fuente, DDL, consola, colección o visor de clave), la clave de la fila de una
// pestaña y los antepasados que hay que expandir para «Mostrar en el árbol».
// Puro; lo reexporta `arbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { prefijosDeClave } from './arbolClaves.ts'
import { claveBd } from './arbolBdClaves.ts'
import { tipoPaneQueAbre } from './arbolBdReglas.ts'
import type { DbPane } from './modeloPestanasBd.ts'
import type { FilaBd, FilaColumna, FilaObjeto } from './arbolBdTipos.ts'

/**
 * La pestaña de un objeto o de una columna: los tipos con datos abren sus DATOS (también desde
 * una columna); los de código, su FUENTE (solo desde el objeto); el resto, nada.
 */
function paneDeObjeto(fila: FilaObjeto | FilaColumna): DbPane | null {
  const o = fila.objeto
  const abre = tipoPaneQueAbre(o.tipo)
  if (abre === 'datos') {
    const p: Extract<DbPane, { tipoPane: 'datos' }> = { tipoPane: 'datos', conexionId: fila.conexionId, esquema: fila.esquema, objeto: o.nombre, tipo: o.tipo }
    if (fila.base !== undefined) p.base = fila.base
    return p
  }
  if (abre === 'fuente' && fila.tipoFila === 'objeto') {
    const p: Extract<DbPane, { tipoPane: 'fuente' }> = {
      tipoPane: 'fuente',
      conexionId: fila.conexionId,
      esquema: fila.esquema,
      objeto: o.nombre,
      tipo: o.tipo
    }
    if (o.firma !== undefined) p.firma = o.firma
    if (fila.base !== undefined) p.base = fila.base
    return p
  }
  return null
}

/** La pestaña que abre una fila, o null si no abre ninguna. */
export function paneDeFila(fila: FilaBd): DbPane | null {
  if (fila.tipoFila === 'consola') {
    return { tipoPane: 'consola', conexionId: fila.conexionId, consolaId: fila.consola.id }
  }
  // También una vista o una serie temporal: se leen igual; la edición la rechaza el servidor.
  if (fila.tipoFila === 'coleccion') {
    return { tipoPane: 'coleccion', conexionId: fila.conexionId, base: fila.base, coleccion: fila.coleccion.nombre }
  }
  // La identidad de una clave son sus BYTES (base64); el nombre pintado solo titula la pestaña.
  if (fila.tipoFila === 'kv-clave') {
    return { tipoPane: 'clave', conexionId: fila.conexionId, base: fila.indice, clave: fila.clave.nombre.base64, nombre: fila.nombre }
  }
  if (fila.tipoFila === 'objeto' || fila.tipoFila === 'columna') return paneDeObjeto(fila)
  return null
}

/**
 * La pestaña de «Ver DDL» de una fila, o null. La ofrece CUALQUIER objeto (el DDL es lo que se
 * copia para recrearlo en otra base); una hoja no, porque su DDL es el de su tabla. La firma
 * viaja (dos sobrecargas de PG son dos DDL) y el pane es un `fuente` con `modo: 'ddl'`.
 */
export function paneDdlDeFila(fila: FilaBd): DbPane | null {
  if (fila.tipoFila !== 'objeto') return null
  const o = fila.objeto
  const p: Extract<DbPane, { tipoPane: 'fuente' }> = {
    tipoPane: 'fuente',
    conexionId: fila.conexionId,
    esquema: fila.esquema,
    objeto: o.nombre,
    tipo: o.tipo,
    modo: 'ddl'
  }
  if (o.firma !== undefined) p.firma = o.firma
  if (fila.base !== undefined) p.base = fila.base
  return p
}

/** Clave de la fila que corresponde a una pestaña (para seleccionarla en el árbol). */
export function claveDePane(pane: DbPane): string {
  if (pane.tipoPane === 'consola') return claveBd.consola(pane.conexionId, pane.consolaId)
  if (pane.tipoPane === 'coleccion') return claveBd.coleccion(pane.conexionId, pane.base, pane.coleccion)
  if (pane.tipoPane === 'clave') return claveBd.kvClave(pane.conexionId, pane.base, pane.clave)
  const firma = pane.tipoPane === 'fuente' ? pane.firma : undefined
  return claveBd.objeto(pane.conexionId, pane.esquema, pane.tipo, pane.objeto, firma, pane.base)
}

/**
 * Claves que hay que EXPANDIR para que la fila de una pestaña se vea («Mostrar en el árbol»),
 * de la raíz hacia abajo, sin la de la propia fila. Con base, su nodo va entre la conexión y el
 * esquema.
 */
export function ancestrosDe(pane: DbPane): string[] {
  const conexion = claveBd.conexion(pane.conexionId)
  if (pane.tipoPane === 'consola') return [conexion, claveBd.consolas(pane.conexionId)]
  // La base de documentos va siempre: con base fija ningún nodo pinta esa clave y expandirla
  // no cambia nada, así que no hace falta saber aquí si la conexión tiene nivel «Bases».
  if (pane.tipoPane === 'coleccion') return [conexion, claveBd.docBase(pane.conexionId, pane.base)]
  // Una clave: su base y las carpetas de su nombre pintado. Si su página aún no se ha cargado,
  // la fila aparece cuando llegue; «Mostrar en el árbol» no recorre la base entera a ciegas.
  if (pane.tipoPane === 'clave') {
    const b = claveBd.kvBase(pane.conexionId, pane.base)
    return [conexion, b, ...prefijosDeClave(pane.nombre).map((p) => claveBd.kvCarpeta(pane.conexionId, pane.base, p))]
  }
  return [
    conexion,
    ...(pane.base !== undefined ? [claveBd.base(pane.conexionId, pane.base)] : []),
    claveBd.esquema(pane.conexionId, pane.esquema, pane.base),
    claveBd.carpeta(pane.conexionId, pane.esquema, pane.tipo, pane.base)
  ]
}
