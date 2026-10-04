// =============================================================================
// Descriptor de SQL SERVER (2012 y superior, driver `tedious`): árbol híbrido, solo lectura impuesto
// por Tessera (`clasificadorYEnvoltorio`), cifrado verificado por defecto y paginado sin cursores
// vivos. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-sqlserver.md
// =============================================================================

import type { DescriptorMotor, DestinoConexion, FormaDestino } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { nunca } from '../nunca.ts'
import { esAutenticacion, pideDominio } from './autenticacion.ts'

/**
 * Esquemas que el árbol atenúa y la rejilla no edita (la regla que no pregunta al
 * servidor): los del sistema y los de los roles fijos de base de datos.
 */
const ESQUEMAS_SISTEMA_SQLSERVER: readonly string[] = [
  'sys',
  'INFORMATION_SCHEMA',
  'guest',
  'db_owner',
  'db_accessadmin',
  'db_securityadmin',
  'db_ddladmin',
  'db_backupoperator',
  'db_datareader',
  'db_datawriter',
  'db_denydatareader',
  'db_denydatawriter'
]

/** El servidor: `host\instancia` con instancia con nombre (sin puerto: lo da SQL Browser), o `host:puerto`. */
function servidorDe(c: DestinoConexion): string {
  return c.instancia ? `${c.host}\\${c.instancia}` : `${c.host}:${c.port}`
}

/** El usuario como lo escribe SQL Server: `DOMINIO\usuario` con una cuenta de dominio. */
function usuarioDe(c: DestinoConexion): string {
  const a = esAutenticacion(c.autenticacion) ? c.autenticacion : 'sql'
  return pideDominio(a) && c.dominio ? `${c.dominio}\\${c.user}` : c.user
}

/**
 * El destino legible de una conexión de SQL Server, en la forma pedida (`FormaDestino`):
 *   - 'completo'   `host:puerto/base`, `host\INST/base`, o sin `/base` si no la fija;
 *   - 'conUsuario' `usuario@` + 'completo' (`DOMINIO\usuario@…` con cuenta de dominio);
 *   - 'ls'         `host:puerto/base` o `host\INST/base` (la base puede ir vacía: `host:1433/`),
 *                  la columna DESTINO de `tdb ls` (copia en `src/tdb/motores.cjs`);
 *   - 'breve'      solo el host.
 */
export function destinoSqlServer(c: DestinoConexion, forma: FormaDestino): string {
  const base = c.database ? `/${c.database}` : ''
  switch (forma) {
    case 'completo':
      return servidorDe(c) + base
    case 'conUsuario':
      return `${usuarioDe(c)}@${servidorDe(c)}${base}`
    case 'ls':
      return `${servidorDe(c)}/${c.database || ''}`
    case 'breve':
      return c.host
    default:
      return nunca(forma, 'destinoSqlServer')
  }
}

export const SQLSERVER: DescriptorMotor<'sqlserver'> = definirMotor({
  id: 'sqlserver',
  etiqueta: 'SQL Server',
  familia: 'sql',
  conexion: {
    puertoPorDefecto: 1433,
    obligatorios: ['alias', 'host', 'port', 'user'],
    opcionales: ['database', 'instancia', 'autenticacion', 'dominio', 'tls'],
    excluyentes: [],
    faltaDestino: {},
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoSqlServer
  },
  sql: {
    dialecto: 'sqlserver',
    lenguajeConsola: 'sql',
    lenguajeFuente: 'sql',
    formateador: { dialecto: 'transactsql', parametros: null }
  },
  catalogo: {
    carpetas: ['tabla', 'vista', 'rutina', 'sinonimo', 'secuencia', 'tipo'],
    pseudoEsquemaPublico: null,
    esquemaImplicito: 'dbo',
    tieneDblinks: false,
    esquemaDelSistema: (nombre) => ESQUEMAS_SISTEMA_SQLSERVER.indexOf(nombre) >= 0,
    nivelBases: 'sinBaseFija'
  },
  sesion: {
    versionMinima: 11,
    paginado: { rejilla: 'offsetFetch', relectura: 'offsetFetch', admitidas: ['offsetFetch'] },
    paginasInestablesSinOrden: true,
    lectorPorId: false,
    mantenerCursor: false,
    candadoSoloLectura: 'clasificadorYEnvoltorio',
    esquemaTransaccional: false,
    fijarEsquemaValida: true,
    salidaServidorSiempre: true,
    explainPideValores: false,
    ddlConfirmaImplicito: false,
    rutinasConfirmanPorDentro: true,
    identidadSinPk: 'unicaNoNula',
    procesoPorSesion: false
  }
})
