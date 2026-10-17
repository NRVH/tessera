// =============================================================================
// Textos del mosaico de agentes: la barra de la barra de título (resumen, distribuciones, selector
// y fichas) y el aviso de un proyecto que ya tiene casilla. Puro y sin JSX.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

interface TextoPreset {
  nombre: string
  ayuda: string
}

export const txMosaico = crearTextos(
  {
    aria: 'Mosaico de agentes',
    agentes: (n: number) => (n === 1 ? '1 agente' : `${n} agentes`),
    trabajando: (n: number) => ` · ${n} trabajando`,
    selectorTitulo:
      'Elegir qué proyectos se ven (como mucho seis). Los que no están en marcha arrancan al añadirlos, y los dormidos levantan antes su contenedor.',
    casillasDe: (n: number, total: number) => `${n} de ${total}`,
    dormido: ' (dormido)',
    distribucion: 'Distribución',
    presets: {
      auto: {
        nombre: 'Automático',
        ayuda: 'Automático: reparte según cuántas haya y la forma de la ventana'
      } as TextoPreset,
      cuadricula: {
        nombre: 'Cuadrícula',
        ayuda: 'Cuadrícula: filas y columnas equilibradas (4 en 2 × 2, 6 en 3 × 2), aunque Automático prefiera otra forma'
      },
      columnas: { nombre: 'Columnas', ayuda: 'Columnas: todas lado a lado' },
      filas: { nombre: 'Filas', ayuda: 'Filas: todas una debajo de otra' },
      principal: {
        nombre: 'Principal y pila',
        ayuda: 'Principal y pila: la primera grande a la izquierda y las demás apiladas a la derecha'
      }
    },
    avisoTitulo: (nombre: string) => `«${nombre}» no cabe en esta ventana: se usa Automático hasta que haya sitio.`,
    avisoAria: (nombre: string) => `${nombre} no cabe: se usa Automático`,
    casillaAVista: 'Casilla a la vista',
    yaTieneTerminal: 'Ese proyecto ya tiene terminal',
    yaTieneTerminalDetalle: (nombre: string) => `«${nombre}» se está viendo en otra casilla; te llevo a ella.`
  },
  {
    aria: 'Agent mosaic',
    agentes: (n: number) => (n === 1 ? '1 agent' : `${n} agents`),
    trabajando: (n: number) => ` · ${n} working`,
    selectorTitulo:
      'Choose which projects are shown (six at most). Those not running start when added, and sleeping ones bring up their container first.',
    casillasDe: (n: number, total: number) => `${n} of ${total}`,
    dormido: ' (asleep)',
    distribucion: 'Layout',
    presets: {
      auto: {
        nombre: 'Automatic',
        ayuda: 'Automatic: arranges them by how many there are and the shape of the window'
      },
      cuadricula: {
        nombre: 'Grid',
        ayuda: 'Grid: balanced rows and columns (4 in 2 × 2, 6 in 3 × 2), even if Automatic prefers another shape'
      },
      columnas: { nombre: 'Columns', ayuda: 'Columns: all side by side' },
      filas: { nombre: 'Rows', ayuda: 'Rows: all one below the other' },
      principal: {
        nombre: 'Main and stack',
        ayuda: 'Main and stack: the first one large on the left and the rest stacked on the right'
      }
    },
    avisoTitulo: (nombre: string) => `“${nombre}” does not fit in this window: Automatic is used until there is room.`,
    avisoAria: (nombre: string) => `${nombre} does not fit: Automatic is used`,
    casillaAVista: 'Tile in view',
    yaTieneTerminal: 'That project already has a terminal',
    yaTieneTerminalDetalle: (nombre: string) => `“${nombre}” is already shown in another tile; taking you to it.`
  }
)
