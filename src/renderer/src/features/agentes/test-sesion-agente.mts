#!/usr/bin/env node
// =============================================================================
// Prueba de `SesionAgente`, el dueño del estado de la sesión del pane del agente
// (node src/renderer/src/features/agentes/test-sesion-agente.mts): la apertura (candado,
// banner de re-apertura, lo pedido que se consume y se devuelve) y lo que hace soltar
// la sesión en cada caso, incluido lo que NO hace (cerrar lo que el main ya cerró).
// =============================================================================

import { PLAN_SOLTAR, SesionAgente, type MotivoSoltar } from './sesionViva.ts'

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

/** Una sesión con espejo y puertos falsos que apuntan, en orden, lo que se les pide. */
function nueva(): { s: SesionAgente; log: string[] } {
  const log: string[] = []
  const s = new SesionAgente({
    limpiarTerminal: () => log.push('limpiar'),
    cerrar: async (id) => {
      log.push(`cerrar:${id}`)
    }
  })
  s.conectar({
    setSessionId: (id) => log.push(`id:${id}`),
    setStatus: (e) => log.push(`estado:${e}`),
    nuevaConversacion: () => log.push('conversacion')
  })
  return { s, log }
}

/** Abre con `cuenta` y adopta `id`, y vacía el registro. */
function abierta(id = 's1', cuenta = 'c1'): { s: SesionAgente; log: string[] } {
  const r = nueva()
  r.s.empezarApertura(cuenta)
  r.s.adoptar(id)
  r.s.terminarApertura()
  r.log.length = 0
  return r
}

hr('(1) Apertura')
{
  const { s, log } = nueva()
  check('sin sesión ni apertura se puede abrir', s.puedeAbrir() && s.id() === null, 'puedeAbrir')
  s.pedirReanudar('conv-7')
  const a = s.empezarApertura('c1')
  check('la primera apertura no lleva banner y consume lo pedido', a !== null && !a.banner && a.pedido.reanudar === 'conv-7' && !a.pedido.deCero, JSON.stringify(a))
  check('con una apertura en vuelo no se abre otra', s.abriendo() && !s.puedeAbrir() && s.empezarApertura('c1') === null, 'null')
  s.devolverPedido(a!.pedido)
  s.terminarApertura()
  const b = s.empezarApertura('c1')
  check('un open fallido devuelve lo pedido al siguiente intento', b?.pedido.reanudar === 'conv-7', JSON.stringify(b))
  s.adoptar('s1')
  s.terminarApertura()
  check('adoptar refleja el id en el estado del pane', s.id() === 's1' && log.includes('id:s1'), JSON.stringify(log))
  check('con una sesión viva no se abre otra', s.empezarApertura('c1') === null, 'null')
  void s.soltar('hibernada')
  const c = s.empezarApertura('c1')
  check('tras hibernar la re-apertura lleva banner «reanudado»', c?.banner === true, JSON.stringify(c))
  s.terminarApertura()
  s.pedirReanudar('x')
  s.pedirNueva()
  void s.soltar('desmontaje')
  const d = s.empezarApertura('c1')
  check('pedir una nueva olvida la reanudación pedida', d?.pedido.deCero === true && d.pedido.reanudar === null, JSON.stringify(d))
}

hr('(2) Cuenta con la que se abrió')
{
  const { s } = abierta('s1', 'c1')
  check('abiertaCon(c1)', s.abiertaCon('c1') && !s.abiertaCon('c2'), 'c1')
  check('otra cuenta elegida con sesión viva', s.abiertaConOtraCuenta('c2') && s.abiertaConOtraCuenta(null), 'c2 / null')
  check('la misma cuenta no es otra', !s.abiertaConOtraCuenta('c1'), 'c1')
  void s.soltar('hibernada')
  check('sin sesión viva no hay cambio de cuenta que atender', !s.abiertaConOtraCuenta('c2'), 'false')
}

hr('(3) Soltar, caso por caso')
{
  const { s, log } = abierta()
  const cierre = s.soltar('conversacion')
  check(
    'conversación: avisa, booting, relee el anillo, limpia y cierra',
    log.join(' > ') === 'id:null > estado:booting > conversacion > limpiar > cerrar:s1' && cierre !== null,
    log.join(' > ')
  )
  check('conversación: la siguiente apertura no lleva banner', s.empezarApertura('c1')?.banner === false, 'banner=false')
}
{
  const { s, log } = nueva()
  const cierre = s.soltar('conversacion')
  check('conversación sin sesión: limpia y no cierra nada', log.join(' > ') === 'estado:booting > conversacion > limpiar' && cierre === null, log.join(' > '))
}
{
  const { s, log } = abierta()
  void s.soltar('cuenta')
  check('cuenta: como una conversación nueva', log.join(' > ') === 'id:null > estado:booting > conversacion > limpiar > cerrar:s1', log.join(' > '))
  log.length = 0
  check('cuenta sin sesión: nada', s.soltar('cuenta') === null && log.length === 0, JSON.stringify(log))
}
{
  const { s, log } = abierta()
  const cierre = s.soltar('logout')
  check('logout: limpia sin cerrar (lo cerró el main) y sin releer', log.join(' > ') === 'id:null > estado:booting > limpiar' && cierre === null, log.join(' > '))
  check('logout: reabre la MISMA conversación, con banner y la misma cuenta', s.abiertaCon('c1') && s.empezarApertura('c1')?.banner === true, 'banner=true')
}
{
  const { s, log } = abierta()
  void s.soltar('eliminada')
  check('eliminada: avisa y limpia sin cerrar', log.join(' > ') === 'id:null > limpiar', log.join(' > '))
  check('eliminada: olvida la cuenta y el banner', !s.abiertaCon('c1') && s.empezarApertura('c2')?.banner === false, 'cuenta olvidada')
}
{
  const r = abierta()
  void r.s.soltar('hibernada')
  r.log.length = 0
  void r.s.soltar('eliminada')
  check('eliminada sin sesión viva: limpia igual', r.log.join(' > ') === 'limpiar' && !r.s.abiertaCon('c1'), r.log.join(' > '))
}
{
  const { s, log } = abierta()
  void s.soltar('hibernada')
  check('hibernada: solo olvida el id (el xterm sobrevive)', log.join(' > ') === 'id:null' && s.id() === null, log.join(' > '))
}
{
  const { s, log } = abierta()
  void s.soltar('desmontaje')
  check('desmontaje: cierra sin tocar el estado del pane', log.join(' > ') === 'cerrar:s1' && s.id() === null, log.join(' > '))
}

hr('(4) El plan')
{
  const motivos = Object.keys(PLAN_SOLTAR) as MotivoSoltar[]
  const cierran = motivos.filter((m) => PLAN_SOLTAR[m].cerrar).sort().join(',')
  check('solo cierran en el main los casos en que el main no la cerró ya', cierran === 'conversacion,cuenta,desmontaje', cierran)
  check('el plan es inmutable', Object.isFrozen(PLAN_SOLTAR), 'frozen')
}

hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  console.log(`      -> ${r.evidence}`)
}
const allPass = results.every((r) => r.pass)
hr(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
