#!/usr/bin/env node
// =============================================================================
// Prueba del saneado de los ajustes de la vista de BASES DE DATOS (npm run test:db-vista-settings).
// `normalizeSettings` descarta en silencio lo que no reconoce: fija que se recuerdan el agente de
// datos por perfil, su ancho, el alto de los resultados y los cuatro de Configuración, que las
// pestañas NO se guardan, y que lo ausente o inválido cae a los valores de siempre.
// Se prueba a través de `normalizeWorkspaceState`, que es lo que corre al leer el archivo.
// =============================================================================

import {
  normalizeWorkspaceState,
  DEFAULT_SETTINGS,
  DEFAULT_DB_AGENTE_WIDTH,
  DEFAULT_DB_RESULTADOS_ALTO,
  DB_RESULTADOS_ALTO_MIN,
  DB_RESULTADOS_ALTO_MAX,
  CC_WIDTH_MIN,
  CC_WIDTH_MAX,
  type WorkspaceSettings
} from './workspace-state-ipc.ts'
import { DB_PAGINA_POR_DEFECTO } from './db-explorador-ipc.ts'

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

/** El slice de ajustes tras pasar por el saneado, con el que se quiera probar. */
function sanear(settings: unknown): WorkspaceSettings {
  const estado = normalizeWorkspaceState({ version: 1, activeProfileId: null, byProfile: {}, settings })
  if (estado === null || estado.settings === undefined) throw new Error('el saneado no devolvió ajustes')
  return estado.settings
}

const j = (v: unknown): string => JSON.stringify(v)

