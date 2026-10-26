// =============================================================================
// El registro de lo que hacen los agentes con `tssh`, en `logs/ssh.log`: una línea por petición, que decide
// `controlador/puenteTssh.ts` (alias, subcomando, código y duración; nunca la orden remota). Rota a un único
// `.old` al pasar de 1 MiB, como el resto de registros. Escribir es lo de menos: un fallo no rompe `tssh`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

/** Tope antes de rotar, el mismo que los demás registros de la app. */
const MAX_BYTES = 1024 * 1024

/** Rota si el archivo pasó del tope. */
function rotarSiHaceFalta(ruta: string): void {
  if (existsSync(ruta) && statSync(ruta).size > MAX_BYTES) renameSync(ruta, `${ruta}.old`)
}

/** El escritor de `<dirLogs>/ssh.log`; si la carpeta no se puede crear, uno que no hace nada. */
export function crearRegistroTssh(dirLogs: string): (linea: string) => void {
  const ruta = path.join(dirLogs, 'ssh.log')
  try {
    mkdirSync(dirLogs, { recursive: true })
    rotarSiHaceFalta(ruta)
  } catch {
    return () => {}
  }
  return (linea) => {
    try {
      rotarSiHaceFalta(ruta)
      appendFileSync(ruta, `[${new Date().toISOString()}] ${linea.replace(/[\r\n]+/g, ' ')}\n`, 'utf8')
    } catch {
      // El registro no puede romper lo que intenta registrar.
    }
  }
}
