// =============================================================================
// Textos del popover del «N de M» y del selector de la consola, por lo que elige (esquemas o bases).
// Español e inglés con las mismas claves; se leen al usarse, nunca al cargar el módulo.
// Sin JSX ni DOM: lo cargan las pruebas con `node`.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txNivelBases = crearTextos(
  {
    popoverEsquemas: {
      cabecera: 'Esquemas de',
      visibles: 'Esquemas visibles',
      filtrar: 'Filtrar esquemas',
      cargando: 'Cargando esquemas…',
      lista: 'Esquemas',
      todos: 'Todos los esquemas',
      ninguno: 'Ningún esquema coincide.',
      delSistema: 'esquema del sistema'
    },
    popoverBases: {
      cabecera: 'Bases de',
      visibles: 'Bases visibles',
      filtrar: 'Filtrar bases',
      cargando: 'Cargando bases…',
      lista: 'Bases',
      todos: 'Todas las bases',
      ninguno: 'Ninguna base coincide.',
      delSistema: 'base del sistema'
    },
    visiblesDe: (visibles: string, alias: string) => `${visibles} de ${alias}`,
    sinonimosPublicos: ' (sinónimos públicos)',
    porDefectoExtra: ' (por defecto)',
    mostrar: (nombre: string) => `Mostrar ${nombre}`,
    porDefectoFila: (nombre: string | null) => `Por defecto (${nombre})`,
    nDeM: (n: number, m: number) => `${n} de ${m}`,
    aplicando: 'Aplicando…',
    pistaTeclas: 'Enter aplica · Esc cancela',
    esquemaDeLaConexion: (p: string | null) => (p ? `Esquema de la conexión (${p})` : 'Esquema de la conexión'),
    esquemaCabecera: 'Esquema de la consola en',
    esquemaEspera: 'Espera a que termine la ejecución para cambiar el esquema',
    esquemaActualTitulo: (a: string) => `Esquema: ${a}. Pulsa para cambiar`,
    esquemaSinActualTitulo: 'Esquema de la consola. Pulsa para cambiar',
    esquemaDato: (a: string) => `Esquema actual: ${a}`,
    esquemaCambiando: 'Cambiando el esquema…',
    esquemaEtiquetaBoton: (a: string | null) => (a ? `Esquema de la consola: ${a}` : 'Esquema de la consola'),
    baseDeLaConexion: (p: string | null) => (p ? `Base de la conexión (${p})` : 'Base de la conexión'),
    baseCabecera: 'Base de la consola en',
    baseEspera: 'Espera a que termine la ejecución para cambiar de base',
    baseActualTitulo: (a: string) => `Base: ${a}. Pulsa para cambiar (USE)`,
    baseSinActualTitulo: 'Base de la consola. Pulsa para cambiar (USE)',
    baseDato: (a: string) => `Base actual: ${a}`,
    baseCambiando: 'Cambiando de base…',
    baseEtiquetaBoton: (a: string | null) => (a ? `Base de la consola: ${a}` : 'Base de la consola')
  },
  {
    popoverEsquemas: {
      cabecera: 'Schemas of',
      visibles: 'Visible schemas',
      filtrar: 'Filter schemas',
      cargando: 'Loading schemas…',
      lista: 'Schemas',
      todos: 'All schemas',
      ninguno: 'No schema matches.',
      delSistema: 'system schema'
    },
    popoverBases: {
      cabecera: 'Databases of',
      visibles: 'Visible databases',
      filtrar: 'Filter databases',
      cargando: 'Loading databases…',
      lista: 'Databases',
      todos: 'All databases',
      ninguno: 'No database matches.',
      delSistema: 'system database'
    },
    visiblesDe: (visibles: string, alias: string) => `${visibles} of ${alias}`,
    sinonimosPublicos: ' (public synonyms)',
    porDefectoExtra: ' (default)',
    mostrar: (nombre: string) => `Show ${nombre}`,
    porDefectoFila: (nombre: string | null) => `Default (${nombre})`,
    nDeM: (n: number, m: number) => `${n} of ${m}`,
    aplicando: 'Applying…',
    pistaTeclas: 'Enter applies · Esc cancels',
    esquemaDeLaConexion: (p: string | null) => (p ? `Connection schema (${p})` : 'Connection schema'),
    esquemaCabecera: 'Console schema in',
    esquemaEspera: 'Wait for the execution to finish to change the schema',
    esquemaActualTitulo: (a: string) => `Schema: ${a}. Click to change`,
    esquemaSinActualTitulo: 'Console schema. Click to change',
    esquemaDato: (a: string) => `Current schema: ${a}`,
    esquemaCambiando: 'Changing the schema…',
    esquemaEtiquetaBoton: (a: string | null) => (a ? `Console schema: ${a}` : 'Console schema'),
    baseDeLaConexion: (p: string | null) => (p ? `Connection database (${p})` : 'Connection database'),
    baseCabecera: 'Console database in',
    baseEspera: 'Wait for the execution to finish to change database',
    baseActualTitulo: (a: string) => `Database: ${a}. Click to change (USE)`,
    baseSinActualTitulo: 'Console database. Click to change (USE)',
    baseDato: (a: string) => `Current database: ${a}`,
    baseCambiando: 'Changing database…',
    baseEtiquetaBoton: (a: string | null) => (a ? `Console database: ${a}` : 'Console database')
  }
)
