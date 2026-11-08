// =============================================================================
// Carpetas privadas de los hooks: destino vacío y copias aceptadas fuera del proyecto.
// Centraliza sus rutas para desactivar hooks o ejecutar la copia autorizada sin depender del árbol mutable.
// Decisiones: docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

let datos = path.join(tmpdir(), `tessera-hooks-${randomUUID()}`)
export function configurarHooksGit(carpeta: string): void { datos = carpeta }
export function carpetaDatosHooks(): string { return datos }
export async function carpetaSinHooks(): Promise<string> {
  const carpeta = path.join(datos, 'hooks-vacios')
  await mkdir(carpeta, { recursive: true })
  return carpeta
}
