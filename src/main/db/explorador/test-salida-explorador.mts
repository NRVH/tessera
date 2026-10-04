#!/usr/bin/env node
// =============================================================================
// Prueba del diálogo de salida del explorador con cambios de la rejilla sin enviar (`salidaSinEnviar.ts` y
// `confirmarSalida`). Sin electron ni drivers: controlador con falsos y una ventana que hace de renderer.
// (node src/main/db/explorador/test-salida-explorador.mts  ·  npm run test:db-salida)
// =============================================================================

import type { BrowserWindow, IpcMain, MessageBoxOptions } from 'electron'
import { DBX_CHANNELS, type DbPestanaSinEnviar } from '../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../shared/db-ipc.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { ExploradorController } from './ExploradorController.ts'
import { registrarIpcExplorador } from './ipc.ts'
import {
  bloqueSinEnviar,
  dialogoSoloSinEnviar,
  leerSinEnviar,
  lineasSinEnviar,
  LINEAS_SIN_ENVIAR,
  MAX_ETIQUETA_SIN_ENVIAR,
  MAX_PESTANAS_SIN_ENVIAR,
  totalSinEnviar
} from './salidaSinEnviar.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

// --- Falsos ----------------------------------------------------------------------------

type Contestar = (id: number) => unknown | undefined

interface Montaje {
  ex: ExploradorController
  dialogos: MessageBoxOptions[]
  respuestas: number[]
  preguntas: Array<{ canal: string; payload: unknown }>
  /** Qué contesta el renderer falso a la pregunta `id` (undefined = no contesta). */
  contestar: { fn: Contestar }
  /** Entrega a mano una respuesta por el canal de vuelta, como si llegara tarde. */
  entregar: (payload: unknown) => void
  win: BrowserWindow
  resoluciones: string[]
  /** Estado de la ventana falsa: minimizada / visible (lo cambian restore y show). */
  ventana: { minimizada: boolean; visible: boolean }
  /** Orden de lo que pasa en la ventana y los diálogos: 'restore', 'show', 'focus', 'dialogo'. */
  orden: string[]
}

function montar(opciones: { conDialogo?: boolean } = {}): Montaje {
  const dialogos: MessageBoxOptions[] = []
  const respuestas: number[] = []
  const preguntas: Array<{ canal: string; payload: unknown }> = []
  const resoluciones: string[] = []
  const ventana = { minimizada: false, visible: true }
  const orden: string[] = []
  const oyentes = new Map<string, (e: unknown, payload: unknown) => void>()
  const contestar: { fn: Contestar } = { fn: () => ({ pestanas: [] }) }
  const conexion = { id: 'c1', alias: 'ED', profileId: 'p1', motor: 'postgres' } as unknown as DbConnection
  const ex = new ExploradorController({
    conexiones: {
      get: (id) => (id === 'c1' ? conexion : undefined),
      secretOf: () => null,
      setEsquemasVisibles: () => {
        throw new Error('no se usa')
      },
      setIntrospeccion: () => {},
      marcarVerificada: () => false
    },
    registro: {
      ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
      notificarCambio: () => {},
      espacioDeDatos: () => {
        throw new Error('no se usa')
      },
      tdbScriptDir: () => '',
      ensureWorkspace: () => {}
    },
    // Sin perfil vivo: `describir` no encuentra el nombre de la consola y pone «consola».
    perfilVivo: () => false,
    nombrePerfil: () => null,
    papelera: async () => {},
    plataforma: plataformaActual(),
    getWindow: () => null,
    ...(opciones.conDialogo === false
      ? {}
      : {
          mostrarMensaje: async (_w: BrowserWindow | null, o: MessageBoxOptions) => {
            orden.push('dialogo')
            dialogos.push(o)
            return { response: respuestas.shift() ?? o.cancelId ?? 0, checkboxChecked: false }
          }
        }),
    log: () => {}
  })
  registrarIpcExplorador({
    ipc: {
      handle: () => {},
      on: (canal: string, fn: (e: unknown, payload: unknown) => void) => {
        oyentes.set(canal, fn)
      }
    } as unknown as IpcMain,
    explorador: ex
  })
  const entregar = (payload: unknown): void => oyentes.get(DBX_CHANNELS.SIN_ENVIAR)?.({}, payload)
  const win = {
    isDestroyed: () => false,
    isMinimized: () => ventana.minimizada,
    isVisible: () => ventana.visible,
    restore: () => {
      orden.push('restore')
      ventana.minimizada = false
    },
    show: () => {
      orden.push('show')
      ventana.visible = true
    },
    focus: () => {
      orden.push('focus')
    },
    webContents: {
      isDestroyed: () => false,
      send: (canal: string, payload?: unknown) => {
        preguntas.push({ canal, payload })
        if (canal !== DBX_CHANNELS.EV_PEDIR_SIN_ENVIAR) return
        const id = (payload as { id: number }).id
        const r = contestar.fn(id)
        // Asíncrono, como un IPC de verdad: la respuesta nunca llega dentro del `send`.
        if (r !== undefined) setTimeout(() => entregar({ id, ...(r as object) }), 1)
      }
    }
  } as unknown as BrowserWindow
  // Las transacciones las pone cada caso; el gestor real se sustituye en la instancia.
  const gestor = ex.gestor as unknown as {
    pendientes: () => unknown[]
    resolverTodas: (accion: string) => Promise<unknown>
  }
  gestor.pendientes = () => []
  gestor.resolverTodas = async (accion) => {
    resoluciones.push(accion)
    return { ok: true, errores: [], revertidas: [] }
  }
  return { ex, dialogos, respuestas, preguntas, contestar, entregar, win, resoluciones, ventana, orden }
}

