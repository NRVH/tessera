#!/usr/bin/env node
// =============================================================================
// Prueba de lo que sobrevive a editar una conexión (`conservarAlEditar.ts`): contraseña, driver,
// verificación, orden, esquemas, introspección, entorno y las claves que esta versión no gobierna.
// (node src/main/db/test-conservar-edicion.mts  ·  npm run test:db-conservar)
// Fija también que no muta sus argumentos y que lo explícito en `nuevo` gana.
// Decisiones: docs/decisiones/bd/conexiones-que-sobrevive-al-editar.md
// =============================================================================

import {
  CLAVES_GOBERNADAS,
  conservarAlEditar,
  esClaveGobernada,
  sanearEntorno,
  type ConexionPersistida
} from './conservarAlEditar.ts'

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

/** Registro guardado con todo lo que el main aprende de una conexión. */
function previo(): ConexionPersistida {
  return {
    id: 'c1',
    profileId: 'p1',
    alias: 'QA-DEMO',
    motor: 'oracle',
    host: 'db.lan',
    port: 1521,
    database: 'QA',
    user: 'ADMDEMO',
    readonly: true,
    notas: 'réplica',
    driverId: 'oracle-ic-19',
    secretEnc: 'CIFRADA-VIEJA',
    verificadaEn: 1700000000000,
    orden: 3,
    esquemas: { modo: 'lista', porDefecto: true, esquemas: ['PUBLIC', 'VENTAS'] },
    introspeccion: { totalEsquemas: 151, esquemaPorDefecto: 'ADMDEMO', en: 1700000001000 }
  }
}

/** Lo que construye `fields(input)` + id: sin nada de lo aprendido. */
function delFormulario(cambios: Partial<ConexionPersistida> = {}): ConexionPersistida {
  return {
    id: 'c1',
    profileId: 'p1',
    alias: 'QA-DEMO',
    motor: 'oracle',
    host: 'db.lan',
    port: 1521,
    database: 'QA',
    user: 'ADMDEMO',
    readonly: true,
    notas: 'réplica',
    driverId: null,
    ...cambios
  }
}

