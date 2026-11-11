// =============================================================================
// Lo que cada pestaña de la tira de terminales necesita para arrastrarse: sus manejadores y sus
// clases durante el gesto. Lo comparten la pestaña local y la SSH, que se reordenan en una sola tira.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

import type { MutableRefObject } from 'react'
import type { ArrastrePestanas } from '../../comun/useArrastrePestanas'

/** La tira a la que pertenece la pestaña. */
export interface TiraArrastrable {
  arrastre: ArrastrePestanas
  nodos: MutableRefObject<Map<string, HTMLDivElement>>
  /** Con una sola pestaña no hay nada que reordenar. */
  reordenable: boolean
}

/** Las props de arrastre de la pestaña. Mientras se renombra, el ratón es para el texto. */
export function propsArrastre(t: TiraArrastrable, clave: string, editando: boolean) {
  return {
    ref: (el: HTMLDivElement | null): void => {
      if (el) t.nodos.current.set(clave, el)
      else t.nodos.current.delete(clave)
    },
    draggable: t.reordenable && !editando,
    onDragStart: (e: React.DragEvent): void => t.arrastre.empezarArrastre(e, clave),
    onDragOver: (e: React.DragEvent): void => {
      e.stopPropagation()
      t.arrastre.sobrevolar(e, clave)
    },
    onDrop: (e: React.DragEvent): void => {
      e.stopPropagation()
      t.arrastre.soltar(e)
    },
    onDragEnd: t.arrastre.terminarArrastre
  }
}

/** Las clases de la pestaña durante el gesto: la que viaja y la raya. */
export function claseArrastre(a: ArrastrePestanas, clave: string): string {
  const rayaAntes = a.raya !== null && a.raya.antesDe === clave
  const rayaDespues = a.raya !== null && a.raya.antesDe === null && clave === a.ultima
  return `${a.arrastrada === clave ? ' arrastrando' : ''}${rayaAntes ? ' soltar-antes' : ''}${rayaDespues ? ' soltar-despues' : ''}`
}
