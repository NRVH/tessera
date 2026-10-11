// =============================================================================
// La configuración generada de los saltos por bastión (`saltosSsh.ts`), en `ssh/saltos/`: un archivo por
// conexión que se abre, porque cada uno cita su propia ruta en los saltos encadenados. Solo lleva opciones y
// rutas, nunca un secreto. ssh la lee al conectar, así que las de más de una hora se barren al escribir otra.
// Decisiones: docs/decisiones/ssh/tuneles-y-bastiones.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Lo que vive una configuración: de sobra para conectar (con el diálogo de la contraseña abierto). */
const VIDA_MS = 60 * 60 * 1000

/** Borra las configuraciones viejas; un fallo no impide conectar. */
function barrer(dir: string, ahora: number): void {
  let nombres: string[]
  try {
    nombres = readdirSync(dir)
  } catch {
    return
  }
  for (const nombre of nombres) {
    if (!nombre.endsWith('.conf')) continue
    const ruta = path.join(dir, nombre)
    try {
      if (ahora - statSync(ruta).mtimeMs > VIDA_MS) rmSync(ruta, { force: true })
    } catch {
      // Otro proceso la acaba de borrar, o la tiene abierta ssh: se intentará la próxima vez.
    }
  }
}

/** Una ruta nueva en `dir` para una configuración, y quien la escribe. */
export function crearConfigSaltos(dir: string, ahora: () => number = Date.now): { reservar: () => string; escribir: (ruta: string, texto: string) => void } {
  return {
    reservar: () => path.join(dir, `${randomUUID()}.conf`),
    escribir: (ruta, texto) => {
      mkdirSync(dir, { recursive: true })
      barrer(dir, ahora())
      writeFileSync(ruta, texto, { encoding: 'utf8', mode: 0o600 })
    }
  }
}
