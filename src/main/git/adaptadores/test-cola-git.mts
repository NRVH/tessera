#!/usr/bin/env node
// =============================================================================
// Prueba de la cola de git (npm run test:cola-git): el tope se respeta aunque lleguen mil trabajos
// de golpe, la prioridad manda, dentro de una prioridad rige el orden de llegada, cancelar un
// ámbito tira lo que no ha nacido y deja acabar lo que ya corre, y un trabajo que falla no atasca la cola.
// =============================================================================

import { ColaGit, PRIORIDAD, esCancelado } from './colaGit.ts'

// ---------------------------------------------------------------------------
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
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  hr('1) EL TOPE se respeta aunque lleguen mil de golpe')
  {
    const cola = new ColaGit(4)
    let vuelo = 0
    let pico = 0
    const trabajos = Array.from({ length: 1000 }, () =>
      cola.correr(async () => {
        vuelo++
        if (vuelo > pico) pico = vuelo
        await esperar(1)
        vuelo--
      })
    )
    // Justo tras encolar, ANTES de ceder el bucle: el tope ya debe estar aplicado.
    check(
      'encolar 1000 no arranca 1000 (bombeo síncrono, tope aplicado ya)',
      cola.enVuelo === 4 && cola.enCola === 996,
      `enVuelo=${cola.enVuelo} enCola=${cola.enCola}`
    )
    await Promise.all(trabajos)
    check('el pico de concurrencia nunca pasó del tope', pico === 4, `pico=${pico} (tope 4)`)
    check('la cola queda vacía al terminar', cola.enVuelo === 0 && cola.enCola === 0, 'vacía')
  }

  // -------------------------------------------------------------------------
  hr('2) LA PRIORIDAD manda: lo que se ve no espera detrás de lo que no')
  {
    const cola = new ColaGit(1)
    const orden: string[] = []
    const t = (n: string, p: (typeof PRIORIDAD)[keyof typeof PRIORIDAD]): Promise<void> =>
      cola.correr(async () => {
        orden.push(n)
        await esperar(1)
      }, p)
    // El primero arranca de inmediato (tope 1) y hace de tapón; los otros compiten.
    const todos = [
      t('tapon', PRIORIDAD.FONDO),
      t('fondo1', PRIORIDAD.FONDO),
      t('fondo2', PRIORIDAD.FONDO),
      t('visible', PRIORIDAD.VISIBLE),
      t('pronto', PRIORIDAD.PRONTO)
    ]
    await Promise.all(todos)
    check(
      'el VISIBLE encolado el CUARTO se atiende antes que los de fondo previos',
      orden[1] === 'visible' && orden[2] === 'pronto',
      orden.join(' -> ')
    )
  }

  // -------------------------------------------------------------------------
  hr('3) DENTRO de una prioridad, orden de llegada (nada se queda atrás)')
  {
    const cola = new ColaGit(1)
    const orden: number[] = []
    const todos = Array.from({ length: 20 }, (_, i) =>
      cola.correr(async () => {
        orden.push(i)
        await esperar(0)
      }, PRIORIDAD.FONDO)
    )
    await Promise.all(todos)
    check(
      'FIFO estricto dentro de la misma prioridad (sin inanición)',
      orden.every((v, i) => v === i),
      `${orden.slice(0, 5).join(',')}…${orden.slice(-3).join(',')}`
    )
  }

  // -------------------------------------------------------------------------
  hr('4) CANCELAR un ámbito tira lo encolado y deja acabar lo que ya corre')
  {
    const cola = new ColaGit(2)
    let ejecutados = 0
    let sueltaTapon = (): void => {}
    const tapon = new Promise<void>((r) => (sueltaTapon = r))
    // Dos tapones ocupan el tope; el resto se queda en cola.
    const enCurso = [
      cola.correr(
        async () => {
          await tapon
          ejecutados++
        },
        PRIORIDAD.FONDO,
        'perfil-A'
      ),
      cola.correr(
        async () => {
          await tapon
          ejecutados++
        },
        PRIORIDAD.FONDO,
        'perfil-A'
      )
    ]
    const encolados = Array.from({ length: 50 }, () =>
      cola.correr(
        async () => {
          ejecutados++
        },
        PRIORIDAD.FONDO,
        'perfil-A'
      ).catch((e: unknown) => (esCancelado(e) ? 'cancelado' : 'otroError'))
    )
    const otroAmbito = cola.correr(
      async () => {
        ejecutados++
        return 'ok'
      },
      PRIORIDAD.FONDO,
      'perfil-B'
    )
    const tirados = cola.cancelarAmbito('perfil-A')
    check('cancelar tira lo que estaba EN COLA de ese ámbito', tirados === 50, `${tirados} tirados`)
    sueltaTapon()
    await Promise.all(enCurso)
    const res = await Promise.all(encolados)
    check(
      'los cancelados rechazan con CanceladoError, no con un fallo real',
      res.every((r) => r === 'cancelado'),
      `${res.filter((r) => r === 'cancelado').length}/50`
    )
    check('lo que YA corría se dejó terminar', ejecutados >= 2, `${ejecutados} ejecutados`)
    check('OTRO ámbito no se ve afectado', (await otroAmbito) === 'ok', 'perfil-B siguió')
    check(
      'un trabajo del ámbito cancelado que llega TARDE tampoco corre',
      await cola
        .correr(async () => 'corrio', PRIORIDAD.FONDO, 'perfil-A')
        .then(() => false)
        .catch(esCancelado),
      'rechazado'
    )
    cola.reabrirAmbito('perfil-A')
    check(
      'al volver a ese perfil, el ámbito se reabre y vuelve a correr',
      (await cola.correr(async () => 'corrio', PRIORIDAD.FONDO, 'perfil-A')) === 'corrio',
      'corrió'
    )
  }

  // -------------------------------------------------------------------------
  hr('5) UN TRABAJO QUE FALLA no atasca la cola')
  {
    const cola = new ColaGit(2)
    const fallos = Array.from({ length: 10 }, () =>
      cola.correr(async () => {
        throw new Error('repo roto')
      }).catch(() => 'falló')
    )
    const bueno = cola.correr(async () => 'ok')
    await Promise.all(fallos)
    check(
      'tras 10 fallos, la cola sigue sirviendo y queda limpia',
      (await bueno) === 'ok' && cola.enVuelo === 0 && cola.enCola === 0,
      'sirvió y quedó vacía'
    )
  }

  // -------------------------------------------------------------------------
  hr('5b) UN TRABAJO QUE LANZA EN SÍNCRONO devuelve su plaza')
  {
    const cola = new ColaGit(2, 1)
    const lanza = (): Promise<string> => {
      throw new Error('argumentos inválidos')
    }
    const fallos = await Promise.all(
      Array.from({ length: 5 }, () => cola.correr(lanza, PRIORIDAD.FONDO).catch((e: Error) => e.message))
    )
    check('cada uno se rechaza con su error, sin escapar de la cola', fallos.every((m) => m === 'argumentos inválidos'), fallos.join(','))
    const bueno = await cola.correr(async () => 'ok', PRIORIDAD.FONDO)
    await esperar(0)
    check(
      'y el fondo (tope 1) sigue sirviendo: ninguna plaza quedó retenida',
      bueno === 'ok' && cola.enVuelo === 0 && cola.enCola === 0,
      `enVuelo=${cola.enVuelo} enCola=${cola.enCola}`
    )
  }

  // -------------------------------------------------------------------------
  hr('6) EL TOPE tiene que ser válido')
  {
    let lanzo = false
    try {
      new ColaGit(0)
    } catch {
      lanzo = true
    }
    check('un tope de 0 se rechaza (dejaría la cola parada para siempre)', lanzo, 'lanza')
    const lanza = (f: () => unknown): boolean => {
      try {
        f()
        return false
      } catch {
        return true
      }
    }
    check('un tope de fondo de 0 se rechaza (el fondo no arrancaría nunca)', lanza(() => new ColaGit(4, 0)), 'lanza')
    check('un tope de fondo mayor que el tope se rechaza', lanza(() => new ColaGit(4, 5)), 'lanza')
    check('y uno igual al tope vale', !lanza(() => new ColaGit(4, 4)), 'no lanza')
  }

  // -------------------------------------------------------------------------
  hr('7) EL FONDO tiene su propio tope y no le quita la plaza a lo visible')
  {
    const cola = new ColaGit(4, 2)
    let fondo = 0
    let picoFondo = 0
    const arranques: string[] = []
    const deFondo = Array.from({ length: 10 }, (_, i) =>
      cola.correr(async () => {
        fondo++
        if (fondo > picoFondo) picoFondo = fondo
        arranques.push(`f${i}`)
        await esperar(15)
        fondo--
      }, PRIORIDAD.FONDO)
    )
    check('encolar 10 de fondo arranca solo 2', cola.enVuelo === 2 && cola.enCola === 8, `enVuelo=${cola.enVuelo} enCola=${cola.enCola}`)
    // Con el fondo lleno, lo visible encuentra plaza libre y arranca AL ENCOLARSE.
    const visibles = ['v0', 'v1'].map((n) =>
      cola.correr(async () => {
        arranques.push(n)
        await esperar(15)
      }, PRIORIDAD.VISIBLE)
    )
    check(
      'dos visibles arrancan sin esperar a que acabe el fondo',
      cola.enVuelo === 4 && arranques.includes('v0') && arranques.includes('v1'),
      `enVuelo=${cola.enVuelo} arranques=${arranques.join(',')}`
    )
    await Promise.all([...deFondo, ...visibles])
    check('el fondo nunca pasó de su tope', picoFondo === 2, `pico=${picoFondo} (tope de fondo 2)`)
    check('y todo el fondo acabó corriendo, en su orden', arranques.filter((a) => a.startsWith('f')).join(',') === 'f0,f1,f2,f3,f4,f5,f6,f7,f8,f9', arranques.join(','))
    check('la cola queda vacía', cola.enVuelo === 0 && cola.enCola === 0, 'vacía')
  }

  // -------------------------------------------------------------------------
  hr('8) LO QUE YA NO INTERESA no llega a ejecutarse')
  {
    const cola = new ColaGit(1)
    let interesa = true
    let ejecutados = 0
    const tapon = cola.correr(() => esperar(20))
    const viejos = Array.from({ length: 5 }, () =>
      cola
        .correr(
          async () => {
            ejecutados++
            return 'corrió'
          },
          PRIORIDAD.FONDO,
          'abanico',
          () => interesa
        )
        .catch((e) => (esCancelado(e) ? 'cancelado' : 'otro error'))
    )
    const sinCondicion = cola.correr(async () => 'corrió', PRIORIDAD.FONDO)
    interesa = false // llega una generación nueva mientras los viejos siguen en cola
    await tapon
    const fin = await Promise.all(viejos)
    check('ninguno de los 5 ejecutó su función', ejecutados === 0, `ejecutados=${ejecutados}`)
    check('y se rechazan como cancelados, no como error', fin.every((r) => r === 'cancelado'), fin.join(','))
    check('un trabajo sin condición corre como siempre', (await sinCondicion) === 'corrió', 'corrió')
    check('`vigente` se pregunta al sacarlo, no al encolar: uno vigente sí corre', (await cola.correr(async () => 'ok', PRIORIDAD.FONDO, '', () => true)) === 'ok', 'ok')
    await esperar(0) // la plaza se libera un instante después de resolver la promesa
    check('la cola queda vacía', cola.enVuelo === 0 && cola.enCola === 0, 'vacía')
  }

  // -------------------------------------------------------------------------
  hr('9) SIN tope de fondo, el fondo usa todo el tope (como siempre)')
  {
    const cola = new ColaGit(4)
    const trabajos = Array.from({ length: 10 }, () => cola.correr(() => esperar(5), PRIORIDAD.FONDO))
    check('10 de fondo arrancan 4', cola.enVuelo === 4 && cola.enCola === 6, `enVuelo=${cola.enVuelo} enCola=${cola.enCola}`)
    await Promise.all(trabajos)
  }

  // -------------------------------------------------------------------------
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

void main()