function main(): void {
  hr('(1) Valores por defecto')
  {
    check(
      'DEFAULT_SETTINGS trae los tres campos',
      j(DEFAULT_SETTINGS.dbAgenteVisiblePorPerfil) === '{}' &&
        DEFAULT_SETTINGS.dbAgenteWidth === DEFAULT_DB_AGENTE_WIDTH &&
        DEFAULT_SETTINGS.dbResultadosAlto === DEFAULT_DB_RESULTADOS_ALTO,
      j({
        v: DEFAULT_SETTINGS.dbAgenteVisiblePorPerfil,
        w: DEFAULT_SETTINGS.dbAgenteWidth,
        h: DEFAULT_SETTINGS.dbResultadosAlto
      })
    )
    const s = sanear({})
    check(
      'archivo SIN las claves -> valores por defecto (agente oculto en todos los perfiles)',
      j(s.dbAgenteVisiblePorPerfil) === '{}' &&
        s.dbAgenteWidth === DEFAULT_DB_AGENTE_WIDTH &&
        s.dbResultadosAlto === DEFAULT_DB_RESULTADOS_ALTO,
      j({ v: s.dbAgenteVisiblePorPerfil, w: s.dbAgenteWidth, h: s.dbResultadosAlto })
    )
    const sinSlice = sanear(undefined)
    check(
      'SIN slice de ajustes (versión vieja) -> también por defecto, nunca undefined',
      j(sinSlice.dbAgenteVisiblePorPerfil) === '{}' &&
        sinSlice.dbAgenteWidth === DEFAULT_DB_AGENTE_WIDTH &&
        sinSlice.dbResultadosAlto === DEFAULT_DB_RESULTADOS_ALTO,
      j({ v: sinSlice.dbAgenteVisiblePorPerfil, w: sinSlice.dbAgenteWidth, h: sinSlice.dbResultadosAlto })
    )
    check(
      'el alto por defecto está dentro de sus propios límites',
      DEFAULT_DB_RESULTADOS_ALTO >= DB_RESULTADOS_ALTO_MIN && DEFAULT_DB_RESULTADOS_ALTO <= DB_RESULTADOS_ALTO_MAX,
      `${DB_RESULTADOS_ALTO_MIN} <= ${DEFAULT_DB_RESULTADOS_ALTO} <= ${DB_RESULTADOS_ALTO_MAX}`
    )
    check(
      'el ancho por defecto respeta el suelo de la columna del agente',
      DEFAULT_DB_AGENTE_WIDTH >= CC_WIDTH_MIN,
      `${DEFAULT_DB_AGENTE_WIDTH} >= ${CC_WIDTH_MIN}`
    )
  }

  hr('(2) Ida y vuelta')
  {
    const entrada = {
      dbAgenteVisiblePorPerfil: { alfa: true, beta: false },
      dbAgenteWidth: 512,
      dbResultadosAlto: 333
    }
    const s = sanear(entrada)
    check(
      'conserva el mapa por perfil, incluido un `false` explícito',
      j(s.dbAgenteVisiblePorPerfil) === j({ alfa: true, beta: false }),
      j(s.dbAgenteVisiblePorPerfil)
    )
    check('conserva el ancho del agente', s.dbAgenteWidth === 512, String(s.dbAgenteWidth))
    check('conserva el alto de los resultados', s.dbResultadosAlto === 333, String(s.dbResultadosAlto))
    // Segunda vuelta: lo que sale del saneado es un punto fijo (guardar lo leído no
    // cambia nada). Es lo que hace el main al persistir el slice que manda App.
    const otra = sanear(s)
    check(
      'el saneado es idempotente (guardar lo leído no lo altera)',
      j(otra.dbAgenteVisiblePorPerfil) === j(s.dbAgenteVisiblePorPerfil) &&
        otra.dbAgenteWidth === s.dbAgenteWidth &&
        otra.dbResultadosAlto === s.dbResultadosAlto,
      j({ v: otra.dbAgenteVisiblePorPerfil, w: otra.dbAgenteWidth, h: otra.dbResultadosAlto })
    )
    const conVecinos = sanear({ ...entrada, ccWidth: 420, terminalHeight: 300 })
    check(
      'no contamina ni se deja contaminar por los tamaños vecinos (ccWidth, franja)',
      conVecinos.ccWidth === 420 &&
        conVecinos.terminalHeight === 300 &&
        conVecinos.dbAgenteWidth === 512 &&
        conVecinos.dbResultadosAlto === 333,
      j({
        cc: conVecinos.ccWidth,
        franja: conVecinos.terminalHeight,
        w: conVecinos.dbAgenteWidth,
        h: conVecinos.dbResultadosAlto
      })
    )
  }

  hr('(3) Tamaños acotados')
  {
    const bajo = sanear({ dbAgenteWidth: 10, dbResultadosAlto: 5 })
    check(
      'por debajo del suelo -> el suelo (el agente no se estrecha hasta romper su cabecera)',
      bajo.dbAgenteWidth === CC_WIDTH_MIN && bajo.dbResultadosAlto === DB_RESULTADOS_ALTO_MIN,
      j({ w: bajo.dbAgenteWidth, h: bajo.dbResultadosAlto })
    )
    const alto = sanear({ dbAgenteWidth: 1e9, dbResultadosAlto: 1e9 })
    check(
      'por encima del techo -> el techo',
      alto.dbAgenteWidth === CC_WIDTH_MAX && alto.dbResultadosAlto === DB_RESULTADOS_ALTO_MAX,
      j({ w: alto.dbAgenteWidth, h: alto.dbResultadosAlto })
    )
    const decimales = sanear({ dbAgenteWidth: 450.6, dbResultadosAlto: 200.4 })
    check(
      'se redondean (viajan a CSS como px enteros)',
      decimales.dbAgenteWidth === 451 && decimales.dbResultadosAlto === 200,
      j({ w: decimales.dbAgenteWidth, h: decimales.dbResultadosAlto })
    )
  }

  hr('(4) Basura descartada')
  {
    const noNumeros = sanear({ dbAgenteWidth: '600', dbResultadosAlto: null })
    check(
      'un tamaño que no es número -> el valor por defecto',
      noNumeros.dbAgenteWidth === DEFAULT_DB_AGENTE_WIDTH &&
        noNumeros.dbResultadosAlto === DEFAULT_DB_RESULTADOS_ALTO,
      j({ w: noNumeros.dbAgenteWidth, h: noNumeros.dbResultadosAlto })
    )
    const noFinitos = sanear({ dbAgenteWidth: Number.NaN, dbResultadosAlto: Number.POSITIVE_INFINITY })
    check(
      'NaN e Infinity -> el valor por defecto (no el techo)',
      noFinitos.dbAgenteWidth === DEFAULT_DB_AGENTE_WIDTH &&
        noFinitos.dbResultadosAlto === DEFAULT_DB_RESULTADOS_ALTO,
      j({ w: noFinitos.dbAgenteWidth, h: noFinitos.dbResultadosAlto })
    )
    const mixto = sanear({
      dbAgenteVisiblePorPerfil: { alfa: true, malo: 'si', otro: 1, nulo: null, '': true, beta: false }
    })
    check(
      'el mapa descarta ENTRADA A ENTRADA (valor no booleano o clave vacía), no el mapa entero',
      j(mixto.dbAgenteVisiblePorPerfil) === j({ alfa: true, beta: false }),
      j(mixto.dbAgenteVisiblePorPerfil)
    )
    for (const [nombre, raw] of [
      ['una cadena', 'basura'],
      ['un array', [true, false]],
      ['null', null],
      ['un número', 42]
    ] as const) {
      const s = sanear({ dbAgenteVisiblePorPerfil: raw })
      check(`un mapa que es ${nombre} -> {} (no rompe la carga)`, j(s.dbAgenteVisiblePorPerfil) === '{}', j(s.dbAgenteVisiblePorPerfil))
    }
  }

  hr('(5) Lo que NO se guarda: las pestañas')
  {
    const s = sanear({
      dbAgenteWidth: 500,
      dbVistaPorPerfil: { alfa: { pestanas: [{ kind: 'datos', conexionId: 'c', esquema: 'E', objeto: 'T' }] } },
      dbPestanas: [{ kind: 'consola', conexionId: 'c', consolaId: 'x' }]
    }) as unknown as Record<string, unknown>
    check(
      'un campo de pestañas en el archivo se descarta al sanear',
      !('dbVistaPorPerfil' in s) && !('dbPestanas' in s) && s.dbAgenteWidth === 500,
      j(Object.keys(s).filter((k) => k.startsWith('db')))
    )
    const claves = Object.keys(DEFAULT_SETTINGS).filter((k) => k.startsWith('db') && k !== 'dbMountsByProject')
    // Los tres de la vista más los cuatro de Configuración › «Bases de datos».
    // La lista es LITERAL: un campo nuevo tiene que entrar aquí a sabiendas.
    check(
      'de la vista de BD solo se persisten estos siete ajustes',
      j(claves.sort()) ===
        j([
          'dbAgenteVisiblePorPerfil',
          'dbAgenteWidth',
          'dbConsolaInactividadMin',
          'dbFilasPorPagina',
          'dbFontSize',
          'dbResultadosAlto',
          'dbTxInicial'
        ]),
      j(claves)
    )
  }

  hr('(6) Ajustes de Configuración › «Bases de datos»')
  {
    // Por defecto: lo de siempre, para que Oracle, PG, SQLite y SQL Server no cambien.
    check(
      'DEFAULT_SETTINGS: tamaño 0 (sigue al Explorador), 500 filas, Tx Automática, 30 min',
      DEFAULT_SETTINGS.dbFontSize === 0 &&
        DEFAULT_SETTINGS.dbFilasPorPagina === DB_PAGINA_POR_DEFECTO &&
        DEFAULT_SETTINGS.dbFilasPorPagina === 500 &&
        DEFAULT_SETTINGS.dbTxInicial === 'auto' &&
        DEFAULT_SETTINGS.dbConsolaInactividadMin === 30,
      j({
        f: DEFAULT_SETTINGS.dbFontSize,
        p: DEFAULT_SETTINGS.dbFilasPorPagina,
        t: DEFAULT_SETTINGS.dbTxInicial,
        i: DEFAULT_SETTINGS.dbConsolaInactividadMin
      })
    )
    // AUSENTES (un archivo de una versión anterior): los mismos por defecto, y el tamaño
    // a 0, que es HEREDAR del Explorador —lo que la vista ya hacía—, no copiar su número.
    const viejo = sanear({ explorerFontSize: 14, dbResultadosAlto: 300 })
    check(
      'archivo sin los campos: por defecto, y el tamaño hereda (0) aunque el Explorador tenga uno propio',
      viejo.dbFontSize === 0 &&
        viejo.dbFilasPorPagina === 500 &&
        viejo.dbTxInicial === 'auto' &&
        viejo.dbConsolaInactividadMin === 30 &&
        viejo.explorerFontSize === 14,
      j({ f: viejo.dbFontSize, p: viejo.dbFilasPorPagina, t: viejo.dbTxInicial, i: viejo.dbConsolaInactividadMin })
    )
    // Válidos: se conservan tal cual.
    const bueno = sanear({ dbFontSize: 15, dbFilasPorPagina: 2000, dbTxInicial: 'manual', dbConsolaInactividadMin: 0 })
    check(
      'valores válidos se conservan (incluido 0 = Nunca en la inactividad)',
      bueno.dbFontSize === 15 && bueno.dbFilasPorPagina === 2000 && bueno.dbTxInicial === 'manual' && bueno.dbConsolaInactividadMin === 0,
      j({ f: bueno.dbFontSize, p: bueno.dbFilasPorPagina, t: bueno.dbTxInicial, i: bueno.dbConsolaInactividadMin })
    )
    // Inválidos: cada uno cae a su por defecto sin llevarse a los demás.
    for (const [nombre, crudo] of [
      ['un texto', 'grande'],
      ['null', null],
      ['NaN', Number.NaN],
      ['un número fuera de la lista', 777],
      ['un negativo', -30]
    ] as const) {
      const s = sanear({ dbFilasPorPagina: crudo, dbConsolaInactividadMin: crudo, dbTxInicial: crudo, dbAgenteWidth: 500 })
      check(
        `${nombre} -> filas 500, inactividad 30, Tx Automática, sin tocar a los vecinos`,
        s.dbFilasPorPagina === 500 && s.dbConsolaInactividadMin === 30 && s.dbTxInicial === 'auto' && s.dbAgenteWidth === 500,
        j({ p: s.dbFilasPorPagina, i: s.dbConsolaInactividadMin, t: s.dbTxInicial })
      )
    }
    check(
      "una Tx que no es 'auto' ni 'manual' -> Automática",
      sanear({ dbTxInicial: 'MANUAL' }).dbTxInicial === 'auto' && sanear({ dbTxInicial: true }).dbTxInicial === 'auto',
      'auto'
    )
    // El tamaño se sanea como los otros overrides: se acota, y lo que no es número es 0.
    check(
      'tamaño: se acota a 9–18 y lo que no es un número hereda (0)',
      sanear({ dbFontSize: 40 }).dbFontSize === 18 &&
        sanear({ dbFontSize: 3 }).dbFontSize === 9 &&
        sanear({ dbFontSize: 13.4 }).dbFontSize === 13 &&
        sanear({ dbFontSize: 'grande' }).dbFontSize === 0 &&
        sanear({ dbFontSize: 0 }).dbFontSize === 0,
      j([40, 3, 13.4, 'grande', 0].map((v) => sanear({ dbFontSize: v }).dbFontSize))
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
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
