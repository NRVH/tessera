#!/usr/bin/env node
// =============================================================================
// Prueba del formulario de conexión por motor (npm run test:db-campos-conexion).
// Fija filas, etiquetas y ayudas de cada motor, que las reglas son las del descriptor
// compartido, lo que se marca (con PARIDAD contra las reglas del main copiadas aquí y
// contra `validarOpcional` y las validaciones en vivo), lo que se descarta al guardar,
// la sección de clientes, el entorno, la ayuda de solo lectura y «Pegar URI».
// Decisiones: docs/decisiones/bd/ui-conexion-campos.md
// =============================================================================

import {
  ayudaEntorno,
  ayudaSinClientes,
  ayudaSoloLectura,
  motorPorNombreDeArchivo,
  ayudasTrasFila,
  fraseSinClientes,
  camposAMarcar,
  entornoDeRadio,
  OPCIONES_ENTORNO,
  valorRadioEntorno,
  camposVisibles,
  DESCRIPTORES,
  descriptorDe,
  driversDelMotor,
  enConflicto,
  faltantes,
  limpiarParaGuardar,
  listoParaGuardar,
  mostrarClientes,
  MOTORES_CONEXION,
  ordenFormulario,
  PRESENTACION,
  requiereAplica,
  usaClientes,
  type CampoConexion,
  type ClienteDeMotor,
  type ValoresConexion
} from './camposConexion.ts'
import { borradorNuevo, entradaDe, type BorradorConexion } from './borradorConexion.ts'
import {
  avisoDeCampo,
  ayudasTrasFilaCredenciales,
  campoDeshabilitado,
  campoVisible,
  ETIQUETA_CONFIAR_CERTIFICADO,
  ETIQUETA_SOLO_LECTURA,
  TITULO_SOLO_LECTURA_AGENTES,
  placeholderCredencial,
  proponeConfiarCertificado
} from './camposConexion.ts'
import { validarOpcional } from '../../../../main/db/opcionalesConexion.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ALIAS_MAX, ENTORNOS, NOMBRE_ENTORNO } from '../../../../shared/db-ipc.ts'
import { limpiarDestinoBd } from '../../../../shared/destinoBd.ts'
import { IDS_MOTORES, MOTORES, descriptor } from '../../../../shared/motores/index.ts'
import { validarBaseRedis, validarOpcionesUriMongo } from '../../../../shared/uriConexion.ts'
import type { DbConnectionInput, DbMotor } from '../../../../shared/db-ipc.ts'

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

/** Un borrador de ese motor con todo lo obligatorio relleno. */
function valido(motor: DbMotor, parcial: Partial<ValoresConexion> = {}): ValoresConexion {
  return {
    motor,
    alias: 'DEV',
    host: '10.0.0.1',
    port: descriptor(motor).conexion.puertoPorDefecto ?? 0,
    database: 'ORCL',
    sid: '',
    user: 'u',
    // Un motor de archivo tiene su archivo elegido (los de red lo ignoran).
    archivo: 'base.db',
    ...parcial
  }
}

// ---------------------------------------------------------------------------------
hr('(1) cada motor tiene descriptor')
{
  // Se lee el registro: cruzarlo con una tabla DERIVADA de él sería circular. Los valores
  // los fijan (2) y (3).
  check('un descriptor del formulario por motor del registro', j(Object.keys(DESCRIPTORES)) === j(IDS_MOTORES), j(Object.keys(DESCRIPTORES)))
  check('el selector ofrece los motores del registro, en su orden', j(MOTORES_CONEXION) === j(IDS_MOTORES), j(MOTORES_CONEXION))
  // El orden de hoy, sin romperse al sumar un motor: los dos de siempre van delante.
  check(
    'y empieza por Oracle y luego PostgreSQL',
    j(MOTORES_CONEXION.slice(0, 2)) === j(['oracle', 'postgres']),
    j(MOTORES_CONEXION)
  )
  for (const m of MOTORES_CONEXION) {
    const d = descriptorDe(m)
    check(`${m}: es el suyo`, d.motor === m, d.motor)
    check(`${m}: etiqueta del registro`, d.etiqueta === descriptor(m).etiqueta, d.etiqueta)
    check(`${m}: puerto del registro`, d.puertoPorDefecto === descriptor(m).conexion.puertoPorDefecto, `${d.puertoPorDefecto}`)
  }
}

// ---------------------------------------------------------------------------------
hr('(1b) las reglas son las del descriptor compartido; la ayuda, de la presentación')
{
  check('un descriptor por motor del registro', j(Object.keys(DESCRIPTORES)) === j(IDS_MOTORES), j(Object.keys(DESCRIPTORES)))
  check('una presentación por motor del registro', j(Object.keys(PRESENTACION)) === j(IDS_MOTORES), j(Object.keys(PRESENTACION)))
  for (const m of IDS_MOTORES) {
    const d = descriptorDe(m)
    const c = MOTORES[m].conexion
    check(`${m}: etiqueta del descriptor`, d.etiqueta === MOTORES[m].etiqueta, d.etiqueta)
    check(`${m}: puerto del descriptor`, d.puertoPorDefecto === c.puertoPorDefecto, `${d.puertoPorDefecto}`)
    // La MISMA lista, no una copia: una regla cambiada allí la ven a la vez el main y el diálogo.
    check(`${m}: obligatorios del descriptor`, d.obligatorios === c.obligatorios, j(d.obligatorios))
    check(`${m}: descartarAlGuardar del descriptor`, d.descartarAlGuardar === c.descartarAlGuardar, j(d.descartarAlGuardar))
    check(`${m}: usaClientes del descriptor`, d.usaClientes === c.usaClientes, `${d.usaClientes}`)
    check(
      `${m}: excluyentes del descriptor (campos y «al menos uno»)`,
      j(d.excluyentes.map((g) => [g.campos, g.alMenosUno])) === j(c.excluyentes.map((g) => [g.campos, g.alMenosUno])),
      j(d.excluyentes.map((g) => g.campos))
    )
    check(
      `${m}: una ayuda por grupo excluyente`,
      PRESENTACION[m].ayudasExcluyentes.length === c.excluyentes.length,
      `${PRESENTACION[m].ayudasExcluyentes.length} para ${c.excluyentes.length}`
    )
    check(`${m}: ninguna ayuda vacía`, d.excluyentes.every((g) => g.ayuda.trim() !== ''), j(d.excluyentes.map((g) => g.ayuda)))
    check(`${m}: las filas son las de su presentación`, d.filas === PRESENTACION[m].filas, `${d.filas.length} filas`)
  }
}

