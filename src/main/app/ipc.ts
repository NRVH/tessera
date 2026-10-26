// =============================================================================
// Canales de la propia aplicación: los fallos globales del renderer al registro de
// fallos, la identidad para «Acerca de», abrir enlaces en el navegador del sistema y las
// ventanas de agente. Varias funciones y no una porque `index.ts` los registra en momentos
// distintos del arranque. Solo lo importa `src/main/index.ts`.
// =============================================================================
import { app, shell, type IpcMain } from 'electron'
import { IPC_CHANNELS, type CrashReport } from '../../shared/ipc'
import { APP_INFO_CHANNELS, type AppInfo } from '../../shared/app-info-ipc'
import {
  VENTANA_AGENTE_CHANNELS,
  type EncargoPaneRemoto,
  type PeticionPaneRemoto,
  type RespuestaPaneRemoto
} from '../../shared/ventana-agente-ipc'
import { esAgenteManual, type IdAgente } from '../../shared/agentesManuales'
import { logCrash } from './crashLog'
import type { ReferenciasApp } from './referencias'

/** `REPORT_CRASH`: errores globales del renderer (payload no confiable: se valida la forma). */
export function registrarIpcFallos(deps: { ipc: Pick<IpcMain, 'on'> }): void {
  deps.ipc.on(IPC_CHANNELS.REPORT_CRASH, (_e, report: CrashReport) => {
    const tag = typeof report?.tag === 'string' ? report.tag : 'renderer:unknown'
    const detail = typeof report?.detail === 'string' ? report.detail : String(report?.detail)
    logCrash(tag, detail)
  })
}

/**
 * `APP_INFO.GET`: versión y motores; con `sandbox` el renderer no tiene `process.versions`.
 * `APP_INFO.REINICIAR`: el cierre ordenado de siempre, que vuelve a abrir Tessera al salir.
 */
export function registrarIpcAcercaDe(deps: { ipc: Pick<IpcMain, 'handle'>; reiniciar: () => void }): void {
  deps.ipc.handle(APP_INFO_CHANNELS.REINICIAR, () => deps.reiniciar())
  deps.ipc.handle(
    APP_INFO_CHANNELS.GET,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    })
  )
}

/** Lo que necesitan los canales de las ventanas de agente. */
export interface DepsIpcVentanaAgente {
  ipc: Pick<IpcMain, 'handle' | 'on'>
  refs: ReferenciasApp
  /** Abre una ventana de agente nueva. */
  abrir: () => void
  /** El id del `webContents` dueño de una sesión de agente, o null si no lo tiene. */
  ventanaDe: (sessionId: string) => number | null
}

/** Tope de un encargo a otra ventana: relanzar puede esperar al candado de la instalación. */
const TOPE_RELANZAR_REMOTO_MS = 5 * 60_000
const TOPE_ENCARGO_REMOTO_MS = 10_000

function esIdAgente(x: unknown): x is IdAgente {
  return x === 'claude-code' || x === 'codex' || (typeof x === 'string' && esAgenteManual(x))
}

function peticionValida(req: unknown): PeticionPaneRemoto | null {
  if (!req || typeof req !== 'object') return null
  const r = req as Partial<PeticionPaneRemoto>
  if (typeof r.sessionId !== 'string' || !['preparar', 'relanzar', 'liberar'].includes(r.accion as string)) return null
  return {
    sessionId: r.sessionId,
    accion: r.accion as PeticionPaneRemoto['accion'],
    ...(typeof r.banner === 'string' ? { banner: r.banner.slice(0, 2000) } : {}),
    ...(r.error === true ? { error: true } : {})
  }
}

/**
 * Las ventanas de agente: abrir una, con qué nace cada una, qué agente enseña y el relevo de la
 * actualización nativa, que corre en la principal y actúa sobre los panes de las demás: la petición
 * va a la ventana dueña de la sesión y su respuesta vuelve con el mismo id, con tope.
 */
