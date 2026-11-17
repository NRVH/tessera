// =============================================================================
// Qué sobrevive a editar una conexión (puro). `AlmacenConexiones.actualizar` reconstruye el registro desde
// el formulario, que no conoce lo que el main aprendió (contraseña cifrada, verificación, orden, driver,
// esquemas visibles); cada cosa se conserva con su propia regla y lo que esta versión no gobierna
// sobrevive mientras la dirección no cambie. No muta sus argumentos.
// Decisiones: docs/decisiones/bd/conexiones-que-sobrevive-al-editar.md
// =============================================================================

import { esEntorno, type ConexionBd } from '../../shared/db-ipc.ts'

/** Forma persistida de una conexión: el DTO más lo que solo vive en disco. */
export interface ConexionPersistida extends Omit<ConexionBd, 'tieneSecreto' | 'verificada' | 'archivoVisible'> {
  /** Motor de archivo: la ruta canónica del archivo, que lee `tdb`. El DTO lleva solo su nombre. */
  archivo?: string
  /** Contraseña cifrada, en base64. Ausente = sin contraseña. */
  secretEnc?: string
  /** Momento de la última prueba buena (epoch ms). Ausente = nunca verificada. */
  verificadaEn?: number
  /** Posición dentro de su perfil (orden que fija el usuario arrastrando). */
  orden?: number
}

/**
 * Qué claves de un registro persistido gobierna esta versión (`true`); las demás son de otra versión y
 * se conservan tal cual. Es un `Record` completo a propósito: un campo nuevo sin decidir aquí no compila.
 * `secretoIlegible` es del DTO y esta versión nunca lo escribe.
 */
export const CLAVES_GOBERNADAS: Readonly<Record<keyof ConexionPersistida, boolean>> = {
  id: true,
  profileId: true,
  alias: true,
  motor: true,
  host: true,
  port: true,
  database: true,
  sid: true,
  user: true,
  archivo: true,
  instancia: true,
  autenticacion: true,
  dominio: true,
  tls: true,
  srv: true,
  opcionesUri: true,
  tunelSsh: true,
  topologiaRedis: true,
  bases: true,
  readonly: true,
  entorno: true,
  notas: true,
  driverId: true,
  esquemas: true,
  introspeccion: true,
  secretEnc: true,
  verificadaEn: true,
  orden: true,
  secretoIlegible: false
}

/** ¿La gobierna esta versión? (ver `CLAVES_GOBERNADAS`). */
export function esClaveGobernada(clave: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLAVES_GOBERNADAS, clave) && CLAVES_GOBERNADAS[clave as keyof ConexionPersistida]
}

/**
 * ¿Mismo servidor, sin usuario ni contraseña? Con un motor de archivo, el mismo archivo: dos grafías
 * sin canonizar cuentan como distintas, que es el lado seguro (se pierde la verificación).
 */
function mismoServidor(a: ConexionPersistida, b: ConexionPersistida): boolean {
  return (
    a.motor === b.motor &&
    a.host === b.host &&
    a.port === b.port &&
    a.database === b.database &&
    a.sid === b.sid &&
    a.archivo === b.archivo &&
    a.instancia === b.instancia &&
    a.srv === b.srv &&
    mismoTunel(a.tunelSsh, b.tunelSsh) &&
    mismaTopologia(a.topologiaRedis, b.topologiaRedis)
  )
}

/** ¿Misma topología de Redis? Por su contenido; ausente en las dos = un servidor en las dos. */
function mismaTopologia(a: ConexionPersistida['topologiaRedis'], b: ConexionPersistida['topologiaRedis']): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** ¿Mismo cifrado? Por sus dos valores y no por referencia. Ausente en los dos = igual. */
function mismoTls(a: ConexionPersistida['tls'], b: ConexionPersistida['tls']): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.cifrar === b.cifrar && a.confiarCertificado === b.confiarCertificado
}

/** ¿Mismo túnel SSH? El mismo host visto desde otro servidor SSH puede ser otra máquina. */
function mismoTunel(a: ConexionPersistida['tunelSsh'], b: ConexionPersistida['tunelSsh']): boolean {
  return (a?.conexionId ?? null) === (b?.conexionId ?? null)
}

/**
 * ¿Misma dirección? Motor, host y puerto (o el archivo): a qué máquina se llega y con qué protocolo,
 * sin la base, el SID ni el usuario. Decide si sobrevive lo que esta versión no gobierna.
 */
function mismaDireccion(a: ConexionPersistida, b: ConexionPersistida): boolean {
  return (
    a.motor === b.motor &&
    a.host === b.host &&
    a.port === b.port &&
    a.archivo === b.archivo &&
    a.instancia === b.instancia &&
    a.srv === b.srv &&
    mismoTunel(a.tunelSsh, b.tunelSsh) &&
    mismaTopologia(a.topologiaRedis, b.topologiaRedis)
  )
}

/** ¿Sigue igual todo lo que se probó (destino, túnel, autenticación, cifrado, usuario y contraseña)? */
function mismoDestinoProbado(previo: ConexionPersistida, registro: ConexionPersistida): boolean {
  return (
    previo.host === registro.host &&
    previo.port === registro.port &&
    previo.database === registro.database &&
    previo.sid === registro.sid &&
    previo.archivo === registro.archivo &&
    previo.instancia === registro.instancia &&
    previo.srv === registro.srv &&
    mismoTunel(previo.tunelSsh, registro.tunelSsh) &&
    mismaTopologia(previo.topologiaRedis, registro.topologiaRedis) &&
    previo.opcionesUri === registro.opcionesUri &&
    previo.autenticacion === registro.autenticacion &&
    previo.dominio === registro.dominio &&
    mismoTls(previo.tls, registro.tls) &&
    previo.user === registro.user &&
    previo.secretEnc === registro.secretEnc
  )
}

