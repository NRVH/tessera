// =============================================================================
// Descriptor de POSTGRESQL (12 y superior): destino de red con la base obligatoria y catálogo con
// esquemas. El tope de espera de bloqueos para toda la transacción (`SET LOCAL lock_timeout`) es de
// `sesionPostgres.ts`. Neutral y ES2020.
// =============================================================================

import type { DescriptorMotor } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { destinoDeRed } from './destinoRed.ts'

/** Esquemas del sistema que la rejilla no edita (la regla que no pregunta al servidor). */
const ESQUEMAS_SISTEMA_POSTGRES: readonly string[] = ['pg_catalog', 'information_schema', 'pg_toast']

export const POSTGRES: DescriptorMotor<'postgres'> = definirMotor({
  id: 'postgres',
  etiqueta: 'PostgreSQL',
  familia: 'sql',
  conexion: {
    puertoPorDefecto: 5432,
    obligatorios: ['alias', 'host', 'port', 'database', 'user'],
    opcionales: [],
    excluyentes: [],
    faltaDestino: { database: 'PostgreSQL necesita el nombre de la base.' },
    // El SID que quedó escrito con Oracle elegido no se borra al cambiar de motor
    // (volver a Oracle no debe perderlo): se descarta al guardar (`camposConexion.ts`).
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoDeRed
  },
  sql: {
    dialecto: 'postgres',
    lenguajeConsola: 'pgsql',
    lenguajeFuente: 'pgsql',
    // Sin `paramTypes`: los `$1` ya los entiende el dialecto de la librería.
    formateador: { dialecto: 'postgresql', parametros: null }
  },
  catalogo: {
    carpetas: ['tabla', 'vista', 'vistaMaterializada', 'tablaForanea', 'rutina', 'secuencia', 'tipo'],
    pseudoEsquemaPublico: null,
    // El `search_path` por defecto es `"$user", public`: lo de public se ve sin calificar.
    esquemaImplicito: 'public',
    tieneDblinks: false,
    esquemaDelSistema: (nombre) => ESQUEMAS_SISTEMA_POSTGRES.indexOf(nombre) >= 0,
    nivelBases: 'ninguno'
  },
  sesion: {
    versionMinima: 12,
    paginado: { rejilla: 'limitOffset', relectura: 'limitOffset', admitidas: ['limitOffset'] },
    paginasInestablesSinOrden: true,
    lectorPorId: false,
    mantenerCursor: true,
    candadoSoloLectura: 'envoltorioRollback',
    // Un ROLLBACK deshace el `SET search_path` hecho dentro de la transacción.
    esquemaTransaccional: true,
    // `set_config('search_path', …)` acepta cualquier nombre: no falla, lo salta.
    fijarEsquemaValida: false,
    // Los NOTICE llegan con la propia respuesta: no cuestan un viaje.
    salidaServidorSiempre: true,
    // El planificador usa los valores, y el servidor los exige.
    explainPideValores: true,
    ddlConfirmaImplicito: false,
    rutinasConfirmanPorDentro: false,
    identidadSinPk: 'unicaNoNula',
    // Uno por conexión: la cancelación es del protocolo (`pg_cancel_backend`).
    procesoPorSesion: false
  }
})