export function registrarIpcVentanaAgente(deps: DepsIpcVentanaAgente): void {
  const { ipc, refs } = deps
  ipc.handle(VENTANA_AGENTE_CHANNELS.ABRIR, () => deps.abrir())
  ipc.handle(VENTANA_AGENTE_CHANNELS.DATOS, (e) => refs.ventanasAgente.get(e.sender.id)?.datos ?? null)
  ipc.on(VENTANA_AGENTE_CHANNELS.ACTIVO, (e, agente: unknown) => {
    const v = refs.ventanasAgente.get(e.sender.id)
    if (v && esIdAgente(agente)) v.agenteActivo = agente
  })
  const encargos = new Map<number, { de: number; resolver: (r: RespuestaPaneRemoto['resultado']) => void }>()
  let siguiente = 1
  ipc.on(VENTANA_AGENTE_CHANNELS.RESPUESTA, (e, r: RespuestaPaneRemoto) => {
    const pendiente = typeof r?.id === 'number' ? encargos.get(r.id) : undefined
    if (!pendiente || pendiente.de !== e.sender.id) return
    const resultado = r.resultado === 'ok' || r.resultado === 'fallo' || r.resultado === 'saltada' ? r.resultado : null
    pendiente.resolver(resultado)
  })
  ipc.handle(VENTANA_AGENTE_CHANNELS.PANE_REMOTO, (e, crudo: unknown): Promise<RespuestaPaneRemoto['resultado']> => {
    const req = peticionValida(crudo)
    const sinDueno = req?.accion === 'relanzar' ? 'saltada' : null
    if (!req) return Promise.resolve(null)
    const dueno = deps.ventanaDe(req.sessionId)
    const v = dueno === null || dueno === e.sender.id ? undefined : refs.ventanasAgente.get(dueno)
    if (!v || v.win.isDestroyed() || v.win.webContents.isDestroyed()) return Promise.resolve(sinDueno)
    const id = siguiente++
    const wc = v.win.webContents
    return new Promise((resolver) => {
      const reloj = setTimeout(
        () => encargos.get(id)?.resolver(req.accion === 'relanzar' ? 'fallo' : null),
        req.accion === 'relanzar' ? TOPE_RELANZAR_REMOTO_MS : TOPE_ENCARGO_REMOTO_MS
      )
      // La ventana se cierra o su renderer se cae: la respuesta ya no llegará y esperar el tope
      // congelaría la actualización minutos. Una recarga pierde el oyente del encargo igual.
      const alIrse = (): void => encargos.get(id)?.resolver(sinDueno)
      wc.once('destroyed', alIrse)
      wc.once('render-process-gone', alIrse)
      encargos.set(id, {
        de: wc.id,
        resolver: (r) => {
          clearTimeout(reloj)
          encargos.delete(id)
          if (!wc.isDestroyed()) {
            wc.removeListener('destroyed', alIrse)
            wc.removeListener('render-process-gone', alIrse)
          }
          resolver(r)
        }
      })
      v.win.webContents.send(VENTANA_AGENTE_CHANNELS.ENCARGO, { id, ...req } satisfies EncargoPaneRemoto)
    })
  })
}

/**
 * `OPEN_EXTERNAL_URL`: abre enlaces de la terminal en el navegador del sistema, solo
 * `http(s)` y `mailto`; el renderer nunca navega.
 */
export function registrarIpcEnlacesExternos(deps: { ipc: Pick<IpcMain, 'handle'> }): void {
  deps.ipc.handle(IPC_CHANNELS.OPEN_EXTERNAL_URL, (_e, url: unknown) => {
    if (typeof url === 'string' && /^(https?|mailto):/i.test(url)) {
      void shell.openExternal(url)
      return
    }
    console.error('[tessera] openExternal RECHAZADO (esquema no permitido):', url)
  })
}
