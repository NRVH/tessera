// =============================================================================
// La PRESENTACIÓN del formulario de conexión por motor: filas, etiquetas, placeholders,
// anchos y ayudas (`presentaciones`), y los textos de los campos opcionales. Las reglas
// (obligatorios, excluyentes, qué se descarta) son del descriptor de `shared/motores/`.
// Puro, para fijarlo bajo `node` (`test-campos-conexion.mts`).
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import { limpiarDestinoBd } from '../../../../shared/destinoBd.ts'
import { idiomaActual } from '../../../../shared/i18n.ts'
import { AUTENTICACIONES, descriptor, etiquetaMotor, usaOpcional } from '../../../../shared/motores/index.ts'
import {
  descomponerUriMongo,
  descomponerUriMysql,
  descomponerUriPostgres,
  descomponerUriRedis,
  validarBaseRedis,
  validarOpcionesFormularioMongo
} from '../../../../shared/uriConexion.ts'
import type { DbAutenticacion, DbMotor, DbTls } from '../../../../shared/db-ipc.ts'
import type { DefCampo, EsquemaUri, OpcionAutenticacion, PresentacionMotor } from './camposConexionTipos.ts'
import { txConexionCampos } from './textosConexionCampos.ts'

/**
 * Lo que dice cada autenticación en el selector. Sin el nombre de un sistema operativo a
 * mano (una cuenta de dominio funciona desde cualquiera), y el del producto sale del
 * registro (`etiquetaMotor`), como exige `test:motores-sueltos`. `Record`: una
 * autenticación nueva no compila sin su etiqueta.
 */
export function etiquetasAutenticacion(): Readonly<Record<DbAutenticacion, string>> {
  const t = txConexionCampos()
  return { sql: t.autenticacionSql(etiquetaMotor('sqlserver')), ntlm: t.autenticacionNtlm }
}

/** Las opciones del selector de autenticación, en el orden de `AUTENTICACIONES`. */
function opcionesAutenticacion(): readonly OpcionAutenticacion[] {
  const etiquetas = etiquetasAutenticacion()
  return AUTENTICACIONES.map((a) => ({ valor: a, etiqueta: etiquetas[a] }))
}

/**
 * La etiqueta de la casilla del certificado. Es también lo que CITA el mensaje del main cuando
 * «Probar» no pudo verificar el certificado (`src/tdb/sqlserverComun.cjs`), y por esa cita la
 * reconoce `proponeConfiarCertificado`: el test lo cruza con el .cjs.
 */
export const etiquetaConfiarCertificado = (): string => txConexionCampos().confiarCertificado

/**
 * Las citas con que el main puede nombrar la casilla: la etiqueta de cada idioma entre las comillas de
 * ese idioma, porque el mensaje lo escribe el main en el idioma con el que arrancó.
 */
const CITAS_CONFIAR_CERTIFICADO: readonly string[] = ['«Confiar en el certificado del servidor»', '“Trust the server certificate”']

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
  const mensaje = r.mensaje
  return CITAS_CONFIAR_CERTIFICADO.some((cita) => mensaje.includes(cita))
}

/**
 * El placeholder de usuario y contraseña en un alta: «opcional» con un motor que ofrece
 * credenciales sin exigirlas (el usuario en `opcionales`); `undefined` en los demás.
 */
export function placeholderCredencial(motor: DbMotor): string | undefined {
  return usaOpcional(descriptor(motor), 'user') ? txConexionCampos().opcional : undefined
}

/** La base de un motor de claves EN VIVO: la validación del main sobre el valor que se guarda (limpio). */
const validarBaseClaves = (valor: string): string | null => validarBaseRedis(limpiarDestinoBd(valor))

