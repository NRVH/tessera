// =============================================================================
// Escribe el bloque de contexto del sandbox (`bloqueMemoriaSandbox.ts`) en la memoria de
// usuario del CLI: `CLAUDE.md` o `AGENTS.md` en la carpeta de credenciales de la cuenta,
// que el contenedor ve en `/agent-config/<agente>/<cuenta>`. Por marcadores propios: las
// notas del usuario y el bloque de bases de datos se conservan.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================
import { lstatSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
// Extensión explícita: cuelga de los imports ESTÁTICOS del test `.mts` de agentes.
import { escribirSinSeguirEnlacesSync } from '../util/escrituraAtomica.ts'
import { reemplazarBloque } from '../db/bloqueMemoriaAgente.ts'
import { INICIO_SANDBOX, FIN_SANDBOX, bloqueSandbox, type ContextoSandbox } from './bloqueMemoriaSandbox.ts'
import type { Agente } from '../perfiles/types'

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
    // La carpeta está montada con escritura en el contenedor: leer a través de un enlace plantado metería
    // un archivo del equipo en ella.
    const info = lstatSync(archivo, { throwIfNoEntry: false })
    if (info && !info.isFile()) {
      log?.(`${archivo} no es un archivo normal: no se escribe el contexto del sandbox`)
      return
    }
    const actual = info ? readFileSync(archivo, 'utf-8') : ''
    const resultado = reemplazarBloque(actual, bloqueSandbox(ctx), INICIO_SANDBOX, FIN_SANDBOX)
    if (resultado === actual) return
    mkdirSync(dir, { recursive: true })
    escribirSinSeguirEnlacesSync(archivo, resultado)
  } catch (err) {
    log?.(`no se pudo escribir el contexto del sandbox en ${archivo}: ${String(err)}`)
  }
}
