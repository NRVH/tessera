// =============================================================================
// La PRESENTACIÓN del formulario de conexión por motor: filas, etiquetas, placeholders,
// anchos y ayudas (`PRESENTACION`), y los textos de los campos opcionales. Las reglas
// (obligatorios, excluyentes, qué se descarta) son del descriptor de `shared/motores/`.
// Puro, para fijarlo bajo `node` (`test-campos-conexion.mts`).
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import { limpiarDestinoBd } from '../../../../shared/destinoBd.ts'
import { AUTENTICACIONES, descriptor, etiquetaMotor, usaOpcional } from '../../../../shared/motores/index.ts'
import {
  descomponerUriMongo,
  descomponerUriRedis,
  validarBaseRedis,
  validarOpcionesFormularioMongo
} from '../../../../shared/uriConexion.ts'
import type { DbAutenticacion, DbMotor, DbTls } from '../../../../shared/db-ipc.ts'
import type { DefCampo, EsquemaUri, OpcionAutenticacion, PresentacionMotor } from './camposConexionTipos.ts'

const HOST: DefCampo = { campo: 'host', tipo: 'texto', etiqueta: 'Host', placeholder: '10.0.0.1', ancho: 'crece' }
const PUERTO: DefCampo = { campo: 'port', tipo: 'puerto', etiqueta: 'Puerto', ancho: 'puerto' }

/**
 * Lo que dice cada autenticación en el selector. Sin el nombre de un sistema operativo a
 * mano (una cuenta de dominio funciona desde cualquiera), y el del producto sale del
 * registro (`etiquetaMotor`), como exige `test:motores-sueltos`. `Record`: una
 * autenticación nueva no compila sin su etiqueta.
 */
export const ETIQUETA_AUTENTICACION: Readonly<Record<DbAutenticacion, string>> = {
  sql: `Usuario de ${etiquetaMotor('sqlserver')}`,
  ntlm: 'Cuenta de dominio (NTLM)'
}

/** Las opciones del selector de autenticación, en el orden de `AUTENTICACIONES`. */
export const OPCIONES_AUTENTICACION: readonly OpcionAutenticacion[] = AUTENTICACIONES.map((a) => ({
  valor: a,
  etiqueta: ETIQUETA_AUTENTICACION[a]
}))

/** La ayuda de la instancia: con ella el puerto no se usa. */
export const AYUDA_INSTANCIA =
  'Con instancia con nombre, el puerto no se usa: lo resuelve el servicio SQL Browser del servidor (UDP 1434). Sin ella, la instancia por defecto en el puerto.'

/**
 * La etiqueta de la casilla del certificado. Es también lo que CITA el mensaje del main
 * cuando «Probar» no pudo verificar el certificado (`src/tdb/sqlserverComun.cjs`), y por
 * esa cita la reconoce `proponeConfiarCertificado`: el test lo cruza con el .cjs.
 */
export const ETIQUETA_CONFIAR_CERTIFICADO = 'Confiar en el certificado del servidor'

/**
 * ¿Se ofrece «Confiar en el certificado y probar» tras una prueba? Solo si falló por el
 * certificado (el mensaje cita la casilla), el motor tiene cifrado y la casilla aún no está
 * marcada. `DbTestResult` no trae el código del error: se reconoce por la cita.
 */
export function proponeConfiarCertificado(
  motor: DbMotor,
  r: { ok: boolean; mensaje: string } | null,
  tls: DbTls | undefined
): boolean {
  if (r === null || r.ok || !usaOpcional(descriptor(motor), 'tls')) return false
  if (tls?.confiarCertificado === true) return false
  return r.mensaje.includes(`«${ETIQUETA_CONFIAR_CERTIFICADO}»`)
}

/** La ayuda del cifrado: qué hace cada casilla. */
export const AYUDA_CIFRADO =
  'El certificado se verifica contra las autoridades de confianza de tu equipo. Si el servidor usa uno propio (autofirmado), marca «Confiar en el certificado del servidor»: se cifra igual, pero sin comprobar quién es el servidor.'

/** La ayuda bajo la base de un motor de documentos: qué pasa sin ella y que las credenciales no se exigen. */
export const AYUDA_BASE_DOCUMENTOS =
  'Sin base, el árbol enseña todas las que el usuario puede leer. Usuario y contraseña son opcionales: sin ellos se conecta sin autenticar.'

/** La ayuda bajo la base de un motor de claves: es un número, y la contraseña vale sin usuario. */
export const AYUDA_BASE_CLAVES =
  'La base con la que se abre la conexión (0 si va vacía); el árbol enseña todas. Usuario y contraseña son opcionales, y la contraseña vale sin usuario.'

/** La ayuda del SRV: qué es, y que con él el puerto no se usa y se cifra. */
export const AYUDA_SRV =
  'Para Atlas y los clústeres que publican sus miembros en DNS: el host es el nombre del clúster, el puerto no se usa y la conexión se cifra salvo que desmarques el cifrado.'

/** La ayuda de las opciones de la URI: qué va y qué no. */
export const AYUDA_OPCIONES_URI =
  'Lo que iría detrás del «?» de la URI (clave=valor&clave=valor). El cifrado, las credenciales y la base de autenticación no: van en sus campos.'

/** Bajo «Base de autenticación» de MongoDB. */
export const AYUDA_AUTH_SOURCE =
  'Dónde se creó el usuario (authSource). Vacío: la base de datos de arriba, como mongosh. Un usuario de «admin» necesita «admin» aquí si escribes otra base.'

const URI_MONGO: EsquemaUri = {
  ejemplo: 'mongodb://usuario:clave@host:27017/base?authSource=admin',
  ayuda: 'Rellena host, puerto, usuario, contraseña, base, SRV, cifrado y opciones. La URI no se guarda: solo sus campos.',
  descomponer: descomponerUriMongo
}

