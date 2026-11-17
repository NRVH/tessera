// =============================================================================
// Binding de Monaco e IPC sobre el núcleo puro del registro de buffers compartidos.
// Enchufa el modelo de texto de Monaco y `files.leerArchivo/escribirArchivo`, y expone el singleton `modelosTexto`.
// Cada buffer lleva la contenedora de su proyecto y la manda con cada lectura y escritura.
// Decisiones: docs/decisiones/editor/registro-de-modelos.md
// =============================================================================

import type { editor } from 'monaco-editor'
import { asegurarMonaco } from '../../comun/monacoSetup'
import { crearRegistro, type RegistroModelos, type DependenciasRegistro } from './registroModelosCore'

/**
 * Clave de un buffer compartido: el target (perfil + proyecto) MÁS la ruta, separados por NUL.
 * Se define aparte de `clavePane` a propósito: el diff (`diff:WORKTREE:<ruta>`) debe resolver a
 * esta misma clave para compartir buffer con la pestaña normal.
 */
export function claveModeloTexto(claveDestino: string, ruta: string): string {
  return `${claveDestino}\u0000${ruta}`
}

const deps: DependenciasRegistro<editor.ITextModel> = {
  crearModelo: (texto, lenguaje) => asegurarMonaco().editor.createModel(texto, lenguaje),
  liberarModelo: (modelo) => modelo.dispose(),
  // `setValue` limpia el deshacer: al descartar cambios, lo de disco manda sobre el buffer.
  fijarValor: (modelo, texto) => modelo.setValue(texto),
  fijarLenguaje: (modelo, lenguaje) => asegurarMonaco().editor.setModelLanguage(modelo, lenguaje),
  obtenerEol: (modelo) => (modelo.getEOL() === '\r\n' ? 'CRLF' : 'LF'),
  fijarEol: (modelo, eol) => {
    const monaco = asegurarMonaco()
    modelo.pushEOL(
      eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
    )
  },
  // `getAlternativeVersionId`: deshacer hasta el punto guardado devuelve el mismo id.
  versionId: (modelo) => modelo.getAlternativeVersionId(),
  // Respeta el EOL del modelo y no normaliza nada: guardar es un round-trip exacto.
  obtenerValor: (modelo) => modelo.getValue(),
  observar: (modelo, onCambio) => {
    const sub = modelo.onDidChangeContent(onCambio)
    return () => sub.dispose()
  },
  cargar: async (ruta, encodingForzado) => {
    const res = await window.tessera.files.leerArchivo(ruta, encodingForzado)
    return {
      contenido: res.contenido,
      lenguaje: res.lenguaje,
      encoding: res.encoding,
      truncado: res.truncado,
      binario: res.binario
    }
  },
  existe: (ruta) => window.tessera.files.existe(ruta),
  escribir: async (ruta, contenido, encoding) => {
    const res = await window.tessera.files.escribirArchivo(ruta, contenido, encoding)
    return { bytesEscritos: res.bytesEscritos }
  }
}

/** Único registro de buffers del renderer. */
export const modelosTexto: RegistroModelos<editor.ITextModel> = crearRegistro(deps)

export { GuardadoModeloBloqueado, type ModeloTextoCompartido } from './registroModelosCore'
