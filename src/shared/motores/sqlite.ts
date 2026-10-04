// =============================================================================
// Descriptor de SQLITE (el de `node:sqlite` del Node de Electron): el primer motor de archivo. Sin
// servidor, puerto ni credenciales; un proceso por consola y paginado sin cursores vivos.
// Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-sqlite.md
// =============================================================================

import type { DescriptorMotor, DestinoConexion, FormaDestino } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { nunca } from '../nunca.ts'

/**
 * El destino legible de una SQLite: el NOMBRE del archivo, en todas las formas (no hay
 * host, puerto ni usuario que añadir). Nunca la ruta: el renderer no la tiene, y `tdb ls`
 * (su copia en `motores.cjs`) enseña solo el nombre a propósito. Sin nombre (una entrada
 * que aún no lo trae), cadena vacía, como el destino de red sin base.
 */
export function destinoDeArchivo(c: DestinoConexion, forma: FormaDestino): string {
  const nombre = c.archivoVisible || ''
  switch (forma) {
    case 'completo':
    case 'conUsuario':
    case 'ls':
    case 'breve':
      return nombre
    default:
      return nunca(forma, 'destinoDeArchivo')
  }
}

export const SQLITE: DescriptorMotor<'sqlite'> = definirMotor({
  id: 'sqlite',
  etiqueta: 'SQLite',
  familia: 'sql',
  conexion: {
    puertoPorDefecto: null,
    obligatorios: ['alias', 'archivo'],
    opcionales: [],
    excluyentes: [],
    faltaDestino: {},
    // Lo que quedó escrito con un motor de red en el borrador no viaja.
    descartarAlGuardar: ['host', 'database', 'sid'],
    usaClientes: false,
    extensionesArchivo: ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3'],
    credenciales: 'ninguna',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoDeArchivo
  },
  sql: {
    dialecto: 'sqlite',
    lenguajeConsola: 'tessera-sqlite-sql',
    lenguajeFuente: 'sql',
    formateador: { dialecto: 'sqlite', parametros: null }
  },
  catalogo: {
    carpetas: ['tabla', 'vista', 'tablaVirtual'],
    pseudoEsquemaPublico: null,
    esquemaImplicito: 'main',
    tieneDblinks: false,
    esquemaDelSistema: () => false,
    nivelBases: 'ninguno'
  },
  sesion: {
    versionMinima: 3,
    paginado: { rejilla: 'keyset', relectura: 'keyset', admitidas: ['keyset', 'limitOffset'] },
    paginasInestablesSinOrden: true,
    lectorPorId: false,
    mantenerCursor: false,
    candadoSoloLectura: 'autorizador',
    esquemaTransaccional: false,
    fijarEsquemaValida: true,
    salidaServidorSiempre: true,
    explainPideValores: false,
    ddlConfirmaImplicito: false,
    rutinasConfirmanPorDentro: false,
    identidadSinPk: 'rowid',
    procesoPorSesion: true
  }
})
