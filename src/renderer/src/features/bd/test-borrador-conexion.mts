#!/usr/bin/env node
// =============================================================================
// Prueba del borrador del diálogo de conexión (npm run test:db-borrador-conexion).
// Fija el alta y la edición, el puerto al cambiar de motor, «¿hay cambios?», lo que
// viaja al main (contraseña de solo escritura, lo descartado, el entorno, la ficha del
// archivo y los opcionales solo con el motor que los declara), el cifrado implícito,
// el SRV y «Pegar URI».
// Decisiones: docs/decisiones/bd/ui-conexion-borrador.md
// =============================================================================

import {
  borradorDesde,
  borradorGuardado,
  borradorNuevo,
  cambiarMotor,
  conArchivoElegido,
  conSrv,
  conUri,
  entradaDe,
  hayCambios,
  tlsImplicito,
  type BorradorConexion
} from './borradorConexion.ts'
import { descriptorDe, MOTORES_CONEXION } from './camposConexion.ts'
import { descomponerUriMongo, descomponerUriRedis } from '../../../../shared/uriConexion.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

const CON: DbConnection = {
  id: 'C1',
  profileId: 'P',
  alias: 'QA-DEMO',
  motor: 'oracle',
  host: '10.1.2.3',
  port: 1521,
  sid: 'DEMO',
  user: 'admdemo',
  tieneSecreto: true,
  readonly: true,
  notas: 'réplica'
}

// ---------------------------------------------------------------------------------
hr('(1) alta')
{
  const b = borradorNuevo('P')
  check('Oracle por defecto en el 1521', b.motor === 'oracle' && b.port === 1521, `${b.motor}:${b.port}`)
  check('Solo lectura marcada', b.readonly === true, 'true')
  check("contraseña ''", b.password === '', j(b.password))
  check('sin id', b.id === undefined, 'undefined')
  const pg = borradorNuevo('P', 'postgres')
  check('PostgreSQL en el 5432', pg.port === 5432, `${pg.port}`)
}

// ---------------------------------------------------------------------------------
hr('(2) edición')
{
  const b = borradorDesde(CON)
  check('id y campos', b.id === 'C1' && b.alias === 'QA-DEMO' && b.sid === 'DEMO' && b.database === '', j(b))
  check('contraseña undefined', b.password === undefined, 'undefined')
  check('notas', b.notas === 'réplica', b.notas)
}

// ---------------------------------------------------------------------------------
hr('(3) motor')
{
  const b = borradorNuevo('P')
  const pg = cambiarMotor(b, 'postgres')
  check('resetea el puerto', pg.motor === 'postgres' && pg.port === 5432, `${pg.port}`)
  check('el mismo motor: el mismo objeto', cambiarMotor(b, 'oracle') === b, 'identidad')
  check('no muta el original', b.motor === 'oracle', b.motor)
}

// ---------------------------------------------------------------------------------
hr('(4) ¿hay cambios?')
{
  const orig = borradorDesde(CON)
  check('alta: siempre', hayCambios(borradorNuevo('P'), null), 'true')
  check('edición intacta: no', !hayCambios(borradorDesde(CON), orig), 'false')
  const campos: Array<[string, Partial<BorradorConexion>]> = [
    ['alias', { alias: 'otro' }],
    ['host', { host: 'h2' }],
    ['port', { port: 1522 }],
    ['database', { database: 'ORCL' }],
    ['sid', { sid: 'X' }],
    ['user', { user: 'u2' }],
    ['readonly', { readonly: false }],
    ['notas', { notas: '' }],
    ['motor', { motor: 'postgres' }],
    ['entorno', { entorno: 'produccion' }]
  ]
  for (const [nombre, parcial] of campos) {
    check(`cambia ${nombre}`, hayCambios({ ...orig, ...parcial }, orig), 'true')
  }
  check('contraseña escrita: sí', hayCambios({ ...orig, password: 'x' }, orig), 'true')
  check("contraseña '': no (conserva)", !hayCambios({ ...orig, password: '' }, orig), 'false')
  const pgOrig: BorradorConexion = { ...orig, motor: 'postgres', sid: '' }
  check('el SID con PostgreSQL no cuenta', !hayCambios({ ...pgOrig, sid: 'X' }, pgOrig), 'false')
}

