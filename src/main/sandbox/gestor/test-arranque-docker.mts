#!/usr/bin/env node
// =============================================================================
// Prueba del arranque de Docker (npm run test:arranque-docker): qué orden se intenta en cada plataforma, que solo se
// inicia si el motor no contesta, que varias peticiones comparten una espera, y que un fallo se dice con su motivo.
// Decisiones: docs/decisiones/sandbox/iniciar-docker-al-necesitarlo.md
// =============================================================================
import { ArranqueDocker, TOPE_ARRANQUE_MS, ordenesInicioDocker, type OrdenInicio } from './arranqueDocker.ts'
import type { DockerCheckResult } from './tipos.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${evidencia}`)
}

const CAIDO: DockerCheckResult = { ok: false, detalle: 'El motor no responde', motorCaido: true }
const LISTO: DockerCheckResult = { ok: true, detalle: '29.0' }
const ROOTLESS: DockerCheckResult = { ok: false, detalle: 'Docker sin privilegios' }

interface Banco {
  arranque: ArranqueDocker
  lanzadas: OrdenInicio[]
  reloj: () => number
}

function banco(estados: () => DockerCheckResult, lanzar: (o: OrdenInicio) => boolean = () => true): Banco {
  const lanzadas: OrdenInicio[] = []
  let reloj = 0
  const arranque = new ArranqueDocker({
    comprobar: () => Promise.resolve(estados()),
    lanzar: (o) => {
      lanzadas.push(o)
      return Promise.resolve(lanzar(o))
    },
    ordenes: () => [{ programa: 'uno', args: [] }, { programa: 'dos', args: [] }],
    log: () => undefined,
    ahora: () => reloj,
    dormir: (ms) => {
      reloj += ms
      return Promise.resolve()
    }
  })
  return { arranque, lanzadas, reloj: () => reloj }
}

function probarOrdenes(): void {
  hr('Órdenes por plataforma')
  const win = ordenesInicioDocker('windows', 'C:\\Programas')
  check('Windows: la orden oficial y, si no, el ejecutable', win[0].args.join(' ') === 'desktop start --detach' && win[1].programa === 'C:\\Programas\\Docker\\Docker\\Docker Desktop.exe', JSON.stringify(win))
  const mac = ordenesInicioDocker('mac')
  check('macOS: la oficial y, si no, abrir la aplicación', mac[1].programa === 'open' && mac[1].args.join(' ') === '-a Docker', JSON.stringify(mac))
  const linux = ordenesInicioDocker('linux')
  check('Linux: sin sudo, solo el servicio del usuario', linux[1].programa === 'systemctl' && linux[1].args[0] === '--user' && !JSON.stringify(linux).includes('sudo'), JSON.stringify(linux))
  check('otra plataforma: nada que intentar', ordenesInicioDocker('otra').length === 0, 'otra')
}

async function probarArranque(): Promise<void> {
  hr('Arranque')
  const yaListo = banco(() => LISTO)
  let avisoSobrante = false
  const r1 = await yaListo.arranque.asegurar(() => {
    avisoSobrante = true
  })
  check('con Docker en marcha no se lanza nada ni se avisa', r1.ok && yaListo.lanzadas.length === 0 && !avisoSobrante, JSON.stringify(r1))

  const otro = banco(() => ROOTLESS)
  const r2 = await otro.arranque.asegurar()
  check('NEGATIVO: un problema con el motor en marcha no se intenta arreglar iniciándolo', !r2.ok && otro.lanzadas.length === 0, JSON.stringify(r2))

  let intentos = 0
  const arranca = banco(() => (++intentos > 3 ? LISTO : CAIDO))
  let esperaAvisada = false
  const r3 = await arranca.arranque.asegurar(() => {
    esperaAvisada = true
  })
  check('apagado: lo inicia, avisa y espera a que conteste', r3.ok && arranca.lanzadas.length === 1 && esperaAvisada, JSON.stringify(r3))

  let vistos = 0
  const respaldo = banco(() => (++vistos > 2 ? LISTO : CAIDO), (o) => o.programa === 'dos')
  const r4 = await respaldo.arranque.asegurar()
  check('si la orden oficial no existe, prueba la siguiente', r4.ok && respaldo.lanzadas.map((o) => o.programa).join() === 'uno,dos', JSON.stringify(respaldo.lanzadas))

  const sinForma = banco(() => CAIDO, () => false)
  const r5 = await sinForma.arranque.asegurar()
  check('si no hay cómo iniciarlo, lo dice sin esperar', !r5.ok && r5.detalle.includes('El motor no responde') && sinForma.reloj() === 0, r5.detalle)

  const nunca = banco(() => CAIDO)
  const r6 = await nunca.arranque.asegurar()
  check('si no contesta, se rinde al llegar al plazo y lo dice', !r6.ok && nunca.reloj() >= TOPE_ARRANQUE_MS && r6.detalle.includes('3'), r6.detalle)

  let liberar: () => void = () => undefined
  let comprobaciones = 0
  const lanzadas: OrdenInicio[] = []
  const compartida = new ArranqueDocker({
    comprobar: () => Promise.resolve(++comprobaciones > 2 ? LISTO : CAIDO),
    lanzar: (o) => {
      lanzadas.push(o)
      return new Promise((r) => {
        liberar = () => r(true)
      })
    },
    ordenes: () => [{ programa: 'uno', args: [] }],
    log: () => undefined,
    dormir: () => Promise.resolve()
  })
  const a = compartida.asegurar()
  const b = compartida.asegurar()
  await new Promise((r) => setTimeout(r, 10))
  liberar()
  const [ra, rb] = await Promise.all([a, b])
  check('dos peticiones a la vez comparten un solo arranque', ra.ok && rb.ok && lanzadas.length === 1, `${lanzadas.length} lanzada(s)`)
}

async function main(): Promise<void> {
  probarOrdenes()
  await probarArranque()
  const pasan = resultados.filter(Boolean).length
  hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${pasan === resultados.length ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(pasan === resultados.length ? 0 : 1)
}

void main()
