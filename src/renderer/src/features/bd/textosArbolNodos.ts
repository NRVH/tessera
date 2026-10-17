// =============================================================================
// Textos de los nodos del árbol de BD que arma el aplanador: los vacíos de cada nivel (esquemas,
// objetos, detalle, colecciones, claves), la fila de «Cargar más claves» y los datos de una
// colección. Español e inglés con las mismas claves; se leen al usarse, nunca al cargar el módulo.
// Sin JSX ni DOM: lo cargan las pruebas con `node`.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txArbolNodos = crearTextos(
  {
    vacio: 'Vacío',
    cargando: 'Cargando…',
    ningunEsquemaVisible: 'Ningún esquema visible',
    ningunaBaseVisible: 'Ninguna base visible',
    sinAccesoBase: 'Sin acceso a esta base',
    sinObjetos: 'Sin objetos',
    sinDetalle: 'Sin detalle',
    sinColecciones: 'Sin colecciones',
    claves: {
      sinClaves: 'Sin claves',
      cargarMas: 'Cargar más claves',
      seguirBuscando: 'Seguir buscando',
      cargando: 'Cargando más claves…',
      reintentar: 'Reintentar'
    },
    ningunaClaveCasa: (patron: string) => `Ninguna clave casa con ${patron}`,
    ningunaClaveDeTipo: (tipo: string) => `Ninguna clave de tipo ${tipo}`,
    ningunaClaveDeTipoCasa: (tipo: string, patron: string) => `Ninguna clave de tipo ${tipo} casa con ${patron}`,
    noSePudieronCargarMas: (m: string) => `No se pudieron cargar más: ${m}`,
    ningunaTodavia: (vueltas: number) =>
      `Ninguna todavía${vueltas > 0 ? ` tras ${vueltas} ${vueltas === 1 ? 'vuelta' : 'vueltas'}` : ''}`,
    cargadas: (cuenta: string) => `${cuenta} cargadas`,
    metaVista: 'vista',
    metaSerieTemporal: 'serie temporal',
    respuestaInesperada: 'Respuesta inesperada del proceso principal.',
    sinExplorador: 'Esta ventana no tiene el explorador de este motor.'
  },
  {
    vacio: 'Empty',
    cargando: 'Loading…',
    ningunEsquemaVisible: 'No visible schemas',
    ningunaBaseVisible: 'No visible databases',
    sinAccesoBase: 'No access to this database',
    sinObjetos: 'No objects',
    sinDetalle: 'No details',
    sinColecciones: 'No collections',
    claves: {
      sinClaves: 'No keys',
      cargarMas: 'Load more keys',
      seguirBuscando: 'Keep searching',
      cargando: 'Loading more keys…',
      reintentar: 'Retry'
    },
    ningunaClaveCasa: (patron: string) => `No key matches ${patron}`,
    ningunaClaveDeTipo: (tipo: string) => `No keys of type ${tipo}`,
    ningunaClaveDeTipoCasa: (tipo: string, patron: string) => `No keys of type ${tipo} match ${patron}`,
    noSePudieronCargarMas: (m: string) => `Could not load more: ${m}`,
    ningunaTodavia: (vueltas: number) =>
      `None yet${vueltas > 0 ? ` after ${vueltas} ${vueltas === 1 ? 'pass' : 'passes'}` : ''}`,
    cargadas: (cuenta: string) => `${cuenta} loaded`,
    metaVista: 'view',
    metaSerieTemporal: 'time series',
    respuestaInesperada: 'Unexpected response from the main process.',
    sinExplorador: 'This window does not have the explorer for this engine.'
  }
)