// ---------------------------------------------------------------------------------
hr('(5) lo que viaja')
{
  const alta = entradaDe(borradorNuevo('P'))
  check("alta sin contraseña manda ''", 'password' in alta && alta.password === '', j(alta.password))
  const altaCon = entradaDe({ ...borradorNuevo('P'), password: 's3cr3t' })
  check('alta con contraseña la manda', altaCon.password === 's3cr3t', 'ok')
  const ed = entradaDe(borradorDesde(CON))
  check('edición sin tocar: NO manda contraseña (conserva)', !('password' in ed), j(Object.keys(ed)))
  const edVacia = entradaDe({ ...borradorDesde(CON), password: '' })
  check("edición vaciada: tampoco (el placeholder promete «sin cambios»)", !('password' in edVacia), j(Object.keys(edVacia)))
  const edNueva = entradaDe({ ...borradorDesde(CON), password: 'nueva' })
  check('edición con contraseña nueva: la manda', edNueva.password === 'nueva', 'ok')
  const pg = entradaDe({ ...borradorDesde(CON), motor: 'postgres', sid: 'DEMO', database: 'app' })
  check('PostgreSQL: el SID va vacío', pg.sid === '' && pg.database === 'app', j([pg.sid, pg.database]))
  check('Oracle: el SID viaja', ed.sid === 'DEMO', j(ed.sid))
  check('sin id en la entrada', !('id' in ed), j(Object.keys(ed)))
  check('perfil, solo lectura y notas', ed.profileId === 'P' && ed.readonly === true && ed.notas === 'réplica', j(ed))
}

// ---------------------------------------------------------------------------------
hr('(6) tras guardar')
{
  const g = borradorGuardado({ ...CON, id: 'NUEVO' })
  check('pasa a edición de lo guardado', g.id === 'NUEVO', j(g.id))
  check('contraseña otra vez «sin cambios»', g.password === undefined, 'undefined')
  check('y sin cambios respecto a sí mismo', !hayCambios(g, borradorGuardado({ ...CON, id: 'NUEVO' })), 'false')
}

// ---------------------------------------------------------------------------------
hr('(7) el descriptor manda')
{
  for (const m of MOTORES_CONEXION) {
    const d = descriptorDe(m)
    // (Un motor sin puerto, SQLite, deja 0 en el borrador.)
    check(`${m}: el alta precarga su puerto`, borradorNuevo('P', m).port === (d.puertoPorDefecto ?? 0), `${d.puertoPorDefecto}`)
    const otro = MOTORES_CONEXION.find((x) => x !== m) ?? m
    check(
      `${m}: cambiar a él precarga su puerto`,
      cambiarMotor(borradorNuevo('P', otro), m).port === (d.puertoPorDefecto ?? 0),
      `${d.puertoPorDefecto}`
    )
    // Todo relleno: lo que llega vacío al main es exactamente lo que el motor descarta.
    const lleno: BorradorConexion = { ...borradorNuevo('P', m), host: 'h', database: 'db', sid: 'sid' }
    const e = entradaDe(lleno)
    const vacios = (['host', 'database', 'sid'] as const).filter((c) => e[c] === '')
    check(
      `${m}: se vacía justo lo que dice descartarAlGuardar`,
      j([...vacios].sort()) === j([...d.descartarAlGuardar].sort()),
      `${j(vacios)} vs ${j(d.descartarAlGuardar)}`
    )
  }
}

