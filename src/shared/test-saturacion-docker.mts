// =============================================================================
// Prueba de cuándo Docker está saturado (npm run test:saturacion-docker): la lectura de `docker stats`,
// el paso del vigía (un pico no basta, el aviso, la cancelación, el respiro y la misma racha), los
// ajustes y la configuración que llega del renderer, con sus mitades negativas.
// Decisiones: docs/decisiones/sandbox/saturacion-de-docker.md
// =============================================================================

import {
  SATURACION_POR_DEFECTO,
  VIGIA_INICIAL,
  bytesDeCantidad,
  normalizarSaturacion,
  pasoVigia,
  sanearConfigSaturacion,
  usoDeStats,
  type AjustesSaturacion,
  type EstadoVigia,
  type MuestraMemoria
} from './saturacionDocker.ts'

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
const GiB = 1024 ** 3

function lecturaStats(): void {
  hr('(1) lectura de docker stats')
  check('unidades binarias y decimales', bytesDeCantidad('1.5GiB') === 1.5 * GiB && bytesDeCantidad('512MiB') === 512 * 1024 ** 2 && bytesDeCantidad('2GB') === 2e9 && bytesDeCantidad('0B') === 0, 'ok')
  check('NEGATIVO: lo que no es una cantidad no se inventa', bytesDeCantidad('--') === null && bytesDeCantidad('12XB') === null && bytesDeCantidad('') === null, 'ok')
  const salida = '1.5GiB / 31.27GiB\r\n512MiB / 31.27GiB\n\n'
  check('suma la parte usada de cada línea (con CRLF y líneas vacías)', usoDeStats(salida) === 1.5 * GiB + 512 * 1024 ** 2, String(usoDeStats(salida)))
  check('una línea rota no cuenta, las demás sí', usoDeStats('1GiB / 4GiB\n-- / --') === GiB, String(usoDeStats('1GiB / 4GiB\n-- / --')))
  check('sin contenedores, 0', usoDeStats('') === 0, 'ok')
  check('NEGATIVO: ninguna línea entendible es null (no se actúa con una medida rota)', usoDeStats('-- / --\nbasura') === null, 'ok')
}

const aj = (o: Partial<AjustesSaturacion> = {}): AjustesSaturacion => ({ ...SATURACION_POR_DEFECTO, ...o })
const T = { avisoMs: 30_000, enfriamientoMs: 20_000 }
const m = (pct: number): MuestraMemoria => ({ usoBytes: pct, totalBytes: 100 })

/** Recorre muestras `[t, pct]` y devuelve las acciones. */
function recorrer(muestras: Array<[number, number | null]>, a: AjustesSaturacion): { acciones: string[]; estado: EstadoVigia } {
  let e = VIGIA_INICIAL
  const acciones: string[] = []
  for (const [t, pct] of muestras) {
    const p = pasoVigia(e, pct === null ? null : m(pct), a, t, T)
    e = p.estado
    acciones.push(p.accion)
  }
  return { acciones, estado: e }
}

