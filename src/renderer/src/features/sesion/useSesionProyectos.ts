// =============================================================================
// La sesión de cada proyecto entre arranques: al montar lee la guardada y siembra las carpetas del explorador
// y las terminales pendientes; las pestañas del editor de un proyecto vuelven la primera vez que se ve (así
// arrancar solo carga los archivos del proyecto activo); y cada cambio de pestañas, cursor, carpetas o
// terminales se guarda con una espera corta, y en el acto cuando Tessera empieza a cerrarse.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md
// =============================================================================
import { useEffect, useLayoutEffect, useState } from 'react'
import { normalizarSesion, type SesionProyecto } from '../../../../shared/sesionProyecto'
import { alMoverCursor, cursorDe, modoInicialPara, clavePaneEditor, recordarCursor, useStoreEditor } from '../editor'
import { useStoreExplorador } from '../explorador'
import {
  accionesTerminales,
  fijarTerminalesPendientes,
  ordenTiraAGuardar,
  terminalesPendientes,
  useStoreTerminales,
  type TerminalesGuardadas
} from '../terminales'
import { aplicacionEditor, sesionDesde } from './modeloSesion'

/** Espera entre un cambio y su guardado: escribir seguido no guarda un archivo por tecla. */
const ESPERA_GUARDADO_MS = 300

/** Las pestañas guardadas de los proyectos que aún no se han visto en esta sesión. */
const editorPendiente = new Map<string, SesionProyecto>()
/** Los proyectos que tenían sesión al arrancar: sus terminales pendientes se vuelven a guardar tal cual. */
const clavesCargadas = new Set<string>()

/** Reparte la sesión leída: las carpetas al explorador, las terminales y las pestañas, pendientes. */
function sembrar(sesiones: Readonly<Record<string, SesionProyecto>>): void {
  const terminales = new Map<string, TerminalesGuardadas>()
  const carpetas: Record<string, readonly string[]> = {}
  for (const [clave, s] of Object.entries(sesiones)) {
    clavesCargadas.add(clave)
    if (s.pestanas.length > 0) editorPendiente.set(clave, s)
    if (s.terminales.length > 0) terminales.set(clave, { nombres: s.terminales.map((t) => t.nombre), activa: s.terminalActiva, orden: s.ordenTerminales })
    if (s.carpetas.length > 0) carpetas[clave] = s.carpetas
  }
  fijarTerminalesPendientes(terminales)
  // Un proyecto que ya se vio con el panel abierto antes de llegar la sesión tiene la terminal de serie: se
  // recrean ahora (`restaurarTerminales` no toca nada que no sea esa).
  for (const clave of terminales.keys()) if (useStoreTerminales.getState().terminalesShell[clave]) accionesTerminales.asegurar(clave)
  // Los árboles no se montan hasta ahora (`carpetasListas`): nada vivo puede haber pisado las guardadas.
  useStoreExplorador.setState((st) => ({ carpetasPorProyecto: { ...st.carpetasPorProyecto, ...carpetas }, carpetasListas: true }))
}

/** Pone las pestañas guardadas de un proyecto en el editor, con su modo y la posición del cursor. */
function restaurarEditor(clave: string): void {
  const s = editorPendiente.get(clave)
  if (!s) return
  editorPendiente.delete(clave)
  useStoreEditor.setState((st) => {
    const ap = aplicacionEditor(clave, s, st.pestanasPorDestino.get(clave), clavePaneEditor)
    const pestanasPorDestino = new Map(st.pestanasPorDestino).set(clave, ap.pestanas)
    const modoVistaPorPane = new Map(st.modoVistaPorPane)
    for (const [pk, modo] of ap.modos) modoVistaPorPane.set(pk, modo)
    const revelarPorPane = new Map(st.revelarPorPane)
    for (const [pk, c] of ap.cursores) {
      revelarPorPane.set(pk, { ...c, token: (st.revelarPorPane.get(pk)?.token ?? 0) + 1 })
      // Lo que se guarde antes de que el archivo cargue conserva la posición.
      recordarCursor(pk, c.linea, c.columna)
    }
    return { pestanasPorDestino, modoVistaPorPane, revelarPorPane }
  })
}

