// =============================================================================
// El registro de salud anota la pila del main en un parón, sobre la app empaquetada: con el registro forzado
// por el arnés (`TESSERA_SALUD`), un bucle ocupado de 1,5 s en el main deja una línea `bloqueo-main` cuya pila
// nombra la función que lo ocupaba, casi sin reposo y sin ninguna ruta del equipo. El resumen lo fija
// `src/main/salud/test-pila-bloqueo.mts`; aquí se comprueba que el perfilador corre de verdad en el main.
// =============================================================================

import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, type SesionTessera } from './tessera'

interface Linea {
  tipo: string
  ms?: number
  pila?: { muestras: number; ms: number; ocioso: number; arriba: { f: string; ms: number }[]; propias: { f: string; ms: number }[] }
}

function lineas(datos: string): Linea[] {
  const ruta = join(datos, 'logs', 'salud.jsonl')
  if (!existsSync(ruta)) return []
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Linea)
}

test.describe('registro de salud: la pila del main en un parón', () => {
  let s: SesionTessera

  test.beforeAll(async () => {
    s = await abrirTessera({ TESSERA_SALUD: '1' })
  })

  test.afterAll(async () => {
    await s?.cerrar()
  })

  test('un parón provocado sale con la función que ocupaba el main', async () => {
    await expect.poll(() => lineas(s.datos).some((l) => l.tipo === 'arranque'), { message: 'el registro graba', timeout: 30_000 }).toBe(true)
    // El perfilador arranca al suscribirse; se le da un momento antes del parón.
    await s.win.waitForTimeout(1500)
    await s.app.evaluate(() => {
      function ocuparElMainAProposito(): number {
        let n = 0
        const fin = performance.now() + 1500
        while (performance.now() < fin) n++
        return n
      }
      ocuparElMainAProposito()
    })
    await expect
      .poll(() => lineas(s.datos).some((l) => l.tipo === 'bloqueo-main' && l.pila !== undefined), { message: 'el parón llega con pila', timeout: 30_000 })
      .toBe(true)
    const bloqueo = lineas(s.datos).find((l) => l.tipo === 'bloqueo-main' && l.pila !== undefined)!
    const pila = bloqueo.pila!
    expect(pila.muestras, 'con muestras del parón').toBeGreaterThan(50)
    expect(pila.ocioso, 'el main estaba ocupado, no en reposo').toBeLessThan(pila.ms / 2)
    expect(pila.arriba.some((m) => m.f.startsWith('ocuparElMainAProposito')), 'nombra la función que lo ocupaba').toBe(true)
    const texto = JSON.stringify(pila)
    expect(texto, 'sin la carpeta de datos').not.toContain(s.datos.replace(/\\/g, '\\\\'))
    expect(/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(texto), 'sin rutas del equipo').toBe(false)
  })
})
