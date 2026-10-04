// =============================================================================
// Descriptor de MONGODB (4.4 y superior): el primer motor de la familia `documentos`. Sin usuario
// obligatorio, base opcional (árbol híbrido), TLS sin cifrar por defecto y solo lectura por lista
// blanca. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-mongodb-y-redis.md
// =============================================================================

import type { DescriptorMotor } from './tipos.ts'
import { definirMotor } from './definir.ts'
import { destinoDeRedUsuarioOpcional } from './destinoRed.ts'

export const MONGODB: DescriptorMotor<'mongodb'> = definirMotor({
  id: 'mongodb',
  etiqueta: 'MongoDB',
  familia: 'documentos',
  conexion: {
    puertoPorDefecto: 27017,
    obligatorios: ['alias', 'host', 'port'],
    opcionales: ['user', 'database', 'tls', 'srv', 'opcionesUri'],
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
  documentos: {
    nivelBases: 'sinBaseFija',
    candadoSoloLectura: 'listaBlanca'
  }
})
