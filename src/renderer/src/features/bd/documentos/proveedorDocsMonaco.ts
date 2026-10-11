// =============================================================================
// El proveedor de autocompletado de la consola de MongoDB en Monaco: de qué conexión y base es cada
// modelo (lo registra el pane), las colecciones y los campos de muestra que pide al main (con una
// caché corta, sin esperar más de `ESPERA_DATOS_MS`) y los candidatos de `autocompletadoDocs.ts`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useEffect } from 'react'
import type { CancellationToken, editor, languages } from 'monaco-editor'
import { ensureMonaco } from '../../../comun/monacoSetup'
import { candidatosDocs, contextoAutocompletadoDocs, type DatosDocs, type PeticionDocs, type TipoCandidatoDocs } from './autocompletadoDocs'
import { LENGUAJE_CONSOLA_DOCS } from './monacoConsolaDocs'

/** De qué conexión y base es un modelo; funciones, porque la base cambia con `use`. */
export interface RutaDocs {
  conexionId: () => string
  base: () => string | null
}

const rutas = new Map<string, RutaDocs>()

/** Registra la ruta de un modelo de consola; devuelve cómo quitarla. */
export function registrarRutaDocs(uri: string, ruta: RutaDocs): () => void {
  rutas.set(uri, ruta)
  return () => {
    if (rutas.get(uri) === ruta) rutas.delete(uri)
  }
}

/** Lo que dura una lista pedida: lo bastante para teclear seguido, poco para no quedarse con una vieja. */
const VIGENCIA_MS = 30_000
/** Lo más que espera una sugerencia a los datos del main; después sale sin ellos. */
const ESPERA_DATOS_MS = 1500

const cache = new Map<string, { en: number; valor: Promise<readonly string[]> }>()

function recordado(clave: string, pedir: () => Promise<readonly string[]>): Promise<readonly string[]> {
  const ahora = Date.now()
  const c = cache.get(clave)
  if (c && ahora - c.en < VIGENCIA_MS) return c.valor
  // Un fallo se recuerda igual (vacío) hasta que caduca: sin eso, con la conexión caída cada tecla
  // volvería a preguntar al main y a esperar.
  const valor = pedir().catch(() => [] as readonly string[])
  for (const [k, v] of cache) if (ahora - v.en >= VIGENCIA_MS) cache.delete(k)
  cache.set(clave, { en: ahora, valor })
  return valor
}

function colecciones(conexionId: string, base: string): Promise<readonly string[]> {
  return recordado(JSON.stringify(['c', conexionId, base]), async () => {
    const r = await window.tessera.dbDocumentos.colecciones({ conexionId, base })
    if (!r.ok) throw new Error(r.error.mensaje)
    return r.valor.map((c) => c.nombre)
  })
}

function campos(conexionId: string, base: string, coleccion: string): Promise<readonly string[]> {
  return recordado(JSON.stringify(['f', conexionId, base, coleccion]), async () => {
    const r = await window.tessera.dbDocumentos.detalle({ conexionId, base, coleccion })
    if (!r.ok) throw new Error(r.error.mensaje)
    return r.valor.campos.map((c) => c.nombre)
  })
}

/** `p`, o nada si tarda más de `ESPERA_DATOS_MS`. */
function aTiempo(p: Promise<readonly string[]>): Promise<readonly string[] | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ESPERA_DATOS_MS))])
}

/** Lo que hace falta pedir al main para este contexto. */
async function datosPara(p: PeticionDocs, ruta: RutaDocs): Promise<DatosDocs> {
  const base = ruta.base()
  if (base === null) return {}
  const c = p.contexto
  if (c.tipo === 'db') return { colecciones: await aTiempo(colecciones(ruta.conexionId(), base)) }
  if (c.tipo === 'clave' && !c.etapa && c.coleccion !== null && !p.parcial.startsWith('$')) {
    return { campos: await aTiempo(campos(ruta.conexionId(), base, c.coleccion)) }
  }
  return {}
}

function tipoMonaco(t: TipoCandidatoDocs): languages.CompletionItemKind {
  const K = ensureMonaco().languages.CompletionItemKind
  if (t === 'coleccion') return K.Module
  if (t === 'metodo') return K.Method
  if (t === 'campo') return K.Field
  if (t === 'operador') return K.Operator
  return K.Keyword
}

async function sugerir(model: editor.ITextModel, position: { lineNumber: number; column: number }, token: CancellationToken): Promise<languages.CompletionList> {
  const ruta = rutas.get(model.uri.toString())
  // Solo hasta el cursor: es lo único que mira el contexto, y el modelo puede ser grande.
  const antes = ruta ? model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column }) : ''
  const p = ruta ? contextoAutocompletadoDocs(antes, antes.length) : null
  if (!ruta || !p) return { suggestions: [] }
  const datos = await datosPara(p, ruta)
  if (token.isCancellationRequested || model.isDisposed()) return { suggestions: [] }
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: position.column - p.parcial.length,
    endColumn: position.column
  }
  return {
    suggestions: candidatosDocs(p, datos).map((c, i) => ({
      label: c.etiqueta,
      kind: tipoMonaco(c.tipo),
      insertText: c.insertar,
      filterText: c.etiqueta,
      // Los datos de la base delante de los métodos y operadores, en el orden en que llegan.
      sortText: `${c.tipo === 'coleccion' || c.tipo === 'campo' ? 0 : 1}${String(i).padStart(4, '0')}`,
      range
    }))
  }
}

/**
 * Engancha el autocompletado a la consola: registra el proveedor (una vez), la ruta del modelo
 * (conexión y base, que leen sus refs) y enciende las sugerencias al escribir en su editor.
 */
export function useAutocompletadoDocs(
  ed: editor.IStandaloneCodeEditor | null,
  modelo: editor.ITextModel | null,
  conexionRef: React.MutableRefObject<{ id: string }>,
  baseRef: React.MutableRefObject<string | null>
): void {
  useEffect(() => {
    if (!ed) return
    asegurarAutocompletadoDocs()
    ed.updateOptions({ quickSuggestions: { other: true, comments: false, strings: false } })
  }, [ed])
  useEffect(() => {
    if (!modelo) return
    return registrarRutaDocs(modelo.uri.toString(), { conexionId: () => conexionRef.current.id, base: () => baseRef.current })
  }, [modelo, conexionRef, baseRef])
}

let registrado = false

/** Registra el proveedor de la consola de documentos UNA vez; se puede llamar al crear cada editor. */
export function asegurarAutocompletadoDocs(): void {
  if (registrado) return
  registrado = true
  ensureMonaco().languages.registerCompletionItemProvider(LENGUAJE_CONSOLA_DOCS, {
    triggerCharacters: ['.', '$'],
    provideCompletionItems: (model, position, _context, token) => sugerir(model, position, token)
  })
}
