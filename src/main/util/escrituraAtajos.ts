// =============================================================================
// Escribe los atajos de los ejecutables de Tessera (`tdb`, `tssh`) en su carpeta de contrato (`bin/s<N>`):
// la crea, escribe cada uno de forma atómica y deja ejecutables los de fin de línea LF (los de `sh`). El
// contenido lo deciden `db/shims.ts` y `ssh/atajosTssh.ts`; lo llaman `db/controlador/atajosTdb.ts` y
// `ssh/componer.ts` en cada arranque. Depende de `node:fs` y de `atomicWrite.ts`.
// Decisiones: docs/decisiones/bd/puente-atajos-de-tdb.md, docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomicSync } from './atomicWrite.ts'

/** Un atajo: nombre de archivo, contenido y fin de línea. */
export interface AtajoAEscribir {
  nombre: string
  contenido: string
  eol: 'lf' | 'crlf'
}

/** Escribe los atajos en `dir`. Lanza si no puede: quien llama lo registra, y ese atajo no existirá en esa sesión. */
export function escribirArchivosDeAtajo(dir: string, atajos: readonly AtajoAEscribir[]): void {
  mkdirSync(dir, { recursive: true })
  for (const { nombre, contenido, eol } of atajos) {
    // El de sh debe ir en LF: un CR de más da un «bad interpreter» que no lo menciona.
    if (eol === 'lf' && contenido.includes('\r')) throw new Error(`el atajo ${nombre} debe ir en LF y lleva CR`)
    const archivo = path.join(dir, nombre)
    writeFileAtomicSync(archivo, contenido)
    // El temporal deja el modo 0644 y zsh, en macOS, respondería «permission denied». En Windows no hace nada.
    if (eol === 'lf') chmodSync(archivo, 0o755)
  }
}
