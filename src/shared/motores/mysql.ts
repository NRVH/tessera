// =============================================================================
// Descriptor de MYSQL Y MARIADB (MySQL 8.0+, MariaDB 10.4+; driver `mysql2`): un solo motor para
// los dos servidores, que hablan el mismo protocolo. La base es el esquema, la base de la conexión
// es opcional y el solo lectura lo impone el servidor con la sesión y la transacción en READ ONLY.
// Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-mysql.md
// =============================================================================

import type { DescriptorMotor } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { destinoDeRed } from './destinoRed.ts'

/** Las bases del propio servidor: el árbol las atenúa y la rejilla no las edita. */
const BASES_SISTEMA_MYSQL: readonly string[] = ['information_schema', 'mysql', 'performance_schema', 'sys']

export const MYSQL: DescriptorMotor<'mysql'> = definirMotor({
  id: 'mysql',
  etiqueta: 'MySQL / MariaDB',
  familia: 'sql',
  conexion: {
    puertoPorDefecto: 3306,
    obligatorios: ['alias', 'host', 'port', 'user'],
    // La base es opcional: sin ella la sesión no tiene base por defecto y el árbol enseña
    // igual todas las que el usuario puede ver.
    opcionales: ['database', 'tls', 'tunelSsh'],
    tlsPorDefecto: { cifrar: false, confiarCertificado: false },
    tlsSoloCifrando: true,
    excluyentes: [],
    faltaDestino: {},
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoDeRed
  },
  sql: {
    dialecto: 'mysql',
    lenguajeConsola: 'mysql',
    lenguajeFuente: 'mysql',
    // Sin `paramTypes`: el `?` posicional ya lo entiende el dialecto de la librería.
    formateador: { dialecto: 'mysql', parametros: null }
  },
  catalogo: {
    carpetas: ['tabla', 'vista', 'rutina', 'disparador', 'evento'],
    pseudoEsquemaPublico: null,
    esquemaImplicito: null,
    tieneDblinks: false,
    // Las bases del sistema se comparan sin distinguir caja: el servidor las enseña en
    // minúsculas, pero en Windows y macOS los nombres de base no distinguen caja.
    esquemaDelSistema: (nombre) => BASES_SISTEMA_MYSQL.indexOf(nombre.toLowerCase()) >= 0,
    nivelBases: 'ninguno'
  },
  sesion: {
    versionMinima: 8,
    paginado: { rejilla: 'limitOffset', relectura: 'limitOffset', admitidas: ['limitOffset'] },
    paginasInestablesSinOrden: true,
    lectorPorId: false,
    mantenerCursor: false,
    candadoSoloLectura: 'envoltorioRollback',
    // `USE` no es transaccional: un ROLLBACK no devuelve a la base de antes.
    esquemaTransaccional: false,
    // `USE` de una base que no existe falla en el acto (1049).
    fijarEsquemaValida: true,
    // Los avisos del servidor se piden con SHOW WARNINGS: un viaje que solo se hace si la
    // respuesta dice que los hay.
    salidaServidorSiempre: true,
    // El plan depende de los valores, que viajan en la sentencia preparada.
    explainPideValores: true,
    // Un DDL confirma lo pendiente antes de ejecutarse.
    ddlConfirmaImplicito: true,
    // Un procedimiento puede hacer COMMIT por dentro.
    rutinasConfirmanPorDentro: true,
    identidadSinPk: 'unicaNoNula',
    // Uno por conexión: Detener es un `KILL QUERY` desde otra conexión.
    procesoPorSesion: false
  }
})