// ---------------------------------------------------------------------------------
hr('(2) Oracle')
{
  const d = descriptorDe('oracle')
  const filas = d.filas.map((f) => f.map((c) => c.campo))
  check('filas: [host, puerto] y [service name, SID]', j(filas) === j([['host', 'port'], ['database', 'sid']]), j(filas))
  check('visibles en orden', j(camposVisibles('oracle')) === j(['host', 'port', 'database', 'sid']), j(camposVisibles('oracle')))
  const etiquetas = d.filas.flat().map((c) => c.etiqueta)
  check('etiquetas', j(etiquetas) === j(['Host', 'Puerto', 'Service Name', 'SID']), j(etiquetas))
  const db = d.filas[1][0]
  check('placeholder del servicio', db.placeholder === 'ORCL', j(db.placeholder))
  check('placeholder del host', d.filas[0][0].placeholder === '10.0.0.1', j(d.filas[0][0].placeholder))
  check('el puerto es numérico', d.filas[0][1].tipo === 'puerto', d.filas[0][1].tipo)
  const anchos = d.filas.flat().map((c) => c.ancho)
  check('anchos: crece, puerto, crece, medio', j(anchos) === j(['crece', 'puerto', 'crece', 'medio']), j(anchos))
  check('etiqueta y puerto', d.etiqueta === 'Oracle' && d.puertoPorDefecto === 1521, `${d.etiqueta}:${d.puertoPorDefecto}`)
  check('usa clientes', usaClientes('oracle') === true, 'true')
  check('no descarta nada', d.descartarAlGuardar.length === 0, j(d.descartarAlGuardar))
  check(
    'obligatorios: nombre, host, puerto, usuario',
    j(d.obligatorios) === j(['alias', 'host', 'port', 'user']),
    j(d.obligatorios)
  )
  check('un grupo excluyente', d.excluyentes.length === 1, `${d.excluyentes.length}`)
  const g = d.excluyentes[0]
  check('Service Name o SID, y al menos uno', j(g.campos) === j(['database', 'sid']) && g.alMenosUno, j(g))
  check(
    'con la ayuda de siempre',
    g.ayuda === 'Service Name o SID, no los dos. Las 11g heredadas suelen ir por SID.',
    g.ayuda
  )
  check('la ayuda va bajo la fila del SID', j(ayudasTrasFila('oracle', 1)) === j([g.ayuda]), j(ayudasTrasFila('oracle', 1)))
  check('y no bajo la de host', ayudasTrasFila('oracle', 0).length === 0, j(ayudasTrasFila('oracle', 0)))
  check('fila inexistente: nada', ayudasTrasFila('oracle', 9).length === 0, '[]')
  check(
    'orden del formulario',
    j(ordenFormulario('oracle')) === j(['alias', 'host', 'port', 'database', 'sid', 'user']),
    j(ordenFormulario('oracle'))
  )
}

// ---------------------------------------------------------------------------------
hr('(3) PostgreSQL')
{
  const d = descriptorDe('postgres')
  const filas = d.filas.map((f) => f.map((c) => c.campo))
  check('filas: [host, puerto] y [base de datos]', j(filas) === j([['host', 'port'], ['database']]), j(filas))
  check('sin SID', !camposVisibles('postgres').includes('sid'), j(camposVisibles('postgres')))
  const db = d.filas[1][0]
  check('«Base de datos» con placeholder mi_base', db.etiqueta === 'Base de datos' && db.placeholder === 'mi_base', j(db))
  check('etiqueta y puerto', d.etiqueta === 'PostgreSQL' && d.puertoPorDefecto === 5432, `${d.etiqueta}:${d.puertoPorDefecto}`)
  check('NO usa clientes', usaClientes('postgres') === false, 'false')
  check('descarta el SID', j(d.descartarAlGuardar) === j(['sid']), j(d.descartarAlGuardar))
  check('sin excluyentes', d.excluyentes.length === 0, '[]')
  check('la base es obligatoria', d.obligatorios.includes('database'), j(d.obligatorios))
  check(
    'obligatorios: nombre, host, puerto, base, usuario',
    j(d.obligatorios) === j(['alias', 'host', 'port', 'database', 'user']),
    j(d.obligatorios)
  )
  check('sin ayudas bajo ninguna fila', d.filas.every((_, i) => ayudasTrasFila('postgres', i).length === 0), '[]')
}

// ---------------------------------------------------------------------------------
hr('(4) coherencia de cada descriptor')
{
  for (const m of MOTORES_CONEXION) {
    const d = descriptorDe(m)
    const vis = new Set<string>(camposVisibles(m))
    // El archivo de un motor de archivo no es una fila de texto: es el selector común del
    // diálogo, como el nombre y el usuario.
    const comunes = new Set<string>(d.deArchivo ? ['alias', 'user', 'archivo'] : ['alias', 'user'])
    check(
      `${m}: los obligatorios se ven (o son comunes)`,
      d.obligatorios.every((c) => vis.has(c) || comunes.has(c)),
      j(d.obligatorios)
    )
    check(`${m}: los excluyentes se ven`, d.excluyentes.every((g) => g.campos.every((c) => vis.has(c))), j(d.excluyentes))
    const textoNoVisible = (['host', 'database', 'sid'] as const).filter((c) => !vis.has(c))
    check(
      `${m}: se descarta EXACTAMENTE lo que no se ve`,
      j([...d.descartarAlGuardar].sort()) === j([...textoNoVisible].sort()),
      `${j(d.descartarAlGuardar)} vs ${j(textoNoVisible)}`
    )
    if (d.deArchivo) {
      check(`${m}: motor de archivo: ni host ni puerto`, !vis.has('host') && !vis.has('port') && d.puertoPorDefecto === null, j([...vis]))
    } else {
      check(`${m}: host y puerto siempre`, vis.has('host') && vis.has('port'), j([...vis]))
    }
    const repetidos = camposVisibles(m).length !== vis.size
    check(`${m}: ningún campo dos veces`, !repetidos, j(camposVisibles(m)))
  }
}

// ---------------------------------------------------------------------------------
hr('(5) faltantes, conflictos y marcas')
{
  const vacioOra = { ...borradorNuevo('P', 'oracle') }
  check(
    'Oracle vacío: nombre, host, servicio, SID y usuario (el puerto viene puesto)',
    j(faltantes(vacioOra)) === j(['alias', 'host', 'database', 'sid', 'user']),
    j(faltantes(vacioOra))
  )
  const vacioPg = { ...borradorNuevo('P', 'postgres') }
  check(
    'PostgreSQL vacío: nombre, host, base y usuario',
    j(faltantes(vacioPg)) === j(['alias', 'host', 'database', 'user']),
    j(faltantes(vacioPg))
  )
  check('Oracle completo por servicio: nada', listoParaGuardar(valido('oracle')), j(camposAMarcar(valido('oracle'))))
  check(
    'Oracle solo por SID: nada',
    listoParaGuardar(valido('oracle', { database: '', sid: 'DEMO' })),
    j(camposAMarcar(valido('oracle', { database: '', sid: 'DEMO' })))
  )
  const ambos = valido('oracle', { sid: 'DEMO' })
  check('Oracle con los dos: chocan los dos', j(enConflicto(ambos)) === j(['database', 'sid']), j(enConflicto(ambos)))
  check('y no «faltan»', faltantes(ambos).length === 0, j(faltantes(ambos)))
  check('y se marcan', j(camposAMarcar(ambos)) === j(['database', 'sid']), j(camposAMarcar(ambos)))
  const pgConSid = valido('postgres', { database: 'app', sid: 'X' })
  check('PostgreSQL con SID escrito: no choca (se descarta)', listoParaGuardar(pgConSid), j(camposAMarcar(pgConSid)))
  const pgSinBase = valido('postgres', { database: '', sid: 'X' })
  check('PostgreSQL sin base y con SID: falta la base', j(faltantes(pgSinBase)) === j(['database']), j(faltantes(pgSinBase)))
  check(
    "host 'http://' falta (el main guardaría '')",
    j(faltantes(valido('oracle', { host: 'http://' }))) === j(['host']),
    j(faltantes(valido('oracle', { host: 'http://' })))
  )
  check(
    "servicio '/' con SID vacío: faltan los dos",
    j(faltantes(valido('oracle', { database: ' / ' }))) === j(['database', 'sid']),
    j(faltantes(valido('oracle', { database: ' / ' })))
  )
  check(
    'host:puerto pegado NO falta (limpiarDestinoBd lo respeta)',
    faltantes(valido('oracle', { host: 'srv-bd:1521' })).length === 0,
    j(limpiarDestinoBd('srv-bd:1521'))
  )
  for (const port of [0, Number.NaN, -1, 65536, 1.5]) {
    check(`puerto ${port} se marca`, j(faltantes(valido('postgres', { port }))) === j(['port']), j(faltantes(valido('postgres', { port }))))
  }
  for (const port of [1, 65535]) {
    check(`puerto ${port} vale`, faltantes(valido('postgres', { port })).length === 0, '[]')
  }
  check('nombre de espacios se marca', j(faltantes(valido('oracle', { alias: '   ' }))) === j(['alias']), 'alias')
  check(
    `nombre de ${ALIAS_MAX + 1} se marca; de ${ALIAS_MAX}, no`,
    faltantes(valido('oracle', { alias: 'x'.repeat(ALIAS_MAX + 1) })).includes('alias') &&
      !faltantes(valido('oracle', { alias: ` ${'x'.repeat(ALIAS_MAX)} ` })).includes('alias'),
    'cota tras recortar'
  )
  check('usuario de espacios se marca', j(faltantes(valido('oracle', { user: ' ' }))) === j(['user']), 'user')
}

