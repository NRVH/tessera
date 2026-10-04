#!/usr/bin/env node
// =============================================================================
// Prueba de los ajustes del explorador de BD (npm run test:ajustes-bd): la lista de filas por página,
// el saneado de cada ajuste (lo raro vuelve al valor por defecto), «Nunca» como umbral infinito, lo que
// recibe el main, la regla de la transacción al nacer, la máquina de estados y la ayuda de la fila.
// Puro: sin electron ni drivers.
// =============================================================================

import {
  AJUSTES_SESIONES_POR_DEFECTO,
  AYUDA_TX_INICIAL,
  DB_FILAS_POR_PAGINA_OPCIONES,
  DB_FILAS_POR_PAGINA_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_OPCIONES,
  DB_INACTIVIDAD_NUNCA,
  DB_TX_INICIAL_POR_DEFECTO,
  ajustesSesionesDe,
  inactividadConsolaMs,
  normalizarFilasPorPagina,
  normalizarInactividadConsolaMin,
  normalizarTxInicial,
  sanearAjustesSesiones,
  txInicialDePeticion
} from './ajustesBd.ts'
import { DB_PAGINA_MAX, DB_PAGINA_POR_DEFECTO } from './db-explorador-ipc.ts'
import { modoTxInicial } from './sql/produccionSql.ts'
import { INACTIVIDAD_CONSOLA_MS, umbralInactividadMs } from '../main/db/explorador/limites.ts'
import { estadoInicial, transicion } from '../main/db/explorador/maquinaSesion.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
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
const j = (v: unknown): string => JSON.stringify(v)

/** Valores crudos que no son válidos para NINGÚN ajuste de los tres con lista. */
const INVALIDOS: ReadonlyArray<readonly [string, unknown]> = [
  ['ausente', undefined],
  ['null', null],
  ['un texto', '500'],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['un negativo', -1],
  ['un decimal', 499.5],
  ['un objeto', { valor: 500 }],
  ['un booleano', true]
]

