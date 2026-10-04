#!/usr/bin/env node
// =============================================================================
// Prueba de la cola de una sesión del explorador (`colaSesion.ts`), pura. Fija lo que el
// gestor da por hecho: concurrencia 1, arranque síncrono si está libre, prioridades, cancelar
// una tarea que espera o que corre, y el descarte por clave. (npm run test:db-cola)
// =============================================================================

import { ColaSesion, ErrorCola, esErrorCola } from './colaSesion.ts'

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

/** Promesa controlable desde fuera. */
function diferida<T = void>(): { promesa: Promise<T>; resolver: (v: T) => void; rechazar: (e: unknown) => void } {
  let resolver!: (v: T) => void
  let rechazar!: (e: unknown) => void
  const promesa = new Promise<T>((res, rej) => {
    resolver = res
    rechazar = rej
  })
  return { promesa, resolver, rechazar }
}

/** Deja correr los microtasks pendientes. */
async function vaciarMicrotareas(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** Resultado de una promesa sin lanzar: 'ok:<valor>' o 'error:<motivo|mensaje>'. */
function observar<T>(p: Promise<T>): { valor: () => string } {
  let estado = 'pendiente'
  p.then(
    (v) => {
      estado = `ok:${String(v)}`
    },
    (e: unknown) => {
      estado = esErrorCola(e) ? `error:${e.motivo}` : `error:${e instanceof Error ? e.message : String(e)}`
    }
  )
  return { valor: () => estado }
}

async function main(): Promise<void> {
  hr('(1)(2) Concurrencia 1 y arranque síncrono')
  {
    const cola = new ColaSesion()
    const orden: string[] = []
    const a = diferida<string>()
    const pa = cola.correr(() => {
      orden.push('A empieza')
      return a.promesa
    })
    check('A arranca síncrona al encolar con la cola libre', orden.length === 1 && cola.enCurso, orden.join(','))
    const pb = cola.correr(() => {
      orden.push('B empieza')
      return 'B'
    })
    await vaciarMicrotareas()
    check('B no empieza mientras A corre', orden.indexOf('B empieza') < 0 && cola.longitud === 1, orden.join(','))
    a.resolver('A')
    const [ra, rb] = await Promise.all([pa, pb])
    check('A y B terminan en orden con su valor', ra === 'A' && rb === 'B' && orden.join(',') === 'A empieza,B empieza', `${ra},${rb}`)
    check('la cola queda vacía', cola.vacia() && !cola.enCurso && cola.longitud === 0, `vacia=${cola.vacia()}`)
  }

  hr('(3) Prioridad y orden de llegada')
  {
    const cola = new ColaSesion()
    const orden: string[] = []
    const bloqueo = diferida()
    const pBloqueo = cola.correr(() => bloqueo.promesa)
    const tareas = [
      cola.correr(() => void orden.push('baja1'), { prioridad: 'baja' }),
      cola.correr(() => void orden.push('normal1')),
      cola.correr(() => void orden.push('alta1'), { prioridad: 'alta' }),
      cola.correr(() => void orden.push('baja2'), { prioridad: 'baja' }),
      cola.correr(() => void orden.push('alta2'), { prioridad: 'alta' }),
      cola.correr(() => void orden.push('normal2'), { prioridad: 'normal' })
    ]
    check('6 esperando tras la bloqueante', cola.longitud === 6, `longitud=${cola.longitud}`)
    bloqueo.resolver()
    await pBloqueo
    await Promise.all(tareas)
    const esperado = 'alta1,alta2,normal1,normal2,baja1,baja2'
    check('alta > normal > baja, FIFO dentro de cada una', orden.join(',') === esperado, orden.join(','))
  }

  hr('(4) Cancelar una que ESPERA')
  {
    const cola = new ColaSesion()
    const bloqueo = diferida()
    void cola.correr(() => bloqueo.promesa)
    let corrio = false
    const obs = observar(
      cola.correr(
        () => {
          corrio = true
        },
        { clave: 'p1' }
      )
    )
    const devuelto = cola.cancelar('p1')
    await vaciarMicrotareas()
    check('cancelar devuelve false (no corría)', devuelto === false, `devuelto=${devuelto}`)
    check("su promesa rechaza con motivo 'cancelada'", obs.valor() === 'error:cancelada', obs.valor())
    check('la sacó de la cola', cola.longitud === 0 && !cola.esperandoClave('p1'), `longitud=${cola.longitud}`)
    bloqueo.resolver()
    await vaciarMicrotareas()
    check('su función nunca corrió', corrio === false, `corrio=${corrio}`)
    check('cancelar una clave desconocida devuelve false', cola.cancelar('nada') === false, 'false')
  }

  hr('(5) Cancelar la que CORRE')
  {
    const cola = new ColaSesion()
    const d = diferida<string>()
    const obs = observar(cola.correr(() => d.promesa, { clave: 'ej1' }))
    check('claveEnCurso = ej1', cola.claveEnCurso() === 'ej1', String(cola.claveEnCurso()))
    const devuelto = cola.cancelar('ej1')
    check('cancelar devuelve true para que el llamador interrumpa', devuelto === true, `devuelto=${devuelto}`)
    // La sentencia interrumpida responde con su error: la promesa refleja ESO.
    d.rechazar(new Error('ORA-01013: el usuario pidió cancelar'))
    await vaciarMicrotareas()
    check('su promesa termina con el resultado real de la tarea', obs.valor().indexOf('ORA-01013') >= 0, obs.valor())
    check('y la cola queda libre', cola.vacia(), `vacia=${cola.vacia()}`)
  }

  hr('(6) Descarte por clave')
  {
    const cola = new ColaSesion()
    const bloqueo = diferida()
    void cola.correr(() => bloqueo.promesa, { clave: 'tabla1' })
    const corridas: string[] = []
    const vieja = observar(cola.correr(() => corridas.push('vieja'), { clave: 'tabla1' }))
    const nueva = observar(cola.correr(() => corridas.push('nueva'), { clave: 'tabla1' }))
    await vaciarMicrotareas()
    check("la que esperaba rechaza con 'descartada'", vieja.valor() === 'error:descartada', vieja.valor())
    check('solo queda la nueva esperando', cola.longitud === 1, `longitud=${cola.longitud}`)
    check('la que corre (misma clave) sigue en curso', cola.claveEnCurso() === 'tabla1' && cola.enCurso, String(cola.claveEnCurso()))
    bloqueo.resolver()
    await vaciarMicrotareas()
    check('corre solo la nueva', corridas.join(',') === 'nueva' && nueva.valor() === 'ok:1', `${corridas.join(',')} ${nueva.valor()}`)

    const cola2 = new ColaSesion()
    const b2 = diferida()
    void cola2.correr(() => b2.promesa)
    const x = observar(cola2.correr(() => 'x', { clave: 'k', descartarClave: false }))
    const y = observar(cola2.correr(() => 'y', { clave: 'k', descartarClave: false }))
    check('descartarClave:false conserva las dos', cola2.longitud === 2, `longitud=${cola2.longitud}`)
    b2.resolver()
    await vaciarMicrotareas()
    check('y las dos corren', x.valor() === 'ok:x' && y.valor() === 'ok:y', `${x.valor()} ${y.valor()}`)
    check('cancelar(k) con dos esperando las saca todas', (() => {
      const c = new ColaSesion()
      void c.correr(() => new Promise<void>(() => undefined))
      void c.correr(() => 1, { clave: 'k', descartarClave: false }).catch(() => undefined)
      void c.correr(() => 2, { clave: 'k', descartarClave: false }).catch(() => undefined)
      c.cancelar('k')
      return c.longitud === 0
    })(), 'longitud=0')
  }

  hr('(7) Los errores no paran la cola')
  {
    const cola = new ColaSesion()
    const sincrono = observar(
      cola.correr(() => {
        throw new Error('síncrono')
      })
    )
    const asincrono = observar(cola.correr(() => Promise.reject(new Error('asíncrono'))))
    const despues = observar(cola.correr(() => 'sigue'))
    await vaciarMicrotareas()
    check('error síncrono rechaza su promesa', sincrono.valor() === 'error:síncrono', sincrono.valor())
    check('error asíncrono rechaza su promesa', asincrono.valor() === 'error:asíncrono', asincrono.valor())
    check('la siguiente corre igual', despues.valor() === 'ok:sigue', despues.valor())
    check('la cola queda vacía', cola.vacia(), `vacia=${cola.vacia()}`)
  }

  hr('(8) Consultas de estado')
  {
    const cola = new ColaSesion()
    check('nueva: vacia, longitud 0, sin clave en curso', cola.vacia() && cola.longitud === 0 && cola.claveEnCurso() === null, 'ok')
    const d = diferida()
    void cola.correr(() => d.promesa)
    check('en curso sin clave: claveEnCurso null pero no vacía', cola.claveEnCurso() === null && !cola.vacia(), `vacia=${cola.vacia()}`)
    void cola.correr(() => undefined, { clave: 'q' })
    check('esperandoClave(q)', cola.esperandoClave('q') && !cola.esperandoClave('z'), 'q sí, z no')
    d.resolver()
    await vaciarMicrotareas()
    check('al terminar todo, vacía', cola.vacia(), `vacia=${cola.vacia()}`)
  }

  hr('(9) descartarTodas')
  {
    const cola = new ColaSesion()
    const d = diferida<string>()
    const enCurso = observar(cola.correr(() => d.promesa))
    const e1 = observar(cola.correr(() => 1))
    const e2 = observar(cola.correr(() => 2, { prioridad: 'baja' }))
    const n = cola.descartarTodas()
    await vaciarMicrotareas()
    check('devuelve cuántas sacó', n === 2, `n=${n}`)
    check("las que esperaban rechazan con 'vaciada'", e1.valor() === 'error:vaciada' && e2.valor() === 'error:vaciada', `${e1.valor()} ${e2.valor()}`)
    check('la que corría sigue en curso', cola.enCurso && enCurso.valor() === 'pendiente', enCurso.valor())
    d.resolver('fin')
    await vaciarMicrotareas()
    check('y termina con su valor', enCurso.valor() === 'ok:fin', enCurso.valor())
    const err = new ErrorCola('cancelada', 'k')
    check('ErrorCola lleva motivo, clave y nombre', err.motivo === 'cancelada' && err.clave === 'k' && err.name === 'ErrorCola' && esErrorCola(err), err.message)
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

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
