// =============================================================================
// arbolBdReglas — las reglas del árbol de BD que no dependen de una fila concreta: qué
// carga una conexión según su familia, qué detalle tiene y qué abre cada tipo de objeto,
// el orden de esquemas y bases, y la regla de la búsqueda (compartida con las ajenas).
// Puro (lo cargan las pruebas con `node`); lo reexporta `arbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { TIPOS_CON_DATOS } from '../../../../shared/db-explorador-ipc.ts'
import { descriptor, tieneNivelBases } from '../../../../shared/motores/index.ts'
import { nunca } from '../../../../shared/nunca.ts'
import { raizDocumentos } from './arbolDocumentos.ts'
import { claveBd } from './arbolBdClaves.ts'
import type { DbParteDetalle, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { CargaBd, Coincidencia } from './arbolBdTipos.ts'

/**
 * Lo que pide una conexión para rellenar lo que cuelga de ella, según su familia: esquemas (o
 * las bases del nivel «Bases») en SQL, bases o colecciones en documentos, bases numeradas en
 * claves. Es la carga de su marcador «Cargando…» y la que refresca `useArbolBd`.
 */
export function cargaDeConexion(c: DbConnection): CargaBd {
  const d = descriptor(c.motor)
  switch (d.familia) {
    case 'sql':
      return tieneNivelBases(d, c)
        ? { tipo: 'bases', clave: claveBd.bases(c.id), conexionId: c.id }
        : { tipo: 'esquemas', clave: claveBd.conexion(c.id), conexionId: c.id }
    case 'documentos': {
      const raiz = raizDocumentos(d, c)
      return raiz.nivel === 'bases'
        ? { tipo: 'docBases', clave: claveBd.docBases(c.id), conexionId: c.id }
        : { tipo: 'colecciones', clave: claveBd.docBase(c.id, raiz.base), conexionId: c.id, base: raiz.base }
    }
    case 'claves':
      return { tipo: 'kvBases', clave: claveBd.kvBases(c.id), conexionId: c.id }
    default:
      return nunca(d, 'cargaDeConexion')
  }
}

const PARTES_DETALLE: Partial<Record<DbTipoObjeto, readonly DbParteDetalle[]>> = {
  tabla: ['columnas', 'indices', 'restricciones'],
  vistaMaterializada: ['columnas', 'indices'],
  vista: ['columnas'],
  tablaForanea: ['columnas'],
  tablaVirtual: ['columnas']
}

/** Partes de detalle que se piden al expandir un objeto de este tipo ([] = no se expande). */
export function partesDetalle(tipo: DbTipoObjeto): readonly DbParteDetalle[] {
  return PARTES_DETALLE[tipo] ?? []
}

const TIPOS_FUENTE: readonly DbTipoObjeto[] = ['paquete', 'rutina', 'disparador', 'tipoObjeto', 'tipoColeccion']

/** Qué pestaña abre un objeto de este tipo, o null si no abre ninguna. */
export function kindAbreTipo(tipo: DbTipoObjeto): 'datos' | 'fuente' | null {
  if (TIPOS_CON_DATOS.indexOf(tipo) !== -1) return 'datos'
  if (TIPOS_FUENTE.indexOf(tipo) !== -1) return 'fuente'
  return null
}

/**
 * Normales, luego los de sistema y al final el pseudo-esquema; estable dentro de cada grupo.
 * Las bases (`DbBase`) se ordenan igual (las del sistema al final).
 */
export function ordenarEsquemas<T extends { sistema: boolean; pseudo?: boolean }>(lista: readonly T[]): T[] {
  const grupo = (x: T): number => (x.pseudo === true ? 2 : x.sistema ? 1 : 0)
  return lista
    .map((x, i) => ({ x, i }))
    .sort((a, b) => grupo(a.x) - grupo(b.x) || a.i - b.i)
    .map((p) => p.x)
}

/**
 * El texto de búsqueda tal como se compara: sin espacios a los lados y en minúsculas. Exportada,
 * como `coincidenciaDe`, para que las filas ajenas se busquen con ESTA regla y no con una copia.
 */
export function normalizarBusqueda(filtro: string | undefined): string {
  return (filtro ?? '').trim().toLowerCase()
}

/**
 * Coincidencia sin distinguir mayúsculas. Si pasar a minúsculas cambia la longitud (como la İ
 * turca), los índices ya no casarían con la etiqueta: entonces se busca tal cual.
 * `filtroMinusculas` es el de `normalizarBusqueda`.
 */
export function coincidenciaDe(etiqueta: string, filtroMinusculas: string): Coincidencia | null {
  const baja = etiqueta.toLowerCase()
  if (baja.length === etiqueta.length) {
    const i = baja.indexOf(filtroMinusculas)
    return i === -1 ? null : [i, i + filtroMinusculas.length]
  }
  const i = etiqueta.indexOf(filtroMinusculas)
  return i === -1 ? null : [i, i + filtroMinusculas.length]
}
