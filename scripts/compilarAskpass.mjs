#!/usr/bin/env node
// =============================================================================
// Compila el programa de contraseñas de Windows (`src/askpass/AskpassTessera.cs`) a
// `out/askpass/tessera-askpass.exe` con el csc de .NET Framework 4 que trae Windows, `-target:winexe`
// (sin ventana). Solo en Windows; si falta csc avisa y sigue (las contraseñas guardadas se teclearán), y
// si csc falla, falla. Lo llaman `predev` y, al final, `scripts/compilar.mjs` (pack:dir y release:win).
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FUENTE_ASKPASS = path.join(RAIZ, 'src', 'askpass', 'AskpassTessera.cs')
export const DESTINO_ASKPASS = path.join(RAIZ, 'out', 'askpass', 'tessera-askpass.exe')

/** El csc de .NET Framework 4 por ruta fija (64 bits primero), nunca el del PATH; `null` si no está. */
export function rutaCsc(env = process.env) {
  const raiz = env.SystemRoot ?? env.windir ?? 'C:\\Windows'
  const candidatos = ['Framework64', 'Framework'].map((d) => path.win32.join(raiz, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe'))
  return candidatos.find((c) => existsSync(c)) ?? null
}

/** ¿El .exe es más nuevo que su fuente? Entonces no hace falta volver a compilar. */
function alDia(fuente, destino) {
  return existsSync(destino) && statSync(destino).mtimeMs >= statSync(fuente).mtimeMs
}

/**
 * Compila el askpass en `destino`. Devuelve `true` si quedó el .exe y `false` si se saltó (no es Windows,
 * o falta csc). Lanza si csc no lo compila: es un error del código, no del equipo.
 */
export function compilarAskpass({ fuente = FUENTE_ASKPASS, destino = DESTINO_ASKPASS, siempre = false } = {}) {
  // Los scripts no cargan `src/shared/plataforma.ts`: solo Windows compila esto.
  if (process.platform !== 'win32') return false
  const csc = rutaCsc()
  if (csc === null) {
    console.warn('[askpass] falta el csc de .NET Framework 4: sin tessera-askpass.exe, las contraseñas guardadas se teclearán.')
    return false
  }
  if (!siempre && alDia(fuente, destino)) return true
  mkdirSync(path.dirname(destino), { recursive: true })
  const r = spawnSync(csc, ['-nologo', '-utf8output', '-target:winexe', '-optimize+', `-out:${destino}`, fuente], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (r.error || r.status !== 0) {
    throw new Error(`csc no compiló el askpass (${r.error?.message ?? `salida ${r.status}`}):\n${r.stdout ?? ''}${r.stderr ?? ''}`)
  }
  console.log(`[askpass] ${path.relative(RAIZ, destino)} compilado`)
  return true
}

// Lanzado directamente (predev): compila si hace falta y solo falla si csc falla.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    compilarAskpass()
  } catch (e) {
    console.error(`[askpass] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
