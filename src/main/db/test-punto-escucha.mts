#!/usr/bin/env node
// =============================================================================
// Prueba de `puntoEscucha.ts`: dónde escucha el puente y que la ruta del socket unix cabe en `sun_path`
// (primera candidata que cabe, la más corta con `cabe: false`, límite exacto en bytes, nombre de 16 hex,
// caída a `/tmp` con aviso, Windows sin cambios). La plataforma es un parámetro: las dos se comprueban
// desde cualquiera. (node src/main/db/test-punto-escucha.mts)
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LIMITE_SUN_PATH,
  NOMBRE_SOCKET,
  elegirCarpetaSocket,
  nombreAleatorio,
  planPuntoEscucha
} from './puntoEscucha.ts'
import { plataformaActual } from '../../shared/plataforma.ts'

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

/** Bytes UTF-8 de una cadena: lo que mide el kernel, no `.length`. */
function bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function main(): void {
  const HEX16 = 'a'.repeat(16)
  const NOMBRE = `tessera-${HEX16}`
  /** Lo que añade el nombre a una candidata: `/` + nombre + `/` + `db.sock`. */
  const COLA = 1 + NOMBRE.length + 1 + NOMBRE_SOCKET.length
  /** Una candidata que no cabe ni sola: 121 bytes. */
  const LARGA = '/' + 'x'.repeat(120)
  /** Otra que tampoco cabe, pero más corta que LARGA: 111 bytes. */
  const LARGA_CORTA = '/' + 'y'.repeat(110)

  // -------------------------------------------------------------------------
  hr('(1) elegirCarpetaSocket: la PRIMERA que cabe')
  // -------------------------------------------------------------------------
  {
    const e = elegirCarpetaSocket(['/tmp'], NOMBRE)
    check(
      '(1a) /tmp cabe: carpeta y ruta con la forma esperada',
      e.cabe && e.candidata === '/tmp' && e.carpeta === `/tmp/${NOMBRE}` && e.ruta === `/tmp/${NOMBRE}/db.sock`,
      `${e.ruta} (${e.bytes} bytes, cabe=${e.cabe})`
    )
    check('(1b) y mide lo que dice', e.bytes === bytes(e.ruta) && e.bytes === 5 + COLA - 1, `${e.bytes}`)
  }
  {
    const e = elegirCarpetaSocket([LARGA, '/tmp'], NOMBRE)
    check(
      '(1c) una candidata larguísima delante cae a /tmp',
      e.cabe && e.candidata === '/tmp' && e.ruta === `/tmp/${NOMBRE}/db.sock`,
      `${e.ruta} (${e.bytes} bytes)`
    )
  }
  {
    // Las dos caben: se queda con la PRIMERA aunque la segunda sea más corta. El
    // orden es la preferencia (temporal del usuario antes que /tmp).
    const e = elegirCarpetaSocket(['/var/folders/xx/T', '/tmp'], NOMBRE)
    check('(1d) si las dos caben gana la primera, no la más corta', e.candidata === '/var/folders/xx/T', e.ruta)
  }

  // -------------------------------------------------------------------------
  hr('(2) ninguna cabe: la más corta, con cabe:false')
  // -------------------------------------------------------------------------
  {
    const e = elegirCarpetaSocket([LARGA, LARGA_CORTA], NOMBRE)
    check(
      '(2a) ambas largas -> cabe:false y la MÁS CORTA (aunque vaya segunda)',
      !e.cabe && e.candidata === LARGA_CORTA,
      `${e.bytes} bytes > ${LIMITE_SUN_PATH}`
    )
  }
  {
    const e = elegirCarpetaSocket([LARGA_CORTA, LARGA], NOMBRE)
    check('(2b) …y también cuando la más corta va primera', !e.cabe && e.candidata === LARGA_CORTA, `${e.bytes} bytes`)
  }
  {
    let lanzo = false
    try {
      elegirCarpetaSocket([], NOMBRE)
    } catch {
      lanzo = true
    }
    check('(2c) una lista vacía lanza en vez de inventar una ruta', lanzo, `lanzó=${lanzo}`)
  }

  // -------------------------------------------------------------------------
  hr('(3) el límite es EXACTO y en BYTES')
  // -------------------------------------------------------------------------
  {
    // Candidata de (100 - COLA) caracteres ASCII: la ruta mide justo 100.
    const justa = '/' + 'j'.repeat(LIMITE_SUN_PATH - COLA - 1)
    const e = elegirCarpetaSocket([justa], NOMBRE)
    check('(3a) una ruta de exactamente 100 bytes cabe', e.cabe && e.bytes === LIMITE_SUN_PATH, `${e.bytes} bytes`)
    const pasada = justa + 'j'
    const e2 = elegirCarpetaSocket([pasada], NOMBRE)
    check('(3b) una de 101 ya no', !e2.cabe && e2.bytes === LIMITE_SUN_PATH + 1, `${e2.bytes} bytes`)
  }
  {
    // Misma LONGITUD en caracteres que `justa`, pero con una `ñ` (2 bytes en UTF-8):
    // por `.length` cabría; por bytes, no. El kernel cuenta bytes.
    const conEnie = '/' + 'j'.repeat(LIMITE_SUN_PATH - COLA - 2) + 'ñ'
    const e = elegirCarpetaSocket([conEnie], NOMBRE)
    const ruta = `${conEnie}/${NOMBRE}/db.sock`
    check(
      '(3c) se cuentan BYTES, no caracteres: una ñ empuja fuera del límite',
      !e.cabe && ruta.length === LIMITE_SUN_PATH && e.bytes === LIMITE_SUN_PATH + 1,
      `length=${ruta.length} bytes=${e.bytes}`
    )
  }
  {
    const e = elegirCarpetaSocket(['/' + 'x'.repeat(20), '/tmp'], NOMBRE, 50)
    check('(3d) el límite es parámetro: con 50, 54 bytes no caben y /tmp sí', e.cabe && e.candidata === '/tmp', e.ruta)
  }
  {
    // (3a)/(3b) construyen la candidata A PARTIR de la propia constante, así que son
    // relativos: subir LIMITE_SUN_PATH a 120 los deja en verde y 120 está POR ENCIMA
    // del tope real. El tope REAL del kernel, medido con net.createServer().listen():
    // 104 escucha, 105 da EINVAL en macOS. La constante propia tiene que quedar por
    // DEBAJO, o el test dejaría pasar un límite que el kernel no acepta.
    const SUN_PATH_MACOS = 104
    check(
      '(3e) el límite propio queda por debajo del tope medido del kernel (104 en macOS)',
      LIMITE_SUN_PATH <= SUN_PATH_MACOS - 4,
      `LIMITE_SUN_PATH=${LIMITE_SUN_PATH} <= ${SUN_PATH_MACOS - 4}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) el nombre aleatorio: 16 hex')
  // -------------------------------------------------------------------------
  {
    const n = nombreAleatorio()
    check('(4a) 16 caracteres hexadecimales (64 bits)', /^[0-9a-f]{16}$/.test(n), n)
    const m = nombreAleatorio()
    check('(4b) dos llamadas dan nombres distintos', n !== m, `${n} / ${m}`)
  }

  // -------------------------------------------------------------------------
  hr('(5) planPuntoEscucha en macOS / POSIX')
  // -------------------------------------------------------------------------
  {
    const p = planPuntoEscucha(HEX16, ['/tmp'], 'mac')
    check(
      '(5a) mac: <candidata>/tessera-<16 hex>/db.sock, carpeta para barrer, sin aviso',
      p.nombre === `/tmp/${NOMBRE}/db.sock` && p.carpeta === `/tmp/${NOMBRE}` && p.cabe && p.aviso === null,
      `${p.nombre} carpeta=${p.carpeta} aviso=${String(p.aviso)}`
    )
  }
  {
    const p = planPuntoEscucha(HEX16, [LARGA, '/tmp'], 'mac')
    check('(5b) mac: el temporal no cabe -> el socket va a /tmp', p.cabe && p.nombre === `/tmp/${NOMBRE}/db.sock`, p.nombre)
    check(
      '(5c) …y lo DICE: el aviso nombra sun_path y la carpeta elegida',
      p.aviso !== null && p.aviso.includes('sun_path') && p.aviso.includes(`/tmp/${NOMBRE}`),
      String(p.aviso)
    )
  }
  {
    const p = planPuntoEscucha(HEX16, [LARGA, LARGA_CORTA], 'mac')
    check('(5d) mac: nada cabe -> cabe:false con la más corta', !p.cabe && p.nombre.startsWith(LARGA_CORTA), p.nombre)
    check(
      '(5e) …y el aviso explica el desenlace (EINVAL, contraseñas en variables)',
      p.aviso !== null && p.aviso.includes('NINGUNA') && p.aviso.includes('EINVAL') && p.aviso.includes('contraseñas'),
      String(p.aviso)
    )
  }
  {
    const mac = planPuntoEscucha(HEX16, [LARGA, '/tmp'], 'mac')
    const otra = planPuntoEscucha(HEX16, [LARGA, '/tmp'], 'otra')
    check(
      "(5f) 'otra' (Linux/BSD) va por la rama POSIX, igual que mac",
      JSON.stringify(otra) === JSON.stringify(mac),
      otra.nombre
    )
  }

  // -------------------------------------------------------------------------
  hr('(6) planPuntoEscucha en Windows: nada cambia')
  // -------------------------------------------------------------------------
  {
    const p = planPuntoEscucha(HEX16, ['/tmp'], 'windows')
    check(
      '(6a) windows: \\\\.\\pipe\\tessera-db-<16 hex>, sin carpeta, cabe, sin aviso',
      p.nombre === `\\\\.\\pipe\\tessera-db-${HEX16}` && p.carpeta === '' && p.cabe && p.aviso === null,
      `${p.nombre} carpeta="${p.carpeta}"`
    )
  }
  {
    const p = planPuntoEscucha(HEX16, [LARGA, LARGA_CORTA], 'windows')
    check(
      '(6b) windows ignora las candidatas: aunque ninguna quepa, un pipe no tiene sun_path',
      p.cabe && p.aviso === null && p.carpeta === '' && p.nombre === `\\\\.\\pipe\\tessera-db-${HEX16}`,
      p.nombre
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) la plataforma por defecto es la actual')
  // -------------------------------------------------------------------------
  {
    const sinParametro = planPuntoEscucha(HEX16, [LARGA, '/tmp'])
    const explicita = planPuntoEscucha(HEX16, [LARGA, '/tmp'], plataformaActual())
    check(
      `(7a) sin pasar plataforma se obtiene lo mismo que con '${plataformaActual()}'`,
      JSON.stringify(sinParametro) === JSON.stringify(explicita),
      sinParametro.nombre
    )
  }

  // -------------------------------------------------------------------------
  hr('(8) EVIDENCIA de esta máquina: cuánto mide la ruta de verdad')
  // -------------------------------------------------------------------------
  {
    const temporal = tmpdir()
    let real = temporal
    try {
      real = realpathSync(temporal)
    } catch {
      /* si el temporal no resuelve, la evidencia se da sobre la forma sin resolver */
    }
    const con16 = join(temporal, NOMBRE, NOMBRE_SOCKET)
    const con16Real = join(real, NOMBRE, NOMBRE_SOCKET)
    const con32 = join(temporal, `tessera-${'a'.repeat(32)}`, NOMBRE_SOCKET)
    const con32Real = join(real, `tessera-${'a'.repeat(32)}`, NOMBRE_SOCKET)
    console.log(`      tmpdir()          = ${temporal} (${bytes(temporal)} bytes)`)
    console.log(`      realpath          = ${real} (${bytes(real)} bytes)`)
    console.log(`      con 16 hex        = ${bytes(con16)} bytes  (realpath: ${bytes(con16Real)})`)
    console.log(`      con 32 hex (antes)= ${bytes(con32)} bytes  (realpath: ${bytes(con32Real)})`)
    const e = elegirCarpetaSocket([temporal, '/tmp'], NOMBRE)
    check(
      '(8a) con las candidatas de producción, en esta máquina el socket cabe',
      e.cabe,
      `${e.ruta} (${e.bytes} bytes; límite ${LIMITE_SUN_PATH}; margen ${LIMITE_SUN_PATH - e.bytes})`
    )
    check(
      '(8b) pasar de 32 a 16 hex recupera 16 bytes de margen, aquí y en cualquier máquina',
      bytes(con32) - bytes(con16) === 16,
      `${bytes(con32)} -> ${bytes(con16)}`
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