// ---------------------------------------------------------------------------------
hr('(8) entorno')
{
  const alta = borradorNuevo('P')
  check('alta: sin entorno', alta.entorno === null, j(alta.entorno))
  check('alta sin entorno: el campo NO viaja', !('entorno' in entradaDe(alta)), j(Object.keys(entradaDe(alta))))
  const altaProd = entradaDe({ ...alta, entorno: 'produccion' })
  check('alta en producción: viaja', altaProd.entorno === 'produccion', j(altaProd.entorno))

  // Edición: lo guardado se lee; lo que no es un entorno válido cuenta como ninguno.
  const prod: DbConnection = { ...CON, entorno: 'produccion' }
  const ed = borradorDesde(prod)
  check('edición: lee el guardado', ed.entorno === 'produccion', j(ed.entorno))
  check('edición: lo re-manda al guardar', entradaDe(ed).entorno === 'produccion', j(entradaDe(ed).entorno))
  check('edición sin entorno en disco: null', borradorDesde(CON).entorno === null, j(borradorDesde(CON).entorno))
  const basura = { ...CON, entorno: 'prod' } as unknown as DbConnection
  check('un valor que no es entorno: null y no se reenvía', borradorDesde(basura).entorno === null && !('entorno' in entradaDe(borradorDesde(basura))), j(borradorDesde(basura).entorno))
  const mayus = { ...CON, entorno: 'PRODUCCION' } as unknown as DbConnection
  check('ni en mayúsculas (mitad negativa de esEntorno)', borradorDesde(mayus).entorno === null, j(borradorDesde(mayus).entorno))

  // Quitar el entorno a una conexión que lo tenía: la entrada va SIN él (en el
  // contrato, ausente = sin entorno), y cuenta como cambio.
  const quitado = { ...ed, entorno: null }
  check('quitarlo es un cambio', hayCambios(quitado, ed), 'true')
  check('y la entrada va sin el campo', !('entorno' in entradaDe(quitado)), j(Object.keys(entradaDe(quitado))))
  check('cambiar de uno a otro es un cambio', hayCambios({ ...ed, entorno: 'pruebas' }, ed), 'true')
  check('el mismo entorno no es un cambio', !hayCambios({ ...ed, entorno: 'produccion' }, ed), 'false')
  check('tras guardar, el entorno se queda', borradorGuardado(prod).entorno === 'produccion', j(borradorGuardado(prod).entorno))
}

// ---------------------------------------------------------------------------------
hr('(9) motor de archivo')
{
  const elegido = { token: 'T1', nombre: 'ventas.2024.db' }
  const alta = conArchivoElegido(borradorNuevo('P', 'sqlite'), elegido)
  check('elegir: nombre, ficha y alias del archivo sin extensión', alta.archivo === 'ventas.2024.db' && alta.alias === 'ventas.2024' && j(alta.origenArchivo) === j({ tipo: 'elegido', token: 'T1' }), j(alta))
  check('elegir no toca «Solo lectura»', alta.readonly === true, j(alta.readonly))
  // La casilla solo limita a los agentes: una base CREADA nace con la recomendada (marcada)
  // como cualquier otra; sin ella daría escritura a tdb.
  const creada = conArchivoElegido(borradorNuevo('P', 'sqlite'), { token: 'T2', nombre: 'nueva.db' })
  check('una base CREADA nace con «Solo lectura para los agentes» (la recomendada)', creada.readonly === true, j(creada.readonly))
  const conNombre = conArchivoElegido({ ...borradorNuevo('P', 'sqlite'), alias: 'Mía' }, elegido)
  check('un nombre ya escrito no se pisa', conNombre.alias === 'Mía', conNombre.alias)
  const sinPunto = conArchivoElegido(borradorNuevo('P', 'sqlite'), { token: 'T3', nombre: '.oculta' })
  check('un nombre que empieza por punto se queda entero', sinPunto.alias === '.oculta', sinPunto.alias)

  const e = entradaDe(alta)
  check('la entrada lleva la FICHA, no una ruta', j(e.archivo) === j({ tipo: 'elegido', token: 'T1' }), j(e.archivo))
  check('y el puerto 0', e.port === 0, j(e.port))
  // La contraseña que quedó escrita con otro motor no viaja en uno sin credenciales.
  const conClave = { ...cambiarMotor({ ...borradorNuevo('P', 'oracle'), password: 'secreta' }, 'sqlite'), archivo: 'a.db' }
  check('un motor sin credenciales NO manda contraseña', !('password' in entradaDe(conClave)), j(Object.keys(entradaDe(conClave))))
  check('Oracle sigue mandándola en el alta', entradaDe({ ...borradorNuevo('P', 'oracle'), password: 'x' }).password === 'x', 'x')
  check('ni un archivo en un motor de red', !('archivo' in entradaDe({ ...borradorNuevo('P', 'oracle'), origenArchivo: { tipo: 'elegido', token: 'T' } })), 'sin archivo')

  // Edición: el archivo guardado viaja AUSENTE (se conserva); uno elegido de nuevo es un
  // cambio aunque se llame igual.
  const guardada: DbConnection = {
    id: 'S1',
    profileId: 'P',
    alias: 'ventas',
    motor: 'sqlite',
    host: '',
    port: 0,
    user: '',
    tieneSecreto: false,
    readonly: true,
    archivoVisible: 'ventas.db'
  }
  const ed = borradorDesde(guardada)
  check('edición: el nombre del archivo guardado', ed.archivo === 'ventas.db' && ed.origenArchivo === undefined, j(ed))
  check('edición sin tocar: sin cambios', !hayCambios(ed, ed), 'false')
  check('edición sin archivo nuevo: no viaja (se conserva)', !('archivo' in entradaDe(ed)), j(Object.keys(entradaDe(ed))))
  const otroIgual = conArchivoElegido(ed, { token: 'T9', nombre: 'ventas.db' })
  check('elegir otro con el mismo nombre ES un cambio', hayCambios(otroIgual, ed), 'true')
  check('y viaja su ficha', j(entradaDe(otroIgual).archivo) === j({ tipo: 'elegido', token: 'T9' }), j(entradaDe(otroIgual).archivo))
}

