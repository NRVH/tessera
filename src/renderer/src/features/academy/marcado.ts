// =============================================================================
// Marcado en línea de los textos de Tessera Academy: `**negrita**`, `` `código` ``,
// `[texto](articulo/ancla)` y los nombres del sistema entre llaves (`{gestorArchivos}`),
// que salen de `shared/nombresSistema.ts` para no escribir el nombre de un sistema a mano.
// Sin anidar: un enlace no lleva negrita dentro. Puro; lo prueba `test-academy.mts`.
// =============================================================================

import type { NombresSistema } from '../../../../shared/nombresSistema'

export type Trozo =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'negrita'; readonly texto: string }
  | { readonly tipo: 'codigo'; readonly texto: string }
  | { readonly tipo: 'enlace'; readonly texto: string; readonly destino: string }

/** Los nombres que admiten las llaves; cualquier otra palabra entre llaves se deja tal cual. */
export const NOMBRES_ADMITIDOS: readonly (keyof NombresSistema)[] = [
  'sistema',
  'tuEquipo',
  'gestorArchivos',
  'shellNativa',
  'almacenSecretos',
  'agenteClavesSsh',
  'papelera'
]

const LLAVE = /\{([a-zA-Z]+)\}/g

/** Cambia cada `{nombre}` admitido por el de este sistema. */
export function sustituirNombres(texto: string, nombres: NombresSistema): string {
  return texto.replace(LLAVE, (todo, clave: string) =>
    (NOMBRES_ADMITIDOS as readonly string[]).includes(clave) ? nombres[clave as keyof NombresSistema] : todo
  )
}

/** Las llaves de un texto, admitidas o no: el test exige que todas lo sean. */
export function llavesDe(texto: string): string[] {
  return [...texto.matchAll(LLAVE)].map((m) => m[1])
}

const PATRON = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g

/** Parte un texto en trozos; lo que no es marcado queda como texto. */
export function partirMarcado(texto: string): Trozo[] {
  const out: Trozo[] = []
  let desde = 0
  for (const m of texto.matchAll(PATRON)) {
    const i = m.index ?? 0
    if (i > desde) out.push({ tipo: 'texto', texto: texto.slice(desde, i) })
    if (m[1] !== undefined) out.push({ tipo: 'negrita', texto: m[1] })
    else if (m[2] !== undefined) out.push({ tipo: 'codigo', texto: m[2] })
    else out.push({ tipo: 'enlace', texto: m[3], destino: m[4] })
    desde = i + m[0].length
  }
  if (desde < texto.length) out.push({ tipo: 'texto', texto: texto.slice(desde) })
  return out
}

/** El texto sin marcado, para un `title` o un `alt`. */
export function textoPlano(texto: string): string {
  return partirMarcado(texto)
    .map((t) => t.texto)
    .join('')
}

/** Los destinos de los enlaces de un texto. */
export function destinosDe(texto: string): string[] {
  return partirMarcado(texto).flatMap((t) => (t.tipo === 'enlace' ? [t.destino] : []))
}
