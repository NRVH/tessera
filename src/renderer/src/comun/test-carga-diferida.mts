#!/usr/bin/env node
// =============================================================================
// Prueba de cuándo se ve el aviso de carga (`cargaDiferida.ts`):
// (node src/renderer/src/comun/test-carga-diferida.mts)
// Fija las fronteras de 250 ms y 5 s, el mínimo visible de 300 ms, el instante del próximo
// cambio (un solo temporizador) y que una carga que vuelve con el aviso a la vista lo continúa.
// =============================================================================

import {
  anotarCarga,
  cargaOcupa,
  evaluarCarga,
  marcasAlMontar,
  MINIMO_VISIBLE_MS,
  RETRASO_INDICADOR_MS,
  UMBRAL_TARDANDO_MS,
  type EvaluacionCarga,
  type MarcasCarga
} from './cargaDiferida.ts'

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

const INICIO = 10_000
const en = (ms: number, fin: number | null = null): EvaluacionCarga =>
  evaluarCarga({ inicio: INICIO, fin: fin === null ? null : INICIO + fin }, INICIO + ms)
const es = (ev: EvaluacionCarga, fase: string, proximo: number | null): boolean =>
  ev.fase === fase && ev.proximoCambio === (proximo === null ? null : INICIO + proximo)
const ver = (ev: EvaluacionCarga): string =>
  `${ev.fase} @${ev.proximoCambio === null ? 'null' : ev.proximoCambio - INICIO}`

hr('Constantes')
check('retraso 250 ms, tardando 5 s, mínimo 300 ms', RETRASO_INDICADOR_MS === 250 && UMBRAL_TARDANDO_MS === 5000 && MINIMO_VISIBLE_MS === 300, `${RETRASO_INDICADOR_MS}/${UMBRAL_TARDANDO_MS}/${MINIMO_VISIBLE_MS}`)

hr('Carga en curso')
check('al empezar, nada; cambia a los 250', es(en(0), 'nada', 250), ver(en(0)))
check('a los 249, nada todavía', es(en(249), 'nada', 250), ver(en(249)))
check('a los 250, el aviso; cambia a los 5 s', es(en(250), 'cargando', 5000), ver(en(250)))
check('a los 4999, sigue el aviso', es(en(4999), 'cargando', 5000), ver(en(4999)))
check('a los 5 s, tardando y ya no cambia solo', es(en(5000), 'tardando', null), ver(en(5000)))
check('a los 30 s, sigue tardando', es(en(30_000), 'tardando', null), ver(en(30_000)))

hr('Carga acabada')
check('acaba a los 100: nada, sin temporizador', es(en(100, 100), 'nada', null), ver(en(100, 100)))
check('acaba justo a los 250: no llegó a verse', es(en(250, 250), 'nada', null), ver(en(250, 250)))
check('acaba a los 260: se ve hasta los 550', es(en(260, 260), 'cargando', 550), ver(en(260, 260)))
check('… a los 549 aún se ve', es(en(549, 260), 'cargando', 550), ver(en(549, 260)))
check('… a los 550 ya no', es(en(550, 260), 'nada', null), ver(en(550, 260)))
check('acaba a los 600 (visible 350 ms): se quita en el acto', es(en(600, 600), 'nada', null), ver(en(600, 600)))
check('acaba a los 549: aguanta 1 ms hasta los 550', es(en(549, 549), 'cargando', 550), ver(en(549, 549)))
check('acaba tardando a los 6 s: se quita en el acto', es(en(6000, 6000), 'nada', null), ver(en(6000, 6000)))
check('un fin futuro cuenta como carga en curso', es(en(300, 1000), 'cargando', 5000), ver(en(300, 1000)))

hr('Anotar las transiciones')
{
  const a = anotarCarga(null, true, 100)
  check('empieza a cargar: inicio ahora, sin fin', JSON.stringify(a) === '{"inicio":100,"fin":null}', JSON.stringify(a))
  check('seguir cargando no mueve el inicio', anotarCarga(a, true, 400) === a, JSON.stringify(anotarCarga(a, true, 400)))
  const b = anotarCarga(a, false, 360)
  check('deja de cargar: anota el fin', JSON.stringify(b) === '{"inicio":100,"fin":360}', JSON.stringify(b))
  check('sin carga ni marcas, nada que anotar', anotarCarga(null, false, 5) === null, 'null')
  const c = anotarCarga(b, true, 500)
  check('vuelve a cargar con el aviso aún visible: continúa la espera', JSON.stringify(c) === '{"inicio":100,"fin":null}', JSON.stringify(c))
  const d = anotarCarga(b, true, 900)
  check('vuelve a cargar con el aviso ya quitado: espera nueva', JSON.stringify(d) === '{"inicio":900,"fin":null}', JSON.stringify(d))
  const rapida: MarcasCarga = { inicio: 0, fin: 100 }
  const e = anotarCarga(rapida, true, 120)
  check('tras una carga que no se vio, espera nueva', JSON.stringify(e) === '{"inicio":120,"fin":null}', JSON.stringify(e))
}

hr('Marcas al montar')
check('sin carga, sin marcas', marcasAlMontar(false, 100) === null, 'null')
check('cargando: desde ahora', JSON.stringify(marcasAlMontar(true, 100)) === '{"inicio":100,"fin":null}', 'ahora')

hr('Una carga que acaba justo antes del retraso no saca el aviso después')
{
  const m = anotarCarga({ inicio: 0, fin: null }, false, 245)
  check('acabada a los 245, a los 250 sigue sin verse', evaluarCarga(m!, 250).fase === 'nada', evaluarCarga(m!, 250).fase)
  check('acabada a los 245, sin temporizador pendiente', evaluarCarga(m!, 245).proximoCambio === null, 'null')
}

hr('Quién ocupa el sitio')
check('cargando, aunque la fase sea nada: el aviso (vacío)', cargaOcupa(true, 'nada'), 'true')
check('acabada pero en su mínimo: el aviso', cargaOcupa(false, 'cargando'), 'true')
check('acabada y sin aviso: el contenido', !cargaOcupa(false, 'nada'), 'false')

const total = results.length
const passed = results.filter((x) => x.pass).length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
