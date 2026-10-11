// =============================================================================
// La vista previa de «Enviar» de una colección de MongoDB: una orden del shell por cambio, en el orden
// en que viajan (`cambiosDeEdicion`), con el `_id` como lo enseña la tabla, y el resumen por tipo. Es
// para leerla y copiarla: lo que se envía son los cambios. Pura, sin React ni DOM; la usa
// `edicionColeccion.tsx` y la prueba `test-coleccion-docs.mts`.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import type { DbDocCambio, DbDocDocumento } from '../../../../../shared/db-documentos-ipc.ts'
import { textoResumen } from '../rejilla/cambiosRejillaModelo.ts'
import { camposDeTexto } from './camposDocs.ts'
import { compactarTexto } from './tokensDocs.ts'

/** Un nombre de campo como lo escribe el shell: suelto si es un identificador, entre comillas si no. */
function claveShell(nombre: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(nombre) ? nombre : JSON.stringify(nombre)
}

/** El `_id` en notación del shell, sacado del documento leído; si no está en la página, traducido de su EJSON. */
export function textoIdDe(documentos: readonly DbDocDocumento[], idEjson: string): string {
  const doc = documentos.find((d) => d.idEjson === idEjson)
  const campo = doc ? camposDeTexto(doc.texto)?.find((c) => c.nombre === '_id') : undefined
  return campo ? compactarTexto(campo.valor) : shellDeEjson(idEjson)
}

/** Un valor EJSON canónico en notación del shell (`{"$oid": "…"}` -> `ObjectId("…")`); si no se entiende, tal cual. */
export function shellDeEjson(ejson: string): string {
  try {
    return shellDeValor(JSON.parse(ejson) as unknown)
  } catch {
    return ejson
  }
}

const q = (s: unknown): string => JSON.stringify(String(s))

/** Los envoltorios de EJSON con un solo campo `$…` y su constructor del shell. */
const ENVOLTORIOS: Record<string, (v: unknown) => string> = {
  $oid: (v) => `ObjectId(${q(v)})`,
  $numberInt: (v) => `NumberInt(${q(v)})`,
  $numberLong: (v) => `NumberLong(${q(v)})`,
  $numberDouble: (v) => `Double(${q(v)})`,
  $numberDecimal: (v) => `NumberDecimal(${q(v)})`,
  $uuid: (v) => `UUID(${q(v)})`,
  $symbol: (v) => q(v),
  $minKey: () => 'MinKey()',
  $maxKey: () => 'MaxKey()',
  $date: (v) => {
    const o = v as { $numberLong?: unknown } | string
    const ms = typeof o === 'object' && o !== null ? Number(o.$numberLong) : Date.parse(String(o))
    return Number.isFinite(ms) ? `ISODate(${q(new Date(ms).toISOString())})` : `new Date(${q(o)})`
  },
  $binary: (v) => {
    const b = v as { base64?: unknown; subType?: unknown }
    return `BinData(${parseInt(String(b.subType ?? '0'), 16) || 0}, ${q(b.base64 ?? '')})`
  },
  $timestamp: (v) => {
    const t = v as { t?: unknown; i?: unknown }
    return `Timestamp({t: ${Number(t.t)}, i: ${Number(t.i)}})`
  },
  $regularExpression: (v) => {
    const r = v as { pattern?: unknown; options?: unknown }
    return `RegExp(${q(r.pattern ?? '')}, ${q(r.options ?? '')})`
  }
}

function shellDeValor(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(shellDeValor).join(', ')}]`
  const entradas = Object.entries(v as Record<string, unknown>)
  if (entradas.length === 1 && ENVOLTORIOS[entradas[0][0]]) return ENVOLTORIOS[entradas[0][0]](entradas[0][1])
  return `{${entradas.map(([k, x]) => `${claveShell(k)}: ${shellDeValor(x)}`).join(', ')}}`
}

/** La orden del shell de un cambio. `getCollection` siempre: un nombre como `stats` chocaría con un método de `db`. */
export function lineaDeCambioDocs(coleccion: string, c: DbDocCambio, textoId: (idEjson: string) => string): string {
  const col = `db.getCollection(${JSON.stringify(coleccion)})`
  switch (c.tipo) {
    case 'insertar':
      return `${col}.insertOne(${compactarTexto(c.documento)})`
    case 'reemplazar':
      return `${col}.replaceOne({_id: ${textoId(c.idEjson)}}, ${compactarTexto(c.documento)})`
    case 'borrar':
      return `${col}.deleteOne({_id: ${textoId(c.idEjson)}})`
    case 'actualizar': {
      const partes: string[] = []
      const poner = Object.entries(c.poner).map(([k, v]) => `${claveShell(k)}: ${compactarTexto(v)}`)
      if (poner.length > 0) partes.push(`$set: {${poner.join(', ')}}`)
      if (c.quitar.length > 0) partes.push(`$unset: {${c.quitar.map((k) => `${claveShell(k)}: ""`).join(', ')}}`)
      return `${col}.updateOne({_id: ${textoId(c.idEjson)}}, {${partes.join(', ')}})`
    }
  }
}

/** «1 actualización, 2 inserciones y 1 borrado»: reemplazar un documento cuenta como actualización. */
export function resumenCambiosDocs(cambios: readonly DbDocCambio[]): string {
  const r = { actualizar: 0, insertar: 0, borrar: 0 }
  for (const c of cambios) {
    if (c.tipo === 'insertar') r.insertar++
    else if (c.tipo === 'borrar') r.borrar++
    else r.actualizar++
  }
  return textoResumen(r)
}