// ---------------------------------------------------------------------------------
hr('(10) SQL Server: los opcionales viajan SOLO con el motor que los declara')
{
  // La entrada de Oracle y PG, al byte: ni una clave nueva.
  const CLAVES_RED = ['profileId', 'alias', 'motor', 'host', 'port', 'database', 'sid', 'user', 'readonly', 'notas', 'password']
  for (const m of ['oracle', 'postgres'] as const) {
    const b = { ...borradorNuevo('P', m), instancia: 'X', autenticacion: 'ntlm' as const, dominio: 'D', tls: { cifrar: false, confiarCertificado: true } }
    check(`${m}: la entrada lleva las claves de siempre (ni instancia, ni autenticación, ni dominio, ni cifrado)`, j(Object.keys(entradaDe(b))) === j(CLAVES_RED), j(Object.keys(entradaDe(b))))
    const orig = borradorDesde({ ...CON, motor: m })
    check(`${m}: cambiar un opcional escrito no es un cambio (no viaja)`, !hayCambios({ ...orig, instancia: 'X', dominio: 'D' }, orig), 'false')
  }
  const alta = borradorNuevo('P', 'sqlserver')
  check('alta: puerto 1433, sin instancia, usuario de SQL Server, cifrar y verificar', alta.port === 1433 && alta.instancia === '' && alta.autenticacion === 'sql' && j(alta.tls) === j({ cifrar: true, confiarCertificado: false }), j(alta))
  const e = entradaDe({ ...alta, alias: 'SQLS', host: 'h', user: 'u' })
  check(
    'alta: viajan instancia, autenticación y cifrado ENTEROS; sin dominio con usuario de SQL Server',
    e.instancia === '' && e.autenticacion === 'sql' && j(e.tls) === j({ cifrar: true, confiarCertificado: false }) && !('dominio' in e),
    j(e)
  )
  const ntlm = entradaDe({ ...alta, alias: 'SQLS', host: 'h', user: 'u', autenticacion: 'ntlm', dominio: ' EMPRESA ', instancia: ' SQLEXPRESS ' })
  check('NTLM: el dominio viaja (recortado), la instancia también', ntlm.dominio === 'EMPRESA' && ntlm.instancia === 'SQLEXPRESS' && ntlm.autenticacion === 'ntlm', j(ntlm))
  check('sin base: la base viaja vacía (el árbol tendrá nivel «Bases»)', e.database === '', j(e.database))

  // Edición: lo guardado vuelve al borrador; tocar un opcional ES un cambio.
  const guardada: DbConnection = {
    ...CON,
    id: 'M1',
    motor: 'sqlserver',
    port: 1433,
    database: undefined,
    sid: undefined,
    instancia: 'SQLEXPRESS',
    autenticacion: 'ntlm',
    dominio: 'EMPRESA',
    tls: { cifrar: true, confiarCertificado: true }
  }
  const ed = borradorDesde(guardada)
  check('edición: lee instancia, autenticación, dominio y cifrado', ed.instancia === 'SQLEXPRESS' && ed.autenticacion === 'ntlm' && ed.dominio === 'EMPRESA' && ed.tls.confiarCertificado, j(ed))
  check('edición intacta: sin cambios', !hayCambios(ed, ed), 'false')
  check('desmarcar «Confiar en el certificado» es un cambio', hayCambios({ ...ed, tls: { cifrar: true, confiarCertificado: false } }, ed), 'true')
  check('cambiar la instancia es un cambio', hayCambios({ ...ed, instancia: 'OTRA' }, ed), 'true')
  check('pasar a usuario de SQL Server es un cambio (y el dominio deja de viajar)', hayCambios({ ...ed, autenticacion: 'sql' }, ed) && !('dominio' in entradaDe({ ...ed, autenticacion: 'sql' })), 'true')
  check('con usuario de SQL Server, tocar el dominio (oculto) no es un cambio', !hayCambios({ ...ed, autenticacion: 'sql', dominio: 'X' }, { ...ed, autenticacion: 'sql' }), 'false')
  // Lo que llega del disco se valida: una autenticación desconocida es la de partida.
  const rara = borradorDesde({ ...guardada, autenticacion: 'kerberos' as unknown as 'sql' })
  check('autenticación desconocida en disco: la de partida (sql)', rara.autenticacion === 'sql', rara.autenticacion)
  const sinTls = borradorDesde({ ...guardada, tls: undefined })
  check('sin cifrado en disco: cifrar y verificar', j(sinTls.tls) === j({ cifrar: true, confiarCertificado: false }), j(sinTls.tls))
  // Cambiar de motor y volver no pierde lo escrito (como el SID).
  const ida = cambiarMotor({ ...alta, instancia: 'SQLEXPRESS' }, 'postgres')
  check('cambiar a PG y volver conserva la instancia escrita', cambiarMotor(ida, 'sqlserver').instancia === 'SQLEXPRESS' && cambiarMotor(ida, 'sqlserver').port === 1433, 'ok')
}

