// =============================================================================
// Menú contextual de la rejilla de datos: «Copiar como» y «Exportar a archivo» despliegan
// sus formatos en un submenú. Lo que necesita al servidor (exportar, traer todas) solo
// aparece si el dueño lo sabe hacer; la edición va al final, en dos grupos (la celda; las filas).
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useCallback } from 'react'
import type { DbFormatoFilas } from '../../../../../shared/db-explorador-ipc'
import { NOMBRE_FORMATO } from '../../../../../shared/formatosFilas'
import { SEP, type EntradaMenuContextual, type SubmenuMenuContextual } from '../../../comun/MenuContextual'
import { IconoCopiar } from '../../../comun/iconosMenu'
import { IconoExportar, IconoTraerTodas, IconoVerValor } from '../iconosBd'
import { IconoAnadirFila, IconoBorrarFilas, IconoEditar, IconoNulo, IconoRevertir } from '../iconosEdicion'
import { hayCambiosEnRango } from './cambiosRejilla'
import { formatoEntero } from './celdasRejilla'
import { FORMATOS_COPIAR_COMO, FORMATOS_EXPORTAR } from './exportarBd'
import { IconoFormato } from './IconoFormato'
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
import { txRejilla } from './textosRejilla.ts'

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
  r.setMenu({ x: punto.x, y: punto.y })
}

/** `MenuContextual` llama a `onCerrar` tras elegir: el foco vuelve a la rejilla (tras «Ver valor» también, y el visor lo devuelve a ella). */
export function useCerrarMenu(r: Rejilla): () => void {
  const { focoAlEditorRef, setMenu, raizRef } = r
  return useCallback((): void => {
    setMenu(null)
    if (focoAlEditorRef.current) {
      focoAlEditorRef.current = false
      return
    }
    raizRef.current?.focus({ preventScroll: true })
  }, [focoAlEditorRef, setMenu, raizRef])
}

function elementosCopiarComo(r: Rejilla, sinSeleccion: boolean): SubmenuMenuContextual {
  return {
    label: txRejilla().copiarComo,
    icon: <IconoCopiar />,
    disabled: sinSeleccion,
    submenu: FORMATOS_COPIAR_COMO.map((f) => ({ label: NOMBRE_FORMATO[f], icon: <IconoFormato formato={f} />, onClick: () => copiar(r, f) }))
  }
}

function elementosExportar(r: Rejilla): SubmenuMenuContextual {
  const { datos, onExportar, exportando = null } = r.props
  return {
    label: txRejilla().exportarArchivoMenu,
    icon: <IconoExportar />,
    // Con una exportación en marcha no se lanza otra (el dueño la ignoraría).
    disabled: exportando !== null || datos === null,
    submenu: FORMATOS_EXPORTAR.map((f: DbFormatoFilas) => ({ label: `${NOMBRE_FORMATO[f]}…`, icon: <IconoFormato formato={f} />, onClick: () => onExportar?.(f) }))
  }
}

function elementosVerYCopiar(r: Rejilla, sinSeleccion: boolean): EntradaMenuContextual[] {
  const t = txRejilla()
  return [
    {
      label: t.verValor,
      icon: <IconoVerValor />,
      onClick: () => {
        if (r.sel) abrirVisor(r, r.sel.foco)
      },
      disabled: sinSeleccion
    },
    SEP,
    { label: t.copiar, icon: <IconoCopiar />, onClick: () => copiar(r, 'tsv'), disabled: sinSeleccion },
    { label: t.copiarConCabeceras, icon: <IconoCopiar />, onClick: () => copiar(r, 'tsvCabecera'), disabled: sinSeleccion },
    elementosCopiarComo(r, sinSeleccion)
  ]
}

function elementosServidor(r: Rejilla): EntradaMenuContextual[] {
  const { datos, onExportar, onTraerTodas, trayendoTodas = false, sinLector } = r.props
  const elementos: EntradaMenuContextual[] = []
  if (onExportar || onTraerTodas) elementos.push(SEP)
  if (onExportar) elementos.push(elementosExportar(r))
  if (onTraerTodas) {
    const motivoTraer = motivoSinTraerTodas({
      hayDatos: datos !== null,
      hayMas: datos?.hayMas ?? false,
      trayendo: trayendoTodas,
      sinLector: sinLector ?? null
    })
    elementos.push({ label: txRejilla().traerTodasFilas, icon: <IconoTraerTodas />, onClick: onTraerTodas, disabled: motivoTraer !== null })
  }
  return elementos
}

/** Solo con el menú ABIERTO: recorrer una selección de miles de filas en cada render era trabajo tirado. */
function elementosEdicion(r: Rejilla, sinSeleccion: boolean): EntradaMenuContextual[] {
  const { sel } = r
  const rg = rango(sel)
  const refs = rg ? refsDelRango(r, rg) : []
  const t = txRejilla()
  const motivoFoco = sel ? motivoEn(r, sel.foco) : t.seleccionaCelda
  const nFilas = refs.length
  return [
    SEP,
    {
      label: t.editarCelda,
      icon: <IconoEditar />,
      onClick: () => {
        if (!sel) return
        r.focoAlEditorRef.current = true
        abrirEditor(r, sel.foco, 'editar', true)
      },
      disabled: sinSeleccion || motivoFoco !== null
    },
    {
      label: t.ponerNull,
      icon: <IconoNulo />,
      onClick: () => {
        if (rg) ponerNulo(r, rg)
      },
      disabled: sinSeleccion
    },
    {
      label: t.revertirSeleccion,
      icon: <IconoRevertir />,
      onClick: () => revertirSeleccion(r),
      disabled: !rg || !hayCambiosEnRango(r.cambios, refs, rg.c0, rg.c1, r.numCols)
    },
    SEP,
    { label: t.anadirFila, icon: <IconoAnadirFila />, onClick: () => anadir(r) },
    {
      label: nFilas > 1 ? t.borrarNFilasMenu(formatoEntero(nFilas)) : t.borrarFila,
      icon: <IconoBorrarFilas />,
      onClick: () => borrarSeleccion(r),
      disabled: nFilas === 0
    }
  ]
}

/** Las entradas del menú abierto. */
export function elementosMenuRejilla(r: Rejilla): EntradaMenuContextual[] {
  const sinSeleccion = !r.sel || r.numFilas === 0
  const elementos = [...elementosVerYCopiar(r, sinSeleccion), ...elementosServidor(r)]
  if (r.edicion && r.menu !== null) elementos.push(...elementosEdicion(r, sinSeleccion))
  return elementos
}
