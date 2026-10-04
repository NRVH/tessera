// =============================================================================
// Validación de «Enviar»: el main no se fía del renderer. Comprueba la FORMA de la petición
// (identidad, cambios, claves, valores, originales) y que cada columna escrita exista en el
// catálogo y sea editable. Puro y sin lanzar; lo reexporta `edicionRejilla.ts`.
// Decisiones: docs/decisiones/bd/rejilla-envio-bloqueos.md
// =============================================================================

import {
  DB_VALOR_MAX,
  type DbCambioFila,
  type DbCelda,
  type DbIdentidadFila,
  type DbOriginalesFila,
  type DbValorEdicion
} from '../../../shared/db-explorador-ipc.ts'
import type { ColumnaEdicion } from './edicionRejillaTablas.ts'
import { esIdentidad } from './edicionRejillaIdentidad.ts'
import {
  MAX_CAMBIOS_ENVIO,
  MAX_CLAVE,
  MAX_COLUMNAS_CAMBIO,
  MAX_IDENT,
  type EnvioValidado,
  type FalloCambio,
  type Validacion
} from './edicionRejillaTipos.ts'

/** ¿Es una `DbCelda` (texto, booleano o null)? Los valores de una clave llegan así. */
export function esCelda(v: unknown): v is DbCelda {
  return v === null || typeof v === 'string' || typeof v === 'boolean'
}

/** ¿Es un objeto plano (prototipo `Object` o nulo), no un array ni una instancia? */
export function esPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

function claveValida(v: unknown): v is DbCelda[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= MAX_CLAVE &&
    v.every((c) => esCelda(c) && (typeof c !== 'string' || c.length <= DB_VALOR_MAX))
  )
}

function valoresValidos(v: unknown): v is Record<string, DbValorEdicion> {
  if (!esPlano(v)) return false
  const claves = Object.keys(v)
  if (claves.length > MAX_COLUMNAS_CAMBIO) return false
  for (const k of claves) {
    if (k.length === 0 || k.length > MAX_IDENT) return false
    const x = v[k]
    if (x !== null && (typeof x !== 'string' || x.length > DB_VALOR_MAX)) return false
  }
  return true
}

/**
 * Los `originales` tal como llegan: undefined si no vienen, la copia con SOLO las entradas
 * bien formadas (nombre de columna y texto o NULL), o null si ni siquiera son un objeto. Una
 * entrada que no se entiende se DESCARTA en vez de rechazar el envío: los originales son una
 * comprobación de más, y no pueden dejar al usuario sin poder guardar su fila.
 */
function originalesDe(v: unknown): DbOriginalesFila | undefined | null {
  if (v === undefined) return undefined
  if (!esPlano(v) || Object.keys(v).length > MAX_COLUMNAS_CAMBIO) return null
  const salida: DbOriginalesFila = {}
  for (const k of Object.keys(v)) {
    const x = v[k]
    if (k.length === 0 || k.length > MAX_IDENT) continue
    if (x !== null && (typeof x !== 'string' || x.length > DB_VALOR_MAX)) continue
    salida[k] = x
  }
  return salida
}

/** Un cambio bien formado, copiado (sin propiedades de más), o su motivo. */
function cambioValido(v: unknown): DbCambioFila | string {
  if (!esPlano(v)) return 'no es un cambio'
  const originales = v.tipo === 'insertar' ? undefined : originalesDe(v.originales)
  if (originales === null) return 'sus valores leídos (originales) no son un objeto'
  switch (v.tipo) {
    case 'actualizar':
      if (!claveValida(v.clave)) return 'su clave no es válida'
      if (!valoresValidos(v.valores)) return 'sus valores no son válidos'
      return { tipo: 'actualizar', clave: v.clave.slice(), valores: { ...v.valores }, ...(originales ? { originales } : {}) }
    case 'insertar':
      if (!valoresValidos(v.valores)) return 'sus valores no son válidos'
      return { tipo: 'insertar', valores: { ...v.valores } }
    case 'borrar':
      if (!claveValida(v.clave)) return 'su clave no es válida'
      return { tipo: 'borrar', clave: v.clave.slice(), ...(originales ? { originales } : {}) }
    default:
      return 'tipo de cambio desconocido'
  }
}

