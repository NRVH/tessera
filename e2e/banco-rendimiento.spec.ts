// =============================================================================
// Banco de rendimiento sobre la app empaquetada: monta el escenario pesado (5 perfiles, 20 proyectos,
// bases con tablas y consolas, sesiones SSH, editores y terminales) y mide cuatro cosas: lo que ocupa
// al crecer, cuánto tarda en responder al volver a un perfil o a su vista de BD, la CPU en reposo y si
// abrir y cerrar lo mismo muchas veces deja memoria o procesos atrás. Solo INFORMA, no exige nada.
// Solo corre con `TESSERA_E2E_BANCO=1` (tarda ~30 min). Medidas: `medidorRendimiento.ts`; la
// comparación con la línea de corte, `scripts/pruebas/banco-rendimiento.mjs`.
// =============================================================================

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  abrirConsola,
  abrirSsh,
  abrirTabla,
  asentar,
  callarAgentes,
  cargarBase,
  cargarProyecto,
  cargarSsh,
  cerrarProyecto,
  cerrarPestanaBd,
  cerrarSsh,
  irAPerfil,
  montarEscenario,
  PERFILES,
  reabrirProyecto,
  sembrarEscenario,
  TABLA_CICLO,
  vista,
  type Escenario
} from './bancoEscenario'
import { cpuEnReposo, diferencia, foto, hijosDeLaApp, hijosNuevos, procesosAhora, type Foto } from './medidorRendimiento'
import { abrirTessera, borrarTemporal, PLATAFORMA, type SesionTessera } from './tessera'

const ACTIVO = process.env.TESSERA_E2E_BANCO === '1'
const CICLOS = Number(process.env.TESSERA_BANCO_CICLOS ?? 15)
const REPOSO_S = Number(process.env.TESSERA_BANCO_REPOSO_S ?? 180)
const SALIDA = join(process.cwd(), 'e2e', '.resultados', `banco-rendimiento-${PLATAFORMA}.json`)

interface Diagnostico {
  activar: () => void
  reiniciar: () => void
  foto: () => { tareasLargas: { duracion: number }[] }
}
type VentanaConDiagnostico = Window & { __tesseraRendimiento: Diagnostico }

/** Lo que cuesta un gesto en la ventana: hasta que pinta y sus tareas largas (>50 ms). */
interface Respuesta {
  ms: number
  tareasLargas: number
  tareaMasLarga: number
}

/** El informe entero, que se reescribe tras cada fase (una caída a medias no se lo lleva). */
const informe: {
  plataforma: string
  arranque?: Foto
  escalado: { perfil: string; foto: Foto }[]
  volver: { perfil: string; aPerfil: Respuesta; aBd: Respuesta }[]
  reposo?: { segundos: number; cpu: Record<string, { media: number; max: number }>; cambio: Record<string, number> }
  agentesEscribiendo?: Record<string, { media: number; max: number }>
  ciclos: { gesto: string; veces: number; cambio: Record<string, number>; procesosQueQuedan: string[]; antes: Foto; despues: Foto }[]
} = { plataforma: PLATAFORMA, escalado: [], volver: [], ciclos: [] }

function guardar(): void {
  mkdirSync(join(process.cwd(), 'e2e', '.resultados'), { recursive: true })
  writeFileSync(SALIDA, JSON.stringify(informe, null, 2))
}

/** Mide un gesto con el diagnóstico de la ventana: del gesto a dos fotogramas, y las tareas largas hasta asentarse. */
async function medirGesto(win: Page, gesto: () => Promise<void>): Promise<Respuesta> {
  await win.evaluate(() => {
    const d = (window as unknown as VentanaConDiagnostico).__tesseraRendimiento
    d.activar()
    d.reiniciar()
  })
  const t0 = Date.now()
  await gesto()
  await asentar(win)
  const ms = Date.now() - t0
  await win.waitForTimeout(1_000)
  const largas = await win.evaluate(() =>
    (window as unknown as VentanaConDiagnostico).__tesseraRendimiento.foto().tareasLargas.map((t) => t.duracion)
  )
  return { ms, tareasLargas: largas.length, tareaMasLarga: Math.round(Math.max(0, ...largas)) }
}

/**
 * Espera a que el número de procesos hijos deje de cambiar (tres lecturas iguales cada 5 s, 3 min como
 * mucho). Las muertes de pty van en una sola cola y cerrar un agente tarda unos segundos, así que tras
 * una tanda de cierres seguidos la cola tarda en vaciarse: contar antes da por huérfano lo que solo
 * espera su turno.
 */
async function procesosAsentados(s: SesionTessera): Promise<void> {
  let previo = -1
  let iguales = 0
  for (let t = 0; t < 180_000 && iguales < 3; t += 5_000) {
    await s.win.waitForTimeout(5_000)
    const n = (await hijosDeLaApp(s.app)).length
    iguales = n === previo ? iguales + 1 : 0
    previo = n
  }
}

/** Repite un gesto `veces` veces y compara la memoria y los procesos de antes y de después. */
async function ciclo(s: SesionTessera, gesto: string, veces: number, hacer: (i: number) => Promise<void>): Promise<void> {
  // Una vuelta de calentamiento: lo que se crea UNA vez (cachés, el proceso de la base) no es fuga.
  await hacer(-1)
  await procesosAsentados(s)
  const antes = await foto(s.app, s.win)
  for (let i = 0; i < veces; i++) await hacer(i)
  await procesosAsentados(s)
  const despues = await foto(s.app, s.win)
  informe.ciclos.push({
    gesto,
    veces,
    cambio: diferencia(antes, despues),
    procesosQueQuedan: hijosNuevos(antes, despues, procesosAhora()),
    antes,
    despues
  })
  guardar()
}

