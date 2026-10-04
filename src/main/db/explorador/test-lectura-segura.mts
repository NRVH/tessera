#!/usr/bin/env node
// =============================================================================
// Prueba de la lógica pura del humo de solo lectura (`lecturaSegura.ts`), sin servidor: buscar la conexión
// como `tdb`, la copia siempre en solo lectura, el protocolo del puente contra el `DbBridge` real, de dónde
// sale la contraseña y el remedio de cada fallo, taparla en la salida, el centinela (lista blanca, EXPLAIN,
// y que no veta nada de lo que el producto manda de verdad) y elegir la tabla de la pestaña de datos.
// (node src/main/db/explorador/test-lectura-segura.mts  ·  npm run test:db-lectura-segura)
// Decisiones: docs/decisiones/bd/conexiones-humo-de-solo-lectura.md
// =============================================================================

import { DbBridge } from '../dbBridge.ts'
import {
  MENSAJE_FORMATO_AJENO,
  comparteId,
  leerRegistroConRespaldo,
  mensajeRegistroIlegible,
  nombreDeEntrada,
  type Registro
} from '../registroConexiones.ts'
import { envVarDestino, envVarSecreto } from '../../../shared/db-ipc.ts'
import { huellaDestino } from '../huellaDestino.ts'
import type { DbTipoObjeto } from '../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../shared/motores/index.ts'
import {
  sqlClavePrimaria,
  sqlColumnas,
  sqlColumnasDeRestricciones,
  sqlConteos,
  sqlFks,
  sqlFksEntrantesOracle,
  sqlEsquemaPorDefecto,
  sqlEsquemas,
  sqlFuente,
  sqlIndices,
  sqlNombres,
  sqlNombresPublicos,
  sqlObjetos,
  sqlResolverSinonimo,
  sqlRestricciones,
  sqlTipoDeObjeto,
  sqlTiposColumnas,
  type ConsultaCatalogo,
  type DialectoCatalogo
} from './catalogoSql.ts'
import {
  buscarEnRegistro,
  copiaSoloLectura,
  elegirTabla,
  formatearMs,
  interpretarRespuestaPuente,
  peticionPuente,
  primeraPalabra,
  resolverSecreto,
  sqlTablasModestas,
  taparSecreto,
  vetarPeticion,
  vetarSql,
  MIN_TAPAR
} from './lecturaSegura.ts'
import type { OpcionesEjecucion, PeticionSinId } from './protocoloTrabajador.ts'
import { PREFIJO_SESION_EDICION } from './edicionRejilla.ts'
import { construirConsultaTabla, construirConteo, esErrorRejilla } from './sqlRejilla.ts'
import { sqlDdlOracle } from './ddlCatalogo.ts'
import { sqlFijarEsquema } from './consolaSql.ts'
import { construirConsultaValor, esErrorValor } from './valorCelda.ts'
import { SQL_NODOS_ORACLE, SQL_TEXTO_ORACLE, sqlExplicarOracle } from './planSql.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

// --- (1) Buscar en el registro --------------------------------------------------------------

