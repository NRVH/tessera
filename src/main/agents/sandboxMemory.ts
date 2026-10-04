// =============================================================================
// Escribe el bloque de contexto del sandbox (`sandboxMemoryBlock.ts`) en la memoria de
// usuario del CLI: `CLAUDE.md` o `AGENTS.md` en la carpeta de credenciales de la cuenta,
// que el contenedor ve en `/agent-config/<agente>/<cuenta>`. Por marcadores propios: las
// notas del usuario y el bloque de bases de datos se conservan.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
// Extensión explícita: cuelga de los imports ESTÁTICOS del test `.mts` de agentes.
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import { reemplazarBloque } from '../db/agentMemoryBlock.ts'
import { INICIO_SANDBOX, FIN_SANDBOX, bloqueSandbox, type ContextoSandbox } from './sandboxMemoryBlock.ts'
import type { Agente } from '../profiles/types'

/** Archivo de memoria que lee cada CLI dentro de su carpeta de configuración. */
const ARCHIVO_POR_AGENTE: Record<Agente, string> = {
  'claude-code': 'CLAUDE.md',
  codex: 'AGENTS.md'
}

/**
 * Escribe/actualiza el bloque en la carpeta de credenciales de una cuenta.
 * Idempotente y sin escrituras inútiles: si el texto no cambia, no toca el archivo.
 *
 * Best-effort a propósito: es contexto, no infraestructura. Que falle una escritura
 * no puede impedir que se abra la sesión del agente, así que nunca lanza.
 */
export function escribirBloqueSandbox(
  dir: string,
  agente: Agente,
  ctx: ContextoSandbox,
  log?: (m: string) => void
): void {
  const archivo = path.join(dir, ARCHIVO_POR_AGENTE[agente])
  try {
    const actual = existsSync(archivo) ? readFileSync(archivo, 'utf-8') : ''
    const resultado = reemplazarBloque(actual, bloqueSandbox(ctx), INICIO_SANDBOX, FIN_SANDBOX)
    if (resultado === actual) return
    mkdirSync(dir, { recursive: true })
    writeFileAtomicSync(archivo, resultado)
  } catch (err) {
    log?.(`no se pudo escribir el contexto del sandbox en ${archivo}: ${String(err)}`)
  }
}
