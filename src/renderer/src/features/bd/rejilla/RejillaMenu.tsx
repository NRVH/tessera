// =============================================================================
// Menú contextual de la rejilla de datos, de DOS PASOS: «Copiar como…» y «Exportar a
// archivo…» sustituyen el menú, en el mismo sitio, por la lista de formatos. Lo que
// necesita al servidor (exportar, traer todas) solo aparece si el dueño lo sabe hacer;
// la edición va al final, en dos grupos (la celda; las filas).
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useCallback } from 'react'
import type { DbFormatoFilas } from '../../../../../shared/db-explorador-ipc'
import { NOMBRE_FORMATO } from '../../../../../shared/formatosFilas'
import { SEP, type ContextMenuEntry } from '../../../comun/ContextMenu'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { IconoExportar, IconoTraerTodas, IconoVerValor } from '../iconosBd'
import { IconoAnadirFila, IconoBorrarFilas, IconoEditar, IconoNulo, IconoRevertir } from '../iconosEdicion'
import { hayCambiosEnRango } from './cambiosRejilla'
import { formatoEntero } from './celdasRejilla'
import { FORMATOS_COPIAR_COMO, FORMATOS_EXPORTAR } from './exportarBd'
import {
  abrirEditor,
  abrirVisor,
  anadir,
  borrarSeleccion,
  copiar,
  motivoEn,
  ponerNulo,
  refsDelRango,
  revertirSeleccion
} from './rejillaAcciones'
import { zonaEn } from './rejillaEventos'
import { contiene, filaCompleta, rango } from './seleccionRejilla'
import { motivoSinTraerTodas } from './traerTodas'
import type { Rejilla } from './rejillaTipos'

/** Dónde sale el menú abierto con teclado: junto a la celda activa, dentro de la caja. */
function puntoDeTeclado(r: Rejilla, el: HTMLDivElement): { x: number; y: number } {
  const rc = el.getBoundingClientRect()
  const { sel, anchoFijo, pref, altoCab } = r
  let x: number
  let y: number
  if (sel) {
    x = rc.left + anchoFijo + pref[sel.foco.c] - el.scrollLeft + 8
    y = rc.top + altoCab + (sel.foco.f + 1) * r.props.altoFila - el.scrollTop
  } else {
    x = rc.left + anchoFijo + 8
    y = rc.top + altoCab + 4
  }
  return { x: Math.max(rc.left, Math.min(rc.right - 8, x)), y: Math.max(rc.top, Math.min(rc.bottom - 8, y)) }
}

/** Clic derecho, Mayús+F10 o la tecla Menú. */
export function alMenuContextual(r: Rejilla, e: React.MouseEvent<HTMLDivElement>): void {
  const el = r.scrollRef.current
  const objetivo = e.target as Node
  const deTeclado = e.target === r.raizRef.current
  // La píldora, el vacío y el propio menú (sus eventos suben por el árbol de React aunque
  // esté en un portal) no son una celda.
  if (!el || (!deTeclado && !el.contains(objetivo))) return
  e.preventDefault()
  let punto = { x: e.clientX, y: e.clientY }
  if (deTeclado) punto = puntoDeTeclado(r, el)
  else {
    const z = zonaEn(r, e.clientX, e.clientY, false)
    // Clic derecho FUERA de la selección: se selecciona lo de debajo. Dentro, se respeta
    // el rango (es lo que se copiará).
    if (z.zona === 'celda' && !contiene(r.sel, z.f, z.c)) {
      r.setSel({ ancla: { f: z.f, c: z.c }, foco: { f: z.f, c: z.c } })
    } else if (z.zona === 'num' && !contiene(r.sel, z.f, 0)) {
      r.setSel(filaCompleta(null, z.f, { filas: r.numFilas, columnas: r.numCols }, false))
    }
  }
  r.setMenu({ x: punto.x, y: punto.y, paso: 'raiz' })
}

/**
 * `ContextMenu` llama a `onClose` justo después del `onClick` de la entrada: con un paso
 * pendiente, el menú cambia de lista en el mismo sitio. Si no, el foco vuelve a la
 * rejilla (tras «Ver valor» también: así el visor lo devuelve a ella al cerrarse).
 */
export function useCerrarMenu(r: Rejilla): () => void {
  const { pasoPendienteRef, focoAlEditorRef, setMenu, raizRef } = r
  return useCallback((): void => {
    const paso = pasoPendienteRef.current
    pasoPendienteRef.current = null
    if (paso) {
      setMenu((m) => (m ? { ...m, paso } : m))
      return
    }
    setMenu(null)
    if (focoAlEditorRef.current) {
      focoAlEditorRef.current = false
      return
    }
    raizRef.current?.focus({ preventScroll: true })
  }, [pasoPendienteRef, focoAlEditorRef, setMenu, raizRef])
}

