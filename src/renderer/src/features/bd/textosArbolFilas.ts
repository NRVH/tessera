// =============================================================================
// Textos de las filas y del cuerpo del lateral de BD (`FilaArbolTexto`, `FilaArbolContenido`,
// `DbArbolCuerpo`): etiquetas de filas, insignias de esquemas, estados de sesión, búsqueda y vacíos.
// Español e inglés con las mismas claves; se leen al usarse, nunca al cargar el módulo.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txArbolFilas = crearTextos(
  {
    restriccion: {
      pk: 'clave primaria',
      unica: 'única',
      fk: 'clave foránea',
      check: 'check',
      exclusion: 'exclusión'
    },
    paraAbrir: (acorde: string) => `${acorde} para abrir`,
    invalidoNoCompila: 'Inválido: no compila',
    porDefectoColumna: (valor: string) => `Por defecto: ${valor}`,
    clavePrimaria: (pk: string) => `Clave primaria (${pk})`,
    sinCaducidad: 'Sin caducidad',
    caduca: (cuando: string) => `Caduca en ${cuando}`,
    unicoLinea: 'Único',
    filtradaPorTooltip: (base: string, patron: string) => `${base} · filtrada por ${patron}`,
    clavesCargadas: (prefijo: string, cuenta: string, n: number) =>
      `${prefijo}* · ${cuenta} ${n === 1 ? 'clave cargada' : 'claves cargadas'}`,
    consolas: 'consolas',
    porDefecto: 'por defecto',
    sobre: (tabla: string) => `sobre ${tabla}`,
    invalido: 'inválido',
    unico: ' único',
    filtradaPor: (patron: string) => `Filtrada por ${patron}`,
    soloClavesDeTipo: (tipo: string) => `Solo claves de tipo ${tipo}`,
    ttl: 'Tiempo que le quedaba al listarla (TTL)',
    sinAcceso: 'sin acceso',
    conectada: 'Conectada',
    conectando: 'Conectando…',
    sesionPerdida: 'Sesión perdida',
    srConectada: ', conectada',
    srConectando: ', conectando',
    motivoEspera: 'la base aún no responde',
    srSesionPerdida: ', sesión perdida',
    error: 'Error',
    nDeM: (n: number, m: number) => `${n} de ${m}`,
    insigniaTitulo: (bases: boolean, n: number, m: number) =>
      `${bases ? 'Bases' : 'Esquemas'} visibles: ${n} de ${m}. Pulsa para elegirl${bases ? 'as' : 'os'}.`,
    insigniaAria: (bases: boolean, n: number, m: number) => `${bases ? 'Bases' : 'Esquemas'} visibles: ${n} de ${m}`,
    insigniaBaseTitulo: (n: number, m: number) => `Esquemas visibles: ${n} de ${m}. Pulsa para elegirlos.`,
    insigniaBaseAria: (base: string, n: number, m: number) => `Esquemas visibles de ${base}: ${n} de ${m}`,
    cerrarAviso: 'Cerrar el aviso',
    buscarPlaceholder: 'Buscar en lo cargado',
    buscarAria: 'Buscar en el árbol (solo lo ya cargado)',
    sinCoincidencias: 'Sin coincidencias',
    cerrarBusquedaTitulo: 'Cerrar la búsqueda (Esc)',
    cerrarBusqueda: 'Cerrar la búsqueda',
    listaAria: 'Bases de datos',
    sinPerfil: 'Sin perfil activo.',
    cargando: 'Cargando…',
    sinConexionesPerfil: 'Sin conexiones en este perfil.',
    nuevaConexion: 'Nueva conexión…'
  },
  {
    restriccion: {
      pk: 'primary key',
      unica: 'unique',
      fk: 'foreign key',
      check: 'check',
      exclusion: 'exclusion'
    },
    paraAbrir: (acorde: string) => `${acorde} to open`,
    invalidoNoCompila: 'Invalid: does not compile',
    porDefectoColumna: (valor: string) => `Default: ${valor}`,
    clavePrimaria: (pk: string) => `Primary key (${pk})`,
    sinCaducidad: 'No expiry',
    caduca: (cuando: string) => `Expires in ${cuando}`,
    unicoLinea: 'Unique',
    filtradaPorTooltip: (base: string, patron: string) => `${base} · filtered by ${patron}`,
    clavesCargadas: (prefijo: string, cuenta: string, n: number) =>
      `${prefijo}* · ${cuenta} ${n === 1 ? 'key loaded' : 'keys loaded'}`,
    consolas: 'consoles',
    porDefecto: 'default',
    sobre: (tabla: string) => `on ${tabla}`,
    invalido: 'invalid',
    unico: ' unique',
    filtradaPor: (patron: string) => `Filtered by ${patron}`,
    soloClavesDeTipo: (tipo: string) => `Only keys of type ${tipo}`,
    ttl: 'Time it had left when it was listed (TTL)',
    sinAcceso: 'no access',
    conectada: 'Connected',
    conectando: 'Connecting…',
    sesionPerdida: 'Session lost',
    srConectada: ', connected',
    srConectando: ', connecting',
    motivoEspera: 'the database has not answered yet',
    srSesionPerdida: ', session lost',
    error: 'Error',
    nDeM: (n: number, m: number) => `${n} of ${m}`,
    insigniaTitulo: (bases: boolean, n: number, m: number) =>
      `${bases ? 'Databases' : 'Schemas'} shown: ${n} of ${m}. Click to choose.`,
    insigniaAria: (bases: boolean, n: number, m: number) => `${bases ? 'Databases' : 'Schemas'} shown: ${n} of ${m}`,
    insigniaBaseTitulo: (n: number, m: number) => `Schemas shown: ${n} of ${m}. Click to choose.`,
    insigniaBaseAria: (base: string, n: number, m: number) => `Schemas shown for ${base}: ${n} of ${m}`,
    cerrarAviso: 'Dismiss the notice',
    buscarPlaceholder: 'Search what is loaded',
    buscarAria: 'Search the tree (only what is already loaded)',
    sinCoincidencias: 'No matches',
    cerrarBusquedaTitulo: 'Close search (Esc)',
    cerrarBusqueda: 'Close search',
    listaAria: 'Databases',
    sinPerfil: 'No active profile.',
    cargando: 'Loading…',
    sinConexionesPerfil: 'No connections in this profile.',
    nuevaConexion: 'New connection…'
  }
)