/** Las cuatro medidas, en orden, sobre una sesión con el escenario montado. */
async function recorrer(s: SesionTessera, e: Escenario): Promise<void> {
  const win = s.win
  await expect.poll(() => e.agente.arranques().length, { timeout: 60_000 }).toBe(1)
  informe.arranque = await foto(s.app, win)
  guardar()

  // ESCALADO: perfil a perfil, todo lo suyo abierto, y una foto tras cada uno.
  let visitados = 0
  for (const perfil of PERFILES) {
    await irAPerfil(win, perfil)
    await vista(win, 'Archivos')
    const suyos = e.proyectos.filter((p) => p.perfil === perfil)
    for (const p of suyos) await cargarProyecto(win, e, p, ++visitados)
    await win.locator('.tabs-projects .project-tab', { hasText: suyos[0].nombre }).first().click()
    await cargarBase(s, perfil, suyos[0])
    await cargarSsh(win, perfil)
    informe.escalado.push({ perfil, foto: await foto(s.app, win) })
    guardar()
  }

  // VOLVER: a cada perfil con la vista de archivos, y en él a su vista de BD.
  for (const perfil of PERFILES) {
    await vista(win, 'Archivos')
    const aPerfil = await medirGesto(win, () => irAPerfil(win, perfil))
    const aBd = await medirGesto(win, () => vista(win, 'Conexiones a bases de datos'))
    informe.volver.push({ perfil, aPerfil, aBd })
  }
  guardar()

  // REPOSO: todo abierto y nadie tocando nada.
  await win.mouse.move(5, 5)
  const antesReposo = await foto(s.app, win)
  const cpu = await cpuEnReposo(s.app, win, REPOSO_S * 1_000, 10_000)
  informe.reposo = { segundos: REPOSO_S, cpu, cambio: diferencia(antesReposo, await foto(s.app, win)) }
  // Y un minuto con los 20 agentes escribiendo una línea por segundo, casi todos fuera de la vista.
  callarAgentes(e, false)
  informe.agentesEscribiendo = await cpuEnReposo(s.app, win, 60_000, 10_000)
  callarAgentes(e, true)
  guardar()

  // CICLOS en el último perfil: abrir y cerrar lo mismo, y comparar.
  const ultimo = PERFILES[PERFILES.length - 1]
  await vista(win, 'Conexiones a bases de datos')
  await ciclo(s, 'tabla', CICLOS, async () => {
    await abrirTabla(win, ultimo, TABLA_CICLO)
    await cerrarPestanaBd(win, TABLA_CICLO)
  })
  await ciclo(s, 'consola', CICLOS, async () => {
    await abrirConsola(win, 'select * from clientes limit 500')
    await cerrarPestanaBd(win)
  })
  await vista(win, 'Archivos')
  await ciclo(s, 'ssh', CICLOS, async () => {
    await abrirSsh(win, 'Ciclo')
    await cerrarSsh(win, 'Ciclo')
  })
  await ciclo(s, 'perfil', CICLOS, async (i) => {
    await irAPerfil(win, PERFILES[(i + PERFILES.length) % PERFILES.length])
  })
  await irAPerfil(win, ultimo)
  await vista(win, 'Archivos')
  const reabierto = e.proyectos.filter((p) => p.perfil === ultimo).at(-1)!
  await ciclo(s, 'proyecto', CICLOS, async () => {
    await cerrarProyecto(win, reabierto)
    await reabrirProyecto(s, e, reabierto, e.agente.arranques().length + 1)
  })
}

/** Una tabla corta para la consola: lo que crece al abrir cada perfil y lo que dejan los ciclos. */
function resumir(): void {
  console.log(`\n[banco] ${PLATAFORMA} — informe completo en ${SALIDA}`)
  console.table(
    Object.fromEntries(
      informe.escalado.map((x) => [
        x.perfil,
        { appMb: x.foto.appMb, main: x.foto.electron.Browser, heapMain: x.foto.heapMainMb, externalMain: x.foto.externalMainMb, heapVentana: x.foto.heapVentanaMb, nodos: x.foto.nodos, xterms: x.foto.xterms, editores: x.foto.editores, hijos: x.foto.pidsHijos.length }
      ])
    )
  )
  console.table(Object.fromEntries(informe.volver.map((v) => [v.perfil, { perfilMs: v.aPerfil.ms, perfilTarea: v.aPerfil.tareaMasLarga, bdMs: v.aBd.ms, bdTarea: v.aBd.tareaMasLarga }])))
  if (informe.reposo) console.table(informe.reposo.cpu)
  if (informe.agentesEscribiendo) console.table(informe.agentesEscribiendo)
  console.table(Object.fromEntries(informe.ciclos.map((c) => [c.gesto, { ...c.cambio, quedan: c.procesosQueQuedan.length }])))
}

test('banco de rendimiento: escalado, volver, reposo y ciclos', async () => {
  test.skip(!ACTIVO, 'solo con TESSERA_E2E_BANCO=1: tarda ~30 min y solo informa')
  test.setTimeout(120 * 60_000)
  const e = montarEscenario()
  let s: SesionTessera | null = null
  try {
    s = await abrirTessera(e.env, { sembrar: (datos) => sembrarEscenario(datos, e) })
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setSize(1400, 860)
    })
    await recorrer(s, e)
  } finally {
    resumir()
    await s?.cerrar()
    await borrarTemporal(e.ssh.raiz)
    await borrarTemporal(e.agente.raiz)
  }
})