// ---------------------------------------------------------------------------------
hr('(11) MongoDB: SRV, opciones de la URI, cifrado del motor y «Pegar URI»')
{
  const SIN = { cifrar: false, confiarCertificado: false }
  const CIFRA = { cifrar: true, confiarCertificado: false }
  const alta = borradorNuevo('P', 'mongodb')
  check('alta: sin SRV, sin opciones y SIN cifrar (el del motor, no TLS_POR_DEFECTO)', !alta.srv && alta.opcionesUri === '' && j(alta.tls) === j(SIN) && alta.port === 27017, j(alta))
  check('tlsImplicito: MongoDB sin SRV no cifra; con SRV, sí', j(tlsImplicito('mongodb', false)) === j(SIN) && j(tlsImplicito('mongodb', true)) === j(CIFRA), 'ok')
  check('tlsImplicito: SQL Server cifra (y el SRV no le aplica)', j(tlsImplicito('sqlserver', false)) === j(CIFRA) && j(tlsImplicito('sqlserver', true)) === j(CIFRA), 'ok')
  const e = entradaDe({ ...alta, alias: 'M', host: 'h', opcionesUri: ' replicaSet=rs0 ' })
  check('la entrada lleva srv, opcionesUri (recortadas) y el cifrado enteros', e.srv === false && e.opcionesUri === 'replicaSet=rs0' && j(e.tls) === j(SIN), j(e))
  // Mitad negativa: SQL Server, Oracle y PG no mandan srv ni opcionesUri aunque estén escritos.
  for (const m of ['oracle', 'postgres', 'sqlserver'] as const) {
    const en = entradaDe({ ...borradorNuevo('P', m), alias: 'X', host: 'h', user: 'u', srv: true, opcionesUri: 'a=1' })
    check(`${m}: sin srv ni opcionesUri en la entrada`, !('srv' in en) && !('opcionesUri' in en), j(Object.keys(en)))
  }
  check('SQL Server: su alta sigue cifrando (no cambia)', j(borradorNuevo('P', 'sqlserver').tls) === j(CIFRA), j(borradorNuevo('P', 'sqlserver').tls))

  // Cambiar de motor: el cifrado sigue al del motor si nadie lo tocó.
  const deOracle = cambiarMotor(borradorNuevo('P'), 'mongodb')
  check('de Oracle (el alta por defecto) a MongoDB: sin cifrar', j(deOracle.tls) === j(SIN) && deOracle.port === 27017, j(deOracle.tls))
  check('y de vuelta a SQL Server: cifrar', j(cambiarMotor(deOracle, 'sqlserver').tls) === j(CIFRA), j(cambiarMotor(deOracle, 'sqlserver').tls))
  const tocado = cambiarMotor({ ...borradorNuevo('P', 'sqlserver'), tls: { cifrar: true, confiarCertificado: true } }, 'mongodb')
  check('con el cifrado tocado, cambiar de motor lo conserva', j(tocado.tls) === j({ cifrar: true, confiarCertificado: true }), j(tocado.tls))

  // El SRV arrastra el cifrado (si nadie lo tocó) y el puerto (si no vale).
  const conS = conSrv(alta, true)
  check('marcar SRV: cifrar', conS.srv && j(conS.tls) === j(CIFRA) && conS.port === 27017, j(conS))
  check('desmarcarlo: vuelve a sin cifrar', j(conSrv(conS, false).tls) === j(SIN) && !conSrv(conS, false).srv, j(conSrv(conS, false).tls))
  const decidido = conSrv({ ...alta, tls: { cifrar: true, confiarCertificado: true } }, true)
  check('con el cifrado tocado, el SRV no lo cambia', j(decidido.tls) === j({ cifrar: true, confiarCertificado: true }), j(decidido.tls))
  const apagadoSinCifrar = conSrv({ ...conS, tls: SIN }, false)
  check('SRV con el cifrado desmarcado a mano: desmarcar el SRV lo deja como está', j(apagadoSinCifrar.tls) === j(SIN), j(apagadoSinCifrar.tls))
  check('marcar SRV con un puerto inválido: vuelve al del motor', conSrv({ ...alta, port: 0 }, true).port === 27017, j(conSrv({ ...alta, port: 0 }, true).port))
  check('marcar SRV con un puerto válido: se conserva', conSrv({ ...alta, port: 27117 }, true).port === 27117, 'ok')
  check('el mismo valor: el MISMO borrador', conSrv(alta, false) === alta, 'identidad')

  // Edición: se leen del disco; tocarlos es un cambio.
  const guardada: DbConnection = { ...CON, id: 'MG', motor: 'mongodb', port: 27017, sid: undefined, srv: true, opcionesUri: 'appName=x', tls: CIFRA }
  const ed = borradorDesde(guardada)
  check('edición: lee srv, opcionesUri y cifrado', ed.srv && ed.opcionesUri === 'appName=x' && j(ed.tls) === j(CIFRA), j(ed))
  check('edición intacta: sin cambios', !hayCambios(ed, ed), 'false')
  check('desmarcar el SRV es un cambio', hayCambios(conSrv(ed, false), ed), 'true')
  check('cambiar las opciones es un cambio', hayCambios({ ...ed, opcionesUri: 'appName=y' }, ed), 'true')
  check('sin cifrado en disco: el del motor (sin cifrar)', j(borradorDesde({ ...guardada, tls: undefined }).tls) === j(SIN), j(borradorDesde({ ...guardada, tls: undefined }).tls))
  check('sin srv ni opciones en disco (registro anterior a esos campos): false y ""', !borradorDesde({ ...guardada, srv: undefined, opcionesUri: undefined }).srv && borradorDesde({ ...guardada, srv: undefined, opcionesUri: undefined }).opcionesUri === '', 'ok')

  // «Pegar URI».
  const u = descomponerUriMongo('mongodb://ana:p%40ss@db.local:27018/ventas?replicaSet=rs0&tls=true')
  if (!u.ok) throw new Error(u.error)
  const pegada = conUri({ ...alta, alias: 'VENTAS' }, u.campos)
  check(
    'pegar: host, puerto, usuario, contraseña, base, srv, cifrado y opciones (el nombre no se toca)',
    pegada.host === 'db.local' && pegada.port === 27018 && pegada.user === 'ana' && pegada.password === 'p@ss' && pegada.database === 'ventas' && !pegada.srv && j(pegada.tls) === j(CIFRA) && pegada.opcionesUri === 'replicaSet=rs0' && pegada.authSource === 'ventas' && pegada.alias === 'VENTAS',
    j(pegada)
  )
  // La base de autenticación va en su campo y vuelve a las opciones al guardar.
  check(
    '(#40) lo pegado viaja con el authSource DONDE estaba (tras replicaSet)',
    entradaDe(pegada).opcionesUri === 'replicaSet=rs0&authSource=ventas',
    String(entradaDe(pegada).opcionesUri)
  )
  {
    const conAuth: DbConnection = { ...guardada, opcionesUri: 'appName=x&authsource=%24external&w=1' }
    const e2 = borradorDesde(conAuth)
    check(
      '(#40) editar: el authSource sale a su campo (decodificado) y el resto se queda en las opciones',
      e2.authSource === '$external' && e2.opcionesUri === 'appName=x&w=1',
      j({ a: e2.authSource, o: e2.opcionesUri })
    )
    check(
      '(#40) sin tocarlo, viaja AL BYTE como estaba (clave, codificación y sitio): no desverifica ni cuenta como cambio',
      entradaDe(e2).opcionesUri === conAuth.opcionesUri && !hayCambios(e2, e2) && !hayCambios({ ...e2, readonly: e2.readonly }, e2),
      String(entradaDe(e2).opcionesUri)
    )
    const cambiada = { ...e2, authSource: 'admin' }
    check(
      '(#40) cambiarlo es un cambio y va en el mismo sitio, codificado',
      hayCambios(cambiada, e2) && entradaDe(cambiada).opcionesUri === 'appName=x&authSource=admin&w=1',
      String(entradaDe(cambiada).opcionesUri)
    )
    check('(#40) vaciarlo lo quita de las opciones', entradaDe({ ...e2, authSource: ' ' }).opcionesUri === 'appName=x&w=1', String(entradaDe({ ...e2, authSource: '' }).opcionesUri))
    const nueva = entradaDe({ ...alta, alias: 'N', host: 'h', user: 'u', password: 'p', authSource: 'a b', opcionesUri: 'w=1' })
    check('(#40) un alta con base de autenticación: al final y codificada', nueva.opcionesUri === 'w=1&authSource=a%20b', String(nueva.opcionesUri))
    const redis = entradaDe({ ...borradorNuevo('P', 'redis'), alias: 'R', host: 'h', authSource: 'admin' })
    check('(#40) mitad negativa: con Redis no viaja (no lleva opciones)', !('opcionesUri' in redis), j(redis))
  }
  const s = descomponerUriMongo('mongodb+srv://c.example.net/')
  if (!s.ok) throw new Error(s.error)
  const pegadaSrv = conUri({ ...alta, port: 27117, password: 'tecleada' }, s.campos)
  check('pegar srv: el puerto que había se queda (apagado); en un alta sin clave, la contraseña queda vacía', pegadaSrv.srv && pegadaSrv.port === 27117 && pegadaSrv.password === '', j(pegadaSrv))
  check('pegar srv sobre un puerto inválido: el del motor', conUri({ ...alta, port: 0 }, s.campos).port === 27017, 'ok')
  const enEdicion = conUri(ed, s.campos)
  check('en una edición, una URI sin contraseña CONSERVA la guardada (undefined)', enEdicion.password === undefined && !('password' in entradaDe(enEdicion)), j(enEdicion.password))
  check('en una edición, una URI con contraseña la manda', entradaDe(conUri(ed, u.campos)).password === 'p@ss', 'ok')
}

