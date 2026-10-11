// =============================================================================
// Volcados de caída (solo alpha): una caída NATIVA del proceso main (sin excepción que capturar)
// deja un `.dmp` en la carpeta de la app y el siguiente arranque lo anota en `logs/crash.log`; en
// una versión que no es alpha, o con su interruptor apagado, no queda nada. El paquete de pruebas
// no es alpha: `TESSERA_VOLCADOS` hace sus veces. Vive aquí porque solo la app empaquetada lleva
// el registrador.
// Decisiones: docs/decisiones/app/volcados-de-caida.md
// =============================================================================

import { test, expect } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { abrirTessera, borrarTemporal } from './tessera'

/** Los `.dmp` bajo una carpeta, a cualquier profundidad razonable. Sin seguir enlaces: en Linux hay rotos. */
function volcados(dir: string, nivel = 0): string[] {
  if (!existsSync(dir) || nivel > 4) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = join(dir, e.name)
    if (e.isDirectory()) return volcados(r, nivel + 1)
    return e.isFile() && e.name.toLowerCase().endsWith('.dmp') ? [r] : []
  })
}

/** Abre Tessera con ese entorno, la tira con una caída nativa del main y espera a que muera. */
async function abrirYTirar(env: Record<string, string>, sembrar?: (datos: string) => void): Promise<string> {
  const s = await abrirTessera(env, { sembrar })
  const salida = new Promise<void>((r) => s.app.process().once('exit', () => r()))
  await s.app.evaluate(() => process.crash()).catch(() => {})
  await salida
  return s.datos
}

test('una caída nativa deja un volcado que el siguiente arranque anota en crash.log', async () => {
  test.setTimeout(180_000)
  const datos = await abrirYTirar({ TESSERA_VOLCADOS: '1' })
  let s2: Awaited<ReturnType<typeof abrirTessera>> | null = null
  try {
    const dumps = join(datos, 'Crashpad')
    await expect.poll(() => volcados(dumps).length, { timeout: 30_000 }).toBeGreaterThan(0)

    s2 = await abrirTessera(
      { TESSERA_VOLCADOS: '1' },
      { sembrar: (d) => cpSync(dumps, join(d, 'Crashpad'), { recursive: true }) }
    )
    const log = join(s2.datos, 'logs', 'crash.log')
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 30_000 }).toMatch(
      /\[volcado\] un proceso de Tessera se cayó el .+; volcado: .+\.dmp/
    )
  } finally {
    if (s2) await s2.cerrar()
    await borrarTemporal(datos)
  }
})

test('NEGATIVO: con el interruptor de «Experimental» apagado la caída no deja volcado', async () => {
  test.setTimeout(120_000)
  // Forzado como alpha, pero con el ajuste guardado en «apagado»: manda el ajuste.
  const datos = await abrirYTirar({ TESSERA_VOLCADOS: '1' }, (d) =>
    writeFileSync(join(d, 'workspace-state.json'), JSON.stringify({ version: 1, byProfile: {}, settings: { volcadosCaida: false } }))
  )
  try {
    await new Promise((r) => setTimeout(r, 5000))
    expect(volcados(datos)).toEqual([])
  } finally {
    await borrarTemporal(datos)
  }
})

test('NEGATIVO: en una versión que no es alpha la caída no deja volcado, y se borran los que quedaran', async () => {
  test.setTimeout(120_000)
  // Vacía a mano: el arnés hereda el entorno de quien lanza las pruebas. El volcado sembrado es
  // el de cuando estaban encendidos (una alpha que se actualizó a la pública).
  const datos = await abrirYTirar({ TESSERA_VOLCADOS: '' }, (d) => {
    mkdirSync(join(d, 'Crashpad', 'reports'), { recursive: true })
    writeFileSync(join(d, 'Crashpad', 'reports', 'viejo.dmp'), 'volcado de mentira')
  })
  try {
    // El margen que en el caso positivo sobra para que aparezca el volcado.
    await new Promise((r) => setTimeout(r, 5000))
    expect(volcados(datos)).toEqual([])
  } finally {
    await borrarTemporal(datos)
  }
})
