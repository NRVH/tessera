// =============================================================================
// Tipos del lenguaje `javascript` de las basic-languages de Monaco (`language` y `conf`),
// que `monacoConsolaDocs.ts` importa y ese módulo no trae. Va en un archivo aparte porque un
// `declare module` no se puede escribir dentro de un archivo que ya es módulo.
// =============================================================================

declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js' {
  import type * as monaco from 'monaco-editor'
  export const language: monaco.languages.IMonarchLanguage
  export const conf: monaco.languages.LanguageConfiguration
}