// ---------------------------------------------------------------------------------
hr('(6) limpiarParaGuardar')
{
  const pg: BorradorConexion = { ...borradorNuevo('P', 'postgres'), sid: 'X', database: 'app' }
  const l = limpiarParaGuardar(pg)
  check('PostgreSQL: el SID sale vacío', l.sid === '' && l.database === 'app', j([l.sid, l.database]))
  check('el resto intacto', l.profileId === 'P' && l.readonly === true && l.password === '', j(l))
  check('no muta el de entrada', pg.sid === 'X', pg.sid)
  const ora: BorradorConexion = { ...borradorNuevo('P', 'oracle'), sid: 'X' }
  check('Oracle: el mismo objeto', limpiarParaGuardar(ora) === ora, 'identidad')
  const pgYaLimpio: BorradorConexion = { ...borradorNuevo('P', 'postgres') }
  check('nada que vaciar: el mismo objeto', limpiarParaGuardar(pgYaLimpio) === pgYaLimpio, 'identidad')
}

// ---------------------------------------------------------------------------------
hr('(7) clientes de base de datos')
{
  const drivers: ClienteDeMotor[] = [
    { id: 'oracle-ic-19', motor: 'oracle' },
    { id: 'oracle-ic-21', motor: 'oracle' }
  ]
  const sinMotivo = { drivers: [] as ClienteDeMotor[], requierePackId: null, abiertoPara: null }
  check('Oracle con clientes suyos: se ve', mostrarClientes('oracle', { ...sinMotivo, drivers }), 'true')
  check(
    'PostgreSQL con los clientes de Oracle: NO (el hueco)',
    !mostrarClientes('postgres', { ...sinMotivo, drivers }),
    'false'
  )
  check(
    'PostgreSQL con una prueba que pidió cliente: NO',
    !mostrarClientes('postgres', { drivers, requierePackId: 'oracle-ic-19', abiertoPara: null }),
    'false'
  )
  check(
    'PostgreSQL abierto desde «Instalar cliente…» con Oracle: NO',
    !mostrarClientes('postgres', { drivers, requierePackId: null, abiertoPara: 'oracle' }),
    'false'
  )
  check('Oracle sin ningún motivo: no', !mostrarClientes('oracle', sinMotivo), 'false')
  check(
    'Oracle con una prueba pendiente (lista aún sin llegar): sí',
    mostrarClientes('oracle', { ...sinMotivo, requierePackId: 'oracle-ic-19' }),
    'true'
  )
  check('Oracle abierto desde «Instalar cliente…»: sí', mostrarClientes('oracle', { ...sinMotivo, abiertoPara: 'oracle' }), 'true')
  check(
    'Oracle abierto para OTRO motor: no',
    !mostrarClientes('oracle', { ...sinMotivo, abiertoPara: 'postgres' }),
    'false'
  )
  check(
    'Oracle con solo clientes de otro motor: no',
    !mostrarClientes('oracle', { ...sinMotivo, drivers: [{ id: 'pg-x', motor: 'postgres' }] }),
    'false'
  )
  check('requiereAplica: pack de su motor', requiereAplica('oracle', 'oracle-ic-19', drivers), 'true')
  check('requiereAplica: pack de otro motor', !requiereAplica('oracle', 'pg-x', [{ id: 'pg-x', motor: 'postgres' }]), 'false')
  check('requiereAplica: pack desconocido, motor con clientes', requiereAplica('oracle', 'nuevo', drivers), 'true')
  check('requiereAplica: motor sin clientes', !requiereAplica('postgres', 'oracle-ic-19', drivers), 'false')
  check('requiereAplica: sin pack', !requiereAplica('oracle', null, drivers), 'false')
  const mixta: ClienteDeMotor[] = [...drivers, { id: 'pg-x', motor: 'postgres' }]
  check(
    'driversDelMotor filtra',
    j(driversDelMotor('oracle', mixta).map((d) => d.id)) === j(['oracle-ic-19', 'oracle-ic-21']),
    j(driversDelMotor('oracle', mixta).map((d) => d.id))
  )
}

// ---------------------------------------------------------------------------------
// (8) PARIDAD. Copia LITERAL de las reglas de `ConnectionStore.validate` (salvo el
// perfil —no lo toca el formulario—, el motor —el selector solo ofrece los del
// descriptor, ver (1)— y el nombre duplicado —exige el registro, lo dice el main—).
// Recibe lo que VIAJA (`entradaDe`), como el main.
function validarComoElMain(input: DbConnectionInput): void {
  validarComunesComoElMain(input)
  const database = limpiarDestinoBd(input.database)
  const sid = limpiarDestinoBd(input.sid)
  if (input.motor === 'oracle' && !database && !sid) {
    throw new Error('Oracle necesita un Service Name o un SID.')
  }
  if (input.motor === 'oracle' && database && sid) {
    throw new Error('Indica Service Name O SID, no ambos.')
  }
  if (input.motor === 'postgres' && !database) {
    throw new Error('PostgreSQL necesita el nombre de la base.')
  }
  validarBaseRedisComoElMain(input)
}

/**
 * La base de Redis, un número 0-9999: el main la valida al
 * guardar con `validarBaseRedis` sobre el valor limpio (la regla de
 * `ConnectionStore`). Va DESPUÉS de las del destino, en las dos copias de (8).
 */
function validarBaseRedisComoElMain(input: DbConnectionInput): void {
  if (input.motor !== 'redis') return
  const error = validarBaseRedis(limpiarDestinoBd(input.database))
  if (error !== null) throw new Error(error)
}

/** Las reglas COMUNES de la copia (no dependen del motor), en su orden. */
function validarComunesComoElMain(input: DbConnectionInput): void {
  const alias = String(input.alias ?? '').trim()
  if (!alias) throw new Error('La conexión necesita un nombre.')
  if (alias.length > ALIAS_MAX) {
    throw new Error(`El nombre no puede pasar de ${ALIAS_MAX} caracteres.`)
  }
  const host = limpiarDestinoBd(input.host)
  if (!host) throw new Error('Falta el host.')
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('El puerto debe ser un entero entre 1 y 65535.')
  }
  // El main recorre los `obligatorios` del motor: con MongoDB y Redis el usuario va
  // en `opcionales` y no se exige (se conectan sin autenticar, o con la clave sola).
  const exigeUsuario = descriptor(input.motor).conexion.obligatorios.indexOf('user') >= 0
  if (exigeUsuario && (typeof input.user !== 'string' || !input.user.trim())) throw new Error('Falta el usuario.')
}

/**
 * Lo mismo, con la regla del destino del DESCRIPTOR (`conexion.validarDestino`), que es
 * como valida el main: las comunes tal cual y, DESPUÉS, la del motor.
 * Tiene que dar el mismo mensaje que la copia de arriba en cada caso.
 */
function mensajeConDescriptor(input: DbConnectionInput): string | null {
  try {
    validarComunesComoElMain(input)
  } catch (err) {
    return (err as Error).message
  }
  const destino = MOTORES[input.motor].conexion.validarDestino({
    database: limpiarDestinoBd(input.database),
    sid: limpiarDestinoBd(input.sid)
  })
  if (destino !== null) return destino
  try {
    validarBaseRedisComoElMain(input)
  } catch (err) {
    return (err as Error).message
  }
  return null
}