function itemsCopiarComo(r: Rejilla, sinSeleccion: boolean): ContextMenuEntry[] {
  return [
    // Título del paso: fila apagada (no enfocable).
    { label: 'Copiar como', onClick: () => undefined, disabled: true },
    ...FORMATOS_COPIAR_COMO.map(
      (f): ContextMenuEntry => ({ label: NOMBRE_FORMATO[f], onClick: () => copiar(r, f), disabled: sinSeleccion })
    )
  ]
}

function itemsExportar(r: Rejilla): ContextMenuEntry[] {
  const { onExportar, exportando = null } = r.props
  return [
    { label: 'Exportar a archivo', onClick: () => undefined, disabled: true },
    ...FORMATOS_EXPORTAR.map(
      (f: DbFormatoFilas): ContextMenuEntry => ({
        label: `${NOMBRE_FORMATO[f]}…`,
        onClick: () => onExportar?.(f),
        disabled: exportando !== null
      })
    )
  ]
}

function itemsVerYCopiar(r: Rejilla, sinSeleccion: boolean): ContextMenuEntry[] {
  return [
    {
      label: 'Ver valor',
      icon: <IconoVerValor />,
      onClick: () => {
        if (r.sel) abrirVisor(r, r.sel.foco)
      },
      disabled: sinSeleccion
    },
    SEP,
    { label: 'Copiar', icon: <IconoCopiar />, onClick: () => copiar(r, 'tsv'), disabled: sinSeleccion },
    { label: 'Copiar con cabeceras', icon: <IconoCopiar />, onClick: () => copiar(r, 'tsvCabecera'), disabled: sinSeleccion },
    {
      label: 'Copiar como…',
      icon: <IconoCopiar />,
      onClick: () => {
        r.pasoPendienteRef.current = 'copiarComo'
      },
      disabled: sinSeleccion
    }
  ]
}

function itemsServidor(r: Rejilla): ContextMenuEntry[] {
  const { datos, onExportar, onTraerTodas, exportando = null, trayendoTodas = false, sinLector } = r.props
  const items: ContextMenuEntry[] = []
  if (onExportar || onTraerTodas) items.push(SEP)
  if (onExportar) {
    items.push({
      label: 'Exportar a archivo…',
      icon: <IconoExportar />,
      onClick: () => {
        r.pasoPendienteRef.current = 'exportar'
      },
      // Con una exportación en marcha no se lanza otra (el dueño la ignoraría).
      disabled: exportando !== null || datos === null
    })
  }
  if (onTraerTodas) {
    const motivoTraer = motivoSinTraerTodas({
      hayDatos: datos !== null,
      hayMas: datos?.hayMas ?? false,
      trayendo: trayendoTodas,
      sinLector: sinLector ?? null
    })
    items.push({ label: 'Traer todas las filas', icon: <IconoTraerTodas />, onClick: onTraerTodas, disabled: motivoTraer !== null })
  }
  return items
}

/** Solo con el menú ABIERTO: recorrer una selección de miles de filas en cada render era trabajo tirado. */
function itemsEdicion(r: Rejilla, sinSeleccion: boolean): ContextMenuEntry[] {
  const { sel } = r
  const rg = rango(sel)
  const refs = rg ? refsDelRango(r, rg) : []
  const motivoFoco = sel ? motivoEn(r, sel.foco) : 'Selecciona una celda'
  const nFilas = refs.length
  return [
    SEP,
    {
      label: 'Editar celda',
      icon: <IconoEditar />,
      onClick: () => {
        if (!sel) return
        r.focoAlEditorRef.current = true
        abrirEditor(r, sel.foco, 'editar', true)
      },
      disabled: sinSeleccion || motivoFoco !== null
    },
    {
      label: 'Poner NULL',
      icon: <IconoNulo />,
      onClick: () => {
        if (rg) ponerNulo(r, rg)
      },
      disabled: sinSeleccion
    },
    {
      label: 'Revertir selección',
      icon: <IconoRevertir />,
      onClick: () => revertirSeleccion(r),
      disabled: !rg || !hayCambiosEnRango(r.cambios, refs, rg.c0, rg.c1, r.numCols)
    },
    SEP,
    { label: 'Añadir fila', icon: <IconoAnadirFila />, onClick: () => anadir(r) },
    {
      label: nFilas > 1 ? `Borrar ${formatoEntero(nFilas)} filas` : 'Borrar fila',
      icon: <IconoBorrarFilas />,
      onClick: () => borrarSeleccion(r),
      disabled: nFilas === 0
    }
  ]
}

/** Las entradas del paso del menú que está abierto. */
export function itemsMenuRejilla(r: Rejilla): ContextMenuEntry[] {
  const sinSeleccion = !r.sel || r.numFilas === 0
  if (r.menu?.paso === 'copiarComo') return itemsCopiarComo(r, sinSeleccion)
  if (r.menu?.paso === 'exportar') return itemsExportar(r)
  const items = [...itemsVerYCopiar(r, sinSeleccion), ...itemsServidor(r)]
  if (r.edicion && r.menu !== null) items.push(...itemsEdicion(r, sinSeleccion))
  return items
}
