// =============================================================================
// Registra los temporales de prueba antes de devolverlos y los borra al salir.
// Los reintentos cubren archivos todavía abiertos por un proceso recién terminado.
// Si la prueba tiene su propio manejo de señales, se deja que cierre sus recursos.
// =============================================================================
import { mkdtempSync, rmSync } from 'node:fs'

const temporales = new Set<string>()

function limpiarTemporales(codigo: number): void {
  for (const ruta of temporales) {
    try {
      rmSync(ruta, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch (error) {
      console.error(`No se pudo borrar el temporal ${ruta}: ${String(error)}`)
      if (codigo === 0) process.exitCode = 1
    }
  }
}

export function crearCarpetaTemporal(
  prefijo: string,
  opciones?: { atenderSenales?: boolean }
): string {
  const ruta = mkdtempSync(prefijo)
  registrarTemporal(ruta, opciones)
  return ruta
}

export function registrarTemporal(
  ruta: string,
  { atenderSenales = true }: { atenderSenales?: boolean } = {}
): void {
  if (temporales.size === 0) {
    process.once('exit', limpiarTemporales)
    if (atenderSenales) {
      for (const [senal, codigo] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
        process.prependListener(senal, () => {
          if (process.listenerCount(senal) === 1) process.exit(codigo)
        })
      }
    }
  }
  temporales.add(ruta)
}