/** Qué campo(s) señala cada mensaje del main. */
const CAMPOS_DEL_MENSAJE: Array<[RegExp, CampoConexion[]]> = [
  [/necesita un nombre|no puede pasar de/, ['alias']],
  [/^Falta el host/, ['host']],
  [/^El puerto/, ['port']],
  [/^Falta el usuario/, ['user']],
  [/Service Name o un SID/, ['database', 'sid']],
  [/Service Name O SID, no ambos/, ['database', 'sid']],
  [/PostgreSQL necesita el nombre de la base/, ['database']],
  [/La base es un número entero/, ['database']]
]

hr('(8) paridad con ConnectionStore.validate')
{
  const ALIASES = ['', '   ', 'DEV', 'x'.repeat(ALIAS_MAX + 1)]
  const HOSTS = ['', 'http://', ' h ', 'srv-bd:1521']
  const PUERTOS = [0, Number.NaN, 1, 65535, 65536, 1.5]
  const BASES = ['', 'http://', 'ORCL']
  const SIDS = ['', ' ', 'DEMO']
  const USUARIOS = ['', ' ', 'u']
  let total = 0
  const desacuerdos: string[] = []
  const sinMarca: string[] = []
  const conDescriptorDistinto: string[] = []
  const mensajesVistos = new Set<string>()
  // La copia literal es la de los motores de RED; la de un motor de ARCHIVO va en (8b).
  for (const motor of MOTORES_CONEXION.filter((m) => !descriptorDe(m).deArchivo)) {
    for (const alias of ALIASES)
      for (const host of HOSTS)
        for (const port of PUERTOS)
          for (const database of BASES)
            for (const sid of SIDS)
              for (const user of USUARIOS) {
                total++
                const b: BorradorConexion = { ...borradorNuevo('P', motor), alias, host, port, database, sid, user }
                let mensaje: string | null = null
                try {
                  validarComoElMain(entradaDe(b))
                } catch (err) {
                  mensaje = (err as Error).message
                }
                const ui = listoParaGuardar(b)
                const caso = j({ motor, alias: alias.length > 10 ? `x*${alias.length}` : alias, host, port, database, sid, user })
                if (ui !== (mensaje === null)) desacuerdos.push(`${caso} main=${mensaje ?? 'OK'} ui=${ui ? 'OK' : j(camposAMarcar(b))}`)
                const delDescriptor = mensajeConDescriptor(entradaDe(b))
                if (delDescriptor !== mensaje) {
                  conDescriptorDistinto.push(`${caso} copia=${mensaje ?? 'OK'} descriptor=${delDescriptor ?? 'OK'}`)
                }
                if (mensaje !== null) {
                  const m = mensaje
                  mensajesVistos.add(m)
                  const apuntados = CAMPOS_DEL_MENSAJE.find(([re]) => re.test(m))?.[1]
                  const marcas = camposAMarcar(b)
                  if (!apuntados || !apuntados.every((c) => marcas.includes(c))) {
                    sinMarca.push(`${caso} main=${mensaje} marcas=${j(marcas)}`)
                  }
                }
              }
  }
  check(
    `el main acepta ⇔ nada que marcar (${total} borradores)`,
    desacuerdos.length === 0,
    desacuerdos.length === 0 ? 'de acuerdo en todos' : `${desacuerdos.length} desacuerdos, p. ej. ${desacuerdos.slice(0, 3).join(' | ')}`
  )
  check(
    `validarDestino del descriptor da el MISMO mensaje que las reglas de siempre (${total} borradores)`,
    conDescriptorDistinto.length === 0,
    conDescriptorDistinto.length === 0
      ? 'el mismo en todos'
      : `${conDescriptorDistinto.length} distintos, p. ej. ${conDescriptorDistinto.slice(0, 3).join(' | ')}`
  )
  check(
    'lo que el main rechaza está marcado',
    sinMarca.length === 0,
    sinMarca.length === 0 ? 'siempre' : `${sinMarca.length} sin marca, p. ej. ${sinMarca.slice(0, 3).join(' | ')}`
  )
  // Sin esto, una rejilla que nunca llegase a una regla daría la paridad por buena
  // sin haberla mirado.
  const sinEjercitar = CAMPOS_DEL_MENSAJE.filter(([re]) => ![...mensajesVistos].some((m) => re.test(m))).map(([re]) => re.source)
  check('la rejilla ejercita todas las reglas del main', sinEjercitar.length === 0, sinEjercitar.length === 0 ? j([...mensajesVistos]) : j(sinEjercitar))
}

hr('(8b) un motor de ARCHIVO: el nombre y el archivo, nada más')
{
  // La regla del main para un motor de archivo (`ConnectionStore.validate`, derivada de
  // sus obligatorios): «La conexión necesita un nombre.» y «Falta el archivo de la base.»;
  // ni host, ni puerto, ni usuario. El formulario marca lo mismo.
  for (const motor of MOTORES_CONEXION.filter((m) => descriptorDe(m).deArchivo)) {
    const base: BorradorConexion = { ...borradorNuevo('P', motor), alias: 'DEV' }
    const conArchivo = { ...base, archivo: 'base.db' }
    check(`${motor}: sin archivo, marca el archivo`, j(camposAMarcar(base)) === j(['archivo']), j(camposAMarcar(base)))
    check(`${motor}: con nombre y archivo, listo (sin host, puerto ni usuario)`, listoParaGuardar(conArchivo), j(camposAMarcar(conArchivo)))
    check(`${motor}: sin nombre, marca el nombre`, j(camposAMarcar({ ...conArchivo, alias: ' ' })) === j(['alias']), j(camposAMarcar({ ...conArchivo, alias: ' ' })))
    check(`${motor}: orden del formulario: nombre y archivo`, j(ordenFormulario(motor)) === j(['alias', 'archivo']), j(ordenFormulario(motor)))
  }
}

// ---------------------------------------------------------------------------------
hr('(9) entorno: opciones, radio y ayuda')
{
  check(
    'orden: «Sin entorno» y luego ENTORNOS',
    j(OPCIONES_ENTORNO.map((o) => o.valor)) === j([null, ...ENTORNOS]),
    j(OPCIONES_ENTORNO.map((o) => o.valor))
  )
  check(
    'las etiquetas de los entornos salen de NOMBRE_ENTORNO',
    OPCIONES_ENTORNO.every((o) => o.valor === null || o.etiqueta === NOMBRE_ENTORNO[o.valor]),
    j(OPCIONES_ENTORNO.map((o) => o.etiqueta))
  )
  check('«Sin entorno» es la primera', OPCIONES_ENTORNO[0].etiqueta === 'Sin entorno', OPCIONES_ENTORNO[0].etiqueta)

  // El radio: ida y vuelta, y sus mitades negativas.
  for (const o of OPCIONES_ENTORNO) {
    check(`radio ida y vuelta: ${o.etiqueta}`, entornoDeRadio(valorRadioEntorno(o.valor)) === o.valor, j(valorRadioEntorno(o.valor)))
  }
  check("'' es «sin entorno»", entornoDeRadio('') === null, 'null')
  for (const malo of ['PRODUCCION', 'prod', 'Producción', ' produccion', 'null']) {
    check(`«${malo}» no es un entorno`, entornoDeRadio(malo) === null, j(entornoDeRadio(malo)))
  }
  check('los values del radio son distintos', new Set(OPCIONES_ENTORNO.map((o) => valorRadioEntorno(o.valor))).size === OPCIONES_ENTORNO.length, 'únicos')

  // La ayuda dice lo que cambia. NO depende de «Solo lectura» (es de
  // los agentes): una producción marcada pide confirmación y nace en Tx Manual igual.
  const prod = ayudaEntorno('produccion')
  check('producción: promete confirmación', /confirmaci[oó]n/i.test(prod), prod)
  check('producción: promete Tx Manual', /Tx Manual/.test(prod), prod)
  check('producción: nombra el rojo', /roj/.test(prod), prod)
  check('NEGATIVO: producción ya no dice que las escrituras se rechacen sin preguntar', !/rechaza/i.test(prod) && !/Solo lectura/.test(prod), prod)
  for (const e of ['desarrollo', 'pruebas'] as const) {
    const a = ayudaEntorno(e)
    check(`${e}: no promete confirmación`, !/confirmaci[oó]n/i.test(a), a)
    check(`${e}: no promete Tx Manual`, !/Manual/.test(a), a)
  }
  check('sin entorno: dice que no hay ni marcas ni confirmaciones', ayudaEntorno(null) === 'Sin marcas ni confirmaciones.', ayudaEntorno(null))
  check('desarrollo nombra el verde', /verde/.test(ayudaEntorno('desarrollo')), ayudaEntorno('desarrollo'))
  check('pruebas nombra el ámbar', /ámbar/.test(ayudaEntorno('pruebas')), ayudaEntorno('pruebas'))
  check(
    'cada opción tiene su ayuda propia',
    new Set(OPCIONES_ENTORNO.map((o) => ayudaEntorno(o.valor))).size === OPCIONES_ENTORNO.length,
    'distintas'
  )
}