function main(): void {
  hr('(1) Contraseña')
  {
    const r1 = conservarAlEditar(previo(), delFormulario())
    check('undefined conserva la cifrada', r1.secretEnc === 'CIFRADA-VIEJA', String(r1.secretEnc))
    const r2 = conservarAlEditar(previo(), delFormulario(), '')
    check("'' la borra (sin clave)", !('secretEnc' in r2), JSON.stringify(Object.keys(r2)))
    const r3 = conservarAlEditar(previo(), delFormulario({ secretEnc: 'CIFRADA-NUEVA' }), 'otra')
    check('texto: queda la nueva que cifró el llamador', r3.secretEnc === 'CIFRADA-NUEVA', String(r3.secretEnc))
    const sinSecreto = { ...previo() }
    delete sinSecreto.secretEnc
    const r4 = conservarAlEditar(sinSecreto, delFormulario())
    check('undefined sin contraseña guardada: sigue sin', !('secretEnc' in r4), 'sin clave')
  }

  hr('(2) driverId (regla original: host y puerto)')
  {
    check('mismo host y puerto: se conserva', conservarAlEditar(previo(), delFormulario({ alias: 'otro', user: 'X' })).driverId === 'oracle-ic-19', 'oracle-ic-19')
    check('otro host: null (hay que volver a sondear)', conservarAlEditar(previo(), delFormulario({ host: 'otra.lan' })).driverId === null, 'null')
    check('otro puerto: null', conservarAlEditar(previo(), delFormulario({ port: 1522 })).driverId === null, 'null')
    const sinDriver = { ...previo() }
    delete sinDriver.driverId
    check('previo sin driverId: null', conservarAlEditar(sinDriver, delFormulario()).driverId === null, 'null')
  }

  hr('(3) verificadaEn')
  {
    check('cambiar alias, notas o solo lectura la conserva', conservarAlEditar(previo(), delFormulario({ alias: 'Nuevo', notas: 'x', readonly: false })).verificadaEn === 1700000000000, 'conservada')
    const casos: Array<[string, Partial<ConexionPersistida>, string | undefined]> = [
      ['host', { host: 'otra.lan' }, undefined],
      ['puerto', { port: 1599 }, undefined],
      ['base', { database: 'PROD' }, undefined],
      ['SID', { database: undefined, sid: 'ORCL' }, undefined],
      ['usuario', { user: 'OTRO' }, undefined]
    ]
    for (const [que, cambios] of casos) {
      const r = conservarAlEditar(previo(), delFormulario(cambios))
      check(`cambiar ${que} la retira`, !('verificadaEn' in r), JSON.stringify(Object.keys(r)))
    }
    const r = conservarAlEditar(previo(), delFormulario({ secretEnc: 'CIFRADA-NUEVA' }), 'nueva')
    check('cambiar la contraseña la retira', !('verificadaEn' in r), 'retirada')
    const rb = conservarAlEditar(previo(), delFormulario(), '')
    check('borrar la contraseña la retira', !('verificadaEn' in rb), 'retirada')
  }

  hr('(4) orden')
  {
    check('se conserva siempre', conservarAlEditar(previo(), delFormulario({ host: 'otra.lan', motor: 'postgres' })).orden === 3, '3')
    const sinOrden = { ...previo() }
    delete sinOrden.orden
    check('previo sin orden: sin clave', !('orden' in conservarAlEditar(sinOrden, delFormulario())), 'sin clave')
  }

  hr('(5) esquemas visibles')
  {
    const r1 = conservarAlEditar(previo(), delFormulario({ host: 'primario.lan', user: 'OTRO', readonly: false }))
    check('mismo motor: se conservan aunque cambien servidor, usuario y solo lectura', JSON.stringify(r1.esquemas) === JSON.stringify(previo().esquemas), JSON.stringify(r1.esquemas))
    const r2 = conservarAlEditar(previo(), delFormulario({ motor: 'postgres', port: 5432 }))
    check('otro motor: se retiran', !('esquemas' in r2), 'retirados')
    const explicito = { modo: 'todos' as const }
    const r3 = conservarAlEditar(previo(), delFormulario({ esquemas: explicito }))
    check('un valor explícito en nuevo gana', r3.esquemas === explicito, JSON.stringify(r3.esquemas))
  }

  hr('(6) introspección')
  {
    const r1 = conservarAlEditar(previo(), delFormulario({ alias: 'X', notas: 'y', readonly: false }), 'nueva-no-importa')
    check('mismo destino y usuario: se conserva (aunque cambie la contraseña)', r1.introspeccion?.totalEsquemas === 151, JSON.stringify(r1.introspeccion))
    const casos: Array<[string, Partial<ConexionPersistida>]> = [
      ['motor', { motor: 'postgres' }],
      ['host', { host: 'otra.lan' }],
      ['puerto', { port: 1599 }],
      ['base', { database: 'PROD' }],
      ['SID', { sid: 'ORCL' }],
      ['usuario', { user: 'OTRO' }]
    ]
    for (const [que, cambios] of casos) {
      const r = conservarAlEditar(previo(), delFormulario(cambios))
      check(`cambiar ${que}: se retira`, !('introspeccion' in r), 'retirada')
    }
  }

  hr('(7) Pureza y forma')
  {
    const p = previo()
    const n = delFormulario({ alias: 'Nuevo' })
    const antesP = JSON.stringify(p)
    const antesN = JSON.stringify(n)
    const r = conservarAlEditar(p, n)
    check('no muta previo ni nuevo', JSON.stringify(p) === antesP && JSON.stringify(n) === antesN && r !== n, 'intactos')
    check('toma los campos del formulario', r.alias === 'Nuevo' && r.id === 'c1' && r.profileId === 'p1', r.alias)
    const conUndefined = Object.entries(r).filter(([, v]) => v === undefined).map(([k]) => k)
    check('sin claves con valor undefined', conUndefined.length === 0, conUndefined.join(',') || 'ninguna')
    const redondo = JSON.parse(JSON.stringify(r)) as ConexionPersistida
    check('sobrevive a JSON igual (lo que persiste el store)', JSON.stringify(redondo) === JSON.stringify(r), 'ok')
  }

  hr('(8) Entorno: un campo más del formulario, que no desverifica')
  {
    const conProd = (): ConexionPersistida => ({ ...previo(), entorno: 'produccion' })
    const r = conservarAlEditar(previo(), delFormulario({ entorno: 'produccion' }))
    check('el del formulario se guarda', r.entorno === 'produccion', String(r.entorno))
    check(
      'cambiar SOLO el entorno no desverifica ni pierde el driver, los esquemas ni la introspección',
      r.verificadaEn === 1700000000000 && r.driverId === 'oracle-ic-19' && r.esquemas !== undefined && r.introspeccion !== undefined && r.secretEnc === 'CIFRADA-VIEJA',
      JSON.stringify({ v: r.verificadaEn, d: r.driverId })
    )
    const quitado = conservarAlEditar(conProd(), delFormulario())
    check('NEGATIVO: sin entorno en el formulario NO se rescata el del previo («sin entorno»)', !('entorno' in quitado), JSON.stringify(quitado.entorno))
    const bajado = conservarAlEditar(conProd(), delFormulario({ entorno: 'desarrollo' }))
    check('de producción a desarrollo: manda el formulario', bajado.entorno === 'desarrollo', String(bajado.entorno))
    const raro = conservarAlEditar(previo(), delFormulario({ entorno: 'prod' as never }))
    check('NEGATIVO: un entorno desconocido se descarta como clave', !('entorno' in raro), JSON.stringify(raro))
    const conUndefined = conservarAlEditar(previo(), delFormulario({ entorno: undefined }))
    check('lo que construye el store (`entorno: undefined`) no deja la clave', !('entorno' in conUndefined), Object.keys(conUndefined).join(','))
    for (const v of ['desarrollo', 'pruebas', 'produccion']) {
      check(`sanearEntorno conserva «${v}» (mismo objeto)`, (() => {
        const c = { ...previo(), entorno: v as ConexionPersistida['entorno'] }
        return sanearEntorno(c) === c
      })(), v)
    }
    for (const v of ['PRODUCCION', 'prod', 1, null, '']) {
      const c = { ...previo(), entorno: v } as unknown as ConexionPersistida
      const s = sanearEntorno(c)
      check(`NEGATIVO: sanearEntorno descarta ${JSON.stringify(v)} sin mutar el original`, !('entorno' in s) && 'entorno' in c, JSON.stringify(s.entorno))
    }
    const sin = previo()
    check('sin la clave: el mismo objeto', sanearEntorno(sin) === sin, 'ok')
  }

  hr('(9) Lo que esta versión NO gobierna sobrevive (compatibilidad con versiones más nuevas)')
  {
    // Un registro escrito por una versión más nueva: claves que esta no conoce y un
    // entorno que no sabe qué es. Se construye como lo deja `crudoDeConocida`.
    const futuro = (extra: Record<string, unknown> = {}): ConexionPersistida =>
      ({ ...previo(), colorFuturo: '#c0392b', grupo: { id: 'g1' }, ...extra }) as unknown as ConexionPersistida
    const campo = (r: ConexionPersistida, k: string): unknown => (r as unknown as Record<string, unknown>)[k]

    const r1 = conservarAlEditar(
      futuro(),
      delFormulario({ alias: 'Otro', database: undefined, sid: 'ORCL', user: 'OTRO', readonly: false, notas: 'x', entorno: 'pruebas' }),
      ''
    )
    check(
      'las claves futuras sobreviven mientras siga siendo el MISMO servidor (motor, host y puerto), aunque cambie todo lo demás (alias, base/SID, usuario, contraseña, modo, notas, entorno)',
      campo(r1, 'colorFuturo') === '#c0392b' && JSON.stringify(campo(r1, 'grupo')) === '{"id":"g1"}',
      JSON.stringify(r1)
    )
    check('y el formulario sigue mandando en lo suyo', r1.alias === 'Otro' && r1.user === 'OTRO' && r1.sid === 'ORCL' && !('secretEnc' in r1), r1.alias)
    // cambiar a qué servidor se conecta es TOCAR la conexión, y lo que
    // una versión más nueva guardó sobre CÓMO llegar a él (un túnel, una CA, un modo TLS)
    // es del servidor viejo. Sus análogos gobernados (driverId, verificación, foto) ya se
    // retiraban en ese caso; estas se copiaban siempre. Con el código de antes, FAIL.
    const casos: Array<[string, Partial<ConexionPersistida>]> = [
      ['el host', { host: 'otra.lan' }],
      ['el puerto', { port: 1522 }],
      ['el motor', { motor: 'postgres' }],
      ['motor, host y puerto', { motor: 'postgres', host: 'pg.lan', port: 5432 }]
    ]
    for (const [que, cambios] of casos) {
      const r = conservarAlEditar(futuro({ tunelSsh: { host: 'bastion-a' }, ssl: { ca: 'CA-vieja' } }), delFormulario(cambios))
      check(
        `NEGATIVO: cambiar ${que} retira las claves futuras (el túnel o la CA del servidor viejo no se pegan al nuevo)`,
        !('colorFuturo' in r) && !('grupo' in r) && !('tunelSsh' in r) && !('ssl' in r),
        JSON.stringify(Object.keys(r))
      )
    }
    const rh = conservarAlEditar(futuro(), delFormulario({ host: 'otra.lan' }))
    check(
      'y cambiar el host no retira más de lo gobernado de lo que ya retiraban sus reglas (orden, esquemas y contraseña siguen)',
      rh.orden === 3 && JSON.stringify(rh.esquemas) === JSON.stringify(previo().esquemas) && rh.secretEnc === 'CIFRADA-VIEJA' && rh.driverId === null && rh.host === 'otra.lan',
      JSON.stringify(rh)
    )
    const rStaging = conservarAlEditar(futuro({ entorno: 'staging' }), delFormulario({ host: 'otra.lan' }))
    check(
      "un entorno que no entiende NO depende del servidor: sobrevive al cambio de host, como el conocido (que el formulario conserva)",
      campo(rStaging, 'entorno') === 'staging' && !('colorFuturo' in rStaging),
      JSON.stringify(campo(rStaging, 'entorno'))
    )
    const r2 = conservarAlEditar(futuro({ entorno: 'staging' }), delFormulario())
    check("un entorno que no entiende ('staging') sobrevive si el formulario no trae ninguno", campo(r2, 'entorno') === 'staging', JSON.stringify(campo(r2, 'entorno')))
    check('y no desverifica ni pierde lo demás', r2.verificadaEn === 1700000000000 && r2.driverId === 'oracle-ic-19', JSON.stringify({ v: r2.verificadaEn, d: r2.driverId }))
    const r3 = conservarAlEditar(futuro({ entorno: 'staging' }), delFormulario({ entorno: 'pruebas' }))
    check('elegir uno conocido lo sustituye', r3.entorno === 'pruebas', String(r3.entorno))
    const r4 = conservarAlEditar(futuro({ entorno: null }), delFormulario())
    check('también un `null` escrito a mano (no es «sin entorno» decidido por el formulario)', campo(r4, 'entorno') === null, JSON.stringify(campo(r4, 'entorno')))
    // NEGATIVOS: lo que SÍ se gobierna no se cuela por la puerta de lo ajeno.
    // El formulario SIN la clave (no con `undefined`): así, si lo gobernado se colara
    // como ajeno, las notas del previo aparecerían aquí.
    const sinNotas = delFormulario()
    delete sinNotas.notas
    const r5 = conservarAlEditar(previo(), sinNotas)
    check('NEGATIVO: una clave gobernada que el formulario no trae (notas) no vuelve del previo', !('notas' in r5), JSON.stringify(r5.notas))
    const r6 = conservarAlEditar({ ...previo(), entorno: 'produccion' }, delFormulario())
    check('NEGATIVO: un entorno CONOCIDO quitado en el formulario no vuelve', !('entorno' in r6), JSON.stringify(r6.entorno))
    const gobernadas = Object.entries(CLAVES_GOBERNADAS).filter(([, g]) => g).map(([k]) => k)
    check(
      'CLAVES_GOBERNADAS: todas las del registro persistido salvo `secretoIlegible` (que es del DTO)',
      Object.keys(previo()).every((k) => esClaveGobernada(k)) && !esClaveGobernada('secretoIlegible') && !esClaveGobernada('colorFuturo') && !esClaveGobernada('toString'),
      gobernadas.join(',')
    )
    const conSecretoIlegible = conservarAlEditar(futuro({ secretoIlegible: true }), delFormulario())
    check('un `secretoIlegible` escrito en disco es ajeno: se conserva, no se gobierna', campo(conSecretoIlegible, 'secretoIlegible') === true, 'conservado')
    const proto = JSON.parse('{"__proto__":{"clave":"futura"}}') as Record<string, unknown>
    const r7 = conservarAlEditar({ ...previo(), ...proto } as ConexionPersistida, delFormulario())
    check(
      'una clave futura llamada `__proto__` sobrevive como clave PROPIA (no como prototipo)',
      (Object.getOwnPropertyDescriptor(r7, '__proto__')?.value as { clave?: string } | undefined)?.clave === 'futura' && Object.getPrototypeOf(r7) === Object.prototype,
      JSON.stringify(r7)
    )
  }

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
}

main()
