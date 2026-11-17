// =============================================================================
// El proveedor de autocompletado de la consola de Redis en Monaco: sugiere el comando de cada línea con su
// sintaxis (`autocompletadoClaves.ts`) y enciende las sugerencias al escribir. Un proveedor para el
// lenguaje `tessera-redis`, registrado una vez.
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { asegurarMonaco } from '../../../comun/monacoSetup'
import { candidatosClaves, parcialDeComando } from './autocompletadoClaves'
import { LENGUAJE_CONSOLA_CLAVES } from './monacoConsolaClaves'

let registrado = false

/** Los modelos (por su uri) de las consolas de Redis Cluster: el proveedor es uno para todas. */
const modelosCluster = new Set<string>()

/** Registra el proveedor UNA vez; se puede llamar al crear cada editor. */
function asegurarAutocompletadoClaves(): void {
  if (registrado) return
  registrado = true
  const monaco = asegurarMonaco()
  monaco.languages.registerCompletionItemProvider(LENGUAJE_CONSOLA_CLAVES, {
    provideCompletionItems: (modelo, posicion) => {
      // Solo la línea hasta el cursor: es lo único que mira el contexto.
      const antes = modelo.getValueInRange({ startLineNumber: posicion.lineNumber, startColumn: 1, endLineNumber: posicion.lineNumber, endColumn: posicion.column })
      const parcial = parcialDeComando(antes)
      if (parcial === null) return { suggestions: [] }
      const rango = {
        startLineNumber: posicion.lineNumber,
        endLineNumber: posicion.lineNumber,
        startColumn: posicion.column - parcial.length,
        endColumn: posicion.column
      }
      return {
        suggestions: candidatosClaves(parcial, { cluster: modelosCluster.has(modelo.uri.toString()) }).map((c, i) => ({
          label: c.etiqueta,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: c.detalle,
          insertText: c.insertar,
          filterText: c.etiqueta,
          sortText: String(i).padStart(4, '0'),
          range: rango
        }))
      }
    }
  })
}

/**
 * Enciende las sugerencias en el editor de una consola de Redis (fuera de comentarios y comillas). Con
 * `cluster`, su modelo (también el que lo sustituya) se apunta para no ofrecer lo que allí no sirve.
 */
export function useAutocompletadoClaves(editorMonaco: editor.IStandaloneCodeEditor | null, cluster: boolean): void {
  useEffect(() => {
    if (!editorMonaco) return
    asegurarAutocompletadoClaves()
    editorMonaco.updateOptions({ quickSuggestions: { other: true, comments: false, strings: false } })
    if (!cluster) return
    let actual = editorMonaco.getModel()?.uri.toString() ?? null
    if (actual !== null) modelosCluster.add(actual)
    const sub = editorMonaco.onDidChangeModel((e) => {
      if (actual !== null) modelosCluster.delete(actual)
      actual = e.newModelUrl?.toString() ?? null
      if (actual !== null) modelosCluster.add(actual)
    })
    return () => {
      sub.dispose()
      if (actual !== null) modelosCluster.delete(actual)
    }
  }, [editorMonaco, cluster])
}