/** La sesión de un proyecto a guardar: lo vivo, salvo lo que aún no se ha restaurado, que va tal cual. */
function sesionAGuardar(clave: string): SesionProyecto | null {
  const editor = useStoreEditor.getState()
  const viva = sesionDesde(clave, {
    clavePane: clavePaneEditor,
    pestanas: editor.pestanasPorDestino.get(clave),
    modoDe: (pk) => editor.modoVistaPorPane.get(pk),
    modoDeSerie: modoInicialPara,
    cursorDe,
    carpetas: useStoreExplorador.getState().carpetasPorProyecto[clave],
    terminales: useStoreTerminales.getState().terminalesShell[clave],
    ordenTerminales: ordenTiraAGuardar(clave)
  })
  const pe = editorPendiente.get(clave)
  const pt = terminalesPendientes(clave)
  if (!pe && !pt) return viva
  const base: SesionProyecto = viva ?? { pestanas: [], activa: null, carpetas: [], terminales: [], terminalActiva: -1 }
  const deEditor = pe ? { pestanas: pe.pestanas, activa: pe.activa } : { pestanas: base.pestanas, activa: base.activa }
  const deTerminales = pt
    ? { terminales: pt.nombres.map((nombre) => (nombre ? { nombre } : {})), terminalActiva: pt.activa, ordenTerminales: pt.orden }
    : { terminales: base.terminales, terminalActiva: base.terminalActiva, ordenTerminales: base.ordenTerminales }
  return normalizarSesion({ ...deEditor, carpetas: base.carpetas, ...deTerminales })
}

/** Todas las sesiones: el main se queda solo con las de los proyectos abiertos. */
function sesionesAGuardar(): Record<string, SesionProyecto> {
  const claves = new Set<string>([
    ...clavesCargadas,
    ...useStoreEditor.getState().pestanasPorDestino.keys(),
    ...Object.keys(useStoreExplorador.getState().carpetasPorProyecto),
    ...Object.keys(useStoreTerminales.getState().terminalesShell)
  ])
  const salida: Record<string, SesionProyecto> = {}
  for (const clave of claves) {
    const s = sesionAGuardar(clave)
    if (s !== null) salida[clave] = s
  }
  return salida
}

function guardar(): void {
  window.tessera.workspace.guardarSesiones(sesionesAGuardar()).catch((err) => console.error('[sesion] guardarSesiones falló:', err))
}

/** Carga la sesión al montar y avisa cuando está sembrada. */
function useSesionCargada(): boolean {
  const [cargada, setCargada] = useState(false)
  useEffect(() => {
    let vivo = true
    window.tessera.workspace
      .cargarSesiones()
      .then((sesiones) => {
        if (!vivo) return
        sembrar(sesiones)
        setCargada(true)
      })
      .catch((err) => {
        console.error('[sesion] cargarSesiones falló:', err)
        // Sin sesión se arranca limpio, y se sigue guardando lo de esta sesión.
        if (!vivo) return
        useStoreExplorador.setState({ carpetasListas: true })
        setCargada(true)
      })
    return () => {
      vivo = false
    }
  }, [])
  return cargada
}

/** Guarda con espera cada cambio de lo que forma la sesión, y en el acto al empezar el cierre. */
function useGuardadoDeSesion(cargada: boolean): void {
  useEffect(() => {
    // Antes de sembrar, guardar escribiría una sesión vacía sobre la del archivo.
    if (!cargada) return
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const programar = (): void => {
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(() => {
        temporizador = null
        guardar()
      }, ESPERA_GUARDADO_MS)
    }
    const yaMismo = (): void => {
      if (temporizador === null) return
      clearTimeout(temporizador)
      temporizador = null
      guardar()
    }
    const bajas = [
      useStoreEditor.subscribe((s, p) => {
        if (s.pestanasPorDestino !== p.pestanasPorDestino || s.modoVistaPorPane !== p.modoVistaPorPane) programar()
      }),
      useStoreExplorador.subscribe((s, p) => {
        if (s.carpetasPorProyecto !== p.carpetasPorProyecto) programar()
      }),
      useStoreTerminales.subscribe((s, p) => {
        // Las pestañas SSH también: el orden guardado las nombra por su posición entre las iguales.
        if (s.terminalesShell !== p.terminalesShell || s.orden !== p.orden || s.ssh.porPerfil !== p.ssh.porPerfil) programar()
      }),
      alMoverCursor(programar),
      window.tessera.cierre.alProgreso(yaMismo)
    ]
    return () => {
      for (const baja of bajas) baja()
      yaMismo()
    }
  }, [cargada])
}

/**
 * La sesión de cada proyecto: la carga, restaura las pestañas del proyecto que se ve la primera vez que se ve
 * (`claveDestinoEditorActivo`, el `perfil|ruta` del editor) y guarda cada cambio. Lo monta App una vez.
 */
export function useSesionProyectos(claveDestinoEditorActivo: string | null): void {
  const cargada = useSesionCargada()
  useLayoutEffect(() => {
    if (cargada && claveDestinoEditorActivo !== null) restaurarEditor(claveDestinoEditorActivo)
  }, [cargada, claveDestinoEditorActivo])
  useGuardadoDeSesion(cargada)
}
