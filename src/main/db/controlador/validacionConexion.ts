// =============================================================================
// Validación y forma persistida de una conexión: qué se rechaza al guardar y qué campos se escriben
// en el registro. Puro: el registro en uso llega por parámetro, sin `fs` ni cifrado.
// Las reglas de cada motor las dicen su descriptor (`descriptor(m).conexion`) y `opcionalesConexion.ts`.
// Decisiones: docs/decisiones/bd/conexiones-registro-crash-safe.md
// =============================================================================
import { ALIAS_MAX, esEntorno, type DbConexionAjena, type DbConnectionInput } from '../../../shared/db-ipc.ts'
import { limpiarDestinoBd } from '../../../shared/destinoBd.ts'
import { descriptor, esMotor, pideUsuarioYClave, type CampoConexion, type CampoTextoDestino } from '../../../shared/motores/index.ts'
import { nunca } from '../../../shared/nunca.ts'
import type { ConexionPersistida } from '../conservarAlEditar.ts'
import { opcionalesAGuardar, usuarioAGuardar, validarBaseClaves, validarOpcional } from '../opcionalesConexion.ts'

/**
 * Lo que reciben `create` y `update`: la entrada del renderer con el archivo de un motor de archivo
 * ya resuelto. El renderer manda un `DbOrigenArchivo`, nunca una ruta; `DbController` lo resuelve
 * y lo pasa aquí como `rutaArchivo`.
 */
export interface EntradaConexion extends Omit<DbConnectionInput, 'archivo'> {
  /** Ruta CANÓNICA del archivo (motores de archivo); la de `canonizarRutaArchivo`. */
  rutaArchivo?: string
}

/** Lo que la validación necesita de las conexiones ya guardadas. */
export interface ConexionesGuardadas {
  conocidas: readonly Pick<ConexionPersistida, 'id' | 'profileId' | 'alias' | 'motor' | 'archivo'>[]
  ajenasDelPerfil: (profileId: string) => readonly Pick<DbConexionAjena, 'id' | 'alias'>[]
}

/** Claves que `camposAGuardar` escribe solo con valor: que una esté guardada y no salga en lo nuevo es un cambio. */
const CLAVES_SOLO_CON_VALOR = ['archivo', 'instancia', 'autenticacion', 'dominio', 'tls', 'srv', 'opcionesUri'] as const

