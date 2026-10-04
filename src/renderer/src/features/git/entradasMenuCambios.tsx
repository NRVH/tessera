// =============================================================================
// entradasMenuCambios: las entradas del menú contextual de una fila de Cambios,
// en grupos por consecuencia: [abrir] | [preparar/quitar] | [excluir] | [descartar].
// Descartar borra trabajo sin commitear: va al final, aislado y en rojo, y nunca
// en un conflicto. Los separadores huérfanos los poda el propio ContextMenu.
// Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import {
  IconoAbrir,
  IconoAbrirFuera,
  IconoDescartar,
  IconoExcluir,
  IconoPreparar
} from '../../comun/iconosMenu'
import { SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import type { Seccion } from './modelo/estadoRepos'
import { existeEnDisco } from './modelo/resolveWorkingDiffTarget'
import { nameOf } from './modelo/rutasArchivo'
import type { ManejadoresArchivo, ObjetivoMenu } from './modelo/seccionesCambios'

/** Las entradas del menú para el objetivo ya calculado al abrirlo. */
export function entradasMenuCambios(
  { change, seccion, objetivo, nuevos }: ObjetivoMenu,
  manejadores: ManejadoresArchivo
): ContextMenuEntry[] {
  const items = entradasAbrir(change, manejadores)
  if (seccion === 'staged') {
    entradaQuitar(items, objetivo, manejadores)
    return items
  }
  entradaPreparar(items, seccion, objetivo, manejadores)
  entradasExcluir(items, nuevos, manejadores)
  entradaDescartar(items, seccion, objetivo, manejadores)
  return items
}

// Abrir actúa SIEMPRE sobre la fila sola, aunque haya 8 marcadas; un archivo
// borrado no se puede abrir ni revelar: el ítem se ve, apagado.
function entradasAbrir(
  change: ObjetivoMenu['change'],
  manejadores: ManejadoresArchivo
): ContextMenuEntry[] {
  const path = change?.path ?? null
  const enDisco = change !== null && existeEnDisco(change)
  return [
    {
      icon: <IconoAbrir />,
      label: 'Abrir archivo',
      onClick: () => {
        if (path) manejadores.onOpenFile({ path, name: nameOf(path) })
      },
      disabled: !enDisco
    },
    {
      icon: <IconoAbrirFuera />,
      label: 'Abrir en el explorador',
      onClick: () => {
        if (path) void window.tessera.files.reveal(path)
      },
      disabled: !enDisco
    },
    SEP
  ]
}

function entradaQuitar(
  items: ContextMenuEntry[],
  objetivo: string[],
  manejadores: ManejadoresArchivo
): void {
  const n = objetivo.length
  if (!manejadores.onUnstage || !manejadores.onUnstageMany) return
  items.push({
    icon: <IconoDescartar />,
    label: n > 1 ? `Quitar ${n} de preparados` : 'Quitar de preparados',
    onClick: () =>
      n > 1 ? manejadores.onUnstageMany?.(objetivo) : manejadores.onUnstage?.(objetivo[0])
  })
}

// En un conflicto, preparar ES marcarlo resuelto (git add): la etiqueta lo dice.
function etiquetaPreparar(seccion: Seccion, n: number): string {
  if (seccion === 'conflict') return n > 1 ? `Marcar ${n} como resueltos` : 'Marcar como resuelto'
  return n > 1 ? `Preparar ${n} archivos` : 'Preparar'
}

function entradaPreparar(
  items: ContextMenuEntry[],
  seccion: Seccion,
  objetivo: string[],
  manejadores: ManejadoresArchivo
): void {
  const n = objetivo.length
  if (!manejadores.onStage || !manejadores.onStageMany) return
  items.push({
    icon: <IconoPreparar />,
    label: etiquetaPreparar(seccion, n),
    onClick: () =>
      n > 1 ? manejadores.onStageMany?.(objetivo) : manejadores.onStage?.(objetivo[0])
  })
}

// Excluir solo afecta a lo que git AÚN NO rastrea: con un objetivo mixto se actúa
// sobre los nuevos y la etiqueta lo dice con números, sin obligar a afinar la selección.
function entradasExcluir(
  items: ContextMenuEntry[],
  nuevos: string[],
  manejadores: ManejadoresArchivo
): void {
  if (!manejadores.onIgnorar || nuevos.length === 0) return
  const cuantos = nuevos.length
  items.push(SEP)
  items.push({
    icon: <IconoExcluir />,
    label: cuantos > 1 ? `Agregar ${cuantos} a .gitignore` : 'Agregar a .gitignore',
    onClick: () => manejadores.onIgnorar?.(nuevos, false)
  })
  items.push({
    icon: <IconoExcluir />,
    label: cuantos > 1 ? `Agregar ${cuantos} a exclusión local` : 'Agregar a exclusión local',
    onClick: () => manejadores.onIgnorar?.(nuevos, true)
  })
}

// En CONFLICTO no se ofrece descartar: el descarte lo revertiría a HEAD sin
// confirmar y se llevaría el lado entrante del merge. Ahí lo que hay es que resolver.
function entradaDescartar(
  items: ContextMenuEntry[],
  seccion: Seccion,
  objetivo: string[],
  manejadores: ManejadoresArchivo
): void {
  const n = objetivo.length
  if (seccion === 'conflict' || !manejadores.onDiscardChanges || !manejadores.onDiscardMany) return
  items.push(SEP)
  items.push({
    icon: <IconoDescartar />,
    label: n > 1 ? `Descartar ${n} archivos…` : 'Descartar cambios…',
    onClick: () =>
      n > 1 ? manejadores.onDiscardMany?.(objetivo) : manejadores.onDiscardChanges?.(objetivo[0]),
    danger: true
  })
}
