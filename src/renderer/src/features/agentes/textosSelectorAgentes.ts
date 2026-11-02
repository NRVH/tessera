// =============================================================================
// Textos del selector de agentes (pestañas o desplegable), de su menú de mostrar y ocultar, del
// aviso con «Deshacer» y de la lista del perfil que se gestiona en Configuración › Agentes.
// Puro y sin JSX. Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txSelector = crearTextos(
  {
    anadir: 'Añadir un agente propio (por su comando)…',
    anadirTitulo: 'Añadir un agente propio (por su comando)',
    gestionar: 'Ordenar y ocultar agentes en Configuración…',
    oculto: (nombre: string) => `${nombre} oculto`,
    pistaOculto: 'Vuelve a mostrarlo con el clic derecho en las pestañas de agente o en Configuración › Agentes.',
    deshacer: 'Deshacer',
    noCaben: 'Agentes que no caben',
    elegir: 'Elegir agente',
    ultimoVisible: 'Tiene que quedar al menos un agente a la vista',
    perfil: (perfil: string) => `Los del perfil «${perfil}»: el orden y lo oculto valen para todos sus proyectos.`,
    sinPerfil: 'No hay ningún perfil abierto.',
    modo: { serie: 'De serie', nativo: 'Nativo', docker: 'Docker' },
    asa: (nombre: string) => `Arrastra (o ↑/↓) para ordenar ${nombre}`,
    mostrar: (nombre: string) => `Mostrar ${nombre}`,
    ocultar: (nombre: string) => `Ocultar ${nombre}`,
    editar: (nombre: string) => `Editar ${nombre}`,
    eliminar: (nombre: string) => `Eliminar ${nombre}`,
    anadirEn: (nativo: boolean) => `Se añade a ${nativo ? 'todos los proyectos, en todos los perfiles' : 'todos los proyectos de este perfil'}`,
    selector: 'Selector de agentes',
    selectorAyuda: 'Pestañas en la cabecera del agente, o un desplegable que ocupa menos.',
    pestanas: 'Pestañas',
    lista: 'Lista'
  },
  {
    anadir: 'Add custom agent (by command)…',
    anadirTitulo: 'Add custom agent (by command)',
    gestionar: 'Reorder and hide agents in Settings…',
    oculto: (nombre: string) => `${nombre} hidden`,
    pistaOculto: 'Show it again by right-clicking the agent tabs or in Settings › Agents.',
    deshacer: 'Undo',
    noCaben: 'Agents that do not fit',
    elegir: 'Choose agent',
    ultimoVisible: 'At least one agent must stay visible',
    perfil: (perfil: string) => `Agents of the profile “${perfil}”: the order and visibility apply to all its projects.`,
    sinPerfil: 'No profile is open.',
    modo: { serie: 'Built-in', nativo: 'Native', docker: 'Docker' },
    asa: (nombre: string) => `Drag (or ↑/↓) to reorder ${nombre}`,
    mostrar: (nombre: string) => `Show ${nombre}`,
    ocultar: (nombre: string) => `Hide ${nombre}`,
    editar: (nombre: string) => `Edit ${nombre}`,
    eliminar: (nombre: string) => `Delete ${nombre}`,
    anadirEn: (nativo: boolean) => `It is added to ${nativo ? 'all projects, in all profiles' : 'all of this profile’s projects'}`,
    selector: 'Agent selector',
    selectorAyuda: 'Tabs in the agent header, or a drop-down that takes less space.',
    pestanas: 'Tabs',
    lista: 'List'
  }
)
