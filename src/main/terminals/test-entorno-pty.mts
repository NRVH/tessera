#!/usr/bin/env node
// =============================================================================
// Prueba de `entornoPty`: cómo se fusiona `extraEnv` (atajo `tdb`, conexiones de BD) sobre el
// entorno del pty nativo en cada sistema.
// (node src/main/terminals/test-entorno-pty.mts)
// Fija el delimitador y la caja de la clave PATH en Windows y macOS desde cualquiera de las dos,
// `primerPath`, y que la fusión no muta el original ni comparte referencias.
// Una sonda con el shell real de esta plataforma comprueba que un `tdb` de mentira se encuentra por
// el PATH fusionado.
// =============================================================================

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeEnv, colapsarPath, clavePath, primerPath, delimitadorPath } from './entornoPty.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

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

/** process.env sin `undefined` (lo mismo que hace `cleanEnv` en TerminalService). */
function entornoLimpio(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  return env
}

/** La carpeta del atajo en macOS de verdad: lleva un espacio y un `;` la rompería. */
const BIN_MAC = '/Users/ana/Library/Application Support/Tessera/bin/s2'
const BIN_WIN = 'C:\\Users\\ana\\AppData\\Roaming\\tessera\\bin\\s2'

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Windows: `;` y colapso de Path/PATH')
  // -------------------------------------------------------------------------
  {
    const base = { Path: 'C:\\Windows;C:\\Windows\\System32', HOME: 'C:\\Users\\ana' }
    const out = mergeEnv(base, { PATH: BIN_WIN }, 'windows')
    check(
      '(1a) el atajo se ANTEPONE con `;` y conserva la caja de la clave del base (Path)',
      out.Path === `${BIN_WIN};C:\\Windows;C:\\Windows\\System32` && !('PATH' in out),
      JSON.stringify(out)
    )
  }
  {
    const base = { Path: 'C:\\A;C:\\B', PATH: 'c:\\b;C:\\C', HOME: 'x' }
    const out = colapsarPath(base, 'windows')
    check(
      '(1b) Path + PATH se colapsan a UNA clave (la primera), en orden y sin repetir (case-insensitive)',
      out.Path === 'C:\\A;C:\\B;C:\\C' && !('PATH' in out) && out.HOME === 'x',
      JSON.stringify(out)
    )
  }
  {
    const base = { Path: 'C:\\A;C:\\B', PATH: 'c:\\b;C:\\C' }
    const out = mergeEnv(base, { PATH: BIN_WIN }, 'windows')
    const segmentos = out.Path.split(';')
    check(
      '(1c) colapso + atajo: una sola clave, el atajo primero y nada repetido',
      segmentos.join('|') === [BIN_WIN, 'C:\\A', 'C:\\B', 'C:\\C'].join('|') &&
        Object.keys(out).filter((k) => k.toUpperCase() === 'PATH').length === 1,
      JSON.stringify(out)
    )
  }
  {
    const out = mergeEnv({ PATH: 'C:\\A' }, { Path: BIN_WIN }, 'windows')
    check(
      '(1d) en Windows un `Path` del extra también ES el PATH (no se crea una segunda clave)',
      out.PATH === `${BIN_WIN};C:\\A` && !('Path' in out),
      JSON.stringify(out)
    )
  }
  {
    const out = colapsarPath({ Path: ' C:\\A ;; ', PATH: 'C:\\B;' }, 'windows')
    check(
      '(1e) segmentos vacíos y espacios alrededor se descartan al colapsar',
      out.Path === 'C:\\A;C:\\B',
      JSON.stringify(out)
    )
  }
  check(
    '(1f) el delimitador de Windows es `;`',
    delimitadorPath('windows') === ';',
    JSON.stringify(delimitadorPath('windows'))
  )

  // -------------------------------------------------------------------------
  hr('(2) macOS: `:` antepuesto y una `Path` ajena intacta')
  // -------------------------------------------------------------------------
  {
    const base = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/ana' }
    const out = mergeEnv(base, { PATH: BIN_MAC }, 'mac')
    const segmentos = out.PATH.split(':')
    check(
      '(2a) EL BUG: el atajo va primero, separado con `:`, y no hay ningún `;` en el PATH',
      out.PATH === `${BIN_MAC}:/usr/bin:/bin:/usr/sbin:/sbin` &&
        segmentos[0] === BIN_MAC &&
        !out.PATH.includes(';'),
      JSON.stringify(out.PATH)
    )
  }
  {
    const base = { Path: '/ajena', PATH: '/usr/bin:/bin' }
    const out = mergeEnv(base, { PATH: BIN_MAC }, 'mac')
    check(
      '(2b) una `Path` ajena del base ni se toca ni se fusiona: PATH y Path siguen siendo dos',
      out.Path === '/ajena' && out.PATH === `${BIN_MAC}:/usr/bin:/bin`,
      JSON.stringify(out)
    )
  }
  {
    const base = { Path: '/ajena', PATH: '/usr/bin:/bin' }
    const out = colapsarPath(base, 'mac')
    check(
      '(2c) en POSIX no hay colapso: la copia es idéntica',
      JSON.stringify(out) === JSON.stringify(base) && out !== base,
      JSON.stringify(out)
    )
  }
  {
    const out = mergeEnv({ PATH: '/usr/bin' }, { Path: '/x' }, 'mac')
    check(
      '(2d) un `Path` del extra en POSIX es una variable normal: no toca el PATH',
      out.PATH === '/usr/bin' && out.Path === '/x',
      JSON.stringify(out)
    )
  }
  {
    const out = mergeEnv({ PATH: '/usr/bin' }, { PATH: '/x' }, 'otra')
    check(
      '(2e) `otra` (Linux) va por la rama POSIX: `:`',
      out.PATH === '/x:/usr/bin' && delimitadorPath('otra') === ':',
      JSON.stringify(out)
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) primerPath en cada plataforma')
  // -------------------------------------------------------------------------
  check(
    '(3a) Windows: parte por `;` y el `:` de la letra de unidad no lo engaña',
    primerPath({ Path: `${BIN_WIN};C:\\Windows` }, 'windows') === BIN_WIN,
    JSON.stringify(primerPath({ Path: `${BIN_WIN};C:\\Windows` }, 'windows'))
  )
  check(
    '(3b) macOS: parte por `:`',
    primerPath({ PATH: `${BIN_MAC}:/usr/bin` }, 'mac') === BIN_MAC,
    JSON.stringify(primerPath({ PATH: `${BIN_MAC}:/usr/bin` }, 'mac'))
  )
  check(
    '(3c) macOS con el PATH del bug viejo: el log enseñaría el segmento roto, no lo esconde',
    primerPath({ PATH: `${BIN_MAC};/usr/bin:/bin` }, 'mac') === `${BIN_MAC};/usr/bin`,
    JSON.stringify(primerPath({ PATH: `${BIN_MAC};/usr/bin:/bin` }, 'mac'))
  )
  check(
    '(3d) sin PATH -> "(sin PATH)"; PATH vacío -> "(vacio)"',
    primerPath({ HOME: '/u' }, 'mac') === '(sin PATH)' &&
      primerPath({ PATH: '' }, 'mac') === '(vacio)' &&
      primerPath({ HOME: 'x' }, 'windows') === '(sin PATH)' &&
      primerPath({ Path: '' }, 'windows') === '(vacio)',
    `${primerPath({ HOME: '/u' }, 'mac')} / ${primerPath({ PATH: '' }, 'mac')}`
  )
  check(
    '(3e) clavePath: en Windows `Path` cuenta; en POSIX sólo `PATH` exacto',
    clavePath({ Path: 'x' }, 'windows') === 'Path' &&
      clavePath({ Path: 'x' }, 'mac') === undefined &&
      clavePath({ Path: 'x', PATH: 'y' }, 'mac') === 'PATH' &&
      primerPath({ Path: '/solo-ajena' }, 'mac') === '(sin PATH)',
    `${clavePath({ Path: 'x' }, 'windows')} / ${clavePath({ Path: 'x' }, 'mac')}`
  )

  // -------------------------------------------------------------------------
  hr('(4) `extra` sin PATH')
  // -------------------------------------------------------------------------
  for (const plataforma of ['windows', 'mac'] as const) {
    const base = { PATH: 'A', HOME: 'h' }
    const out = mergeEnv(base, { TESSERA_DB_REGISTRO: '/r', TESSERA_DB_PERFIL: 'p' }, plataforma)
    check(
      `(4-${plataforma}) el PATH del base no se toca y las demás variables llegan`,
      out.PATH === 'A' && out.TESSERA_DB_REGISTRO === '/r' && out.TESSERA_DB_PERFIL === 'p',
      JSON.stringify(out)
    )
  }

  // -------------------------------------------------------------------------
  hr('(5) base sin PATH')
  // -------------------------------------------------------------------------
  for (const plataforma of ['windows', 'mac'] as const) {
    const out = mergeEnv({ HOME: 'h' }, { PATH: '/x' }, plataforma)
    check(
      `(5-${plataforma}) el PATH del extra se pone tal cual, sin delimitador colgando`,
      out.PATH === '/x' && out.HOME === 'h',
      JSON.stringify(out)
    )
  }
  {
    const out = mergeEnv({ HOME: 'h' }, { Path: 'C:\\x' }, 'windows')
    check(
      '(5c) Windows, base sin PATH y extra con `Path`: se crea una sola clave PATH',
      out.PATH === 'C:\\x' && !('Path' in out),
      JSON.stringify(out)
    )
  }

  // -------------------------------------------------------------------------
  hr('(6) `extra` vacío o undefined devuelve una COPIA')
  // -------------------------------------------------------------------------
  for (const plataforma of ['windows', 'mac'] as const) {
    const base = { PATH: 'A', HOME: 'h' }
    const vacio = mergeEnv(base, {}, plataforma)
    const indef = mergeEnv(base, undefined, plataforma)
    check(
      `(6-${plataforma}) mismo contenido, distinta referencia (con {} y con undefined)`,
      vacio !== base &&
        indef !== base &&
        JSON.stringify(vacio) === JSON.stringify(base) &&
        JSON.stringify(indef) === JSON.stringify(base),
      JSON.stringify(vacio)
    )
  }
  {
    const base = { Path: 'C:\\A', PATH: 'C:\\B' }
    const out = mergeEnv(base, {}, 'windows')
    check(
      '(6c) Windows: aun sin extra, el colapso de Path/PATH se aplica (una sola clave)',
      out.Path === 'C:\\A;C:\\B' && !('PATH' in out),
      JSON.stringify(out)
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) el base nunca se muta')
  // -------------------------------------------------------------------------
  {
    const base = { Path: 'C:\\A', PATH: 'C:\\B', HOME: 'h' }
    const foto = JSON.stringify(base)
    mergeEnv(base, { PATH: 'X', NUEVA: '1' }, 'windows')
    mergeEnv(base, { PATH: 'X', NUEVA: '1' }, 'mac')
    colapsarPath(base, 'windows')
    const out = mergeEnv(base, {}, 'mac')
    out.HOME = 'mutado'
    check(
      '(7a) tras fusionar en las dos plataformas y mutar el resultado, el base es el mismo',
      JSON.stringify(base) === foto,
      `${foto} == ${JSON.stringify(base)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(8) SONDA: el shell REAL de esta plataforma encuentra `tdb` por el PATH fusionado')
  // -------------------------------------------------------------------------
  // Es lo que ningún test cazaba: que el delimitador que se escribe sea el que el shell
  // lee. Se crea un `tdb` de mentira en una carpeta temporal CON ESPACIO en el nombre
  // (como `Application Support`) y se le pide al shell que lo ejecute usando SOLO el
  // PATH que devuelve `mergeEnv` con la plataforma por defecto (la actual).
  {
    const actual: Plataforma = plataformaActual()
    const esWin = actual === 'windows'
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera bin '))
    try {
      if (esWin) {
        fs.writeFileSync(path.join(dir, 'tdb.cmd'), '@echo TDB_OK\r\n')
      } else {
        fs.writeFileSync(path.join(dir, 'tdb'), '#!/bin/sh\necho TDB_OK\n', { mode: 0o755 })
      }
      const correr = (env: Record<string, string>): { out: string; status: number | null } => {
        const r = esWin
          ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'tdb'], { env, encoding: 'utf8' })
          : spawnSync('/bin/sh', ['-c', 'tdb'], { env, encoding: 'utf8' })
        return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), status: r.status }
      }

      const env = mergeEnv(entornoLimpio(), { PATH: dir })
      const bien = correr(env)
      check(
        `(8a) ${esWin ? 'cmd.exe' : 'sh'} ejecuta el tdb de la carpeta antepuesta (plataforma por defecto = ${actual})`,
        bien.status === 0 && bien.out.includes('TDB_OK'),
        `PATH[0]=${primerPath(env)} status=${bien.status} out=${JSON.stringify(bien.out.slice(0, 120))}`
      )

      // Control: con el delimitador de la OTRA plataforma pegado al mismo PATH, el shell
      // NO lo encuentra. Es la prueba de que (8a) no pasaría con el bug viejo.
      //
      // El PATH del control es uno de SISTEMA, no el heredado: si este test se corre desde
      // una terminal nativa de Tessera —el caso que este mismo arreglo hace posible, con
      // `<userData>/bin` antepuesto al PATH— hay un `tdb` REAL heredado, el shell lo
      // encuentra pese al delimitador equivocado y (8b) daría FAIL sin que nada esté roto.
      const otra: Plataforma = esWin ? 'mac' : 'windows'
      const base = entornoLimpio()
      const clave = clavePath(base) ?? 'PATH'
      const sistema = esWin ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32` : '/usr/bin:/bin'
      const roto = { ...base, [clave]: `${dir}${delimitadorPath(otra)}${sistema}` }
      const mal = correr(roto)
      check(
        `(8b) control: con el delimitador de ${otra} ('${delimitadorPath(otra)}') el shell NO encuentra tdb`,
        mal.status !== 0 && !mal.out.includes('TDB_OK'),
        `status=${mal.status} out=${JSON.stringify(mal.out.slice(0, 120))}`
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
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

main()
