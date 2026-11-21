// =============================================================================
// Modelo del chip, sus tareas y cuentas distintas: conserva las salidas y controla el popover y la confirmación.
// Los estados de interacción viven en el store; las referencias locales solo apuntan a los controles.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import type { VistaTarea, VistaTareaPanel } from '../../../../shared/delegacion-ipc'
import { useListaConSalida } from '../../comun/presencia'
import { documentoDe, esNodo, ventanaDeNodo } from '../../util/ventanaDe'
import { txDelegacion } from './textos'
import { cuentasDeTareas, esFallo, estadoChip, seleccionarTareas, tareasVisibles, tiempoTranscurrido, tituloTarea, type CuentaDelegada } from './modeloDelegacion'
import { cambiarVista, confirmarCancelacion, descartarTarea, olvidarVista, useStoreDelegacion, VISTA_CERRADA } from './storeDelegacion'

const claveTarea = (t: VistaTarea): string => t.id
const claveCuenta = (cuenta: CuentaDelegada): string => cuenta.clave

function useCerrarPopover(abierto: boolean, cerrar: (abierto: boolean) => void, envoltura: React.RefObject<HTMLDivElement>, panel: React.RefObject<HTMLDivElement>, boton: React.RefObject<HTMLButtonElement>): () => void {
  const cerrarConFoco = useCallback(() => {
    cerrar(false)
    boton.current?.focus({ preventScroll: true })
  }, [cerrar, boton])
  useEffect(() => {
    if (!abierto) return
    const doc = documentoDe(envoltura.current ?? boton.current)
    const ventana = doc.defaultView ?? window
    const fuera = (e: PointerEvent): void => {
      const destino = e.target
      if (!esNodo(destino)) return
      if (!envoltura.current?.contains(destino) && !panel.current?.contains(destino)) cerrar(false)
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cerrarConFoco()
    }
    const alCambiarVentana = (): void => cerrar(false)
    doc.addEventListener('pointerdown', fuera)
    doc.addEventListener('keydown', tecla)
    ventana.addEventListener('resize', alCambiarVentana)
    ventana.addEventListener('blur', alCambiarVentana)
    return () => {
      doc.removeEventListener('pointerdown', fuera)
      doc.removeEventListener('keydown', tecla)
      ventana.removeEventListener('resize', alCambiarVentana)
      ventana.removeEventListener('blur', alCambiarVentana)
    }
  }, [abierto, cerrar, cerrarConFoco, envoltura, panel, boton])
  return cerrarConFoco
}

const SIN_TAREAS: VistaTareaPanel[] = []

export function useIndicadorDelegadas(origenes: readonly string[]) {
  const clave = useId()
  const envoltura = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const tareas = useStoreDelegacion((s) => s.tareas)
  const ahora = useStoreDelegacion((s) => s.ahora)
  const retiradas = useStoreDelegacion((s) => s.retiradas)
  const errores = useStoreDelegacion((s) => s.errores)
  const cancelando = useStoreDelegacion((s) => s.cancelando)
  const fallosCancelar = useStoreDelegacion((s) => s.fallosCancelar)
  const vista = useStoreDelegacion((s) => s.vistas[clave] ?? VISTA_CERRADA)
  // Por su contenido y no por el array: quien llama lo crea en cada render. Sin tareas, siempre el mismo vacío, para
  // que la lista con salida no cambie de estado con cada render del padre ni con cada segundo del reloj.
  const claveOrigenes = origenes.join('\n')
  const seleccionadas = useMemo(() => {
    const s = seleccionarTareas(tareasVisibles(tareas, retiradas, ahora, errores), claveOrigenes === '' ? [] : claveOrigenes.split('\n'))
    return s.length === 0 ? SIN_TAREAS : s
  }, [tareas, retiradas, ahora, errores, claveOrigenes])
  const ultima = useRef<VistaTareaPanel[]>([])
  if (seleccionadas.length) ultima.current = seleccionadas
  const contenido = seleccionadas.length ? seleccionadas : ultima.current
  const lista = useListaConSalida(seleccionadas, claveTarea)
  const cuentasSeleccionadas = useMemo(() => cuentasDeTareas(seleccionadas), [seleccionadas])
  const cuentas = useListaConSalida(cuentasSeleccionadas, claveCuenta)
  const cerrar = useCallback((abierto: boolean) => cambiarVista(clave, { abierto }), [clave])
  const visible = seleccionadas.length > 0
  const cerrarConFoco = useCerrarPopover(vista.abierto, cerrar, envoltura, panel, boton)
  useEffect(() => () => olvidarVista(clave), [clave])
  useEffect(() => {
    cerrar(false)
  }, [cerrar, claveOrigenes])
  useEffect(() => {
    if (!visible) cerrar(false)
  }, [cerrar, visible])
  const textos = txDelegacion()
  const unica = contenido.length === 1 ? contenido[0] : null
  // Un fallo al cancelar se ve en el propio chip: con una sola tarea no hay desplegable que abrir para leerlo.
  const hayFalloCancelar = contenido.some((t) => fallosCancelar[t.id])
  const estado = hayFalloCancelar ? 'fallo' : estadoChip(contenido)
  const falloCancelarUnica = unica ? fallosCancelar[unica.id] : undefined
  const filas = lista.map(({ elemento: tarea, saliendo }) => ({
    tarea, saliendo, fallo: esFallo(tarea), titulo: tituloTarea(tarea, textos),
    estado: estadoChip([tarea]), cancelable: tarea.estado === 'en-marcha', descartable: esFallo(tarea) || Boolean(errores[tarea.id]),
    tiempo: cancelando[tarea.id] ? textos.cancelando : tiempoTranscurrido(tarea, ahora), error: errores[tarea.id],
    cancelando: Boolean(cancelando[tarea.id]), falloCancelar: fallosCancelar[tarea.id],
    motivo: tarea.motivo ? textos.motivos[tarea.motivo] : textos.fallida
  }))
  const alternar = (): void => {
    const el = boton.current
    const r = el?.getBoundingClientRect()
    if (!el || !r) return
    const ventana = ventanaDeNodo(el)
    const arriba = r.bottom > ventana.innerHeight / 2
    cambiarVista(clave, { abierto: !vista.abierto, arriba, derecha: Math.max(8, ventana.innerWidth - r.right), borde: arriba ? ventana.innerHeight - r.top + 4 : r.bottom + 4 })
  }
  return {
    textos, vista, envoltura, panel, boton, filas, cuentas, estado, unica,
    anuncio: hayFalloCancelar ? textos.errorCancelar : estado === 'hecha' ? textos.hecha : estado === 'fallo' ? textos.fallida : '',
    visible,
    etiqueta: unica ? unica.cuenta : textos.cantidad(contenido.length),
    titulo: unica ? (falloCancelarUnica ?? tituloTarea(unica, textos)) : textos.titulo,
    tiempo: unica?.estado === 'en-marcha' ? (cancelando[unica.id] ? textos.cancelando : tiempoTranscurrido(unica, ahora)) : null,
    cancelandoUnica: Boolean(unica && cancelando[unica.id]),
    alternar, cerrarConFoco,
    pedirCancelacion: (tarea: VistaTarea) => cambiarVista(clave, { abierto: false, cancelar: tarea }),
    mantener: () => cambiarVista(clave, { cancelar: null }),
    confirmar: () => { void confirmarCancelacion(clave) },
    descartar: (id: string) => { void descartarTarea(id) }
  }
}