/** Igualdad de un valor guardado: `undefined` y `''` son lo mismo; `tls`, por su contenido. */
function mismoValorGuardado(a: unknown, b: unknown): boolean {
  const x = a === '' || a === null ? undefined : a
  const y = b === '' || b === null ? undefined : b
  if (typeof x === 'object' && typeof y === 'object') {
    const orden = (o: object): string =>
      JSON.stringify(Object.fromEntries(Object.entries(o).sort(([k1], [k2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : 0))))
    return orden(x as object) === orden(y as object)
  }
  return x === y
}

/**
 * El destino tal como se guarda: host, base y SID limpios, con lo que el motor descarta al guardar
 * tomado como vacío. Lo usan la validación y `camposAGuardar`, así se valida exactamente lo escrito.
 * Pide un motor del registro: la validación lo comprueba antes.
 */
export function destinoAGuardar(input: EntradaConexion): { host: string; database: string; sid: string } {
  const descartados = descriptor(input.motor).conexion.descartarAlGuardar
  const limpio = (campo: CampoTextoDestino): string => (descartados.includes(campo) ? '' : limpiarDestinoBd(input[campo]))
  return { host: limpio('host'), database: limpio('database'), sid: limpio('sid') }
}

/**
 * La ruta del archivo que se guarda para un motor de archivo: la de la entrada o, en una edición
 * que no trae una y no cambia de motor, la guardada. `undefined` en los motores de red.
 */
export function rutaArchivoAGuardar(
  input: EntradaConexion,
  guardadas: ConexionesGuardadas['conocidas'],
  idEditada?: string
): string | undefined {
  if (!descriptor(input.motor).conexion.deArchivo) return undefined
  if (typeof input.rutaArchivo === 'string' && input.rutaArchivo !== '') return input.rutaArchivo
  if (idEditada === undefined) return undefined
  const previa = guardadas.find((c) => c.id === idEditada)
  return previa && previa.motor === input.motor && typeof previa.archivo === 'string' ? previa.archivo : undefined
}

/** Los campos comunes normalizados a partir de la entrada; se llama después de validar. */
export function camposAGuardar(
  input: EntradaConexion,
  guardadas: ConexionesGuardadas['conocidas'],
  idEditada?: string
): Omit<ConexionPersistida, 'id' | 'secretEnc'> {
  const { host, database, sid } = destinoAGuardar(input)
  // Lo que el motor no usa se guarda vacío ('' / 0 / ''), no con lo que quedó en el borrador.
  const obligatorios = descriptor(input.motor).conexion.obligatorios
  const archivo = rutaArchivoAGuardar(input, guardadas, idEditada)
  return {
    profileId: input.profileId,
    alias: input.alias.trim(),
    motor: input.motor,
    // `limpiarDestinoBd` y no `.trim()`: estos campos se copian de consolas web y de cadenas JDBC.
    host,
    port: obligatorios.includes('port') ? input.port : 0,
    database: database || undefined,
    sid: sid || undefined,
    user: usuarioAGuardar(descriptor(input.motor), input),
    ...(archivo !== undefined ? { archivo } : {}),
    // Solo si el motor los declara (`conexion.opcionales`); lo escrito con otro motor no viaja.
    ...opcionalesAGuardar(descriptor(input.motor), input),
    readonly: input.readonly !== false, // por defecto solo lectura
    entorno: esEntorno(input.entorno) ? input.entorno : undefined,
    notas: input.notas?.trim() || undefined,
    driverId: null
  }
}

/** ¿Guardar `nuevo` sobre `previo` solo marca o desmarca la casilla de los agentes? */
export function soloCambiaLaCasilla(nuevo: Record<string, unknown>, previo: Record<string, unknown>): boolean {
  if (nuevo.readonly === previo.readonly) return false
  // Ausentes en lo nuevo y presentes en lo guardado es un cambio; `driverId` no es del formulario.
  const claves = new Set([...Object.keys(nuevo), ...CLAVES_SOLO_CON_VALOR])
  claves.delete('readonly')
  claves.delete('driverId')
  return [...claves].every((k) => mismoValorGuardado(nuevo[k], previo[k]))
}

/** Perfil, nombre (no vacío, no larguísimo, único en el perfil incluidas las ajenas). */
function validarNombre(input: EntradaConexion, ignoreId: string | undefined, guardadas: ConexionesGuardadas): void {
  if (typeof input?.profileId !== 'string' || !input.profileId) {
    throw new Error('Una conexión requiere un perfil.')
  }
  // El alias es un nombre libre: el secreto cuelga del `id`, así que espacios y símbolos no rompen nada.
  const alias = String(input.alias ?? '').trim()
  if (!alias) throw new Error('La conexión necesita un nombre.')
  if (alias.length > ALIAS_MAX) {
    throw new Error(`El nombre no puede pasar de ${ALIAS_MAX} caracteres.`)
  }
  // `tdb` resuelve por nombre y las ajenas también se ven en la lista: un alias repetido confunde igual.
  const aliasNorm = alias.toLowerCase()
  const choque =
    guardadas.conocidas.find(
      (c) => c.profileId === input.profileId && c.id !== ignoreId && c.alias.trim().toLowerCase() === aliasNorm
    )?.alias ??
    guardadas.ajenasDelPerfil(input.profileId).find((a) => a.id !== ignoreId && a.alias.trim().toLowerCase() === aliasNorm)?.alias
  if (choque !== undefined) throw new Error(`Este perfil ya tiene una conexión llamada "${choque}".`)
}

/** Lo que una regla de campo común ve de la entrada. */
interface ContextoCampo {
  input: EntradaConexion
  host: string
  rutaArchivo: () => string | undefined
}

const sinRegla = (): string | null => null

/** Regla común de cada campo obligatorio; un campo nuevo sin decidir aquí no compila. */
const REGLAS_COMUNES: Record<CampoConexion, (c: ContextoCampo) => string | null> = {
  alias: sinRegla, // ya validado en `validarNombre`
  host: (c) => (c.host ? null : 'Falta el host.'),
  port: (c) =>
    Number.isInteger(c.input.port) && c.input.port >= 1 && c.input.port <= 65535
      ? null
      : 'El puerto debe ser un entero entre 1 y 65535.',
  user: (c) => (typeof c.input.user !== 'string' || !c.input.user.trim() ? 'Falta el usuario.' : null),
  archivo: (c) => (c.rutaArchivo() ? null : 'Falta el archivo de la base.'),
  // Los decide `validarDestino` del motor, con sus mensajes.
  database: sinRegla,
  sid: sinRegla,
  // Los valida `validarOpcional`, sean obligatorios o no.
  instancia: sinRegla,
  autenticacion: sinRegla,
  dominio: sinRegla,
  tls: sinRegla,
  srv: sinRegla,
  opcionesUri: sinRegla
}

/** Valida la forma de una alta o edición. Lanza con un mensaje para el usuario. */
export function validarEntrada(input: EntradaConexion, guardadas: ConexionesGuardadas, ignoreId?: string): void {
  validarNombre(input, ignoreId, guardadas)
  // `esMotor` y no un `includes`: el motor llega por IPC y «constructor» no es un motor.
  if (!esMotor(input.motor)) throw new Error(`Motor desconocido: "${String(input.motor)}".`)
  // Se valida lo que se va a guardar, no lo que llegó: `limpiarDestinoBd` puede dejar en nada un `http://`.
  const { host, database, sid } = destinoAGuardar(input)
  const d = descriptor(input.motor)
  const contexto: ContextoCampo = { input, host, rutaArchivo: () => rutaArchivoAGuardar(input, guardadas.conocidas, ignoreId) }
  // Las reglas comunes, en el orden de los obligatorios del motor.
  for (const campo of d.conexion.obligatorios) {
    const regla = REGLAS_COMUNES[campo] ?? nunca(campo as never, 'ConnectionStore.validate')
    const error = regla(contexto)
    if (error !== null) throw new Error(error)
  }
  for (const campo of d.conexion.opcionales) {
    const error = validarOpcional(campo, input)
    if (error !== null) throw new Error(error)
  }
  // Un motor sin credenciales (SQLite) no guarda contraseña: quedaría un secreto huérfano.
  if (!pideUsuarioYClave(d) && typeof input.password === 'string' && input.password !== '') {
    throw new Error(`${d.etiqueta} no usa contraseña.`)
  }
  // Lo que el destino exige es cosa del motor; va después de lo común (con el host vacío, el error es el del host).
  const errorDestino = d.conexion.validarDestino({ database, sid })
  if (errorDestino !== null) throw new Error(errorDestino)
  // En un motor de claves (Redis) la base por defecto es un número de 0 a 9999.
  const errorBase = validarBaseClaves(d, database)
  if (errorBase !== null) throw new Error(errorBase)
}
