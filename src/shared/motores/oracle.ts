// =============================================================================
// Descriptor de ORACLE (11.2 y superior; thin y thick). Las cuentas del sistema
// (`ESQUEMAS_SISTEMA_ORACLE`) viven aquí para que el descriptor responda `esquemaDelSistema` sin
// importar el main; la espera de bloqueos fila a fila es de `sesionOracle.ts`. Neutral y ES2020.
// =============================================================================

import type { DescriptorMotor } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { destinoDeRed } from './destinoRed.ts'

/**
 * Cuentas que crea Oracle (ver la procedencia en `catalogoSql.ts`). En 12.1+ lo dice
 * `all_users.oracle_maintained`; en la 11.2 y en la rejilla, esta lista.
 */
export const ESQUEMAS_SISTEMA_ORACLE: readonly string[] = [
  'ANONYMOUS',
  'APEX_PUBLIC_USER',
  'APPQOSSYS',
  'ASMSNMP',
  'AUDSYS',
  'CTXSYS',
  'DBSFWUSER',
  'DBSNMP',
  'DGPDB_INT',
  'DIP',
  'DMSYS',
  'DVF',
  'DVSYS',
  'EXFSYS',
  'FLOWS_FILES',
  'GGSYS',
  'GSMADMIN_INTERNAL',
  'GSMCATUSER',
  'GSMROOTUSER',
  'GSMUSER',
  'LBACSYS',
  'MDDATA',
  'MDSYS',
  'MGMT_VIEW',
  'OJVMSYS',
  'OLAPSYS',
  'ORACLE_OCM',
  'ORDDATA',
  'ORDPLUGINS',
  'ORDSYS',
  'OUTLN',
  'OWBSYS',
  'OWBSYS_AUDIT',
  'REMOTE_SCHEDULER_AGENT',
  'SI_INFORMTN_SCHEMA',
  'SPATIAL_CSW_ADMIN_USR',
  'SPATIAL_WFS_ADMIN_USR',
  'SYS',
  'SYS$UMF',
  'SYSBACKUP',
  'SYSDG',
  'SYSKM',
  'SYSMAN',
  'SYSRAC',
  'SYSTEM',
  'TSMSYS',
  'WKPROXY',
  'WKSYS',
  'WK_TEST',
  'WMSYS',
  'XDB',
  'XS$NULL'
]

/** ¿Es una cuenta de Oracle? Lista fija más las versionadas (`APEX_040200`, `FLOWS_030000`). */
export function esEsquemaSistemaOracle(nombre: string): boolean {
  return ESQUEMAS_SISTEMA_ORACLE.indexOf(nombre) >= 0 || /^(APEX|FLOWS)_\d+$/.test(nombre)
}

export const ORACLE: DescriptorMotor<'oracle'> = definirMotor({
  id: 'oracle',
  etiqueta: 'Oracle',
  familia: 'sql',
  conexion: {
    puertoPorDefecto: 1521,
    obligatorios: ['alias', 'host', 'port', 'user'],
    opcionales: [],
    // Service Name o SID, uno y solo uno: las 11g heredadas suelen ir por SID.
    excluyentes: [
      {
        campos: ['database', 'sid'],
        alMenosUno: true,
        siNinguno: 'Oracle necesita un Service Name o un SID.',
        siVarios: 'Indica Service Name O SID, no ambos.'
      }
    ],
    faltaDestino: {},
    descartarAlGuardar: [],
    usaClientes: true,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoDeRed
  },
  sql: {
    dialecto: 'oracle',
    // El lenguaje propio de la consola (`lenguajeConsola.ts`): el `sql` de Monaco es
    // T-SQL y marcaba `[x]` y `@@x` como sintaxis válida.
    lenguajeConsola: 'tessera-oracle-sql',
    // En la pestaña de fuente, `sql`: `plsql` no existe en Monaco.
    lenguajeFuente: 'sql',
    // Los binds de Oracle son `:x`, `:1` y `:"x"`; sin decirlo, sql-formatter los parte.
    formateador: { dialecto: 'plsql', parametros: { numbered: [':'], named: [':'], quoted: [':'] } }
  },
  catalogo: {
    carpetas: [
      'tabla',
      'vista',
      'vistaMaterializada',
      'rutina',
      'paquete',
      'secuencia',
      'sinonimo',
      'tipoObjeto',
      'tipoColeccion',
      'disparador'
    ],
    pseudoEsquemaPublico: 'PUBLIC',
    esquemaImplicito: null,
    tieneDblinks: true,
    esquemaDelSistema: esEsquemaSistemaOracle,
    nivelBases: 'ninguno'
  },
  sesion: {
    // Sin versión se toma la MÁS VIEJA soportada: el SQL de la 11.2 funciona en todas.
    versionMinima: 11,
    paginado: { rejilla: 'cursor', relectura: 'rownum', admitidas: ['cursor', 'rownum'] },
    paginasInestablesSinOrden: false,
    lectorPorId: true,
    mantenerCursor: false,
    candadoSoloLectura: 'transaccionSoloLectura',
    // ALTER SESSION no es transaccional.
    esquemaTransaccional: false,
    // ALTER SESSION SET CURRENT_SCHEMA a uno que no existe: ORA-01435.
    fijarEsquemaValida: true,
    // DBMS_OUTPUT.GET_LINES es un viaje: solo en las clases que pueden escribir salida.
    salidaServidorSiempre: false,
    // EXPLAIN PLAN no hace «bind peeking» y trata todo bind como VARCHAR2.
    explainPideValores: false,
    ddlConfirmaImplicito: true,
    rutinasConfirmanPorDentro: true,
    identidadSinPk: 'rowid',
    // Uno por conexión: `initOracleClient` es uno por proceso y la cancelación es del driver.
    procesoPorSesion: false
  }
})
