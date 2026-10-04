#!/usr/bin/env node
// =============================================================================
// Prueba del dueño del estado del controlador del explorador (`estado.ts`), pura: la consola y
// su esquema por perfil, el cambio de esquema en vuelo, las esperas al renderer y las marcas
// de las peticiones de datos en preparación. (npm run test:db-estado-explorador)
// =============================================================================

import { EstadoExplorador } from './estado.ts'

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

function consolas(): void {
  hr('Consolas: conexión y esquema')
  const e = new EstadoExplorador()
  e.recordarConsola('p1', 'c1', 'con-a', 'HR')
  e.recordarConsola('p1', 'c2', 'con-a', undefined)
  e.recordarConsola('p2', 'c3', 'con-a', 'SCOTT')
  e.recordarConsola('p2', 'c4', 'con-b', 'X')
  check('recordar fija conexión y esquema', e.conexionDeConsola('p1', 'c1') === 'con-a' && e.esquemaDeConsola('p1', 'c1') === 'HR', String(e.esquemaDeConsola('p1', 'c1')))
  check('sin esquema en el índice: el de la conexión', e.esquemaDeConsola('p1', 'c2') === undefined, String(e.esquemaDeConsola('p1', 'c2')))

  check('empezar un cambio de esquema', e.empezarCambioDeEsquema('p1', 'c1'), 'true')
  check('un segundo cambio en la misma consola se rechaza', !e.empezarCambioDeEsquema('p1', 'c1'), 'false')
  e.fijarEsquemaDeConsola('p1', 'c1', 'NUEVO')
  e.recordarConsola('p1', 'c1', 'con-a', 'HR')
  check('en vuelo, un índice viejo no pisa el esquema', e.esquemaDeConsola('p1', 'c1') === 'NUEVO', String(e.esquemaDeConsola('p1', 'c1')))
  e.terminarCambioDeEsquema('p1', 'c1')
  check('terminado, se puede volver a empezar', e.empezarCambioDeEsquema('p1', 'c1'), 'true')
  e.terminarCambioDeEsquema('p1', 'c1')
  e.fijarEsquemaDeConsola('p1', 'c1', null)
  check('null vuelve al de la conexión', e.esquemaDeConsola('p1', 'c1') === undefined, String(e.esquemaDeConsola('p1', 'c1')))

  e.olvidarConsolasDeConexion('con-a', 'p2')
  check(
    'olvidar en un perfil solo toca ese perfil',
    e.conexionDeConsola('p2', 'c3') === undefined && e.conexionDeConsola('p1', 'c2') === 'con-a' && e.esquemaDeConsola('p2', 'c4') === 'X',
    `${String(e.conexionDeConsola('p2', 'c3'))} ${String(e.conexionDeConsola('p1', 'c2'))}`
  )
  e.olvidarConsolasDeConexion('con-a')
  check(
    'olvidar la conexión entera la quita de todos los perfiles',
    e.conexionDeConsola('p1', 'c1') === undefined && e.conexionDeConsola('p1', 'c2') === undefined && e.conexionDeConsola('p2', 'c4') === 'con-b',
    String(e.conexionDeConsola('p2', 'c4'))
  )
  e.olvidarConsola('p2', 'c4')
  check('olvidar una consola quita conexión y esquema', e.conexionDeConsola('p2', 'c4') === undefined && e.esquemaDeConsola('p2', 'c4') === undefined, 'ok')

  // Perder un esquema (el ALTER al reabrir falla) solo olvida ESE esquema: si mientras volaba el
  // usuario eligió otro, o hay un cambio en vuelo, lo elegido se conserva.
  e.fijarEsquemaDeConsola('p3', 'c5', 'Y')
  check('perder el esquema guardado lo olvida', e.olvidarEsquemaPerdido('p3', 'c5', 'Y') && e.esquemaDeConsola('p3', 'c5') === undefined, String(e.esquemaDeConsola('p3', 'c5')))
  e.fijarEsquemaDeConsola('p3', 'c6', 'Y')
  e.empezarCambioDeEsquema('p3', 'c6')
  e.fijarEsquemaDeConsola('p3', 'c6', 'X')
  check('perder Y con un cambio a X en vuelo conserva X', !e.olvidarEsquemaPerdido('p3', 'c6', 'Y') && e.esquemaDeConsola('p3', 'c6') === 'X', String(e.esquemaDeConsola('p3', 'c6')))
  e.terminarCambioDeEsquema('p3', 'c6')
  check('perder Y cuando ya está guardado X conserva X', !e.olvidarEsquemaPerdido('p3', 'c6', 'Y') && e.esquemaDeConsola('p3', 'c6') === 'X', String(e.esquemaDeConsola('p3', 'c6')))
}

async function esperas(): Promise<void> {
  hr('Esperas al renderer')
  const e = new EstadoExplorador()
  let respuesta: unknown = 'nada'
  const id1 = e.abrirEsperaSinEnviar((p) => {
    respuesta = p
  })
  e.responderSinEnviar((id) => (id === id1 + 1 ? [] : null))
  check('una respuesta a otra pregunta no resuelve', respuesta === 'nada', String(respuesta))
  e.responderSinEnviar((id) => (id === id1 ? [] : null))
  check('la respuesta a la pregunta en curso resuelve', Array.isArray(respuesta), JSON.stringify(respuesta))
  respuesta = 'nada'
  e.responderSinEnviar(() => [])
  check('ya respondida, no se responde dos veces', respuesta === 'nada', String(respuesta))
  const id2 = e.abrirEsperaSinEnviar(() => undefined)
  check('cada pregunta lleva un id nuevo', id2 === id1 + 1, `${id1} -> ${id2}`)
  e.cerrarEsperaSinEnviar(id1)
  let tardia = false
  e.responderSinEnviar(() => {
    tardia = true
    return null
  })
  check('cerrar con un id viejo no cierra la pregunta en curso', tardia, String(tardia))

  const acuse = e.esperarVaciado()
  let cumplida = false
  void acuse.then(() => {
    cumplida = true
  })
  e.acusarVaciado()
  await acuse
  check('el acuse cumple la espera de vaciado', cumplida, String(cumplida))
}

function preparacion(): void {
  hr('Peticiones de datos en preparación')
  const e = new EstadoExplorador()
  const a = e.apuntarPreparacion('con', 'p1')
  const b = e.apuntarPreparacion('con', 'p1')
  check('apuntada, está en preparación', e.hayEnPreparacion('con', 'p1') && !e.hayEnPreparacion('con', 'p2'), 'ok')
  e.detenerPreparacion('con', 'p1')
  check('el Stop detiene las dos con el mismo id', a.detenido() && b.detenido(), `${a.detenido()} ${b.detenido()}`)
  a.soltar()
  check('la que acaba no borra la marca de la otra', e.hayEnPreparacion('con', 'p1'), 'sigue')
  b.soltar()
  check('sin marcas, ya no está en preparación', !e.hayEnPreparacion('con', 'p1'), 'fuera')
  const c = e.apuntarPreparacion('con', 'p1')
  check('una marca nueva nace sin detener', !c.detenido(), String(c.detenido()))
  c.soltar()
}

async function main(): Promise<void> {
  consolas()
  await esperas()
  preparacion()
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