const URI_REDIS: EsquemaUri = {
  ejemplo: 'redis://usuario:clave@host:6379/0',
  ayuda:
    'Rellena host, puerto, usuario, contraseña, base y cifrado (rediss:// cifra). La URI no se guarda: solo sus campos; lo de detrás del «?» se deja fuera.',
  descomponer: descomponerUriRedis
}

/** La base de un motor de claves EN VIVO: la validación del main sobre el valor que se guarda (limpio). */
const validarBaseClaves = (valor: string): string | null => validarBaseRedis(limpiarDestinoBd(valor))

/**
 * El placeholder de usuario y contraseña en un alta: «opcional» con un motor que ofrece
 * credenciales sin exigirlas (el usuario en `opcionales`); `undefined` en los demás.
 */
export function placeholderCredencial(motor: DbMotor): string | undefined {
  return usaOpcional(descriptor(motor), 'user') ? 'opcional' : undefined
}

/** El cifrado tras las credenciales, con la etiqueta de su primera casilla. */
function filaCifrado(etiqueta: string): DefCampo[] {
  return [{ campo: 'tls', tipo: 'cifrado', etiqueta, etiquetaConfiar: ETIQUETA_CONFIAR_CERTIFICADO, ancho: 'crece', ayuda: AYUDA_CIFRADO }]
}

/** La presentación de cada motor. `Record<DbMotor, …>`: un motor sin ella no compila. */
export const PRESENTACION: Readonly<Record<DbMotor, PresentacionMotor>> = {
  oracle: {
    filas: [
      [HOST, PUERTO],
      [
        { campo: 'database', tipo: 'texto', etiqueta: 'Service Name', placeholder: 'ORCL', ancho: 'crece' },
        { campo: 'sid', tipo: 'texto', etiqueta: 'SID', ancho: 'medio' }
      ]
    ],
    ayudasExcluyentes: ['Service Name o SID, no los dos. Las 11g heredadas suelen ir por SID.']
  },
  postgres: {
    filas: [
      [HOST, PUERTO],
      [{ campo: 'database', tipo: 'texto', etiqueta: 'Base de datos', placeholder: 'mi_base', ancho: 'crece' }]
    ],
    ayudasExcluyentes: []
  },
  // Sin filas de texto: el archivo es el selector que el diálogo pinta por `deArchivo`.
  sqlite: {
    filas: [],
    ayudasExcluyentes: []
  },
  // La base opcional (sin ella, el árbol tiene un nivel «Bases») con la instancia al lado, y
  // la autenticación con su dominio (solo con cuenta de dominio: `campoVisible`).
  sqlserver: {
    filas: [
      [HOST, PUERTO],
      [
        { campo: 'database', tipo: 'texto', etiqueta: 'Base de datos', placeholder: 'opcional: sin ella, todas', ancho: 'crece' },
        { campo: 'instancia', tipo: 'texto', etiqueta: 'Instancia', placeholder: 'opcional', ancho: 'medio', ayuda: AYUDA_INSTANCIA }
      ],
      [
        { campo: 'autenticacion', tipo: 'eleccion', etiqueta: 'Autenticación', ancho: 'crece', opciones: OPCIONES_AUTENTICACION },
        { campo: 'dominio', tipo: 'texto', etiqueta: 'Dominio', placeholder: 'EMPRESA', ancho: 'medio' }
      ]
    ],
    filasTrasCredenciales: [filaCifrado('Cifrar la conexión')],
    ayudasExcluyentes: []
  },
  // La base opcional (sin ella, el árbol empieza en las bases que el usuario puede leer) y el
  // SRV bajo host y puerto (apaga el puerto); usuario y contraseña, sin exigirlos.
  mongodb: {
    filas: [
      [HOST, PUERTO],
      [{ campo: 'srv', tipo: 'casilla', etiqueta: 'DNS SRV (mongodb+srv)', ancho: 'crece', ayuda: AYUDA_SRV }],
      [{ campo: 'database', tipo: 'texto', etiqueta: 'Base de datos', placeholder: 'opcional: sin ella, todas', ancho: 'crece', ayuda: AYUDA_BASE_DOCUMENTOS }]
    ],
    filasTrasCredenciales: [
      filaCifrado('Cifrar la conexión (TLS)'),
      [
        {
          campo: 'authSource',
          tipo: 'texto',
          etiqueta: 'Base de autenticación',
          placeholder: 'opcional: admin',
          ancho: 'crece',
          ayuda: AYUDA_AUTH_SOURCE
        }
      ],
      [
        {
          campo: 'opcionesUri',
          tipo: 'texto',
          etiqueta: 'Opciones de la URI',
          placeholder: 'opcional: replicaSet=rs0',
          ancho: 'crece',
          ayuda: AYUDA_OPCIONES_URI,
          // La función del main, sin el `authSource`, que tiene campo propio.
          validar: validarOpcionesFormularioMongo
        }
      ]
    ],
    ayudasExcluyentes: [],
    uri: URI_MONGO
  },
  // El NÚMERO de la base va en el `database` de siempre (la forma en disco no cambia); vacío es la 0.
  redis: {
    filas: [
      [HOST, PUERTO],
      [
        {
          campo: 'database',
          tipo: 'texto',
          etiqueta: 'Base (número)',
          placeholder: '0',
          ancho: 'medio',
          ayuda: AYUDA_BASE_CLAVES,
          validar: validarBaseClaves
        }
      ]
    ],
    filasTrasCredenciales: [filaCifrado('Cifrar la conexión (TLS)')],
    ayudasExcluyentes: [],
    uri: URI_REDIS
  }
}