function construirPresentaciones(): Readonly<Record<DbMotor, PresentacionMotor>> {
  const t = txConexionCampos()
  const HOST: DefCampo = { campo: 'host', tipo: 'texto', etiqueta: t.host, placeholder: '10.0.0.1', ancho: 'crece' }
  const PUERTO: DefCampo = { campo: 'port', tipo: 'puerto', etiqueta: t.puerto, ancho: 'puerto' }
  const HOST_MONGO: DefCampo = { ...HOST, ayuda: t.ayudaHostMongo }

  const URI_MONGO: EsquemaUri = { ejemplo: t.uriMongoEjemplo, ayuda: t.uriMongoAyuda, descomponer: descomponerUriMongo }
  const URI_REDIS: EsquemaUri = { ejemplo: t.uriRedisEjemplo, ayuda: t.uriRedisAyuda, descomponer: descomponerUriRedis }
  const URI_POSTGRES: EsquemaUri = { ejemplo: t.uriPostgresEjemplo, ayuda: t.uriPostgresAyuda, descomponer: descomponerUriPostgres }
  const URI_MYSQL: EsquemaUri = { ejemplo: t.uriMysqlEjemplo, ayuda: t.uriMysqlAyuda, descomponer: descomponerUriMysql }

  /** El cifrado tras las credenciales, con la etiqueta de su primera casilla. */
  const filaCifrado = (etiqueta: string): DefCampo[] => [
    { campo: 'tls', tipo: 'cifrado', etiqueta, etiquetaConfiar: t.confiarCertificado, ancho: 'crece', ayuda: t.ayudaCifrado }
  ]

  return {
    oracle: {
      filas: [
        [HOST, PUERTO],
        [
          { campo: 'database', tipo: 'texto', etiqueta: 'Service Name', placeholder: 'ORCL', ancho: 'crece' },
          { campo: 'sid', tipo: 'texto', etiqueta: 'SID', ancho: 'medio' }
        ]
      ],
      filasTrasCredenciales: [
        [{ campo: 'tls', tipo: 'cifrado', etiqueta: t.cifrarTcps, etiquetaConfiar: null, ancho: 'crece', ayuda: t.ayudaCifradoOracle }]
      ],
      ayudasExcluyentes: [t.ayudaServiceNameSid]
    },
    postgres: {
      filas: [
        [HOST, PUERTO],
        [{ campo: 'database', tipo: 'texto', etiqueta: t.baseDeDatos, placeholder: t.phBaseMiBase, ancho: 'crece' }]
      ],
      filasTrasCredenciales: [filaCifrado(t.cifrarSsl)],
      ayudasExcluyentes: [],
      uri: URI_POSTGRES
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
          { campo: 'database', tipo: 'texto', etiqueta: t.baseDeDatos, placeholder: t.phBaseOpcionalTodas, ancho: 'crece' },
          { campo: 'instancia', tipo: 'texto', etiqueta: t.instancia, placeholder: t.opcional, ancho: 'medio', ayuda: t.ayudaInstancia }
        ],
        [
          { campo: 'autenticacion', tipo: 'eleccion', etiqueta: t.autenticacion, ancho: 'crece', opciones: opcionesAutenticacion() },
          { campo: 'dominio', tipo: 'texto', etiqueta: t.dominio, placeholder: t.phDominio, ancho: 'medio' }
        ]
      ],
      filasTrasCredenciales: [filaCifrado(t.cifrar)],
      ayudasExcluyentes: []
    },
    // La base opcional: en MySQL la base es el esquema, y el árbol enseña todas las visibles.
    mysql: {
      filas: [
        [HOST, PUERTO],
        [{ campo: 'database', tipo: 'texto', etiqueta: t.baseDeDatos, placeholder: t.opcional, ancho: 'crece', ayuda: t.ayudaBaseMysql }]
      ],
      filasTrasCredenciales: [filaCifrado(t.cifrarTls)],
      ayudasExcluyentes: [],
      uri: URI_MYSQL
    },
    mongodb: presentacionMongo(t, HOST_MONGO, PUERTO, filaCifrado(t.cifrarTls), URI_MONGO),
    redis: presentacionRedis(t, HOST, PUERTO, filaCifrado(t.cifrarTls), URI_REDIS)
  }
}

type TextosCampos = ReturnType<typeof txConexionCampos>

// La base opcional (sin ella, el árbol empieza en las bases que el usuario puede leer) y el
// SRV bajo host y puerto (apaga el puerto); usuario y contraseña, sin exigirlos.
function presentacionMongo(
  t: TextosCampos,
  host: DefCampo,
  puerto: DefCampo,
  cifrado: DefCampo[],
  uri: EsquemaUri
): PresentacionMotor {
  return {
    filas: [
      [host, puerto],
      [{ campo: 'srv', tipo: 'casilla', etiqueta: t.srvEtiqueta, ancho: 'crece', ayuda: t.ayudaSrv }],
      [
        {
          campo: 'database',
          tipo: 'texto',
          etiqueta: t.baseDeDatos,
          placeholder: t.phBaseOpcionalTodas,
          ancho: 'crece',
          ayuda: t.ayudaBaseDocumentos
        }
      ]
    ],
    filasTrasCredenciales: [
      cifrado,
      [
        {
          campo: 'authSource',
          tipo: 'texto',
          etiqueta: t.baseAutenticacion,
          placeholder: t.phAuthSource,
          ancho: 'crece',
          ayuda: t.ayudaAuthSource
        }
      ],
      [
        {
          campo: 'opcionesUri',
          tipo: 'texto',
          etiqueta: t.opcionesUri,
          placeholder: t.phOpcionesUri,
          ancho: 'crece',
          ayuda: t.ayudaOpcionesUri,
          // La función del main, sin el `authSource`, que tiene campo propio.
          validar: validarOpcionesFormularioMongo
        }
      ]
    ],
    ayudasExcluyentes: [],
    uri
  }
}

// El NÚMERO de la base va en el `database` de siempre (la forma en disco no cambia); vacío es la 0.
function presentacionRedis(
  t: TextosCampos,
  host: DefCampo,
  puerto: DefCampo,
  cifrado: DefCampo[],
  uri: EsquemaUri
): PresentacionMotor {
  return {
    filas: [
      [host, puerto],
      [
        {
          campo: 'database',
          tipo: 'texto',
          etiqueta: t.baseNumero,
          placeholder: '0',
          ancho: 'medio',
          ayuda: t.ayudaBaseClaves,
          validar: validarBaseClaves
        }
      ]
    ],
    filasTrasCredenciales: [cifrado],
    ayudasExcluyentes: [],
    uri
  }
}

let memo: { idioma: string; valor: Readonly<Record<DbMotor, PresentacionMotor>> } | null = null

/**
 * La presentación de cada motor en el idioma activo. `Record<DbMotor, …>`: un motor sin ella no
 * compila. Se construye al pedirla y se reutiliza mientras el idioma no cambie (identidad estable
 * de las filas, que el diálogo usa como clave).
 */
export function presentaciones(): Readonly<Record<DbMotor, PresentacionMotor>> {
  const idioma = idiomaActual()
  if (memo === null || memo.idioma !== idioma) memo = { idioma, valor: construirPresentaciones() }
  return memo.valor
}