// ---------------------------------------------------------------------------------
hr('(10) la ayuda de «Clientes de base de datos»: los motores sin clientes, del registro')
{
  // El texto, al byte. SQLite tampoco necesita clientes (node:sqlite va dentro de Electron);
  // SQL Server, MongoDB y Redis entran en la frase por el registro.
  const hoy = 'PostgreSQL, SQLite, SQL Server, MongoDB y Redis no necesitan ninguno.'
  check(`hoy: «${hoy}»`, ayudaSinClientes() === hoy, ayudaSinClientes())
  check('ninguno: sin frase', fraseSinClientes([]) === '', j(fraseSinClientes([])))
  check('uno: singular', fraseSinClientes(['SQLite']) === 'SQLite no necesita ninguno.', fraseSinClientes(['SQLite']))
  check(
    'dos: plural, con «y»',
    fraseSinClientes(['PostgreSQL', 'SQLite']) === 'PostgreSQL y SQLite no necesitan ninguno.',
    fraseSinClientes(['PostgreSQL', 'SQLite'])
  )
  check(
    'tres: comas y «y»',
    fraseSinClientes(['PostgreSQL', 'SQLite', 'SQL Server']) === 'PostgreSQL, SQLite y SQL Server no necesitan ninguno.',
    fraseSinClientes(['PostgreSQL', 'SQLite', 'SQL Server'])
  )
  // Para cualquier registro: nombra a todo motor sin clientes y a ninguno que los use.
  const mal = IDS_MOTORES.filter((m) => ayudaSinClientes().includes(descriptor(m).etiqueta) === descriptor(m).conexion.usaClientes)
  check('nombra justo a los motores que no usan clientes', mal.length === 0, j(mal))
}

// ---------------------------------------------------------------------------------
hr('(11) motores de archivo: la oferta por extensión y la ayuda de «Solo lectura»')
{
  check('ventas.db -> sqlite', motorPorNombreDeArchivo('ventas.db') === 'sqlite', j(motorPorNombreDeArchivo('ventas.db')))
  check('sin caja: DATOS.SQLITE3 -> sqlite', motorPorNombreDeArchivo('DATOS.SQLITE3') === 'sqlite', j(motorPorNombreDeArchivo('DATOS.SQLITE3')))
  // Todas las extensiones del descriptor, y nada más.
  const exts = descriptorDe('sqlite').extensionesArchivo
  check('cada extensión del descriptor se ofrece', exts.every((e) => motorPorNombreDeArchivo(`x.${e}`) === 'sqlite'), j(exts))
  // Las mitades negativas: lo que NO se ofrece.
  for (const n of ['notas.txt', 'db', '.db', 'x.', 'x.db-wal', 'x.db-journal', 'backup.db.bak', 'x.sql']) {
    check(`«${n}» no se ofrece`, motorPorNombreDeArchivo(n) === null, j(motorPorNombreDeArchivo(n)))
  }
  const red = ayudaSoloLectura('oracle')
  check(
    'con usuario y clave: dice que limita a los agentes (tdb) y no al usuario, y la garantía del servidor',
    /agentes/.test(red) && /tdb/.test(red) && /tú no quedas limitado/.test(red) && red.includes('el servidor abre sus transacciones en solo lectura') && /permisos de lectura/.test(red),
    red
  )
  check('PostgreSQL: la misma que Oracle', ayudaSoloLectura('postgres') === red, 'igual')
  const arch = ayudaSoloLectura('sqlite')
  check(
    'sin credenciales: ni servidor ni usuario de base (tdb abre el archivo en solo lectura)',
    !arch.includes('servidor') && !arch.includes('un usuario') && arch.includes('archivo') && /tdb/.test(arch),
    arch
  )
  // Ninguna ayuda promete que TESSERA rechace las escrituras del usuario: limita a los agentes.
  const todas = IDS_MOTORES.map((m) => ayudaSoloLectura(m))
  check(
    'NEGATIVO: ninguna ayuda dice «Tessera rechaza cualquier escritura» (describía al explorador limitando al humano)',
    todas.every((a) => !/Tessera rechaza/.test(a) && /tú no quedas limitado/.test(a)),
    j(todas)
  )
  check('la etiqueta de la casilla nombra a los agentes', ETIQUETA_SOLO_LECTURA === 'Solo lectura para los agentes (recomendado)', ETIQUETA_SOLO_LECTURA)
  check(
    'el título de la marca «RO» informa (tdb no escribe) y no dice que Tessera rechace',
    /agentes/.test(TITULO_SOLO_LECTURA_AGENTES) && /tdb no escribe/.test(TITULO_SOLO_LECTURA_AGENTES) && !/rechaza/.test(TITULO_SOLO_LECTURA_AGENTES),
    TITULO_SOLO_LECTURA_AGENTES
  )
}

