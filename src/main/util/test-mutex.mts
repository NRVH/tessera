#!/usr/bin/env node
// =============================================================================
// Prueba del MutexPorClave (npm run test:mutex), lógica pura: misma clave en serie y en orden,
// claves distintas en paralelo, un rechazo propaga su error sin romper la cadena, el valor de
// retorno se propaga, `vaciar()` espera lo encolado hasta ese momento (también con rechazos, y
// resuelve ya sin nada encolado) y `ocupado` dice si queda algo en alguna clave.
// =============================================================================

import { MutexPorClave } from './mutex.ts'

interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}
function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main(): Promise<void> {
  // --- (a) misma clave => serie ---------------------------------------------
  {
    const m = new MutexPorClave()
    let enMarcha = 0
    let maxEnMarcha = 0
    const orden: number[] = []
    const tarea = (n: number): Promise<void> =>
      m.ejecutarExclusivo('perfil-A', async () => {
        enMarcha++
        maxEnMarcha = Math.max(maxEnMarcha, enMarcha)
        orden.push(n)
        await esperar(20)
        enMarcha--
      })
    // Lanza 3 CASI a la vez; el mutex debe correrlas una tras otra, en orden de llegada.
    await Promise.all([tarea(1), tarea(2), tarea(3)])
    check('(a) misma clave nunca solapa (maxEnMarcha === 1)', maxEnMarcha === 1, `maxEnMarcha=${maxEnMarcha}`)
    check('(a.2) orden de llegada preservado', JSON.stringify(orden) === '[1,2,3]', `order=${JSON.stringify(orden)}`)
  }

  // --- (b) claves distintas => paralelo -------------------------------------
  {
    const m = new MutexPorClave()
    let enMarcha = 0
    let maxEnMarcha = 0
    const tarea = (clave: string): Promise<void> =>
      m.ejecutarExclusivo(clave, async () => {
        enMarcha++
        maxEnMarcha = Math.max(maxEnMarcha, enMarcha)
        await esperar(30)
        enMarcha--
      })
    await Promise.all([tarea('perfil-A'), tarea('perfil-B')])
    check('(b) claves distintas corren en paralelo (maxEnMarcha === 2)', maxEnMarcha === 2, `maxEnMarcha=${maxEnMarcha}`)
  }

  // --- (c) aislamiento de errores -------------------------------------------
  {
    const m = new MutexPorClave()
    // Holder objeto (no `let`): TS no estrecha lecturas de propiedad a través de
    // sentencias como haría con una variable mutada dentro de un callback async.
    const st = { rechazadaCon: '', corrioDespues: false }
    // fn que rechaza: su error debe llegar al LLAMADOR...
    const p1 = m
      .ejecutarExclusivo('perfil-A', async () => {
        await esperar(5)
        throw new Error('boom')
      })
      .catch((e) => {
        st.rechazadaCon = e instanceof Error ? e.message : String(e)
      })
    // ...pero la cadena de 'perfil-A' NO se rompe: este segundo corre igual.
    const p2 = m.ejecutarExclusivo('perfil-A', async () => {
      st.corrioDespues = true
    })
    await Promise.all([p1, p2])
    check('(c) el error del fn llega al llamador', st.rechazadaCon === 'boom', `rechazadaCon="${st.rechazadaCon}"`)
    check('(c.2) un rechazo no rompe la cadena (el siguiente corre)', st.corrioDespues === true, `corrioDespues=${st.corrioDespues}`)
  }

  // --- (d) retorno se propaga -----------------------------------------------
  {
    const m = new MutexPorClave()
    const v = await m.ejecutarExclusivo('k', async () => 42)
    check('(d) el valor de retorno de fn se propaga', v === 42, `v=${v}`)
  }

  // --- (e) vaciar ----------------------------------------------------------
  {
    const m = new MutexPorClave()
    // Nada encolado: resuelve en la siguiente vuelta, sin esperar a ningún temporizador.
    const sinNada = await Promise.race([m.vaciar().then(() => 'vacio'), esperar(50).then(() => 'colgado')])
    check('(e) con nada encolado, vaciar() resuelve ya', sinNada === 'vacio', `resultado=${sinNada}`)

    const hechas: string[] = []
    const a1 = m.ejecutarExclusivo('perfil-A', async () => {
      await esperar(20)
      hechas.push('A1')
    })
    const a2 = m
      .ejecutarExclusivo('perfil-A', async () => {
        await esperar(10)
        hechas.push('A2')
        throw new Error('boom')
      })
      .catch(() => undefined)
    const b1 = m.ejecutarExclusivo('perfil-B', async () => {
      await esperar(30)
      hechas.push('B1')
    })
    const st = { rechazo: false }
    await m.vaciar().catch(() => {
      st.rechazo = true
    })
    check(
      '(e.2) vaciar() espera a todo lo encolado en todas las claves, también a la que rechaza, y no rechaza',
      hechas.length === 3 && hechas.indexOf('A2') >= 0 && !st.rechazo,
      `hechas=${JSON.stringify(hechas)} rechazo=${st.rechazo}`
    )
    await Promise.all([a1, a2, b1])

    // Lo que se encola DESPUÉS de llamar a vaciar() no se espera.
    const tarde = { hecha: false }
    const lenta = m.ejecutarExclusivo('perfil-A', async () => {
      await esperar(15)
    })
    const espera = m.vaciar()
    const posterior = m.ejecutarExclusivo('perfil-C', async () => {
      await esperar(200)
      tarde.hecha = true
    })
    await espera
    check('(e.3) lo encolado después de vaciar() no se espera', tarde.hecha === false, `tarde.hecha=${tarde.hecha}`)
    // ...y `ocupado` es lo que dice que queda algo: con él se repite `vaciar()` hasta el final.
    check('(f) tras vaciar(), ocupado sigue en true si se encoló algo después', m.ocupado === true, `ocupado=${m.ocupado}`)
    await Promise.all([lenta, posterior])
  }

  // --- (f) ocupado -----------------------------------------------------------
  {
    const m = new MutexPorClave()
    const antes = m.ocupado
    // Holder objeto: TS no estrecha lecturas de propiedad mutadas dentro de un callback.
    const visto = { durante: false }
    const p = m.ejecutarExclusivo('k', async () => {
      await esperar(10)
      visto.durante = m.ocupado
    })
    const alEncolar = m.ocupado
    await p
    await m.vaciar()
    check(
      '(f.2) ocupado: false sin nada, true al encolar y mientras corre, false tras vaciar()',
      antes === false && alEncolar === true && visto.durante && m.ocupado === false,
      `antes=${antes} alEncolar=${alEncolar} durante=${visto.durante} despues=${m.ocupado}`
    )
    // La clave se limpia aunque la fn rechace (si no, `ocupado` mentiría para siempre).
    await m.ejecutarExclusivo('k', async () => {
      throw new Error('boom')
    }).catch(() => undefined)
    await m.vaciar()
    check('(f.3) una fn que rechaza tampoco deja la clave ocupada', m.ocupado === false, `ocupado=${m.ocupado}`)
  }

  console.log('\n' + '='.repeat(78))
  const allPass = results.every((r) => r.pass)
  console.log(`VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('[test:mutex] error inesperado:', err)
  process.exit(1)
})
