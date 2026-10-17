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
import { txGit } from './textos.ts'
import type { ManejadoresArchivo, ObjetivoMenu } from './modelo/seccionesCambios'

/** Las entradas del menú para el objetivo ya calculado al abrirlo, en el proyecto `raiz`. */
export function entradasMenuCambios(
  { change, seccion, objetivo, nuevos }: ObjetivoMenu,
  manejadores: ManejadoresArchivo,
  raiz: string
): ContextMenuEntry[] {
  const items = entradasAbrir(change, manejadores, raiz)
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
  manejadores: ManejadoresArchivo,
  raiz: string
): ContextMenuEntry[] {
  const path = change?.path ?? null
  const enDisco = change !== null && existeEnDisco(change)
  return [
    {
      icon: <IconoAbrir />,
      label: txGit().abrirArchivo,
      onClick: () => {
        if (path) manejadores.onOpenFile({ path, name: nameOf(path) })
      },
      disabled: !enDisco
    },
    {
      icon: <IconoAbrirFuera />,
      label: txGit().abrirEnExplorador,
      onClick: () => {
        if (path) void window.tessera.files.reveal({ raiz, path })
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
    label: n > 1 ? txGit().quitarNTitulo(n) : txGit().quitarDePreparados,
    onClick: () =>
      n > 1 ? manejadores.onUnstageMany?.(objetivo) : manejadores.onUnstage?.(objetivo[0])
  })
}

// En un conflicto, preparar ES marcarlo resuelto (git add): la etiqueta lo dice.
function etiquetaPreparar(seccion: Seccion, n: number): string {
  const t = txGit()
  if (seccion === 'conflict') return n > 1 ? t.marcarResueltosN(n) : t.marcarResuelto
  return n > 1 ? t.prepararNTitulo(n) : t.preparar
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
  const t = txGit()
  items.push(SEP)
  items.push({
    icon: <IconoExcluir />,
    label: cuantos > 1 ? t.agregarGitignoreN(cuantos) : t.agregarGitignore,
    onClick: () => manejadores.onIgnorar?.(nuevos, false)
  })
  items.push({
    icon: <IconoExcluir />,
    label: cuantos > 1 ? t.agregarExclusionLocalN(cuantos) : t.agregarExclusionLocal,
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
    label: n > 1 ? txGit().descartarArchivosN(n) : txGit().descartarCambios,
    onClick: () =>
      n > 1 ? manejadores.onDiscardMany?.(objetivo) : manejadores.onDiscardChanges?.(objetivo[0]),
    danger: true
  })
}
