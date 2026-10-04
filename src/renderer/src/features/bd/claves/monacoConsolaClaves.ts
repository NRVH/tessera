// =============================================================================
// monacoConsolaClaves: lo que la consola de claves necesita de Monaco: su lenguaje
// (`tessera-redis`, un comando por línea) y sus acciones de teclado, con los mismos acordes
// que las otras consolas. Lo usa `DbConsolaClavesPane`; las marcas del margen son las de
// `documentos/monacoConsolaDocs.ts`.
// Decisiones: docs/decisiones/bd/ui-claves-comandos-y-registro.md
// =============================================================================

import type { editor, IDisposable, languages } from 'monaco-editor'
import type { Plataforma } from '../../../../../shared/plataforma'
import { ensureMonaco } from '../../../comun/monacoSetup'

/** Id de Monaco del lenguaje de las consolas de Redis. */
export const LENGUAJE_CONSOLA_CLAVES = 'tessera-redis'

/** Esquema propio de URI: el enrutador de autocompletado SQL no la reconoce como suya. */
const ESQUEMA_URI = 'tessera-consola-claves'

/** La URI del modelo de una consola de Redis. */
export function uriConsolaClaves(consolaId: string): string {
  return `${ESQUEMA_URI}://consola/${encodeURIComponent(consolaId)}.redis`
}

/** El Monarch de la línea de comandos (ver el ADR). */
export const MONARCH_CONSOLA_CLAVES: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.redis',
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/^\s*[^\s"'#]+/, 'keyword'],
      [/\s+/, 'white'],
      [/"(?:[^"\\]|\\.)*"?/, 'string'],
      [/'(?:[^'\\]|\\.)*'?/, 'string'],
      [/-?\d+(?:\.\d+)?(?!\S)/, 'number'],
      [/[^\s"']+/, '']
    ]
  }
}

const CONF_CONSOLA_CLAVES: languages.LanguageConfiguration = {
  comments: { lineComment: '#' },
  autoClosingPairs: [
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] }
  ],
  surroundingPairs: [
    { open: '"', close: '"' },
    { open: "'", close: "'" }
  ]
}

type MonacoMinimo = ReturnType<typeof ensureMonaco>

const registrados = new WeakSet<object>()

/** Registra `tessera-redis` (idempotente por instancia de Monaco). */
export function registrarLenguajeConsolaClaves(monaco: MonacoMinimo): void {
  if (registrados.has(monaco)) return
  registrados.add(monaco)
  const l = monaco.languages
  if (!l.getLanguages().some((x) => x.id === LENGUAJE_CONSOLA_CLAVES)) {
    // Sin `extensions`: registrarlo solo al montar una consola haría que el editor de
    // archivos coloreara un `.redis` distinto según se hubiera abierto antes una o no.
    l.register({ id: LENGUAJE_CONSOLA_CLAVES, aliases: ['Consola de claves'] })
  }
  l.setLanguageConfiguration(LENGUAJE_CONSOLA_CLAVES, CONF_CONSOLA_CLAVES)
  // Síncrono (no una factoría perezosa): el primer pintado ya sale coloreado.
  l.setMonarchTokensProvider(LENGUAJE_CONSOLA_CLAVES, MONARCH_CONSOLA_CLAVES)
}

export interface ManejadoresConsolaClaves {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
}

/** Los acordes de la consola en el editor (los mismos que las otras consolas). */
export function registrarAccionesConsolaClaves(
  ed: editor.IStandaloneCodeEditor,
  plataforma: Plataforma,
  h: ManejadoresConsolaClaves
): IDisposable[] {
  const { KeyMod, KeyCode } = ensureMonaco()
  const grupo = '1_consola'
  return [
    ed.addAction({
      id: 'tessera.consolaClaves.ejecutar',
      label: 'Ejecutar comando o líneas seleccionadas',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
      contextMenuGroupId: grupo,
      contextMenuOrder: 1,
      run: () => h.ejecutar()
    }),
    ed.addAction({
      id: 'tessera.consolaClaves.ejecutarTodo',
      label: 'Ejecutar todos los comandos',
      keybindings: [KeyMod.Alt | KeyCode.KeyX, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter],
      contextMenuGroupId: grupo,
      contextMenuOrder: 2,
      run: () => h.ejecutarTodo()
    }),
    ed.addAction({
      id: 'tessera.consolaClaves.detener',
      label: 'Detener',
      keybindings: [plataforma === 'mac' ? KeyMod.CtrlCmd | KeyCode.Period : KeyMod.CtrlCmd | KeyCode.F2],
      contextMenuGroupId: grupo,
      contextMenuOrder: 3,
      run: () => h.detener()
    })
  ]
}
