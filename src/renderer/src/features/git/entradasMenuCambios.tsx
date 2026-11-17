// =============================================================================
// entradasMenuCambios: las entradas del menú contextual de una fila de Cambios,
// en grupos por consecuencia: [abrir] | [preparar/quitar] | [excluir] | [descartar].
// Descartar borra trabajo sin commitear: va al final, aislado y en rojo, y nunca
// en un conflicto. Los separadores huérfanos los poda el propio MenuContextual.
// Ver docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import {
  IconoAbrir,
  IconoAbrirFuera,
  IconoDescartar,
  IconoExcluir,
  IconoPreparar
} from '../../comun/iconosMenu'
import { SEP, type EntradaMenuContextual } from '../../comun/MenuContextual'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { Seccion } from './modelo/estadoRepos'
import { existeEnDisco } from './modelo/resolverDestinoDiffWorktree'
import { nombreArchivoDe } from './modelo/rutasArchivo'
import { txGit } from './textos.ts'
import type { ManejadoresArchivo, ObjetivoMenu } from './modelo/seccionesCambios'

/** Las entradas del menú para el objetivo ya calculado al abrirlo, en el proyecto `raiz`. */
export function entradasMenuCambios(
  { cambio, seccion, objetivo, nuevos }: ObjetivoMenu,
  manejadores: ManejadoresArchivo,
  raiz: string
): EntradaMenuContextual[] {
  const elementos = entradasAbrir(cambio, manejadores, raiz)
  if (seccion === 'staged') {
    entradaQuitar(elementos, objetivo, manejadores)
    return elementos
  }
  entradaPreparar(elementos, seccion, objetivo, manejadores)
  entradasExcluir(elementos, nuevos, manejadores)
  entradaDescartar(elementos, seccion, objetivo, manejadores)
  return elementos
}

// Abrir actúa SIEMPRE sobre la fila sola, aunque haya 8 marcadas; un archivo
// borrado no se puede abrir ni revelar: el ítem se ve, apagado.
function entradasAbrir(
  cambio: ObjetivoMenu['cambio'],
  manejadores: ManejadoresArchivo,
  raiz: string
): EntradaMenuContextual[] {
  const ruta = cambio?.ruta ?? null
  const enDisco = cambio !== null && existeEnDisco(cambio)
  return [
    {
      icon: <IconoAbrir />,
      label: txGit().abrirArchivo,
      onClick: () => {
        if (ruta) manejadores.onAbrirArchivo({ ruta, nombre: nombreArchivoDe(ruta) })
      },
      disabled: !enDisco
    },
    {
      icon: <IconoAbrirFuera />,
      label: txGit().mostrarEn(nombresSistema(window.tessera.plataforma).gestorArchivos),
      onClick: () => {
        if (ruta) void window.tessera.files.revelar({ raiz, ruta })
      },
      disabled: !enDisco
    },
    SEP
  ]
}

function entradaQuitar(
  elementos: EntradaMenuContextual[],
  objetivo: string[],
  manejadores: ManejadoresArchivo
): void {
  const n = objetivo.length
  if (!manejadores.onUnstage || !manejadores.onUnstageVarios) return
  elementos.push({
    icon: <IconoDescartar />,
    label: n > 1 ? txGit().quitarNTitulo(n) : txGit().quitarDePreparados,
    onClick: () =>
      n > 1 ? manejadores.onUnstageVarios?.(objetivo) : manejadores.onUnstage?.(objetivo[0])
  })
}

// En un conflicto, preparar ES marcarlo resuelto (git add): la etiqueta lo dice.
function etiquetaPreparar(seccion: Seccion, n: number): string {
  const t = txGit()
  if (seccion === 'conflict') return n > 1 ? t.marcarResueltosN(n) : t.marcarResuelto
  return n > 1 ? t.prepararNTitulo(n) : t.preparar
}

function entradaPreparar(
  elementos: EntradaMenuContextual[],
  seccion: Seccion,
  objetivo: string[],
  manejadores: ManejadoresArchivo
): void {
  const n = objetivo.length
  if (!manejadores.onStage || !manejadores.onStageVarios) return
  elementos.push({
    icon: <IconoPreparar />,
    label: etiquetaPreparar(seccion, n),
    onClick: () =>
      n > 1 ? manejadores.onStageVarios?.(objetivo) : manejadores.onStage?.(objetivo[0])
  })
}

// Excluir solo afecta a lo que git AÚN NO rastrea: con un objetivo mixto se actúa
// sobre los nuevos y la etiqueta lo dice con números, sin obligar a afinar la selección.
function entradasExcluir(
  elementos: EntradaMenuContextual[],
  nuevos: string[],
  manejadores: ManejadoresArchivo
): void {
  if (!manejadores.onIgnorar || nuevos.length === 0) return
  const cuantos = nuevos.length
  const t = txGit()
  elementos.push(SEP)
  elementos.push({
    icon: <IconoExcluir />,
    label: cuantos > 1 ? t.agregarGitignoreN(cuantos) : t.agregarGitignore,
    onClick: () => manejadores.onIgnorar?.(nuevos, false)
  })
  elementos.push({
    icon: <IconoExcluir />,
    label: cuantos > 1 ? t.agregarExclusionLocalN(cuantos) : t.agregarExclusionLocal,
    onClick: () => manejadores.onIgnorar?.(nuevos, true)
  })
}

// En CONFLICTO no se ofrece descartar: el descarte lo revertiría a HEAD sin
// confirmar y se llevaría el lado entrante del merge. Ahí lo que hay es que resolver.
function entradaDescartar(
  elementos: EntradaMenuContextual[],
  seccion: Seccion,
  objetivo: string[],
  manejadores: ManejadoresArchivo
): void {
  const n = objetivo.length
  if (seccion === 'conflict' || !manejadores.onDescartarCambios || !manejadores.onDescartarVarios) return
  elementos.push(SEP)
  elementos.push({
    icon: <IconoDescartar />,
    label: n > 1 ? txGit().descartarArchivosN(n) : txGit().descartarCambios,
    onClick: () =>
      n > 1 ? manejadores.onDescartarVarios?.(objetivo) : manejadores.onDescartarCambios?.(objetivo[0]),
    danger: true
  })
}
