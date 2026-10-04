// =============================================================================
// Tipos del lenguaje `sql` de las basic-languages de Monaco, que no trae .d.ts:
// `lenguajeConsola.ts` deriva de él los lenguajes de consola. Solo declara lo que se usa
// (`language` y `conf`), y va aparte porque un `declare module` de un JS sin tipos no cabe
// en un archivo que ya es módulo.
// =============================================================================

declare module 'monaco-editor/esm/vs/basic-languages/sql/sql.js' {
  import type * as monaco from 'monaco-editor'
  export const language: monaco.languages.IMonarchLanguage
  export const conf: monaco.languages.LanguageConfiguration
}