// ---------------------------------------------------------------------------------
hr('(12) SQL Server: sus campos, lo que se marca y la paridad con validarOpcional')
{
  const d = descriptorDe('sqlserver')
  const filas = d.filas.map((f) => f.map((c) => `${c.campo}:${c.tipo}`))
  check(
    'filas del destino: host|puerto, base|instancia, autenticación|dominio',
    j(filas) === j([['host:texto', 'port:puerto'], ['database:texto', 'instancia:texto'], ['autenticacion:eleccion', 'dominio:texto']]),
    j(filas)
  )
  const tras = d.filasTrasCredenciales.map((f) => f.map((c) => `${c.campo}:${c.tipo}`))
  check('tras las credenciales: el cifrado (sus dos casillas)', j(tras) === j([['tls:cifrado']]), j(tras))
  const cifrado = d.filasTrasCredenciales[0][0]
  check(
    'la casilla del certificado dice «Confiar en el certificado del servidor»',
    cifrado.tipo === 'cifrado' && cifrado.etiquetaConfiar === 'Confiar en el certificado del servidor' && cifrado.etiqueta === 'Cifrar la conexión',
    j(cifrado)
  )
  check('la base es OPCIONAL (placeholder que lo dice)', (d.filas[1][0].placeholder ?? '').startsWith('opcional'), j(d.filas[1][0].placeholder))
  // Las opciones de la autenticación, en el orden de AUTENTICACIONES y sin «Windows» a mano.
  const eleccion = d.filas[2][0]
  const opciones = eleccion.tipo === 'eleccion' ? eleccion.opciones : []
  check(
    'autenticación: usuario de SQL Server y cuenta de dominio (NTLM), en ese orden',
    j(opciones.map((o) => o.valor)) === j(['sql', 'ntlm']) && opciones.every((o) => !/windows/i.test(o.etiqueta)),
    j(opciones)
  )
  // Las ayudas: la de la instancia bajo su fila, la del cifrado bajo la suya.
  check('bajo la fila de la instancia, su ayuda (el puerto no se usa)', ayudasTrasFila('sqlserver', 1).some((a) => a.includes('SQL Browser') && a.includes('puerto')), j(ayudasTrasFila('sqlserver', 1)))
  check('bajo host|puerto y la de autenticación, nada', ayudasTrasFila('sqlserver', 0).length === 0 && ayudasTrasFila('sqlserver', 2).length === 0, 'ok')
  check('bajo el cifrado, su ayuda', ayudasTrasFilaCredenciales('sqlserver', 0).some((a) => a.includes('Confiar en el certificado del servidor')), j(ayudasTrasFilaCredenciales('sqlserver', 0)))
  // Oracle y PG: nada de esto (los de siempre).
  for (const m of ['oracle', 'postgres', 'sqlite'] as const) {
    check(`${m}: sin filas tras las credenciales ni ayudas nuevas`, descriptorDe(m).filasTrasCredenciales.length === 0 && ayudasTrasFilaCredenciales(m, 0).length === 0, 'ok')
  }
  check(
    'Oracle: orden del formulario de siempre (sin opcionales)',
    j(ordenFormulario('oracle')) === j(['alias', 'host', 'port', 'database', 'sid', 'user']),
    j(ordenFormulario('oracle'))
  )
  check(
    'SQL Server: orden del formulario (el cifrado tras el usuario)',
    j(ordenFormulario('sqlserver')) === j(['alias', 'host', 'port', 'database', 'instancia', 'autenticacion', 'dominio', 'user', 'tls']),
    j(ordenFormulario('sqlserver'))
  )

  // El dominio solo se ve con cuenta de dominio (por el VALOR, no por el motor).
  check('dominio: oculto con usuario de SQL Server', !campoVisible('dominio', { autenticacion: 'sql' }), 'oculto')
  check('dominio: oculto sin autenticación (= sql)', !campoVisible('dominio', {}), 'oculto')
  check('dominio: visible con NTLM', campoVisible('dominio', { autenticacion: 'ntlm' }), 'visible')
  check('los demás campos siempre se ven', campoVisible('instancia', { autenticacion: 'sql' }) && campoVisible('host', {}), 'ok')

  // Lo que se marca: sin base, listo (la base es opcional); NTLM sin dominio, el dominio.
  const sinBase = valido('sqlserver', { database: '' })
  check('sin base: listo (el árbol tendrá nivel «Bases»)', listoParaGuardar(sinBase), j(camposAMarcar(sinBase)))
  const ntlm = valido('sqlserver', { autenticacion: 'ntlm', dominio: '' })
  check('NTLM sin dominio: se marca el dominio', j(camposAMarcar(ntlm)) === j(['dominio']), j(camposAMarcar(ntlm)))
  check('NTLM con dominio en blanco: también', j(camposAMarcar({ ...ntlm, dominio: '  ' })) === j(['dominio']), j(camposAMarcar({ ...ntlm, dominio: '  ' })))
  check('NTLM con dominio: listo', listoParaGuardar({ ...ntlm, dominio: 'EMPRESA' }), 'ok')
  const inst = valido('sqlserver', { instancia: 'srv\\SQLEXPRESS' })
  check('instancia con el servidor pegado: se marca', j(camposAMarcar(inst)) === j(['instancia']), j(camposAMarcar(inst)))
  check('instancia con puerto: se marca', j(camposAMarcar({ ...inst, instancia: 'SQLEXPRESS:1433' })) === j(['instancia']), 'ok')
  check('instancia sola: lista', listoParaGuardar({ ...inst, instancia: 'SQLEXPRESS' }), 'ok')
  // La mitad negativa: un dominio escrito con un Oracle o un PG no marca nada (no lo usan).
  check('Oracle con dominio e instancia escritos: nada que marcar', listoParaGuardar(valido('oracle', { autenticacion: 'ntlm', dominio: '', instancia: 'a\\b' })), 'ok')

  // PARIDAD con el main: `validarOpcional` (main/db/opcionalesConexion.ts) sobre una rejilla
  // de autenticaciones, dominios e instancias. El main acepta los opcionales ⇔ el formulario
  // no marca ninguno de ellos.
  let casos = 0
  const desacuerdos: string[] = []
  for (const autenticacion of ['sql', 'ntlm', undefined] as const)
    for (const dominio of ['', ' ', 'EMPRESA', undefined])
      for (const instancia of ['', 'SQLEXPRESS', 'srv\\X', 'X:1433', 'a/b', undefined]) {
        casos++
        const v = valido('sqlserver', { autenticacion, dominio, instancia })
        const main = descriptor('sqlserver').conexion.opcionales.map((c) => validarOpcional(c, { autenticacion, dominio, instancia })).filter((x) => x !== null)
        const marcas = camposAMarcar(v).filter((c) => c === 'dominio' || c === 'instancia')
        if ((main.length === 0) !== (marcas.length === 0)) desacuerdos.push(j({ autenticacion, dominio, instancia, main, marcas }))
      }
  check(`paridad con validarOpcional del main (${casos} casos)`, desacuerdos.length === 0, desacuerdos.slice(0, 3).join(' | ') || 'de acuerdo')

  // Solo lectura: aquí lo impone Tessera (el texto pedido, al byte en su parte clave).
  const ro = ayudaSoloLectura('sqlserver')
  check(
    'solo lectura: «aquí el solo lectura lo impone Tessera; para garantía, un usuario con db_datareader»',
    ro.includes('aquí el solo lectura lo impone Tessera; para garantía, un usuario con db_datareader') && !ro.includes('el servidor abre'),
    ro
  )

  // «Confiar en el certificado y probar»: solo tras un fallo que cita la casilla, en un
  // motor con cifrado y con la casilla sin marcar.
  const falloCert = { ok: false, mensaje: 'No se pudo verificar el certificado de h:1433 (self signed). Si es un servidor de tu red con un certificado propio, marca «Confiar en el certificado del servidor» en la conexión.' }
  check('fallo de certificado: se ofrece', proponeConfiarCertificado('sqlserver', falloCert, { cifrar: true, confiarCertificado: false }), 'sí')
  check('con la casilla ya marcada: no', !proponeConfiarCertificado('sqlserver', falloCert, { cifrar: true, confiarCertificado: true }), 'no')
  check('una prueba buena: no', !proponeConfiarCertificado('sqlserver', { ok: true, mensaje: 'Conectado' }, undefined), 'no')
  check('otro fallo: no', !proponeConfiarCertificado('sqlserver', { ok: false, mensaje: 'Login failed for user' }, undefined), 'no')
  check('en un motor sin cifrado (PG): no', !proponeConfiarCertificado('postgres', falloCert, undefined), 'no')
  // La cita es la del .cjs que traduce el error (sqlserverComun): si cambia allí, esto lo ve.
  const cjs = readFileSync(fileURLToPath(new URL('../../../../tdb/sqlserverComun.cjs', import.meta.url)), 'utf8')
  check('sqlserverComun.cjs cita la casilla con la MISMA etiqueta', cjs.includes(`«${ETIQUETA_CONFIAR_CERTIFICADO}»`), ETIQUETA_CONFIAR_CERTIFICADO)
}

