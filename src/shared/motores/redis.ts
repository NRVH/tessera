// =============================================================================
// Descriptor de REDIS (standalone): el primer motor de la familia `claves`. Sin usuario obligatorio,
// `database` es el número de la base, TLS sin cifrar por defecto y solo lectura por lista blanca.
// Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-mongodb-y-redis.md
// =============================================================================

import type { DescriptorMotor } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { destinoDeRedUsuarioOpcional } from './destinoRed.ts'

export const REDIS: DescriptorMotor<'redis'> = definirMotor({
  id: 'redis',
  etiqueta: 'Redis',
  familia: 'claves',
  conexion: {
    puertoPorDefecto: 6379,
    obligatorios: ['alias', 'host', 'port'],
    opcionales: ['user', 'database', 'tls'],
    tlsPorDefecto: { cifrar: false, confiarCertificado: false },
    excluyentes: [],
    faltaDestino: {},
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoDeRedUsuarioOpcional
  },
  claves: {
    basesPorDefecto: 16,
    candadoSoloLectura: 'listaBlanca'
  }
})