hr('(1) Buscar la conexión como tdb: la misma lectura, el mismo nombre, solo en el perfil de la terminal')
/** Un «disco» de mentira para `leerRegistroConRespaldo`: ruta -> texto (ausente = no se puede leer). */
function disco(archivos: Record<string, string>): (ruta: string) => string | null {
  return (ruta) => (Object.prototype.hasOwnProperty.call(archivos, ruta) ? archivos[ruta] : null)
}
/** El registro tal como lo leería el main con ese contenido en el principal. */
function leido(doc: unknown): Registro {
  return leerRegistroConRespaldo(disco({ 'r.json': typeof doc === 'string' ? doc : JSON.stringify(doc) }), 'r.json')
}
const REGISTRO_EN_DISCO = {
  version: 1,
  connections: [
    {
      id: 'c-alfa',
      profileId: 'alfa',
      alias: 'DEV-CENTRAL',
      motor: 'oracle',
      host: 'db.interna',
      port: 1521,
      sid: 'DEV',
      user: 'app',
      readonly: false,
      driverId: 'oracle-ic-19',
      secretEnc: 'Y2lmcmFkbw==',
      esquemas: { modo: 'todos' },
      introspeccion: { totalEsquemas: 40, porDefecto: 'APP' },
      notas: 'nota',
      orden: 3
    },
    { id: 'c-pg', profileId: 'alfa', alias: 'Informes', motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', readonly: true },
    { id: 'c-otro', profileId: 'otro', alias: 'dev-central', motor: 'oracle', host: 'h2', port: 1521, database: 'S', user: 'u2', readonly: true },
    // Tres que esta versión NO sabe usar, del mismo perfil: sin alias (forma), de un
    // motor que no conoce, y una sin alias ni id (no se puede ni nombrar).
    { id: 'c-sin-alias', profileId: 'alfa', motor: 'oracle', host: 'h3', port: 1521, sid: 'X', user: 'u3' },
    { id: 'c-sqls', profileId: 'alfa', alias: 'Ventas SQLS', motor: 'mysql', host: 'h4', port: 1433, user: 'sa' },
    { profileId: 'alfa', motor: 'mysql' },
    'basura',
    null
  ]
}
const REGISTRO = leido(REGISTRO_EN_DISCO)
const porAlias = buscarEnRegistro(REGISTRO, '  dev-central ', 'alfa')
check(
  'por alias sin distinguir mayúsculas ni espacios, en SU perfil (no el homónimo de otro)',
  porAlias.ok && porAlias.entrada.id === 'c-alfa',
  JSON.stringify(porAlias.ok ? porAlias.entrada.id : porAlias)
)
const porId = buscarEnRegistro(REGISTRO, 'C-PG', 'alfa')
check('también por id', porId.ok && porId.entrada.id === 'c-pg', JSON.stringify(porId.ok ? porId.entrada.id : porId))
const noEsta = buscarEnRegistro(REGISTRO, 'PROD', 'alfa')
check(
  '«no está» nombra las disponibles DE ESE perfil y ninguna de otro',
  !noEsta.ok && noEsta.mensaje.includes('«DEV-CENTRAL»') && noEsta.mensaje.includes('«Informes»') && !noEsta.mensaje.includes('dev-central»'),
  noEsta.ok ? 'la encontró' : noEsta.mensaje
)
const sinPerfil = buscarEnRegistro(REGISTRO, 'dev-central', null)
check('sin perfil conocido busca en todo el registro (como tdb)', sinPerfil.ok && sinPerfil.entrada.id === 'c-alfa', JSON.stringify(sinPerfil.ok ? sinPerfil.entrada.id : sinPerfil))

// LA MISMA LECTURA que el main y `tdb` (antes leía el JSON a pelo).
{
  const conBak = leerRegistroConRespaldo(
    disco({ 'r.json': '{ roto', 'r.json.bak': JSON.stringify(REGISTRO_EN_DISCO) }),
    'r.json'
  )
  const r = buscarEnRegistro(conBak, 'DEV-CENTRAL', 'alfa')
  check(
    'con el principal corrupto, la encuentra en el .bak (como el main y tdb)',
    r.ok && r.entrada.id === 'c-alfa',
    JSON.stringify(r.ok ? r.entrada.id : r)
  )
  const vacioAMano = leerRegistroConRespaldo(disco({ 'r.json': '{}', 'r.json.bak': JSON.stringify(REGISTRO_EN_DISCO) }), 'r.json')
  const v = buscarEnRegistro(vacioAMano, 'DEV-CENTRAL', 'alfa')
  check(
    'NEGATIVO: un principal LEGIBLE y vacío manda (el .bak no resucita lo que se vació a mano)',
    !v.ok && v.mensaje.includes('(ninguna)'),
    v.ok ? 'la encontró en el .bak' : v.mensaje
  )
}
{
  // Formato AJENO del archivo entero: el main no interpreta ninguna entrada, así que el
  // smoke tampoco. Antes, con `version: "2"`, encontraba la Oracle que la app no enseña.
  const futuro = buscarEnRegistro(leido({ ...REGISTRO_EN_DISCO, version: '2' }), 'DEV-CENTRAL', 'alfa')
  check(
    'formato ajeno (`version: "2"`): no la da por buena, dice el porqué del archivo',
    !futuro.ok && futuro.mensaje === MENSAJE_FORMATO_AJENO,
    futuro.ok ? `la encontró: ${String(futuro.entrada.id)}` : futuro.mensaje
  )
  const roto = buscarEnRegistro(leido({ connections: 'no' }), 'x', 'alfa')
  check(
    'un `connections` que no es lista: formato ajeno, no «(ninguna)» (que se leería como un registro vacío)',
    !roto.ok && roto.mensaje === MENSAJE_FORMATO_AJENO,
    roto.ok ? '?' : roto.mensaje
  )
  // Un principal que NO SE PUEDE LEER y sin `.bak`: el main lo
  // bloquea con su propio aviso en vez de tomarlo por vacío. El smoke dice lo mismo que la
  // app, no «(ninguna)» —se leería como un registro vacío— ni el aviso del formato ajeno,
  // que mandaría a actualizar a quien dejó una coma de más.
  const ilegible = buscarEnRegistro(leido('{ "connections": [ { "id": "c-alfa", }, ] }'), 'DEV-CENTRAL', 'alfa')
  check(
    'JSON roto y sin .bak: dice que no se puede leer (el aviso de la app), no «(ninguna)» ni «formato»',
    !ilegible.ok &&
      ilegible.mensaje === mensajeRegistroIlegible({ tipo: 'roto' }, 'ausente') &&
      !ilegible.mensaje.includes('(ninguna)') &&
      ilegible.mensaje !== MENSAJE_FORMATO_AJENO,
    ilegible.ok ? `la encontró: ${String(ilegible.entrada.id)}` : ilegible.mensaje
  )
}
{
  // EL MISMO NOMBRE que `tdb` (`nombreDe`): alias, id o «(sin nombre)», nunca «undefined».
  check(
    'nombreDeEntrada: alias; si no, id; si no, «(sin nombre)»',
    nombreDeEntrada({ alias: 'A', id: 'x' }) === 'A' &&
      nombreDeEntrada({ alias: '  ', id: 'x' }) === 'x' &&
      nombreDeEntrada({ alias: 7, id: 'x' }) === 'x' &&
      nombreDeEntrada({}) === '(sin nombre)' &&
      nombreDeEntrada({ id: '' }) === '(sin nombre)',
    JSON.stringify([nombreDeEntrada({ alias: '  ', id: 'x' }), nombreDeEntrada({})])
  )
  const indefinido = buscarEnRegistro(REGISTRO, 'undefined', 'alfa')
  check(
    'NEGATIVO: «undefined» no encuentra la entrada sin alias (con String(c.alias) sí la habría encontrado)',
    !indefinido.ok &&
      indefinido.mensaje.startsWith('No hay ninguna conexión «undefined»') &&
      !/Disponibles:.*undefined/.test(indefinido.mensaje) &&
      !indefinido.mensaje.includes('«»'),
    indefinido.ok ? `encontró ${String(indefinido.entrada.id)}` : indefinido.mensaje
  )
  check(
    '«Disponibles» son solo las que se pueden usar, y las demás se cuentan',
    !noEsta.ok && noEsta.mensaje.includes('Disponibles: «DEV-CENTRAL», «Informes».') && noEsta.mensaje.includes('Y 3 que esta versión no sabe usar'),
    noEsta.ok ? '?' : noEsta.mensaje
  )
  const deForma = buscarEnRegistro(REGISTRO, 'C-SIN-ALIAS', 'alfa')
  check(
    'una AJENA de forma que casa por id: no se devuelve, se nombra por su id y se dice su causa',
    !deForma.ok && deForma.mensaje.startsWith('«c-sin-alias» está guardada de una forma') && deForma.mensaje.includes('edición a mano'),
    deForma.ok ? `la devolvió: ${String(deForma.entrada.id)}` : deForma.mensaje
  )
  const deMotor = buscarEnRegistro(REGISTRO, 'ventas sqls', 'alfa')
  check(
    'una AJENA de motor que casa por alias: no se devuelve, y dice su motor',
    !deMotor.ok && deMotor.mensaje.startsWith('«Ventas SQLS» es de un motor (mysql)') && deMotor.mensaje.includes('actualiza Tessera'),
    deMotor.ok ? `la devolvió: ${String(deMotor.entrada.id)}` : deMotor.mensaje
  )
  // la COPIA de una conocida con su mismo id (pegada a mano) es ajena por
  // id repetido. Por su alias no se devuelve (se abriría la original con su contraseña), y
  // su mensaje dice su causa, no la de la forma; por el id se encuentra la original.
  const ORIGINAL = REGISTRO_EN_DISCO.connections[0] as Record<string, unknown>
  const conCopia = leido({
    version: 1,
    connections: [ORIGINAL, { ...ORIGINAL, alias: 'Copia DEV', host: 'otra' }, { ...ORIGINAL, profileId: 'otro', alias: 'Copia en otro' }]
  })
  const copiaR = buscarEnRegistro(conCopia, 'copia dev', 'alfa')
  check(
    'la copia con el id de otra: no se devuelve, y dice que comparte su identificador con la original (no «forma»)',
    !copiaR.ok && copiaR.mensaje.startsWith('«Copia DEV» comparte su identificador con «DEV-CENTRAL»') && !copiaR.mensaje.includes('forma'),
    copiaR.ok ? `la devolvió: ${String(copiaR.entrada.alias)}` : copiaR.mensaje
  )
  const copiaOtro = buscarEnRegistro(conCopia, 'copia en otro', 'otro')
  check(
    'la de OTRO perfil no nombra la original (es de otro perfil)',
    !copiaOtro.ok && copiaOtro.mensaje.includes('con una conexión de otro perfil') && !copiaOtro.mensaje.includes('DEV-CENTRAL'),
    copiaOtro.ok ? 'la devolvió' : copiaOtro.mensaje
  )
  // SIN perfil de terminal (`null`, el smoke lanzado a mano) la
  // decisión se re-derivaba con el perfil de la terminal y, sin él, nombraba la original de
  // OTRO perfil; la UI y `tdb` la esconden. Ahora es la MISMA regla (`comparteId`, con el
  // perfil de la copia), y las dos mitades: la de otro perfil no la nombra, la del mismo sí.
  const sinTerminalOtro = buscarEnRegistro(conCopia, 'copia en otro', null)
  check(
    'sin perfil de terminal, la copia de OTRO perfil tampoco nombra la original (como la UI y tdb)',
    !sinTerminalOtro.ok && sinTerminalOtro.mensaje.includes('con una conexión de otro perfil') && !sinTerminalOtro.mensaje.includes('DEV-CENTRAL'),
    sinTerminalOtro.ok ? 'la devolvió' : sinTerminalOtro.mensaje
  )
  const sinTerminalMismo = buscarEnRegistro(conCopia, 'copia dev', null)
  check(
    'NEGATIVO: sin perfil de terminal, la copia del MISMO perfil que la original sí la nombra',
    !sinTerminalMismo.ok && sinTerminalMismo.mensaje.startsWith('«Copia DEV» comparte su identificador con «DEV-CENTRAL»'),
    sinTerminalMismo.ok ? 'la devolvió' : sinTerminalMismo.mensaje
  )
  // Y es la misma decisión que la de la UI (`ajenasDelPerfil` -> `comparteId`), no una copia.
  const deLaUi = comparteId(conCopia, 'c-alfa', 'otro')
  check('la regla es la de la UI: `comparteId` con el perfil de la copia dice «otro perfil»', deLaUi.tipo === 'otroPerfil', JSON.stringify(deLaUi))
  const porIdOriginal = buscarEnRegistro(conCopia, 'c-alfa', 'alfa')
  check(
    'por el id, la ORIGINAL (la primera), como tdb',
    porIdOriginal.ok && porIdOriginal.entrada.alias === 'DEV-CENTRAL',
    JSON.stringify(porIdOriginal.ok ? porIdOriginal.entrada.alias : porIdOriginal)
  )
}

// --- (2) Copia en solo lectura --------------------------------------------------------------

hr('(2) La copia para el gestor: SIEMPRE solo lectura y solo lo necesario')
const copia = porAlias.ok ? copiaSoloLectura(porAlias.entrada) : null
const c = copia && copia.ok ? copia.conexion : null
check(
  'en ESCRITURA en el registro -> readonly:true en la copia, y se sabe que lo era',
  !!c && c.readonly === true && copia !== null && copia.ok && copia.eraEscritura === true,
  JSON.stringify(c && { readonly: c.readonly, eraEscritura: copia?.ok && copia.eraEscritura })
)
const claves = c ? Object.keys(c).sort().join(',') : ''
check(
  'sin secretEnc, esquemas, introspección, notas ni orden',
  claves === 'alias,driverId,host,id,motor,port,profileId,readonly,sid,tieneSecreto,user',
  claves
)
check('conserva el SID y el driver de la conexión', c?.sid === 'DEV' && c.database === undefined && c.driverId === 'oracle-ic-19', JSON.stringify(c))
const deLectura = copiaSoloLectura({ ...(porAlias.ok ? porAlias.entrada : {}), readonly: true, driverId: undefined })
check(
  'si ya era de lectura no lo marca como forzado; sin driver, driverId null',
  deLectura.ok && !deLectura.eraEscritura && deLectura.conexion.driverId === null,
  JSON.stringify(deLectura.ok ? { era: deLectura.eraEscritura, d: deLectura.conexion.driverId } : deLectura)
)
const pgCopia = porId.ok ? copiaSoloLectura(porId.entrada) : null
check('una de PostgreSQL se rechaza con motivo', !!pgCopia && !pgCopia.ok && /solo de Oracle/.test(pgCopia.mensaje), JSON.stringify(pgCopia))
const sinPuerto = copiaSoloLectura({ id: 'x', profileId: 'p', alias: 'X', motor: 'oracle', host: 'h', port: '1521', sid: 'S', user: 'u' })
check('puerto que no es número -> incompleta', !sinPuerto.ok && /incompleta/.test(sinPuerto.mensaje), JSON.stringify(sinPuerto))
const sinServicio = copiaSoloLectura({ id: 'x', profileId: 'p', alias: 'X', motor: 'oracle', host: 'h', port: 1521, user: 'u' })
check('ni servicio ni SID -> rechazada', !sinServicio.ok && /servicio ni SID/.test(sinServicio.mensaje), JSON.stringify(sinServicio))

// --- (3) Protocolo del puente, contra el DbBridge real -------------------------------------

hr('(3) El protocolo del puente contra el DbBridge REAL')
const PROYECTO = 'C:\\proyectos\\uno'
const CONEXIONES_ALFA = [
  { id: 'c-alfa', profileId: 'alfa', motor: 'oracle', host: 'db.alfa', port: 1521, database: 'ALFA', user: 'ADM' },
  { id: 'c-pg', profileId: 'alfa', motor: 'postgres', host: 'pg.alfa', port: 5432, database: 'app', user: 'u' }
]
const puente = new DbBridge({
  conexionesDelPerfil: (p) => (p === 'alfa' ? CONEXIONES_ALFA : []),
  secretoDe: (id) => (id === 'c-alfa' ? 'clave "con" \\ raras' : null)
})
const token = puente.mint('alfa', PROYECTO)
puente.setScope('alfa', PROYECTO, ['c-alfa'])
const linea = peticionPuente(token)
check('la petición es UNA línea JSON terminada en salto', linea.endsWith('\n') && linea.indexOf('\n') === linea.length - 1, JSON.stringify(linea.slice(-3)))
const respuesta = puente.resolver(JSON.parse(linea))
const estado = interpretarRespuestaPuente(JSON.stringify(respuesta) + '\n')
check(
  'el puente entiende la petición y el smoke su respuesta (scope y secreto)',
  estado.tipo === 'ok' && estado.scope.join() === 'c-alfa' && estado.secretos['c-alfa'] === 'clave "con" \\ raras',
  JSON.stringify(estado.tipo === 'ok' ? { scope: estado.scope, n: Object.keys(estado.secretos).length } : estado)
)
const ajeno = interpretarRespuestaPuente(JSON.stringify(puente.resolver(JSON.parse(peticionPuente('inventado')))))
check('un token que no vale -> rechazado, con el motivo del puente', ajeno.tipo === 'rechazado' && ajeno.error === 'no autorizado', JSON.stringify(ajeno))
check('respuesta vacía -> no responde', interpretarRespuestaPuente('').tipo === 'noResponde', interpretarRespuestaPuente('').tipo)
check('respuesta ilegible -> no responde', interpretarRespuestaPuente('{roto\n').tipo === 'noResponde', interpretarRespuestaPuente('{roto\n').tipo)
const varias = interpretarRespuestaPuente('{"ok":false,"error":"x"}\n{"ok":true,"scope":["a",3],"secretos":{"a":"s","b":7}}\n\n')
check(
  'se queda con la ÚLTIMA línea y descarta lo que no es texto',
  varias.tipo === 'ok' && varias.scope.join() === 'a' && JSON.stringify(varias.secretos) === '{"a":"s"}',
  JSON.stringify(varias)
)

// --- (4) De dónde sale la contraseña -------------------------------------------------------

hr('(4) La contraseña: del puente; del entorno SOLO sin puente')
const ENV = { [envVarSecreto('c-alfa')]: 'del-entorno' }
// El destino de `c-alfa` tal como está en el registro, y su huella (la que Tessera manda con su
// contraseña). `OTRO` es la misma entrada con otro host.
const DESTINO = { motor: 'oracle', host: 'db.alfa', port: 1521, database: 'ALFA', user: 'ADM' }
const OTRO = { ...DESTINO, host: 'otro.alfa' }
const HUELLAS = { 'c-alfa': huellaDestino(DESTINO) }
const r1 = resolverSecreto('c-alfa', { tipo: 'ok', scope: ['c-alfa'], secretos: { 'c-alfa': 'del-puente' }, huellas: HUELLAS }, ENV, DESTINO)
check('con puente: la del puente aunque el entorno traiga otra', r1.ok && r1.secreto === 'del-puente' && r1.origen === 'puente', JSON.stringify(r1.ok ? r1.origen : r1))
const r2 = resolverSecreto('c-alfa', { tipo: 'ok', scope: [], secretos: {}, huellas: {} }, ENV, DESTINO)
check('puente sin ella en el scope -> «no está montada», SIN caer al entorno', !r2.ok && /NO está montada/.test(r2.mensaje), JSON.stringify(r2))
const r3 = resolverSecreto('c-alfa', { tipo: 'ok', scope: ['c-alfa'], secretos: {}, huellas: {} }, ENV, DESTINO)
check('montada pero sin contraseña -> dice que la escriba y la pruebe', !r3.ok && /no tiene su contraseña/.test(r3.mensaje) && /Probar/.test(r3.mensaje), JSON.stringify(r3))
const r4 = resolverSecreto('c-alfa', { tipo: 'rechazado', error: 'no autorizado' }, ENV, DESTINO)
check('token rechazado -> «Recargar» la terminal', !r4.ok && /Recargar/.test(r4.mensaje), JSON.stringify(r4))
const r5 = resolverSecreto('c-alfa', { tipo: 'noResponde' }, ENV, DESTINO)
check('puente que no responde -> Tessera cerrada u otra instancia', !r5.ok && /no responde/.test(r5.mensaje), JSON.stringify(r5))
const r6 = resolverSecreto('c-alfa', { tipo: 'sinPuente' }, ENV, DESTINO)
check('sin puente: la variable TESSERA_DB_SECRET_<ID> puesta a mano, sin huella (el respaldo de las pruebas)', r6.ok && r6.secreto === 'del-entorno' && r6.origen === 'entorno', JSON.stringify(r6.ok ? r6.origen : r6))
const r7 = resolverSecreto('c-alfa', { tipo: 'sinPuente' }, {}, DESTINO)
check('sin puente ni variable -> lo dice', !r7.ok && /no lleva el puente/.test(r7.mensaje), JSON.stringify(r7))
const r8 = resolverSecreto('c-alfa', { tipo: 'ok', scope: ['c-alfa'], secretos: { 'c-alfa': '' }, huellas: HUELLAS }, ENV, DESTINO)
check('una contraseña vacía del puente cuenta como que no hay', !r8.ok, JSON.stringify(r8))
// la contraseña solo va contra la entrada para la que se emitió.
const r9 = resolverSecreto('c-alfa', { tipo: 'ok', scope: ['c-alfa'], secretos: { 'c-alfa': 'del-puente' }, huellas: HUELLAS }, ENV, OTRO)
check(
  'con puente: si la entrada del registro no es la que sirve el puente (otra huella), NO se usa, y se dice que se reinicie',
  !r9.ok && /no es la que tiene cargada Tessera/.test(r9.mensaje) && /reinicia Tessera/.test(r9.mensaje),
  JSON.stringify(r9)
)
const r10 = resolverSecreto('c-alfa', { tipo: 'ok', scope: ['c-alfa'], secretos: { 'c-alfa': 'del-puente' }, huellas: null }, ENV, DESTINO)
check('con puente: un secreto servido SIN huellas tampoco se usa (el puente de Tessera las manda siempre)', !r10.ok, JSON.stringify(r10))
const ENV_TERMINAL = { ...ENV, [envVarDestino('c-alfa')]: huellaDestino(DESTINO) }
const r11 = resolverSecreto('c-alfa', { tipo: 'sinPuente' }, ENV_TERMINAL, DESTINO)
check('sin puente: la de una terminal de Tessera, con la huella de SU destino, se usa', r11.ok && r11.secreto === 'del-entorno', JSON.stringify(r11.ok ? r11.origen : r11))
const r12 = resolverSecreto('c-alfa', { tipo: 'sinPuente' }, ENV_TERMINAL, OTRO)
check(
  'sin puente: la de una terminal de Tessera cuya conexión cambió de destino NO se usa, y se dice que se recargue',
  !r12.ok && /de otro destino/.test(r12.mensaje) && /Recarga la terminal/.test(r12.mensaje),
  JSON.stringify(r12)
)
// Y el puente REAL manda la huella que el smoke acepta: la entrada que sirve, contra sí misma.
const huellaReal = interpretarRespuestaPuente(JSON.stringify(puente.resolver(JSON.parse(peticionPuente(puente.mint('alfa', PROYECTO))))))
const conReal = CONEXIONES_ALFA.find((c) => c.id === 'c-alfa')!
check(
  'el puente real y el smoke casan la huella (la conexión que sirve, contra su propio destino)',
  resolverSecreto('c-alfa', huellaReal, {}, conReal).ok && !resolverSecreto('c-alfa', huellaReal, {}, { ...conReal, user: 'OTRO' }).ok,
  JSON.stringify(huellaReal.tipo === 'ok' ? huellaReal.huellas : huellaReal)
)

// --- (5) Tapar la contraseña ---------------------------------------------------------------

hr('(5) Tapar la contraseña en la salida')
const t1 = taparSecreto('conectando con Secreto#2024 y Secreto#2024', 'Secreto#2024')
check('se tapa cada aparición y se avisa', t1.tapado && t1.texto === 'conectando con *** y ***', JSON.stringify(t1))
const rara = 'a"b\\c'
const enJson = JSON.stringify({ clave: rara })
const t2 = taparSecreto(enJson, rara)
check('también su forma escapada dentro de un JSON.stringify', t2.tapado && !t2.texto.includes('b\\\\c') && t2.texto.includes('***'), t2.texto)
const t3 = taparSecreto('nada que ver', 'Secreto#2024')
check('sin la contraseña no se toca nada', !t3.tapado && t3.texto === 'nada que ver', JSON.stringify(t3))
const corto = 'x'.repeat(MIN_TAPAR - 1)
const t4 = taparSecreto('xxxxxxxx', corto)
check(`con menos de ${MIN_TAPAR} caracteres no se tapa (destrozaría la salida)`, !t4.tapado && t4.texto === 'xxxxxxxx', JSON.stringify(t4))
check(
  'formatearMs: ms, segundos y minutos',
  formatearMs(85) === '85 ms' && formatearMs(1234) === '1.23 s' && formatearMs(125_000) === '2 min 5 s' && formatearMs(119_999) === '2 min 0 s' && formatearMs(-1) === '?',
  [85, 1234, 125_000, 119_999, -1].map(formatearMs).join(' | ')
)

// --- (6) Centinela ---------------------------------------------------------------------------

hr('(6) El centinela: solo lecturas, y las de usuario con candado')
const OPC_USUARIO: OpcionesEjecucion = { proposito: 'usuario', maxFilas: 100, candadoRO: true, sinBegin: true }
const OPC_CATALOGO: OpcionesEjecucion = { proposito: 'catalogo', maxFilas: 250_000, candadoRO: false, sinBegin: true, comprobarTx: false }
const ejecutar = (sql: string, opciones: OpcionesEjecucion = OPC_USUARIO): PeticionSinId => ({ op: 'ejecutar', sesion: 's', sql, opciones })
const casos: Array<[string, string, boolean]> = [
  ['select sysdate, user from dual', 'SELECT', true],
  ['  -- comentario\n  /* otro */ (SELECT 1 FROM dual)', 'SELECT', true],
  ['with t as (select 1 x from dual) select * from t', 'WITH', true],
  ['update TESSERA_NO_EXISTE set x = 1', 'UPDATE', false],
  ['-- select\ndelete from t', 'DELETE', false],
  ['/* select */ merge into t using s on (1=1)', 'MERGE', false],
  ['begin null; end;', 'BEGIN', false],
  ['declare n number; begin null; end;', 'DECLARE', false],
  ['call p()', 'CALL', false],
  ['lock table t in exclusive mode', 'LOCK', false],
  ['alter session set current_schema = X', 'ALTER', false],
  ['/* sin cerrar select', '', false],
  ['', '', false]
]
for (const [sql, palabra, pasa] of casos) {
  const veto = vetarSql(sql)
  check(
    `${pasa ? 'pasa' : 'VETA'}: ${JSON.stringify(sql.slice(0, 44))}`,
    primeraPalabra(sql) === palabra && (veto === null) === pasa,
    `palabra=${primeraPalabra(sql) || '(nada)'} veto=${veto ?? 'no'}`
  )
}
check('veta WITH FUNCTION (PL/SQL en la consulta, 12c+)', vetarSql('WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f FROM dual') !== null, String(vetarSql('WITH FUNCTION f ...')))
check('veta SELECT … FOR UPDATE (bloquea filas)', vetarSql('select * from t where id = 1 for\n update nowait') !== null, String(vetarSql('select * from t for update')))
check('veta DBMS_LOCK aunque vaya en un SELECT', vetarSql('select dbms_lock.request(1) from dual') !== null, String(vetarSql('select dbms_lock.request(1) from dual')))
check('NO confunde una tabla DBMS_LOCK_X con DBMS_LOCK', vetarSql('select * from DBMS_LOCK_X') === null, String(vetarSql('select * from DBMS_LOCK_X')))
check(
  'veta una sentencia de USUARIO sin candadoRO aunque sea SELECT',
  vetarPeticion(ejecutar('select 1 from dual', { proposito: 'usuario', maxFilas: 1 })) !== null,
  String(vetarPeticion(ejecutar('select 1 from dual', { proposito: 'usuario', maxFilas: 1 })))
)
check('deja pasar un SELECT de catálogo sin candado (así lo manda el gestor)', vetarPeticion(ejecutar('SELECT 1 FROM dual', OPC_CATALOGO)) === null, 'ok')
check('pero no un UPDATE disfrazado de catálogo', vetarPeticion(ejecutar('UPDATE t SET x = 1', OPC_CATALOGO)) !== null, String(vetarPeticion(ejecutar('UPDATE t SET x = 1', OPC_CATALOGO))))
const abrir = (readonly: boolean): PeticionSinId => ({
  op: 'abrir',
  sesion: 's',
  rol: 'meta',
  conexion: { id: 'c', alias: 'C', motor: 'oracle', host: 'h', port: 1521, user: 'u', readonly },
  secreto: 'x',
  ctx: { packs: [], externos: {}, driversDir: '', usuarioWindows: 'yo' },
  opciones: { timeoutMs: 0 }
})
check('veta abrir una sesión que no es de solo lectura', vetarPeticion(abrir(false)) !== null && vetarPeticion(abrir(true)) === null, String(vetarPeticion(abrir(false))))
// la sesión de «Enviar» es el canario del smoke; con una conexión de solo
// lectura el main no llega a abrirla, así que si aparece es un fallo.
const abrirEdicion: PeticionSinId = { ...(abrir(true) as Extract<PeticionSinId, { op: 'abrir' }>), sesion: `${PREFIJO_SESION_EDICION}p1`, rol: 'datos' }
check('veta abrir la sesión de «Enviar» aunque la conexión sea de solo lectura', vetarPeticion(abrirEdicion) !== null, String(vetarPeticion(abrirEdicion)))
const abrirDatos: PeticionSinId = { ...(abrir(true) as Extract<PeticionSinId, { op: 'abrir' }>), sesion: 'datos', rol: 'datos' }
check('NEGATIVO: la sesión de datos de siempre (solo lectura) pasa', vetarPeticion(abrirDatos) === null, String(vetarPeticion(abrirDatos)))
check(
  'veta COMMIT; deja rollback y estado',
  vetarPeticion({ op: 'tx', sesion: 's', accion: 'commit' }) !== null &&
    vetarPeticion({ op: 'tx', sesion: 's', accion: 'rollback' }) === null &&
    vetarPeticion({ op: 'tx', sesion: 's', accion: 'estado' }) === null,
  String(vetarPeticion({ op: 'tx', sesion: 's', accion: 'commit' }))
)
check('veta autoCommit (el main no lo manda)', vetarPeticion({ op: 'autoCommit', sesion: 's', valor: true }) !== null, 'vetado')
const inocuas: PeticionSinId[] = [
  { op: 'iniciar', v: 1 },
  { op: 'leer', sesion: 's', lector: 'l', maxFilas: 100 },
  { op: 'cerrarLector', sesion: 's', lector: 'l' },
  { op: 'cancelar', sesion: 's' },
  { op: 'cerrar', sesion: 's' },
  { op: 'salir' }
]
check('deja pasar iniciar, leer, cerrarLector, cancelar, cerrar y salir', inocuas.every((p) => vetarPeticion(p) === null), inocuas.map((p) => p.op).join(', '))

// --- (6b) El EXPLAIN PLAN ---------------------------------------------------------

hr('(6b) El EXPLAIN PLAN del producto: exacto, sin autocommit y solo de una lectura')
const ID = 'TESSERA_1_AB'
/** Como lo manda el gestor en solo lectura: sin candado (dentro falla) y sin autocommit. */
const OPC_EXPLAIN: OpcionesEjecucion = { proposito: 'usuario', maxFilas: 1, candadoRO: false, txManual: true, comprobarTx: false }
const explicar = (sentencia: string, opciones: OpcionesEjecucion = OPC_EXPLAIN): PeticionSinId =>
  ejecutar(sqlExplicarOracle(ID, sentencia), opciones)
check('pasa el de un SELECT', vetarPeticion(explicar('select * from t where rownum <= :n')) === null, String(vetarPeticion(explicar('select 1 from dual'))))
check('pasa el de un WITH', vetarPeticion(explicar('with a as (select 1 x from dual) select * from a')) === null, 'ok')
const negativos: Array<[string, PeticionSinId]> = [
  ['el de un UPDATE (detrás del FOR tiene que pasar por sí mismo)', explicar('update t set x = 1')],
  ['el de un DELETE', explicar('delete from t')],
  ['el de un SELECT … FOR UPDATE', explicar('select * from t for update')],
  ['el de un bloque PL/SQL', explicar('begin null; end;')],
  ['el de otro EXPLAIN (anidado)', explicar(sqlExplicarOracle(ID, 'select 1 from dual'))],
  ['el del bloque de «Ver DDL» (esa excepción no vale detrás del FOR)', explicar(sqlDdlOracle({ esquema: 'X', nombre: 'X', tipo: 'tabla' }).sql)],
  ['con autocommit (sin txManual): confirmaría las filas del plan', explicar('select 1 from dual', { ...OPC_EXPLAIN, txManual: undefined })],
  ['con txManual false', explicar('select 1 from dual', { ...OPC_EXPLAIN, txManual: false })],
  ['en minúsculas (no es EXACTAMENTE el del producto)', ejecutar(`explain plan set statement_id = '${ID}' into plan_table for\nselect 1 from dual`, OPC_EXPLAIN)],
  ['a otra tabla', ejecutar(`EXPLAIN PLAN SET STATEMENT_ID = '${ID}' INTO MI_TABLA FOR\nselect 1 from dual`, OPC_EXPLAIN)],
  ['sin STATEMENT_ID del producto', ejecutar('EXPLAIN PLAN FOR\nselect 1 from dual', OPC_EXPLAIN)],
  ['un id que no es TESSERA_…', ejecutar("EXPLAIN PLAN SET STATEMENT_ID = 'X' INTO PLAN_TABLE FOR\nselect 1 from dual", OPC_EXPLAIN)]
]
for (const [nombre, p] of negativos) check(`VETA ${nombre}`, vetarPeticion(p) !== null, String(vetarPeticion(p)))
check(
  'las lecturas del plan (PLAN_TABLE y DBMS_XPLAN) pasan como catálogo',
  vetarPeticion(ejecutar(SQL_NODOS_ORACLE, OPC_CATALOGO)) === null && vetarPeticion(ejecutar(SQL_TEXTO_ORACLE, OPC_CATALOGO)) === null,
  'ok'
)

// --- (7) Lo que manda el producto de verdad NO se veta ---------------------------------------

hr('(7) El centinela deja pasar TODO el SQL que el producto manda de verdad')
const vetadas: string[] = []
let revisadas = 0
const revisar = (que: string, consulta: ConsultaCatalogo | string): void => {
  revisadas++
  const sql = typeof consulta === 'string' ? consulta : consulta.sql
  const v = vetarSql(sql)
  if (v) vetadas.push(`${que}: ${v}`)
}
for (const versionMayor of [11, 19]) {
  const d: DialectoCatalogo = { motor: 'oracle', versionMayor }
  const v = `v${versionMayor}`
  revisar(`${v} esquemas`, sqlEsquemas(d))
  revisar(`${v} esquema por defecto`, sqlEsquemaPorDefecto(d))
  revisar(`${v} conteos`, sqlConteos(d, 'APP'))
  for (const tipo of descriptorSql('oracle').catalogo.carpetas) revisar(`${v} objetos ${tipo}`, sqlObjetos(d, 'APP', tipo))
  revisar(`${v} columnas`, sqlColumnas(d, 'APP', 'T'))
  revisar(`${v} clave primaria`, sqlClavePrimaria(d, 'APP', 'T'))
  revisar(`${v} índices`, sqlIndices(d, 'APP', 'T'))
  revisar(`${v} restricciones`, sqlRestricciones(d, 'APP', 'T'))
  const conFuente: DbTipoObjeto[] = ['paquete', 'vista', 'vistaMaterializada', 'rutina', 'disparador', 'tipoObjeto', 'tipoColeccion']
  for (const tipo of conFuente) revisar(`${v} fuente ${tipo}`, sqlFuente(d, { esquema: 'APP', nombre: 'X', tipo }))
  revisar(`${v} resolver sinónimo`, sqlResolverSinonimo(d, 'APP', 'S'))
  revisar(`${v} tipo de objeto`, sqlTipoDeObjeto(d, 'APP', 'X'))
  // los tipos DECLARADOS que la pestaña de datos lee al abrir una tabla
  // (`sqlTiposColumnas`). El smoke abre tablas contra la base remota: si el centinela la vetara, esa
  // apertura fallaría allí y no aquí.
  revisar(`${v} tipos declarados (pestaña de tabla)`, sqlTiposColumnas(d, 'APP', 'T'))
  for (const n of sqlNombres(d, ['APP'])) revisar(`${v} nombres`, n)
  const pub = sqlNombresPublicos(d)
  if (pub) revisar(`${v} sinónimos PUBLIC`, pub)
  // claves ajenas y las lecturas del plan. Hoy son TRES consultas
  // (`leerFksOracle`): propias, ENTRANTES (con RULE en la 11g) y columnas por dueño. Las
  // entrantes se revisan aparte porque el smoke las manda contra la base remota en su sección (21): si
  // el centinela las vetara, ese viaje por la VPN se perdería.
  revisar(`${v} claves ajenas (propias)`, sqlFks(d, 'APP', 'T'))
  const entrantes = sqlFksEntrantesOracle(d, 'APP', ['T_PK', 'T_UK'])
  for (const c of entrantes) revisar(`${v} claves ajenas (entrantes)`, c)
  if (entrantes.length !== 1) vetadas.push(`${v} claves ajenas (entrantes): ${entrantes.length} consultas, se esperaba 1`)
  for (const c of sqlColumnasDeRestricciones(d, [['APP', 'T_FK'], ['OTRO', 'T_PK']])) revisar(`${v} columnas de las FK`, c)
}
revisar('nodos del plan (PLAN_TABLE)', SQL_NODOS_ORACLE)
revisar('texto del plan (DBMS_XPLAN)', SQL_TEXTO_ORACLE)
revisar('EXPLAIN PLAN de un SELECT con un bind', sqlExplicarOracle('TESSERA_1_AB', 'select * from t where rownum <= :n'))
revisar('un SELECT con un bind (la consola con parámetros)', 'select * from t where rownum <= :n')
const selTabla = construirConsultaTabla({ dialecto: 'oracle', objeto: { esquema: 'APP', nombre: 'T' }, forma: 'cursor' })
if (!esErrorRejilla(selTabla)) revisar('SELECT de la pestaña (cursor)', selTabla.sql)
const selRownum = construirConsultaTabla({ dialecto: 'oracle', objeto: { esquema: 'APP', nombre: 'T' }, forma: 'rownum', n: 101, desde: 100 })
if (!esErrorRejilla(selRownum)) revisar('SELECT de la pestaña (respaldo ROWNUM)', selRownum.sql)
const conteo = construirConteo({ dialecto: 'oracle', objeto: { esquema: 'APP', nombre: 'T' } })
if (!esErrorRejilla(conteo)) revisar('COUNT de Contar', conteo.sql)
revisar('tablas modestas (la del smoke)', sqlTablasModestas('APP').sql)
// lo que el smoke ejercita de ella también tiene que pasar.
revisar('«Ver DDL» (bloque DBMS_METADATA)', sqlDdlOracle({ esquema: 'APP', nombre: 'T', tipo: 'tabla' }).sql)
revisar('«Ver DDL» de una rutina (mismo bloque)', sqlDdlOracle({ esquema: 'APP', nombre: 'P', tipo: 'rutina' }).sql)
const fijar = sqlFijarEsquema('oracle', 'OTRO "RARO"', 'APP')
if (fijar) revisar('esquema de la consola', fijar)
const volver = sqlFijarEsquema('oracle', null, 'APP')
if (volver) revisar('volver al esquema de la conexión', volver)
const valorSql = construirConsultaValor({
  dialecto: 'oracle',
  esquema: 'APP',
  nombre: 'T',
  columna: 'DOC',
  pk: [{ nombre: 'ID', binario: false }],
  clave: ['1']
})
if (!esErrorValor(valorSql)) revisar('valor completo de una celda', valorSql.sql)
check(
  'y su SQL existe (ni el esquema de la consola ni el valor completo se quedaron sin generar)',
  fijar !== null && volver !== null && !esErrorValor(valorSql),
  `${fijar?.sql ?? '(null)'} | ${volver?.sql ?? '(null)'}`
)
check(
  'NEGATIVO: un bloque PL/SQL que no es EXACTAMENTE el del DDL se veta',
  vetarSql(sqlDdlOracle({ esquema: 'X', nombre: 'X', tipo: 'tabla' }).sql.replace('END;', 'COMMIT; END;')) !== null &&
    vetarSql('BEGIN DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, \'DEFAULT\'); END;') !== null,
  'vetados'
)
check(
  'NEGATIVO: otro ALTER SESSION, o algo detrás del esquema citado, se veta',
  vetarSql('ALTER SESSION SET NLS_DATE_FORMAT = \'YYYY\'') !== null &&
    vetarSql('ALTER SESSION SET CURRENT_SCHEMA = "APP" ; DROP TABLE T') !== null &&
    vetarSql('ALTER SESSION SET CURRENT_SCHEMA = APP') !== null &&
    vetarSql('ALTER SESSION SET CURRENT_SCHEMA = "A"" OR ""B"') === null,
  'el único ALTER que pasa es CURRENT_SCHEMA con el nombre bien citado'
)
check(
  'ninguna consulta del producto (ni la del smoke) cae en un falso veto',
  // El mínimo solo asegura que el recorrido corrió (hoy son 60): no fija el catálogo.
  vetadas.length === 0 && revisadas >= 40 && !esErrorRejilla(selTabla) && !esErrorRejilla(selRownum) && !esErrorRejilla(conteo),
  vetadas.length > 0 ? vetadas.join(' | ') : `${revisadas} consultas revisadas`
)
const modestas = sqlTablasModestas('APP')
check(
  'la de tablas modestas va con binds (esquema y rango) y con tope de filas',
  modestas.binds.esq === 'APP' && /ROWNUM <= \d+/.test(modestas.sql) && !modestas.sql.includes("'APP'"),
  modestas.sql.replace(/\s+/g, ' ')
)

// --- (8) Elegir la tabla --------------------------------------------------------------------

hr('(8) La tabla de la pestaña de datos')
const LISTADO = ['AUDITORIA', 'CLIENTES', 'PEDIDOS']
const e1 = elegirTabla(LISTADO, [['OTRA_FUERA_DEL_ARBOL', 300], ['PEDIDOS', 900]], null)
check('por estadísticas, la primera candidata QUE ESTÉ en el árbol', e1.ok && e1.nombre === 'PEDIDOS' && /900/.test(e1.motivo), JSON.stringify(e1))
const e2 = elegirTabla(LISTADO, [], null)
check('sin estadísticas: la primera del listado, y lo dice', e2.ok && e2.nombre === 'AUDITORIA' && /primera del listado/.test(e2.motivo), JSON.stringify(e2))
const e3 = elegirTabla(LISTADO, [['PEDIDOS', 900]], ' clientes ')
check('la pedida por argumento manda (sin distinguir mayúsculas)', e3.ok && e3.nombre === 'CLIENTES', JSON.stringify(e3))
const e4 = elegirTabla(LISTADO, [], 'NO_EXISTE')
check('una pedida que no está -> error, no otra en su lugar', !e4.ok && /NO_EXISTE/.test(e4.mensaje), JSON.stringify(e4))
const e5 = elegirTabla([], [['X', 500]], null)
check('esquema sin tablas -> lo dice', !e5.ok && /no tiene tablas/.test(e5.mensaje), JSON.stringify(e5))

// --- Veredicto ------------------------------------------------------------------------------

hr('RESULTADO (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