const CUARENTA: DbPestanaSinEnviar[] = [{ etiqueta: 'ED · public.personas', cambios: 40 }]
const TX_PENDIENTE = [{ ref: { rol: 'consola', perfilId: 'p1', consolaId: 'k1' }, conexionId: 'c1', tx: 'pendiente' }]
/** Nombres del sistema que un texto de Tessera no escribe a mano (`test:nombres-sistema`). */
const NOMBRES_SISTEMA = /\b(Windows|macOS|Mac|Finder|Explorador|PowerShell|Terminal)\b/

async function main(): Promise<void> {
  // ===========================================================================
  hr('1. leerSinEnviar: la respuesta del renderer, validada')
  check('(1a) la respuesta a ESTA pregunta', j(leerSinEnviar({ id: 3, pestanas: CUARENTA }, 3)) === j(CUARENTA), j(leerSinEnviar({ id: 3, pestanas: CUARENTA }, 3)))
  check('(1b) la de OTRA pregunta no vale (null: se sigue esperando)', leerSinEnviar({ id: 2, pestanas: CUARENTA }, 3) === null, 'null')
  const sinForma = [null, undefined, 'x', 7, { id: 3 }, { id: 3, pestanas: 'x' }, { id: '3', pestanas: [] }]
  check(
    '(1c) sin forma -> null',
    sinForma.every((p) => leerSinEnviar(p, 3) === null),
    j(sinForma.map((p) => leerSinEnviar(p, 3)))
  )
  check('(1d) lista vacía = nada que perder (no null)', j(leerSinEnviar({ id: 3, pestanas: [] }, 3)) === '[]', '[]')
  const raras = leerSinEnviar(
    {
      id: 3,
      pestanas: [
        { etiqueta: 'A', cambios: 0 },
        { etiqueta: 'B', cambios: Number.NaN },
        { etiqueta: 'C', cambios: '3' },
        { etiqueta: 'D', cambios: -1 },
        null,
        'E',
        { etiqueta: 'F', cambios: 2.7 }
      ]
    },
    3
  )
  check('(1e) sin cambios o con un número que no lo es se saltan; los decimales, a entero', j(raras) === j([{ etiqueta: 'F', cambios: 2 }]), j(raras))
  const etiquetas = leerSinEnviar(
    {
      id: 1,
      pestanas: [
        { etiqueta: 'ED\n· falsa línea\r\n\tpublic.t', cambios: 1 },
        { etiqueta: '   ', cambios: 1 },
        { etiqueta: 42, cambios: 1 },
        { etiqueta: 'x'.repeat(5000), cambios: 1 }
      ]
    },
    1
  )!
  check(
    '(1f) la etiqueta queda en UNA línea (un salto partiría la lista del diálogo)',
    etiquetas[0].etiqueta === 'ED · falsa línea public.t',
    j(etiquetas[0].etiqueta)
  )
  check('(1g) sin texto útil, un nombre genérico', etiquetas[1].etiqueta === 'Pestaña de tabla' && etiquetas[2].etiqueta === 'Pestaña de tabla', j([etiquetas[1], etiquetas[2]]))
  check(
    '(1h) una etiqueta larguísima se acota con «…»',
    etiquetas[3].etiqueta.length === MAX_ETIQUETA_SIN_ENVIAR && etiquetas[3].etiqueta.endsWith('…'),
    String(etiquetas[3].etiqueta.length)
  )
  const muchas = leerSinEnviar({ id: 1, pestanas: Array.from({ length: 5000 }, (_, i) => ({ etiqueta: `t${i}`, cambios: 1 })) }, 1)!
  check('(1i) tope de pestañas por respuesta', muchas.length === MAX_PESTANAS_SIN_ENVIAR, String(muchas.length))

  // ===========================================================================
  hr('2. Los textos')
  const uno = dialogoSoloSinEnviar([{ etiqueta: 'ED · public.personas', cambios: 1 }])
  const cuarenta = dialogoSoloSinEnviar(CUARENTA)
  check('(2a) singular', uno.message === 'Hay un cambio sin enviar.' && String(uno.detail).startsWith('ED · public.personas: 1 cambio\n'), j([uno.message, uno.detail]))
  check('(2b) plural', cuarenta.message === 'Hay 40 cambios sin enviar.' && String(cuarenta.detail).includes('ED · public.personas: 40 cambios'), j([cuarenta.message, cuarenta.detail]))
  check(
    '(2c) Descartar y salir / Cancelar, y Cancelar por defecto (Intro o Esc no tiran el trabajo)',
    j(cuarenta.buttons) === j(['Descartar y salir', 'Cancelar']) && cuarenta.defaultId === 1 && cuarenta.cancelId === 1,
    j([cuarenta.buttons, cuarenta.defaultId, cuarenta.cancelId])
  )
  const diez = Array.from({ length: LINEAS_SIN_ENVIAR + 2 }, (_, i) => ({ etiqueta: `ED · public.t${i}`, cambios: i + 1 }))
  const lineas = lineasSinEnviar(diez)
  check(
    '(2d) como mucho LINEAS_SIN_ENVIAR pestañas y el resto resumido',
    lineas.length === LINEAS_SIN_ENVIAR + 1 && lineas[lineas.length - 1] === 'y 2 pestañas más',
    j(lineas.slice(-2))
  )
  check('(2e) el total suma TODAS las pestañas, también las no listadas', totalSinEnviar(diez) === 55 && dialogoSoloSinEnviar(diez).message === 'Hay 55 cambios sin enviar.', String(totalSinEnviar(diez)))
  check('(2f) sin cambios, el bloque que se añade al de transacciones es vacío', bloqueSinEnviar([]) === '', j(bloqueSinEnviar([])))
  const bloque = bloqueSinEnviar(CUARENTA)
  check(
    '(2g) con cambios, el bloque dice que «Confirmar y salir» NO los envía',
    bloque.includes('ED · public.personas: 40 cambios') && bloque.includes('«Confirmar y salir» solo confirma las transacciones'),
    j(bloque)
  )
  const textos = [cuarenta.title, cuarenta.message, cuarenta.detail, ...(cuarenta.buttons ?? []), bloque].join('\n')
  check('(2h) ningún texto nombra el sistema operativo', !NOMBRES_SISTEMA.test(textos), NOMBRES_SISTEMA.exec(textos)?.[0] ?? 'ninguno')

  // ===========================================================================
  hr('3. confirmarSalida: el flujo, con los canales de verdad')
  {
    const m = montar()
    const d = await m.ex.confirmarSalida(m.win, 500)
    const pregunta = m.preguntas.filter((p) => p.canal === DBX_CHANNELS.EV_PEDIR_SIN_ENVIAR)
    check('(3a) sin nada pendiente: SIN diálogo y se sigue', d === 'seguir' && m.dialogos.length === 0, j([d, m.dialogos.length]))
    check('(3b) pero se preguntó al renderer, una vez y con un id', pregunta.length === 1 && typeof (pregunta[0].payload as { id?: unknown }).id === 'number', j(pregunta))
  }
  {
    // EL HALLAZGO: 40 cambios sin enviar y ninguna transacción. Antes: 'seguir' sin diálogo.
    const m = montar()
    m.contestar.fn = () => ({ pestanas: CUARENTA })
    m.respuestas.push(1)
    const d = await m.ex.confirmarSalida(m.win, 500)
    const o = m.dialogos[0]
    check(
      '(3c) con 40 cambios sin enviar y sin transacciones, PREGUNTA',
      m.dialogos.length === 1 && o?.title === 'Cambios sin enviar' && o?.message === 'Hay 40 cambios sin enviar.',
      j(m.dialogos.map((x) => [x.title, x.message]))
    )
    check('(3d) Cancelar deja la app viva', d === 'cancelar', d)
    check('(3e) y no toca el servidor (no hay nada que resolver allí)', m.resoluciones.length === 0, j(m.resoluciones))
    m.respuestas.push(0)
    const d2 = await m.ex.confirmarSalida(m.win, 500)
    check('(3f) la segunda vez vuelve a preguntar, y «Descartar y salir» sale', d2 === 'seguir' && m.dialogos.length === 2, j([d2, m.dialogos.length]))
  }
  {
    const m = montar()
    m.contestar.fn = () => undefined // colgado: no contesta nunca
    const t0 = Date.now()
    const d = await m.ex.confirmarSalida(m.win, 80)
    const ms = Date.now() - t0
    check('(3g) un renderer que no contesta NO cuelga la salida: vuelve al plazo', d === 'seguir' && ms >= 70 && ms < 2000 && m.dialogos.length === 0, `${d} en ${ms} ms`)
  }
  {
    const m = montar()
    const t0 = Date.now()
    const d = await m.ex.confirmarSalida(null, 5000)
    const destruida = { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: () => {} } } as unknown as BrowserWindow
    const d2 = await m.ex.confirmarSalida(destruida, 5000)
    const ms = Date.now() - t0
    check('(3h) sin ventana (o destruida) no se espera el plazo: no hay a quién preguntar', d === 'seguir' && d2 === 'seguir' && ms < 1000, `${d}/${d2} en ${ms} ms`)
  }
  {
    // Una respuesta TARDÍA a la pregunta anterior (la del plazo vencido, con 40 cambios)
    // llega en medio de la siguiente, cuyo renderer ya no tiene nada: no vale para ella.
    const m = montar()
    m.contestar.fn = () => undefined
    await m.ex.confirmarSalida(m.win, 30)
    // (Sin pregunta —un controlador que no pregunta— el caso tiene que FALLAR, no petar.)
    const idViejo = (m.preguntas[0]?.payload as { id?: number } | undefined)?.id ?? -1
    m.contestar.fn = (id) => {
      m.entregar({ id: idViejo, pestanas: CUARENTA })
      return id === idViejo ? undefined : { pestanas: [] }
    }
    const d = await m.ex.confirmarSalida(m.win, 500)
    check('(3i) una respuesta tardía a una pregunta ANTERIOR no contesta a esta', d === 'seguir' && m.dialogos.length === 0, j([d, m.dialogos.map((x) => x.message)]))
  }
  {
    // Con transacciones Y cambios sin enviar: UN diálogo, el de las transacciones, que
    // nombra los dos. «Revertir y salir» revierte y sale.
    const m = montar()
    m.contestar.fn = () => ({ pestanas: CUARENTA })
    ;(m.ex.gestor as unknown as { pendientes: () => unknown[] }).pendientes = () => TX_PENDIENTE
    m.respuestas.push(1)
    const d = await m.ex.confirmarSalida(m.win, 500)
    const o = m.dialogos[0]
    check('(3j) con transacciones y cambios: UN solo diálogo', m.dialogos.length === 1, String(m.dialogos.length))
    check(
      '(3k) los botones de siempre',
      j(o?.buttons) === j(['Confirmar y salir', 'Revertir y salir', 'Cancelar']) && o?.cancelId === 2 && o?.defaultId === 2,
      j(o?.buttons)
    )
    check(
      '(3l) el mensaje nombra las dos cosas',
      o?.message === 'Hay una transacción sin confirmar y 40 cambios sin enviar.',
      String(o?.message)
    )
    check(
      '(3m) el detalle lista la transacción Y la pestaña, y avisa de que se descartan',
      String(o?.detail).includes('ED · consola') &&
        String(o?.detail).includes('ED · public.personas: 40 cambios') &&
        String(o?.detail).includes('«Confirmar y salir» solo confirma las transacciones'),
      j(o?.detail)
    )
    check('(3n) «Revertir y salir» revierte y sale', d === 'seguir' && j(m.resoluciones) === j(['rollback']), j([d, m.resoluciones]))
  }
  {
    // MITAD NEGATIVA: transacciones sin cambios -> el diálogo de siempre, sin una letra
    // de más (el e2e (10) de `conexiones.spec.ts` lo compara entero entre dos caminos).
    const m = montar()
    ;(m.ex.gestor as unknown as { pendientes: () => unknown[] }).pendientes = () => TX_PENDIENTE
    m.respuestas.push(2)
    const d = await m.ex.confirmarSalida(m.win, 500)
    const o = m.dialogos[0]
    check(
      '(3o) con transacciones y SIN cambios, el diálogo de siempre',
      o?.message === 'Hay una transacción sin confirmar.' &&
        o?.detail === 'ED · consola\n\nSi sales revirtiendo, se pierden sus cambios.' &&
        d === 'cancelar',
      j([o?.message, o?.detail, d])
    )
  }
  {
    // Sin diálogo inyectado (algún arnés): no se cuelga ni lanza; se sale.
    const m = montar({ conDialogo: false })
    m.contestar.fn = () => ({ pestanas: CUARENTA })
    const d = await m.ex.confirmarSalida(m.win, 500)
    check('(3p) sin diálogo inyectado, se sale sin colgarse', d === 'seguir', d)
  }

  // ===========================================================================
  hr('4. La ventana, A LA VISTA antes del diálogo')
  // Cerrar Tessera MINIMIZADA (la barra de tareas, el Dock): con el padre minimizado, el
  // diálogo nativo caía en la esquina del monitor de más a la izquierda (medido en
  // Windows con cuatro monitores). Se restaura ANTES de preguntar.
  {
    const m = montar()
    m.contestar.fn = () => ({ pestanas: CUARENTA })
    m.ventana.minimizada = true
    m.respuestas.push(1)
    await m.ex.confirmarSalida(m.win, 500)
    check(
      '(4a) minimizada y con cambios sin enviar: se restaura y se enfoca ANTES del diálogo',
      j(m.orden) === j(['restore', 'focus', 'dialogo']) && !m.ventana.minimizada,
      j(m.orden)
    )
  }
  {
    const m = montar()
    ;(m.ex.gestor as unknown as { pendientes: () => unknown[] }).pendientes = () => TX_PENDIENTE
    m.ventana.minimizada = true
    m.ventana.visible = false
    m.respuestas.push(2)
    await m.ex.confirmarSalida(m.win, 500)
    check(
      '(4b) con transacciones (el diálogo de siempre) también, y una ventana oculta se muestra',
      j(m.orden) === j(['restore', 'show', 'focus', 'dialogo']),
      j(m.orden)
    )
  }
  {
    // MITAD NEGATIVA: sin nada que preguntar la app se cierra SIN asomarse.
    const m = montar()
    m.ventana.minimizada = true
    const d = await m.ex.confirmarSalida(m.win, 500)
    check('(4c) sin nada pendiente NO se toca la ventana (cerrar minimizada no la asoma)', d === 'seguir' && m.orden.length === 0 && m.ventana.minimizada, j(m.orden))
  }
  {
    // Una ventana que no se deja (lanza) no impide preguntar.
    const m = montar()
    m.contestar.fn = () => ({ pestanas: CUARENTA })
    ;(m.win as unknown as { isMinimized: () => boolean }).isMinimized = () => {
      throw new Error('ventana rota')
    }
    m.respuestas.push(1)
    const d = await m.ex.confirmarSalida(m.win, 500)
    check('(4d) si la ventana lanza al restaurarla, el diálogo sale igual', d === 'cancelar' && m.dialogos.length === 1, j([d, m.dialogos.length]))
  }

  hr('RESUMEN')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('FALLO INESPERADO:', err)
  process.exit(1)
})
