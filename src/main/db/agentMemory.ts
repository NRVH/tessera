// =============================================================================
// Contexto de los agentes propios de un perfil: escribe un bloque gestionado en el `CLAUDE.md` y el
// `AGENTS.md` de su carpeta (el espacio de datos aquí; el agente de la terminal desde `ssh/`), así
// ninguna otra sesión lo ve. El texto lo genera `agentMemoryBlock.ts`; aquí solo el sistema de archivos.
// Retira además el bloque que la primera versión dejaba en la memoria global del usuario.
// =============================================================================
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import { bloqueEspacioDatos, reemplazarBloque } from './agentMemoryBlock.ts'
import type { DbConnection } from '../../shared/db-ipc.ts'

/** Archivos de contexto de la carpeta de un agente propio: el de Claude Code y el de Codex. */
const ARCHIVOS_CONTEXTO = ['CLAUDE.md', 'AGENTS.md']

/** Las marcas del bloque gestionado; sin ellas, las del espacio de datos (`agentMemoryBlock.ts`). */
export interface MarcasBloque {
  inicio?: string
  fin?: string
}

/**
 * Escribe `bloque` entre sus marcas en el `CLAUDE.md` y el `AGENTS.md` de `dir`, que ya existe: lo
 * escriben el espacio de datos y el agente de la terminal (`ssh/controlador/espacioTerminal.ts`).
 * Vía `reemplazarBloque` y no sobrescribiendo: lo que el usuario añada a mano fuera de las marcas se
 * conserva. Sin escrituras inútiles: si el contenido no cambia, no se toca el archivo. No crea la
 * carpeta: la crea quien la prepara, y crearla aquí resucitaría la de un perfil que se está borrando.
 * Un archivo que falla se cuenta por `alFallar` con su NOMBRE y no impide el otro.
 */
export function escribirBloqueContexto(
  dir: string,
  bloque: string,
  marcas: MarcasBloque,
  alFallar: (nombre: string, err: unknown) => void
): void {
  for (const nombre of ARCHIVOS_CONTEXTO) {
    const archivo = path.join(dir, nombre)
    try {
      const actual = existsSync(archivo) ? readFileSync(archivo, 'utf-8') : ''
      const resultado = reemplazarBloque(actual, bloque, marcas.inicio, marcas.fin)
      if (resultado === actual) continue
      writeFileAtomicSync(archivo, resultado)
    } catch (err) {
      alFallar(nombre, err)
    }
  }
}

/**
 * Escribe/actualiza el contexto del espacio de datos de un perfil, cuya carpeta ya existe.
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
  escribirBloqueContexto(dir, bloque, {}, (nombre, err) => log?.(`no se pudo escribir ${path.join(dir, nombre)}: ${String(err)}`))
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