// ---------------------------------------------------------------------------------
hr('(13) MongoDB y Redis: usuario y clave OFRECIDOS sin exigirlos')
{
  // MongoDB lleva el SRV entre host|puerto y la base; Redis, host|puerto y la base.
  const FILAS: Record<'mongodb' | 'redis', string[][]> = {
    mongodb: [['host:texto', 'port:puerto'], ['srv:casilla'], ['database:texto']],
    redis: [['host:texto', 'port:puerto'], ['database:texto']]
  }
  const FILA_BASE: Record<'mongodb' | 'redis', number> = { mongodb: 2, redis: 1 }
  for (const motor of ['mongodb', 'redis'] as const) {
    const d = descriptorDe(motor)
    const filas = d.filas.map((f) => f.map((c) => `${c.campo}:${c.tipo}`))
    check(`${motor}: host y puerto; la base, opcional`, j(filas) === j(FILAS[motor]), j(filas))
    check(`${motor}: el puerto de su descriptor`, d.puertoPorDefecto === descriptor(motor).conexion.puertoPorDefecto && d.puertoPorDefecto !== null, j(d.puertoPorDefecto))
    check(`${motor}: SOLO nombre, host y puerto son obligatorios`, j(d.obligatorios) === j(['alias', 'host', 'port']), j(d.obligatorios))
    check(`${motor}: con usuario y contraseña en el formulario (credenciales)`, ordenFormulario(motor).includes('user'), j(ordenFormulario(motor)))
    check(`${motor}: «opcional» en usuario y contraseña`, placeholderCredencial(motor) === 'opcional', j(placeholderCredencial(motor)))
    const fb = FILA_BASE[motor]
    check(
      `${motor}: la base lleva su ayuda`,
      d.filas[fb][0].campo === 'database' && ayudasTrasFila(motor, fb).length === 1 && ayudasTrasFila(motor, fb)[0].length > 20,
      j(ayudasTrasFila(motor, fb))
    )
    // Sin usuario, sin clave y sin base: nada que marcar (el main lo acepta).
    const b: BorradorConexion = { ...borradorNuevo('P', motor), alias: 'DEV', host: 'h' }
    check(`${motor}: sin usuario ni clave ni base, nada que marcar`, listoParaGuardar(b) && faltantes(b).length === 0, j(camposAMarcar(b)))
    check(`${motor}: y la contraseña viaja vacía en el alta`, entradaDe(b).password === '', j(entradaDe(b).password))
    // Mitad negativa: sin host sí se marca.
    check(`${motor}: sin host, se marca el host`, j(faltantes({ ...b, host: '' })) === j(['host']), j(faltantes({ ...b, host: '' })))
    // Solo lectura: lo impone Tessera y la garantía es de la familia.
    const ro = ayudaSoloLectura(motor)
    check(`${motor}: solo lectura lo impone Tessera`, ro.includes('aquí el solo lectura lo impone Tessera') && !ro.includes('el servidor abre'), ro)
  }
  check('MongoDB: la garantía es el rol read', ayudaSoloLectura('mongodb').includes('rol read'), ayudaSoloLectura('mongodb'))
  check('Redis: la garantía es un usuario ACL', ayudaSoloLectura('redis').includes('usuario ACL'), ayudaSoloLectura('redis'))
  check('Redis: la base es un número (placeholder 0)', descriptorDe('redis').filas[1][0].placeholder === '0' && /número/.test(descriptorDe('redis').filas[1][0].etiqueta), j(descriptorDe('redis').filas[1][0]))
  // Mitad negativa: los motores SQL siguen sin placeholder (lo de siempre).
  const conPista = MOTORES_CONEXION.filter((m) => m !== 'mongodb' && m !== 'redis' && placeholderCredencial(m) !== undefined)
  check('los SQL: sin placeholder en usuario y contraseña (lo de siempre)', conPista.length === 0, j(conPista))
}

// ---------------------------------------------------------------------------------
hr('(14) MongoDB: SRV, cifrado, opciones de la URI y «Pegar URI»')
{
  const d = descriptorDe('mongodb')
  const tras = d.filasTrasCredenciales.map((f) => f.map((c) => `${c.campo}:${c.tipo}`))
  check(
    'tras las credenciales: el cifrado, la base de autenticación y las opciones de la URI',
    j(tras) === j([['tls:cifrado'], ['authSource:texto'], ['opcionesUri:texto']]),
    j(tras)
  )
  const srv = d.filas[1][0]
  check('la casilla dice «DNS SRV (mongodb+srv)» y lleva su ayuda', srv.tipo === 'casilla' && srv.etiqueta === 'DNS SRV (mongodb+srv)' && ayudasTrasFila('mongodb', 1).length === 1, j(srv))
  const cifrado = d.filasTrasCredenciales[0][0]
  check(
    'el cifrado: la casilla del certificado con la MISMA etiqueta que SQL Server (la cita el mensaje de «Probar»)',
    cifrado.tipo === 'cifrado' && cifrado.etiquetaConfiar === ETIQUETA_CONFIAR_CERTIFICADO,
    j(cifrado)
  )
  check('bajo las opciones, su ayuda', ayudasTrasFilaCredenciales('mongodb', 2).some((a) => a.includes('«?»')), j(ayudasTrasFilaCredenciales('mongodb', 2)))
  check('bajo la base de autenticación, la suya (nombra authSource y admin)', ayudasTrasFilaCredenciales('mongodb', 1).some((a) => a.includes('authSource') && a.includes('admin')), j(ayudasTrasFilaCredenciales('mongodb', 1)))
  check(
    'orden del formulario: srv tras el puerto; el cifrado y las opciones tras el usuario',
    j(ordenFormulario('mongodb')) === j(['alias', 'host', 'port', 'srv', 'database', 'user', 'tls', 'opcionesUri']),
    j(ordenFormulario('mongodb'))
  )
  // «Pegar URI»: MongoDB y Redis; los SQL, no.
  const conUri = MOTORES_CONEXION.filter((m) => descriptorDe(m).uri !== null)
  check('«Pegar URI»: MongoDB y Redis (hoy)', j(conUri) === j(['mongodb', 'redis']), j(conUri))
  check('con su ejemplo mongodb://', (d.uri?.ejemplo ?? '').startsWith('mongodb://'), j(d.uri?.ejemplo))

  // El puerto se apaga con SRV, por el VALOR y solo en un motor que declara el SRV.
  check('puerto apagado con SRV', campoDeshabilitado('port', { motor: 'mongodb', srv: true }), 'apagado')
  check('puerto encendido sin SRV', !campoDeshabilitado('port', { motor: 'mongodb', srv: false }) && !campoDeshabilitado('port', { motor: 'mongodb' }), 'encendido')
  check('otro campo: nunca apagado', !campoDeshabilitado('host', { motor: 'mongodb', srv: true }), 'encendido')
  for (const m of ['oracle', 'postgres', 'sqlserver', 'redis'] as const) {
    check(`${m}: el puerto no se apaga aunque el borrador lleve srv`, !campoDeshabilitado('port', { motor: m, srv: true }), 'encendido')
  }

  // Las opciones: aviso en vivo y marca al guardar, con la función del main.
  const bien = valido('mongodb', { opcionesUri: 'replicaSet=rs0' })
  check('opciones buenas: ni aviso ni marca', avisoDeCampo('opcionesUri', bien) === null && listoParaGuardar(bien), j(camposAMarcar(bien)))
  // El authSource tiene campo propio: escrito en las opciones, aviso y marca
  // (el main lo rechazaría por repetido si además va en su campo). En su campo, nada.
  const authEnOpciones = valido('mongodb', { opcionesUri: 'w=1&AUTHSOURCE=admin' })
  check(
    '(#40) authSource escrito en las opciones: «va en su campo» y marca',
    /va en su campo/.test(avisoDeCampo('opcionesUri', authEnOpciones) ?? '') && j(camposAMarcar(authEnOpciones)) === j(['opcionesUri']),
    String(avisoDeCampo('opcionesUri', authEnOpciones))
  )
  const authEnSuCampo = valido('mongodb', { authSource: 'admin' })
  check('(#40) en su campo: ni aviso ni marca, y no está en el orden del foco', listoParaGuardar(authEnSuCampo) && !(ordenFormulario('mongodb') as string[]).includes('authSource'), j(camposAMarcar(authEnSuCampo)))
  const mal = valido('mongodb', { opcionesUri: 'tls=true' })
  check('opciones malas: aviso (el del main) y marca', avisoDeCampo('opcionesUri', mal) === validarOpcionesUriMongo('tls=true') && j(camposAMarcar(mal)) === j(['opcionesUri']), j(camposAMarcar(mal)))
  check('sin opciones: listo', listoParaGuardar(valido('mongodb', { opcionesUri: '' })) && listoParaGuardar(valido('mongodb')), 'ok')
  check('otro campo: sin aviso', avisoDeCampo('host', mal) === null, 'null')
  // Mitad negativa: con otro motor, unas opciones escritas no avisan ni marcan (no viajan).
  for (const m of ['oracle', 'postgres', 'sqlserver', 'redis'] as const) {
    const v = valido(m, { opcionesUri: 'tls=true', database: m === 'redis' ? '0' : 'B' })
    check(`${m}: unas opciones malas escritas ni avisan ni marcan`, avisoDeCampo('opcionesUri', v) === null && !camposAMarcar(v).includes('opcionesUri'), j(camposAMarcar(v)))
  }
  // PARIDAD con lo que aplica el main al guardar (`validarOpcionesUriMongo`).
  // Sin authSource: ese lo rechaza el formulario a propósito (va en su campo).
  const rejilla = ['', 'replicaSet=rs0', 'appName=a&replicaSet=rs0', 'tls=true', 'password=x', 'x=1', 'appName=a&appName=b', '?w=1', 'w=majority', 'maxPoolSize=-1']
  const desacuerdos = rejilla.filter((t) => (validarOpcionesUriMongo(t) === null) !== !camposAMarcar(valido('mongodb', { opcionesUri: t })).includes('opcionesUri'))
  check(`paridad con validarOpcionesUriMongo (${rejilla.length} casos)`, desacuerdos.length === 0, j(desacuerdos))

  // SQL Server no cambia: su cifrado sigue siendo el de siempre y no gana campos.
  check(
    'SQL Server: sus filas tras las credenciales, las de siempre',
    j(descriptorDe('sqlserver').filasTrasCredenciales.map((f) => f.map((c) => c.campo))) === j([['tls']]) && descriptorDe('sqlserver').uri === null,
    'ok'
  )
}

