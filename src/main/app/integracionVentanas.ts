// =============================================================================
// Por dónde se abre una ventana de agente desde el sistema y qué sobrevive a una actualización:
// la Jump List de Windows (también con la app cerrada), el menú del Dock de macOS, y el archivo
// con las ventanas de agente que «Reiniciar para actualizar» deja escrito para reabrirlas.
// Decide con `ventanasAgentePuro.ts`; lo compone `index.ts`.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================
import { app, Menu } from 'electron'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { esMac, esWindows } from '../../shared/plataforma'
import { lanzadaPorElArnes } from '../../shared/arnesE2e.ts'
import { writeFileAtomicSync } from '../util/atomicWrite'
import type { AgentTerminalController } from '../agents/AgentTerminalController'
import { entradasDock, tareasJumpList, ventanasARestaurar, type ArchivoRestauracion, type VentanaARestaurar } from './ventanasAgentePuro'
import type { ReferenciasApp, RestauracionVentanas } from './referencias'
import { rutaIconoAgente } from './ventanaAgente'
import { txApp } from './textos.ts'

/** Lo que hacen las entradas del sistema. */
export interface AccionesIntegracion {
  nuevaVentanaAgente: () => void
  abrirPrincipal: () => void
}

function hayPrincipal(refs: ReferenciasApp): boolean {
  return refs.ventana !== null && !refs.ventana.isDestroyed()
}

/**
 * La Jump List de Windows. Solo la app instalada: en desarrollo el ejecutable es el de Electron y
 * la tarea abriría otra cosa. Las tareas quedan en el sistema con la app cerrada. Tampoco la que
 * lanza el arnés de interfaz: comparte el AppUserModelID con la instalada y dejaría su Jump List
 * apuntando al paquete de prueba, que se abriría con los datos reales del usuario.
 */
export function actualizarJumpList(refs: ReferenciasApp, appViva = true): void {
  if (!esWindows() || !app.isPackaged || lanzadaPorElArnes(process.argv)) return
  const t = txApp().ventanaAgente
  const icono = rutaIconoAgente()
  const tareas = tareasJumpList(
    { appViva, hayPrincipal: hayPrincipal(refs) },
    { nueva: t.nueva, nuevaDescripcion: t.nuevaDescripcion, abrir: t.abrir, abrirDescripcion: t.abrirDescripcion }
  )
  try {
    app.setUserTasks(
      tareas.map((x) => ({
        program: process.execPath,
        arguments: x.argumentos,
        title: x.titulo,
        description: x.descripcion,
        iconPath: x.argumentos ? (icono ?? process.execPath) : process.execPath,
        iconIndex: 0
      }))
    )
  } catch (err) {
    console.error('[ventana-agente] no se pudo escribir la Jump List:', err)
  }
}

/** El menú del Dock de macOS: «Nueva ventana de agente» y, sin principal, «Abrir Tessera». */
export function actualizarDock(refs: ReferenciasApp, acciones: AccionesIntegracion): void {
  if (!esMac() || !app.dock) return
  const t = txApp().ventanaAgente
  const entradas = entradasDock(hayPrincipal(refs), { nueva: t.nueva, abrir: t.abrir })
  app.dock.setMenu(
    Menu.buildFromTemplate(
      entradas.map((e) => ({
        label: e.label,
        click: e.accion === 'nueva-ventana-agente' ? acciones.nuevaVentanaAgente : acciones.abrirPrincipal
      }))
    )
  )
}

const ARCHIVO = 'ventanas-agente.json'

function rutaArchivo(): string {
  return join(app.getPath('userData'), ARCHIVO)
}

/** Las ventanas de agente vivas con su agente a la vista y la conversación de su sesión. */
function recordar(refs: ReferenciasApp, agentes: () => AgentTerminalController | null): VentanaARestaurar[] {
  const ctrl = agentes()
  const fuera: VentanaARestaurar[] = []
  for (const [id, v] of refs.ventanasAgente) {
    if (v.win.isDestroyed()) continue
    const sesiones = ctrl?.sesionesDeVentana(id) ?? []
    const agente = v.agenteActivo ?? sesiones[0]?.agente ?? v.datos.agente
    if (!agente) continue
    const sesion = sesiones.find((s) => s.agente === agente)
    const conversacion = sesion ? ctrl?.conversacionDe(sesion.sessionId) : undefined
    fuera.push(conversacion ? { agente, conversacion } : { agente })
  }
  return fuera
}

/** Lo que el cierre usa para dejar escritas las ventanas de agente cuando relanza tras actualizar. */
export function restauracionVentanas(refs: ReferenciasApp, agentes: () => AgentTerminalController | null): RestauracionVentanas {
  return {
    recordar: () => recordar(refs, agentes),
    guardar: (recuerdo) => {
      const ventanas = Array.isArray(recuerdo) ? (recuerdo as VentanaARestaurar[]) : []
      if (ventanas.length === 0) return
      try {
        const archivo: ArchivoRestauracion = { escritoEn: Date.now(), ventanas }
        writeFileAtomicSync(rutaArchivo(), JSON.stringify(archivo))
      } catch (err) {
        console.error('[ventana-agente] no se pudieron guardar las ventanas para reabrirlas:', err)
      }
    },
    olvidar: () => olvidarRestauracion()
  }
}

/** Borra el archivo de restauración (si no existe, nada). */
function olvidarRestauracion(): void {
  try {
    rmSync(rutaArchivo(), { force: true })
  } catch (err) {
    console.error('[ventana-agente] no se pudo borrar el archivo de restauración:', err)
  }
}

/** Lee y CONSUME el archivo de restauración: se reabre una vez, en el arranque que sigue a actualizar. */
export function tomarVentanasARestaurar(): VentanaARestaurar[] {
  let crudo: unknown = null
  try {
    crudo = JSON.parse(readFileSync(rutaArchivo(), 'utf8'))
  } catch {
    return []
  }
  olvidarRestauracion()
  return ventanasARestaurar(crudo, Date.now())
}