/** Lo que prueba «Probar»: el destino, la autenticación, el cifrado, el usuario y la contraseña. */
const CAMPOS_PROBADOS = [
  'motor',
  'host',
  'port',
  'database',
  'sid',
  'archivo',
  'instancia',
  'srv',
  'opcionesUri',
  'tunelSsh',
  'topologiaRedis',
  'autenticacion',
  'dominio',
  'tls',
  'user',
  'secretEnc'
] as const satisfies ReadonlyArray<keyof ConexionPersistida>

/**
 * Huella de lo que se probó (`CAMPOS_PROBADOS`, más estricta que `mismoDestinoProbado`: también el motor).
 * Si cambia mientras «Probar» está en vuelo, su resultado es del destino de antes y no se apunta.
 */
export function huellaDestinoProbado(c: ConexionPersistida): string {
  return JSON.stringify(CAMPOS_PROBADOS.map((k) => (c[k] === undefined ? [k] : [k, c[k]])))
}

/** Contraseña: `undefined` conserva la guardada, `''` la borra y un texto la sustituye (ya viene cifrada). */
function conservarContrasena(registro: ConexionPersistida, previo: ConexionPersistida, contrasena?: string): void {
  if (contrasena === undefined) {
    if (previo.secretEnc) registro.secretEnc = previo.secretEnc
    else delete registro.secretEnc
  } else if (contrasena === '') {
    delete registro.secretEnc
  }
}

/** Verificación y sitio en la lista: la primera solo si nada de lo probado cambió; el orden, siempre. */
function conservarVerificacionYOrden(registro: ConexionPersistida, previo: ConexionPersistida): void {
  if (mismoDestinoProbado(previo, registro) && previo.verificadaEn !== undefined) registro.verificadaEn = previo.verificadaEn
  else delete registro.verificadaEn
  if (previo.orden !== undefined) registro.orden = previo.orden
  else delete registro.orden
}

/**
 * Lo del explorador que el formulario no manda: esquemas y bases visibles si el motor no cambió, y la
 * foto de la introspección si son el mismo servidor y usuario. Un valor explícito de `nuevo` gana.
 */
function conservarDelExplorador(registro: ConexionPersistida, previo: ConexionPersistida, nuevo: ConexionPersistida): void {
  if (nuevo.esquemas === undefined) {
    if (previo.esquemas !== undefined && previo.motor === nuevo.motor) registro.esquemas = previo.esquemas
    else delete registro.esquemas
  }
  if (nuevo.bases === undefined) {
    if (previo.bases !== undefined && previo.motor === nuevo.motor) registro.bases = previo.bases
    else delete registro.bases
  }
  if (nuevo.introspeccion === undefined) {
    if (previo.introspeccion !== undefined && mismoServidor(previo, nuevo) && previo.user === nuevo.user) {
      registro.introspeccion = previo.introspeccion
    } else delete registro.introspeccion
  }
}

/**
 * @param previo   el registro guardado.
 * @param nuevo    el registro reconstruido desde el formulario, con `secretEnc` ya cifrado si `password` es un texto nuevo.
 * @param password `DatosEntradaConexionBd.password` tal cual: `undefined` conserva, `''` borra, texto sustituye.
 */
export function conservarAlEditar(
  previo: ConexionPersistida,
  nuevo: ConexionPersistida,
  password?: string
): ConexionPersistida {
  // Se parte de lo que esta versión no gobierna del previo, si la dirección no cambió, y encima el
  // formulario. `Object.fromEntries` y no una asignación: crea propiedades propias incluso para un `__proto__`.
  const noGobernadas = mismaDireccion(previo, nuevo)
    ? Object.fromEntries(Object.entries(previo).filter(([clave, valor]) => !esClaveGobernada(clave) && valor !== undefined))
    : {}
  const registro: ConexionPersistida = { ...noGobernadas, ...nuevo }
  conservarContrasena(registro, previo, password)
  // Cliente resuelto: solo si no cambian host ni puerto.
  registro.driverId = previo.host === nuevo.host && previo.port === nuevo.port ? (previo.driverId ?? null) : null
  conservarVerificacionYOrden(registro, previo)
  conservarDelExplorador(registro, previo, nuevo)
  // Entorno: el del formulario, saneado. Uno que esta versión no entiende no lo pudo quitar el
  // formulario, que ni lo enseña: sobrevive hasta que se elija uno conocido.
  const saneado = sanearEntorno(registro)
  if (!('entorno' in saneado) && previo.entorno !== undefined && !esEntorno(previo.entorno)) {
    return { ...saneado, entorno: previo.entorno }
  }
  return saneado
}

/**
 * Un registro con su `entorno` válido o sin la clave: lo desconocido se descarta como «sin entorno».
 * No muta: devuelve el mismo objeto si no hay nada que quitar, o una copia sin la clave.
 */
export function sanearEntorno<T extends { entorno?: unknown }>(c: T): T {
  if (c.entorno === undefined && !('entorno' in c)) return c
  if (esEntorno(c.entorno)) return c
  const copia = { ...c }
  delete copia.entorno
  return copia
}