// ---------------------------------------------------------------------------------
hr('(12) Redis: cifrado del motor y «Pegar URI» redis:// y rediss://')
{
  const SIN = { cifrar: false, confiarCertificado: false }
  const CIFRA = { cifrar: true, confiarCertificado: false }
  const alta = borradorNuevo('P', 'redis')
  check('alta: puerto 6379 y SIN cifrar (el del motor, no TLS_POR_DEFECTO)', alta.port === 6379 && j(alta.tls) === j(SIN), j(alta))
  check('tlsImplicito: Redis no cifra (y el SRV no le aplica)', j(tlsImplicito('redis', false)) === j(SIN) && j(tlsImplicito('redis', true)) === j(SIN), 'ok')
  const e = entradaDe({ ...alta, alias: 'R', host: 'h', database: '3', srv: true, opcionesUri: 'a=1' })
  check('la entrada lleva el cifrado y la base; ni srv ni opcionesUri (no los declara)', j(e.tls) === j(SIN) && e.database === '3' && !('srv' in e) && !('opcionesUri' in e), j(e))
  check('de SQL Server (cifra) a Redis sin tocarlo: sin cifrar', j(cambiarMotor(borradorNuevo('P', 'sqlserver'), 'redis').tls) === j(SIN), 'ok')
  check('sin cifrado en disco: el del motor (sin cifrar)', j(borradorDesde({ ...CON, id: 'R1', motor: 'redis', port: 6379, sid: undefined }).tls) === j(SIN), 'ok')

  // «Pegar URI».
  const u = descomponerUriRedis('redis://ana:p%40ss@cache.local:6380/5?family=6')
  if (!u.ok) throw new Error(u.error)
  const pegada = conUri({ ...alta, alias: 'CACHE', srv: true, opcionesUri: 'x=1' }, u.campos)
  check(
    'pegar: host, puerto, usuario, contraseña, base y cifrado (el nombre, el SRV y las opciones no se tocan)',
    pegada.host === 'cache.local' && pegada.port === 6380 && pegada.user === 'ana' && pegada.password === 'p@ss' && pegada.database === '5' && j(pegada.tls) === j(SIN) && pegada.alias === 'CACHE' && pegada.srv && pegada.opcionesUri === 'x=1',
    j(pegada)
  )
  const s = descomponerUriRedis('rediss://:secreto@nube.example.net')
  if (!s.ok) throw new Error(s.error)
  const cifrada = conUri(alta, s.campos)
  check('rediss://: cifra; sin puerto, 6379; la clave sola, usuario vacío; sin base, vacía', j(cifrada.tls) === j(CIFRA) && cifrada.port === 6379 && cifrada.user === '' && cifrada.password === 'secreto' && cifrada.database === '', j(cifrada))
  check('y viaja cifrada', j(entradaDe({ ...cifrada, alias: 'N' }).tls) === j(CIFRA), 'ok')
  const guardada: DbConnection = { ...CON, id: 'R2', motor: 'redis', port: 6379, sid: undefined, database: '1', tls: SIN }
  const ed = borradorDesde(guardada)
  const sinClave = descomponerUriRedis('redis://cache.local/2')
  if (!sinClave.ok) throw new Error(sinClave.error)
  const enEdicion = conUri(ed, sinClave.campos)
  check('en una edición, una URI sin contraseña CONSERVA la guardada', enEdicion.password === undefined && !('password' in entradaDe(enEdicion)), j(enEdicion.password))
  check('y cambiar la base por la URI es un cambio', enEdicion.database === '2' && hayCambios(enEdicion, ed), 'true')
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
