// =============================================================================
// Contexto del agente para el espacio de datos de un perfil: escribe el bloque gestionado en el `CLAUDE.md`
// y el `AGENTS.md` de su carpeta, que es una por perfil, así ninguna otra sesión lo ve. El texto lo genera
// `agentMemoryBlock.ts`; aquí solo el sistema de archivos. Retira además el bloque que la primera versión
// dejaba en la memoria global del usuario.
// =============================================================================
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import { bloqueEspacioDatos, reemplazarBloque } from './agentMemoryBlock.ts'
import type { DbConnection } from '../../shared/db-ipc.ts'

/** Archivos de contexto que se escriben en la carpeta del espacio de datos. */
const ARCHIVOS_CONTEXTO = ['CLAUDE.md', 'AGENTS.md']

/**
 * Escribe/actualiza el contexto del espacio de datos de un perfil. Idempotente y sin
 * escrituras inútiles: si el contenido no cambia no se toca el archivo.
 *
 * @param avisoFormato el aviso del main si el registro tiene un formato que esta versión
 *                     no reconoce o no se pudo leer, o `null`. OBLIGATORIO y no opcional
 *                     a propósito: con él `conexiones` llega vacía sin que el perfil lo
 *                     esté, y un llamador que lo olvidara volvería a escribir «ninguna
 *                     configurada» (ver `bloqueEspacioDatos`).
 */
export function escribirContextoEspacio(
  dir: string,
  nombrePerfil: string,
  conexiones: DbConnection[],
  avisoFormato: string | null,
  log?: (m: string) => void
): void {
  const bloque = bloqueEspacioDatos(nombrePerfil, conexiones, avisoFormato)
  for (const nombre of ARCHIVOS_CONTEXTO) {
    const archivo = path.join(dir, nombre)
    try {
      const actual = existsSync(archivo) ? readFileSync(archivo, 'utf-8') : ''
      // Vía `reemplazarBloque` y no sobrescribiendo: si añades notas tuyas a mano en
      // este archivo, se conservan; solo se regenera el bloque entre marcadores.
      const resultado = reemplazarBloque(actual, bloque)
      if (resultado === actual) continue
      mkdirSync(dir, { recursive: true })
      writeFileAtomicSync(archivo, resultado)
    } catch (err) {
      log?.(`no se pudo escribir ${archivo}: ${String(err)}`)
    }
  }
}

/**
 * MIGRACIÓN: retira el bloque que la primera versión dejaba en la memoria GLOBAL del
 * usuario. Se ejecuta en cada arranque y es idempotente —si no hay bloque, no toca
 * el archivo ni lo crea—, así que también limpia el equipo de quien actualice desde
 * aquella versión.
 */
export function limpiarMemoriaGlobal(log?: (m: string) => void): void {
  const home = homedir()
  const globales = [path.join(home, '.claude', 'CLAUDE.md'), path.join(home, '.codex', 'AGENTS.md')]
  for (const archivo of globales) {
    try {
      if (!existsSync(archivo)) continue
      const actual = readFileSync(archivo, 'utf-8')
      const limpio = reemplazarBloque(actual, '')
      if (limpio === actual) continue
      writeFileAtomicSync(archivo, limpio)
      log?.(`retirado el bloque heredado de ${archivo}`)
    } catch (err) {
      // Un archivo bloqueado no debe impedir arrancar; se reintentará al siguiente inicio.
      log?.(`no se pudo limpiar ${archivo}: ${String(err)}`)
    }
  }
}
