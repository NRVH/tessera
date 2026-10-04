// =============================================================================
// Declaración de tipos para los módulos de basic-languages de monaco-editor que se importan
// directamente (no traen .d.ts). Solo declara la forma que se usa: `language` (definición
// Monarch) y `conf` (configuración del lenguaje).
// =============================================================================

declare module 'monaco-editor/esm/vs/basic-languages/java/java.js' {
  import type * as monaco from 'monaco-editor'
  export const language: monaco.languages.IMonarchLanguage
  export const conf: monaco.languages.LanguageConfiguration
}
