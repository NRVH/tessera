// =============================================================================
// Binding de Monaco e IPC sobre el núcleo puro del registro de buffers compartidos.
// Enchufa el modelo de texto de Monaco y `files.read/write`, y expone el singleton `textModels`.
// `acquire` y `reload` solo se llaman desde el target ACTIVO: la raíz de `files.read` es la suya.
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import type { editor } from 'monaco-editor'
import { ensureMonaco } from '../../comun/monacoSetup'
import { createRegistry, type ModelRegistry, type RegistryDeps } from './modelRegistryCore'

/**
 * Clave de un buffer compartido: el target (perfil + proyecto) MÁS la ruta, separados por NUL.
 * Se define aparte de `paneKey` a propósito: el diff (`diff:WORKTREE:<ruta>`) debe resolver a
 * esta misma clave para compartir buffer con la pestaña normal.
 */
export function textModelKey(targetKey: string, path: string): string {
  return `${targetKey}\u0000${path}`
}

const deps: RegistryDeps<editor.ITextModel> = {
  createModel: (text, language) => ensureMonaco().editor.createModel(text, language),
  disposeModel: (model) => model.dispose(),
  // `setValue` limpia el deshacer: al descartar cambios, lo de disco manda sobre el buffer.
  setValue: (model, text) => model.setValue(text),
  setLanguage: (model, language) => ensureMonaco().editor.setModelLanguage(model, language),
  getEol: (model) => (model.getEOL() === '\r\n' ? 'CRLF' : 'LF'),
  setEol: (model, eol) => {
    const monaco = ensureMonaco()
    model.pushEOL(
      eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
    )
  },
  // `getAlternativeVersionId`: deshacer hasta el punto guardado devuelve el mismo id.
  versionId: (model) => model.getAlternativeVersionId(),
  // Respeta el EOL del modelo y no normaliza nada: guardar es un round-trip exacto.
  getValue: (model) => model.getValue(),
  observe: (model, onChange) => {
    const sub = model.onDidChangeContent(onChange)
    return () => sub.dispose()
  },
  load: async (path, forcedEncoding) => {
    const res = await window.tessera.files.read(path, forcedEncoding)
    return {
      content: res.content,
      language: res.language,
      encoding: res.encoding,
      truncated: res.truncated,
      binary: res.binary
    }
  },
  existe: (path) => window.tessera.files.existe(path),
  write: async (path, content, encoding) => {
    const res = await window.tessera.files.write(path, content, encoding)
    return { bytesWritten: res.bytesWritten }
  }
}

/** Único registro de buffers del renderer. */
export const textModels: ModelRegistry<editor.ITextModel> = createRegistry(deps)

export { ModelSaveBlocked, type SharedTextModel } from './modelRegistryCore'