function vigia(): void {
  hr('(2) el paso del vigía')
  const pico = recorrer([[0, 95], [5_000, 95], [10_000, 50], [15_000, 95], [20_000, 95]], aj())
  check('NEGATIVO: un pico más corto que los segundos no hace nada', pico.acciones.every((x) => x === 'nada'), j(pico.acciones))
  const sostenido = recorrer([[0, 92], [10_000, 93], [20_000, 95], [30_000, 91]], aj())
  check('sostenido 30 s por encima del 90 %: avisa', j(sostenido.acciones) === j(['nada', 'nada', 'nada', 'avisar']) && sostenido.estado.fase === 'avisando' && sostenido.estado.hasta === 60_000, j(sostenido))
  check('justo en el umbral cuenta como encima', recorrer([[0, 90], [30_000, 90]], aj()).acciones[1] === 'avisar', 'ok')
  check('NEGATIVO: un punto por debajo no', recorrer([[0, 89], [30_000, 89]], aj()).acciones.every((x) => x === 'nada'), 'ok')
  const aviso = recorrer([[0, 95], [30_000, 95], [45_000, 95], [60_000, 95]], aj())
  check('el aviso espera su plazo y entonces para, y pasa al respiro', j(aviso.acciones) === j(['nada', 'avisar', 'nada', 'parar']) && aviso.estado.fase === 'enfriando' && aviso.estado.hasta === 80_000, j(aviso))
  const baja = recorrer([[0, 95], [30_000, 95], [40_000, 70]], aj())
  check('si baja durante el aviso, se cancela y no se para', j(baja.acciones) === j(['nada', 'avisar', 'cancelar']) && baja.estado.fase === 'normal', j(baja))
  const directo = recorrer([[0, 95], [30_000, 95]], aj({ avisoPrevio: false }))
  check('sin aviso previo para directamente', j(directo.acciones) === j(['nada', 'parar']) && directo.estado.fase === 'enfriando', j(directo))
  const racha = recorrer([[0, 95], [30_000, 95], [40_000, 95], [50_000, 95]], aj({ avisoPrevio: false }))
  check('NEGATIVO: durante el respiro no se para otro', j(racha.acciones) === j(['nada', 'parar', 'nada', 'parar']), j(racha.acciones))
  const sigue = recorrer([[0, 95], [30_000, 95], [60_000, 95], [80_000, 95]], aj())
  check('tras el respiro, si sigue saturado, avisa ya sin volver a esperar los segundos', j(sigue.acciones) === j(['nada', 'avisar', 'parar', 'avisar']), j(sigue.acciones))
  const recupera = recorrer([[0, 95], [30_000, 95], [60_000, 95], [80_000, 60], [85_000, 95]], aj())
  check('tras el respiro, si bajó, vuelve a la calma y otra subida empieza de cero', j(recupera.acciones) === j(['nada', 'avisar', 'parar', 'nada', 'nada']) && recupera.estado.fase === 'sostenido', j(recupera))
  const sinMedida = recorrer([[0, 95], [30_000, 95], [70_000, null]], aj())
  check('NEGATIVO: sin medida no se para ni se cancela (Docker que no responde no se recuperó)', sinMedida.acciones[2] === 'nada' && sinMedida.estado.fase === 'avisando', j(sinMedida))
  const hueco = recorrer([[0, 95], [10_000, null], [30_000, 95], [45_000, 95]], aj())
  check(
    'NEGATIVO: un hueco sin medida no cuenta como tiempo por encima (la racha vuelve a empezar)',
    hueco.acciones.every((x) => x === 'nada') && hueco.estado.fase === 'sostenido' && hueco.estado.desde === 30_000,
    j(hueco)
  )
  const roto = pasoVigia(VIGIA_INICIAL, { usoBytes: 5, totalBytes: 0 }, aj(), 0, T)
  check('NEGATIVO: una memoria total de 0 no es una medida', roto.accion === 'nada' && roto.porcentaje === null, j(roto))
  check('el porcentaje sale redondeado', pasoVigia(VIGIA_INICIAL, { usoBytes: 2, totalBytes: 3 }, aj(), 0, T).porcentaje === 67, 'ok')
}

function ajustes(): void {
  hr('(3) ajustes y configuración del renderer')
  check('lo que vale se conserva', j(normalizarSaturacion({ saturacionUmbral: 85, saturacionSegundos: 60, avisarAntesDeParar: false })) === j({ saturacionUmbral: 85, saturacionSegundos: 60, avisarAntesDeParar: false }), 'ok')
  const roto = normalizarSaturacion({ saturacionUmbral: 99, saturacionSegundos: 1, avisarAntesDeParar: 'no' })
  check('NEGATIVO: fuera de las opciones, al de serie', j(roto) === j({ saturacionUmbral: 90, saturacionSegundos: 30, avisarAntesDeParar: true }), j(roto))
  const c = sanearConfigSaturacion({
    ajustes: { umbralPct: 95, segundos: 15, avisoPrevio: false },
    politica: { primero: 'inactivos', protegerTrabajando: false },
    enPantalla: [{ profileId: 'p', projectHostPath: 'C:\\a' }, { profileId: 3 }, null, 'x']
  })
  check(
    'la configuración sana pasa y lo que no tiene forma en la lista se descarta',
    c !== null && c.ajustes.umbralPct === 95 && c.politica.primero === 'inactivos' && c.enPantalla.length === 1 && c.enPantalla[0].projectHostPath === 'C:\\a',
    j(c)
  )
  const vacia = sanearConfigSaturacion({})
  check('un objeto vacío da los de serie y nada a la vista', vacia !== null && vacia.ajustes.umbralPct === 90 && vacia.politica.primero === 'ultimos' && vacia.enPantalla.length === 0, j(vacia))
  check('NEGATIVO: lo que no es un objeto no configura nada', sanearConfigSaturacion(null) === null && sanearConfigSaturacion('x') === null, 'ok')
}

lecturaStats()
vigia()
ajustes()
hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