// ---------------------------------------------------------------------------------
hr('(15) Redis: cifrado, base numérica en vivo y «Pegar URI»')
{
  const d = descriptorDe('redis')
  const tras = d.filasTrasCredenciales.map((f) => f.map((c) => `${c.campo}:${c.tipo}`))
  check('tras las credenciales: el cifrado (sin opciones de URI)', j(tras) === j([['tls:cifrado']]), j(tras))
  const cifrado = d.filasTrasCredenciales[0][0]
  check('el cifrado: la casilla del certificado con la MISMA etiqueta', cifrado.tipo === 'cifrado' && cifrado.etiquetaConfiar === ETIQUETA_CONFIAR_CERTIFICADO, j(cifrado))
  check('bajo el cifrado, su ayuda', ayudasTrasFilaCredenciales('redis', 0).length === 1, j(ayudasTrasFilaCredenciales('redis', 0)))
  check(
    'orden del formulario: la base tras el puerto; el cifrado tras el usuario',
    j(ordenFormulario('redis')) === j(['alias', 'host', 'port', 'database', 'user', 'tls']),
    j(ordenFormulario('redis'))
  )
  check('la etiqueta de la base dice que es un número', d.filas[1][0].etiqueta === 'Base (número)', j(d.filas[1][0].etiqueta))

  // «Pegar URI»: su ejemplo, su ayuda (sin SRV ni opciones) y que su ejemplo se descompone.
  check('con su ejemplo redis://', (d.uri?.ejemplo ?? '').startsWith('redis://'), j(d.uri?.ejemplo))
  check('su ayuda nombra rediss:// y no el SRV', (d.uri?.ayuda ?? '').includes('rediss://') && !(d.uri?.ayuda ?? '').includes('SRV'), j(d.uri?.ayuda))
  for (const m of MOTORES_CONEXION) {
    const esquema = descriptorDe(m).uri
    if (esquema === null) continue
    const r = esquema.descomponer(esquema.ejemplo)
    check(`${m}: su ejemplo se descompone y su ayuda no está vacía`, r.ok && esquema.ayuda.length > 20, j(r))
  }

  // La base: aviso en vivo y marca al guardar, con la función del main sobre el valor LIMPIO.
  for (const t of ['', '0', '15', '9999', ' 3 ', '/3/']) {
    const v = valido('redis', { database: t })
    check(`base «${t}»: ni aviso ni marca`, avisoDeCampo('database', v) === null && listoParaGuardar(v), j(camposAMarcar(v)))
  }
  const mal = valido('redis', { database: 'abc' })
  check('base «abc»: aviso (el de validarBaseRedis) y marca', avisoDeCampo('database', mal) === validarBaseRedis('abc') && j(camposAMarcar(mal)) === j(['database']), j([avisoDeCampo('database', mal), camposAMarcar(mal)]))
  check('base 10000: marca', j(faltantes(valido('redis', { database: '10000' }))) === j(['database']), j(faltantes(valido('redis', { database: '10000' }))))
  // PARIDAD con lo que aplica el main al guardar (`validarBaseRedis` sobre `limpiarDestinoBd`).
  const rejilla = ['', '0', '7', '007', '9999', '10000', '-1', '1.5', 'a', ' 2 ', '/4', 'db1', '1e2']
  const desacuerdos = rejilla.filter((t) => (validarBaseRedis(limpiarDestinoBd(t)) === null) !== !camposAMarcar(valido('redis', { database: t })).includes('database'))
  check(`paridad con validarBaseRedis (${rejilla.length} casos)`, desacuerdos.length === 0, j(desacuerdos))
  // Mitad negativa: en los demás motores la base es texto y no se valida como número.
  for (const m of ['oracle', 'postgres', 'sqlserver', 'mongodb'] as const) {
    const v = valido(m, { database: 'ventas_2024' })
    check(`${m}: una base con letras ni avisa ni marca`, avisoDeCampo('database', v) === null && !camposAMarcar(v).includes('database'), j(camposAMarcar(v)))
  }
  // Las opciones de Mongo siguen avisando por su campo (el `validar` que las movió del esquema).
  check('Mongo: las opciones malas siguen avisando', avisoDeCampo('opcionesUri', valido('mongodb', { opcionesUri: 'tls=true' })) !== null, 'aviso')
  check('Redis: unas opciones escritas no avisan (no las usa)', avisoDeCampo('opcionesUri', valido('redis', { opcionesUri: 'tls=true' })) === null, 'null')

  // Cada opcional con presentación propia tiene su fila: el 'tls' de Redis estaba en el
  // descriptor y la casilla no salía (ver la cabecera). El usuario lo pinta el diálogo por
  // `credenciales`, fuera de las filas.
  for (const m of MOTORES_CONEXION) {
    const pintados = new Set<string>([...camposVisibles(m), ...descriptorDe(m).filasTrasCredenciales.flatMap((f) => f.map((c) => c.campo))])
    const sinFila = descriptor(m).conexion.opcionales.filter((c) => c !== 'user' && !pintados.has(c))
    check(`${m}: todo opcional tiene su fila en el formulario`, sinFila.length === 0, j(sinFila))
  }
}

// ---------------------------------------------------------------------------------
const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