/** El motivo por el que la cabecera de la petición (ids, identidad, lista de cambios) no vale, o null. */
function motivoDeCabecera(req: Record<string, unknown>): string | null {
  const { conexionId, peticionId, identidad, cambios, confirmado } = req
  if (typeof conexionId !== 'string' || conexionId.length === 0 || conexionId.length > MAX_IDENT) {
    return 'Petición inválida: falta «conexionId».'
  }
  if (typeof peticionId !== 'string' || peticionId.length === 0 || peticionId.length > 200) {
    return 'Petición inválida: falta «peticionId».'
  }
  if (!esIdentidad(identidad)) return 'Petición inválida: «identidad».'
  if (!Array.isArray(cambios) || cambios.length === 0) return 'No hay cambios que enviar.'
  if (cambios.length > MAX_CAMBIOS_ENVIO) {
    return `Demasiados cambios en un envío (${cambios.length}; el tope es ${MAX_CAMBIOS_ENVIO}).`
  }
  if (confirmado !== undefined && typeof confirmado !== 'boolean') return 'Petición inválida: «confirmado».'
  return null
}

/** Los cambios copiados y validados, o el motivo del primero que no vale. */
function cambiosValidos(cambios: readonly unknown[]): DbCambioFila[] | string {
  const lista: DbCambioFila[] = []
  for (let i = 0; i < cambios.length; i++) {
    const c = cambioValido(cambios[i])
    if (typeof c === 'string') return `Petición inválida: el cambio ${i + 1} ${c}.`
    lista.push(c)
  }
  return lista
}

/** La FORMA de un `DbEnviarCambios` tal como llega del renderer. Nunca lanza. */
export function validarFormaEnvio(req: unknown): Validacion<EnvioValidado> {
  if (!esPlano(req)) return { ok: false, mensaje: 'Petición inválida.' }
  const motivo = motivoDeCabecera(req)
  if (motivo !== null) return { ok: false, mensaje: motivo }
  const lista = cambiosValidos(req.cambios as unknown[])
  if (typeof lista === 'string') return { ok: false, mensaje: lista }
  return {
    ok: true,
    valor: {
      conexionId: req.conexionId as string,
      peticionId: req.peticionId as string,
      objeto: req.objeto,
      identidad: req.identidad as DbIdentidadFila,
      cambios: lista,
      confirmado: req.confirmado === true
    }
  }
}

/** Un mapa nombre -> columna del catálogo. */
export function columnasPorNombre(columnas: readonly ColumnaEdicion[]): Map<string, ColumnaEdicion> {
  const porNombre = new Map<string, ColumnaEdicion>()
  for (const c of columnas) porNombre.set(c.nombre, c)
  return porNombre
}

/**
 * Cada columna que se ESCRIBE existe en el catálogo y es editable; la del ROWID nunca.
 * Devuelve el primer fallo o null. Las claves las comprueba `prepararEnvio` (con la misma
 * función que construye la sentencia).
 */
export function validarCambios(
  identidad: DbIdentidadFila,
  cambios: readonly DbCambioFila[],
  columnas: readonly ColumnaEdicion[]
): FalloCambio | null {
  const porNombre = columnasPorNombre(columnas)
  for (let i = 0; i < cambios.length; i++) {
    const cambio = cambios[i]
    if (cambio.tipo === 'borrar') continue
    for (const nombre of Object.keys(cambio.valores)) {
      if (identidad.tipo === 'rowid' && nombre === identidad.columna) {
        return { indice: i, mensaje: `Cambio ${i + 1}: la columna del ROWID no se escribe.` }
      }
      const col = porNombre.get(nombre)
      if (!col) return { indice: i, mensaje: `Cambio ${i + 1}: la columna ${nombre} no existe en la tabla (vuelve a abrirla).` }
      if (col.noEditable !== null) return { indice: i, mensaje: `Cambio ${i + 1}: ${nombre} no se puede editar. ${col.noEditable}` }
    }
  }
  return null
}