function main(): void {
  hr('(1) La lista de filas por página')
  {
    const l = DB_FILAS_POR_PAGINA_OPCIONES
    check(
      'por defecto el de siempre: 500 = DB_PAGINA_POR_DEFECTO, y está en la lista',
      DB_FILAS_POR_PAGINA_POR_DEFECTO === 500 && DB_FILAS_POR_PAGINA_POR_DEFECTO === DB_PAGINA_POR_DEFECTO && l.includes(500),
      j(l)
    )
    check(
      'ordenada de menor a mayor y sin repetidos',
      l.every((n, i) => i === 0 || n > l[i - 1]),
      j(l)
    )
    check(
      'ninguna opción pasa de DB_PAGINA_MAX (el main no puede rechazar ninguna) y la última es él',
      l.every((n) => Number.isInteger(n) && n >= 1 && n <= DB_PAGINA_MAX) && l[l.length - 1] === DB_PAGINA_MAX,
      `max=${DB_PAGINA_MAX}`
    )
    check('la lista pedida: 100, 200, 500, 1000, 2000, 5000', j(l) === j([100, 200, 500, 1000, 2000, 5000]), j(l))
  }

  hr('(2) Saneado de cada ajuste')
  {
    for (const n of DB_FILAS_POR_PAGINA_OPCIONES) {
      check(`filas: ${n} se conserva`, normalizarFilasPorPagina(n) === n, String(normalizarFilasPorPagina(n)))
    }
    for (const [nombre, v] of [...INVALIDOS, ['un número fuera de la lista', 300], ['por encima del máximo', 10000]] as const) {
      check(`filas: ${nombre} -> 500`, normalizarFilasPorPagina(v) === 500, String(normalizarFilasPorPagina(v)))
    }
    check("Tx: 'manual' y 'auto' se conservan", normalizarTxInicial('manual') === 'manual' && normalizarTxInicial('auto') === 'auto', 'ok')
    for (const [nombre, v] of [...INVALIDOS, ['en mayúsculas', 'MANUAL'], ['otra palabra', 'implícita']] as const) {
      check(`Tx: ${nombre} -> Automática`, normalizarTxInicial(v) === 'auto', normalizarTxInicial(v))
    }
    check('Tx: por defecto Automática', DB_TX_INICIAL_POR_DEFECTO === 'auto', DB_TX_INICIAL_POR_DEFECTO)
    for (const o of DB_INACTIVIDAD_CONSOLA_OPCIONES) {
      check(`inactividad: ${o.min} (${o.etiqueta}) se conserva`, normalizarInactividadConsolaMin(o.min) === o.min, String(normalizarInactividadConsolaMin(o.min)))
    }
    for (const [nombre, v] of [...INVALIDOS, ['un número fuera de la lista', 45]] as const) {
      check(`inactividad: ${nombre} -> 30`, normalizarInactividadConsolaMin(v) === 30, String(normalizarInactividadConsolaMin(v)))
    }
  }

  hr('(3) «Nunca» y el plazo por defecto')
  {
    const etiquetas = DB_INACTIVIDAD_CONSOLA_OPCIONES.map((o) => o.etiqueta)
    check(
      'las opciones: 15 min, 30 min, 1 h, 2 h, 4 h y Nunca, en ese orden',
      j(DB_INACTIVIDAD_CONSOLA_OPCIONES.map((o) => o.min)) === j([15, 30, 60, 120, 240, 0]) && etiquetas[etiquetas.length - 1] === 'Nunca',
      j(etiquetas)
    )
    check('«Nunca» se guarda como 0', DB_INACTIVIDAD_NUNCA === 0, String(DB_INACTIVIDAD_NUNCA))
    check('«Nunca» es un umbral INFINITO', inactividadConsolaMs(0) === Number.POSITIVE_INFINITY, String(inactividadConsolaMs(0)))
    check('15 min = 900 000 ms; 4 h = 14 400 000 ms', inactividadConsolaMs(15) === 900_000 && inactividadConsolaMs(240) === 14_400_000, `${inactividadConsolaMs(15)} / ${inactividadConsolaMs(240)}`)
    check(
      'el por defecto (30 min) es el INACTIVIDAD_CONSOLA_MS de siempre del main',
      DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO === 30 && inactividadConsolaMs(30) === INACTIVIDAD_CONSOLA_MS && INACTIVIDAD_CONSOLA_MS === 30 * 60_000,
      String(INACTIVIDAD_CONSOLA_MS)
    )
    check(
      'un valor raro no da un umbral NaN (que no cerraría nunca): da 30 min',
      inactividadConsolaMs(Number.NaN) === 30 * 60_000 && inactividadConsolaMs(-5) === 30 * 60_000,
      String(inactividadConsolaMs(Number.NaN))
    )
    check(
      'umbralInactividadMs: la consola usa el del ajuste; meta y datos no cambian',
      umbralInactividadMs('consola', Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY &&
        umbralInactividadMs('consola') === INACTIVIDAD_CONSOLA_MS &&
        umbralInactividadMs('meta', 1) === 10 * 60_000 &&
        umbralInactividadMs('datos', 1) === 10 * 60_000,
      'ok'
    )
  }

  hr('(4) Lo que recibe el main')
  {
    check(
      'por defecto: Automática y 30 min',
      AJUSTES_SESIONES_POR_DEFECTO.txInicial === 'auto' && AJUSTES_SESIONES_POR_DEFECTO.inactividadConsolaMs === INACTIVIDAD_CONSOLA_MS,
      j(AJUSTES_SESIONES_POR_DEFECTO)
    )
    check('sin ajustes (null, undefined, {}) -> los de siempre', [null, undefined, {}].every((s) => j(ajustesSesionesDe(s)) === j(AJUSTES_SESIONES_POR_DEFECTO)), 'ok')
    const a = ajustesSesionesDe({ dbTxInicial: 'manual', dbConsolaInactividadMin: 0 })
    check('Manual y Nunca llegan como Manual e Infinity', a.txInicial === 'manual' && a.inactividadConsolaMs === Number.POSITIVE_INFINITY, j({ t: a.txInicial, ms: String(a.inactividadConsolaMs) }))
    const crudo = ajustesSesionesDe({ dbTxInicial: 'DROP', dbConsolaInactividadMin: '15' })
    check('crudo e inválido (llega tal cual del renderer) -> saneado', crudo.txInicial === 'auto' && crudo.inactividadConsolaMs === INACTIVIDAD_CONSOLA_MS, j(crudo))
  }

  hr('(5) Tx al nacer: la preferencia no puede con producción ni con solo lectura')
  {
    const entornos = ['desarrollo', 'pruebas', 'produccion', null, undefined] as const
    // Sin preferencia: EXACTAMENTE la regla de antes (Manual solo en producción de escritura).
    const antes = (e: (typeof entornos)[number], ro: boolean): string => (e === 'produccion' && !ro ? 'manual' : 'auto')
    let igual = true
    for (const e of entornos) for (const ro of [false, true]) if (modoTxInicial(e, ro) !== antes(e, ro)) igual = false
    check('sin preferencia: la regla de siempre en todos los entornos', igual, 'producción de escritura -> Manual; lo demás Auto')
    check("con preferencia 'auto': la regla de siempre", entornos.every((e) => [false, true].every((ro) => modoTxInicial(e, ro, 'auto') === antes(e, ro))), 'ok')
    check("preferencia 'manual' en desarrollo, pruebas y sin entorno -> Manual", ['desarrollo', 'pruebas', null, undefined].every((e) => modoTxInicial(e as never, false, 'manual') === 'manual'), 'manual')
    check("NEGATIVO: preferencia 'manual' en SOLO LECTURA -> Auto (invariante de la máquina)", entornos.every((e) => modoTxInicial(e, true, 'manual') === 'auto'), 'auto')
    check("NEGATIVO: preferencia 'auto' en PRODUCCIÓN de escritura -> Manual (no se puede quitar)", modoTxInicial('produccion', false, 'auto') === 'manual', 'manual')
  }

  hr('(6) La máquina de estados con el umbral que sale de aquí')
  {
    const t0 = 1_000_000
    const base = estadoInicial({ soloLectura: false, ahora: t0 })
    const abierta = { ...base, fase: 'lista' as const }
    const cierra = (umbralMs: number, tras: number): boolean =>
      transicion(abierta, { tipo: 'inactividad', ahora: t0 + tras, umbralMs }).estado.fase === 'cerrada'
    check('«Nunca»: ni a las 24 h se cierra', !cierra(inactividadConsolaMs(0), 24 * 3600_000), 'lista')
    check('15 min: a los 16 se cierra y a los 14 no', cierra(inactividadConsolaMs(15), 16 * 60_000) && !cierra(inactividadConsolaMs(15), 14 * 60_000), 'ok')
  }

  hr('(7) UNA sola fuente para el saneado')
  {
    // La de la PETICIÓN: ausente o inválida = «la del main» (undefined), no Automática.
    check(
      "txInicialDePeticion: 'auto'/'manual' tal cual; lo demás, undefined",
      txInicialDePeticion('auto') === 'auto' &&
        txInicialDePeticion('manual') === 'manual' &&
        INVALIDOS.every(([, v]) => txInicialDePeticion(v) === undefined) &&
        txInicialDePeticion('MANUAL') === undefined,
      'ok'
    )
    check(
      'normalizarTxInicial ES txInicialDePeticion con la de siempre por defecto (no dos reglas)',
      [...INVALIDOS.map(([, v]) => v), 'auto', 'manual', 'MANUAL'].every((v) => normalizarTxInicial(v) === (txInicialDePeticion(v) ?? DB_TX_INICIAL_POR_DEFECTO)),
      'ok'
    )
    // Lo que re-sanea el gestor (`fijarAjustes`): antes, copiado a mano en GestorSesiones.
    check('sanearAjustesSesiones: sin nada -> los de siempre', [null, undefined, {}].every((a) => j(sanearAjustesSesiones(a)) === j(AJUSTES_SESIONES_POR_DEFECTO)), 'ok')
    const nunca = sanearAjustesSesiones({ txInicial: 'manual', inactividadConsolaMs: Number.POSITIVE_INFINITY })
    check('Manual y «Nunca» (Infinity) pasan tal cual', nunca.txInicial === 'manual' && nunca.inactividadConsolaMs === Number.POSITIVE_INFINITY, j({ t: nunca.txInicial, ms: String(nunca.inactividadConsolaMs) }))
    const rotos = [Number.NaN, 0, -1, '15' as unknown as number]
    check(
      'un umbral NaN, 0, negativo o que no es número -> 30 min (ni «Nunca» sin pedirlo ni cerrar en cada barrido)',
      rotos.every((ms) => sanearAjustesSesiones({ txInicial: 'auto', inactividadConsolaMs: ms }).inactividadConsolaMs === INACTIVIDAD_CONSOLA_MS),
      'ok'
    )
    check(
      "un modo que no existe -> Automática",
      sanearAjustesSesiones({ txInicial: 'DROP' as never, inactividadConsolaMs: 60_000 }).txInicial === 'auto',
      'auto'
    )
    check(
      'idempotente sobre lo que manda el main (ajustesSesionesDe): el gestor no cambia nada bueno',
      [{ dbTxInicial: 'manual', dbConsolaInactividadMin: 0 }, { dbTxInicial: 'auto', dbConsolaInactividadMin: 15 }, {}].every(
        (s) => j(sanearAjustesSesiones(ajustesSesionesDe(s))) === j(ajustesSesionesDe(s)) &&
          sanearAjustesSesiones(ajustesSesionesDe(s)).inactividadConsolaMs === ajustesSesionesDe(s).inactividadConsolaMs
      ),
      'ok'
    )
  }

  hr('(8) La ayuda de «Transacción al abrir» dice la verdad')
  {
    check(
      'dice que vale para las pestañas ABIERTAS sin sesión (su barra se recalcula) y que las que tienen sesión conservan su modo',
      /abiertas que aún no han ejecutado nada/.test(AYUDA_TX_INICIAL) && /ya tienen sesión conservan su modo/.test(AYUDA_TX_INICIAL),
      AYUDA_TX_INICIAL
    )
    check(
      'NEGATIVO: ya no dice que «las que ya están abiertas conservan el suyo» (falso para una abierta sin sesión)',
      !/ya están abiertas conservan/.test(AYUDA_TX_INICIAL),
      'ok'
    )
    check('y sigue diciendo lo que NO cambia: producción en Manual', /producción[^.]*Manual/.test(AYUDA_TX_INICIAL), 'ok')
    // la casilla «Solo lectura» es de los agentes; una consola con ella marcada
    // nace con la preferencia, así que la ayuda ya no promete «solo lectura en Automática».
    check('NEGATIVO: no nombra la casilla «Solo lectura» (es de los agentes y no cambia el modo)', !/solo lectura/i.test(AYUDA_TX_INICIAL), AYUDA_TX_INICIAL)
  }

  // ---------------------------------------------------------------------------
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
