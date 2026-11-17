#!/usr/bin/env node
// =============================================================================
// Prueba de la detección de codificación en los tres lados del diff (npm run test:blob-encoding):
// `leerBlobEnCommit` (commit), `leerBlobIndice` (índice) y `leerBlobWorktree` (disco) con el MISMO archivo deben
// coincidir. Casos: latin-1 legible, UTF-8 con BOM, bytes NUL (`esBinario`), más de 2 MiB
// (`truncado`, con el corte temprano de `cat-file`), ASCII byte-exacto e inexistente. Fixture temporal.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { ResultadoBlob } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`.
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))
const { ServicioGit } = await import('./ServicioGit.ts')

// =============================================================================
// Reporte PASS/FAIL (mismo patrón que el resto de tests de git)
// =============================================================================
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
/**
 * El BOM, ESCRITO y no pegado. Iba como carácter literal dentro de los
 * `startsWith`, invisible en el fuente: quien tocara esa línea lo rompía sin
 * enterarse, y ni grep ni una revisión lo veían. Lo encontró
 * `npm run test:fuentes-limpias`, que vigila exactamente esto.
 */
const BOM = String.fromCharCode(0xfeff)

const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Resumen legible de un ResultadoBlob (los contenidos largos se recortan). */
function brief(b: ResultadoBlob): string {
  const head = b.contenido.length > 48 ? b.contenido.slice(0, 48) + '…' : b.contenido
  return JSON.stringify({
    existe: b.existe,
    encoding: b.encoding,
    esBinario: b.esBinario,
    truncado: b.truncado,
    len: b.contenido.length,
    head
  })
}

// -----------------------------------------------------------------------------
// Texto latin-1 con la muestra de acentos. Se repite para dar material a jschardet
// (con dos palabras sueltas su confianza no llega al umbral y cae al fallback; el
// fallback TAMBIÉN es correcto, pero así se ejercita el camino de verdad).
// -----------------------------------------------------------------------------
const TEXTO_LATIN =
  'La función de configuración añade el número de sesión.\n' +
  'Días: lunes, miércoles, sábado. Año 2025. Señor Muñoz.\n' +
  'Corrección ortográfica: camión, después, jamás, según.\n'

/** Un blob se considera BIEN decodificado si los acentos volvieron intactos. */
function acentosOk(contenido: string): boolean {
  return (
    contenido.includes('función') &&
    contenido.includes('añade') &&
    contenido.includes('miércoles') &&
    !contenido.includes('�') // U+FFFD = el rombo de "byte no representable"
  )
}

// =============================================================================
// Fixture: repo con los cinco archivos, cada uno en su estado (commiteado,
// staged y modificado en disco) para que los tres lados tengan versión propia.
// =============================================================================
function crearEscenario(): string {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-blobenc-test-')))
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })

  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'core.autocrlf', 'false']) // blobs deterministas (LF)
  git(['config', 'commit.gpgsign', 'false'])

  // (1) latin-1: se escriben BYTES crudos, no una cadena (writeFileSync con 'utf8'
  //     re-codificaría y el fixture dejaría de probar lo que dice probar).
  writeFileSync(path.join(repo, 'acentos.txt'), Buffer.from(TEXTO_LATIN, 'latin1'))
  // (2) UTF-8 con BOM.
  writeFileSync(
    path.join(repo, 'conbom.txt'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hola áéíóú\n', 'utf8')])
  )
  // (3) binario: un byte NUL en la cabecera es suficiente.
  writeFileSync(
    path.join(repo, 'binario.bin'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0x00, 0xff, 0xfe])
  )
  // (4) grande: 3 MiB de ASCII, por encima del tope de 2 MiB.
  writeFileSync(path.join(repo, 'grande.txt'), Buffer.alloc(3 * 1024 * 1024, 0x61))
  // (5) ASCII normal (regresión).
  writeFileSync(path.join(repo, 'plano.txt'), 'linea uno\nlinea dos\n', 'utf8')

  git(['add', '-A'])
  git(['commit', '-m', 'fixture de codificaciones'])

  // Tras el commit, se modifican EN DISCO los dos de texto para que la versión del
  // disco no sea la misma que la del commit (así el test distingue de verdad los
  // lados). Se conserva la codificación de cada uno.
  writeFileSync(
    path.join(repo, 'acentos.txt'),
    Buffer.from(TEXTO_LATIN + 'Línea añadida sólo en el disco.\n', 'latin1')
  )
  writeFileSync(path.join(repo, 'plano.txt'), 'linea uno\nlinea dos\nlinea tres\n', 'utf8')

  return repo
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir el fixture en un dir temporal del SO')
  const repo = crearEscenario()
  console.log('repo:', repo)

  const gitCli = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })
  const head = gitCli(['rev-parse', 'HEAD']).trim()
  console.log('HEAD:', head)

  try {
    const silenciar = (): void => {}
    const git = new ServicioGit({ raizProyecto: repo, log: silenciar })
    git.fijarRaizProyecto(repo)

    // -----------------------------------------------------------------------
    // (1) latin-1 en los TRES lados. El del disco es el que fallaba de verdad.
    // -----------------------------------------------------------------------
    hr('(1) archivo latin-1: los tres lados lo decodifican con acentos legibles')

    const c1 = await git.leerBlobEnCommit(head, 'acentos.txt')
    check(
      '(1a) leerBlobEnCommit -> encoding no-utf8 y acentos intactos',
      c1.existe && c1.encoding !== undefined && c1.encoding !== 'utf8' && acentosOk(c1.contenido),
      brief(c1)
    )

    const i1 = await git.leerBlobIndice('acentos.txt')
    check(
      '(1b) leerBlobIndice -> encoding no-utf8 y acentos intactos',
      i1.existe && i1.encoding !== undefined && i1.encoding !== 'utf8' && acentosOk(i1.contenido),
      brief(i1)
    )

    const w1 = await git.leerBlobWorktree('acentos.txt')
    check(
      '(1c) leerBlobWorktree -> encoding no-utf8 y acentos intactos (ESTE fallaba antes)',
      w1.existe && w1.encoding !== undefined && w1.encoding !== 'utf8' && acentosOk(w1.contenido),
      brief(w1)
    )

    check(
      '(1d) el disco tiene la línea extra que no está en el commit (los lados son distintos)',
      w1.contenido.includes('sólo en el disco') && !c1.contenido.includes('sólo en el disco'),
      `disco=${w1.contenido.length}B commit=${c1.contenido.length}B`
    )

    check(
      '(1e) commit e índice coinciden entre sí (mismo blob, misma detección)',
      c1.contenido === i1.contenido && c1.encoding === i1.encoding,
      `commit=${c1.encoding} indice=${i1.encoding} iguales=${c1.contenido === i1.contenido}`
    )

    // -----------------------------------------------------------------------
    // (2) UTF-8 con BOM: el id lo delata y el BOM NO debe llegar al contenido
    //     (decodificarTexto hace stripBOM; si se colara, el diff pintaría un cambio
    //     fantasma en la primera línea).
    // -----------------------------------------------------------------------
    hr('(2) UTF-8 con BOM -> id utf8bom y contenido sin el BOM')

    const w2 = await git.leerBlobWorktree('conbom.txt')
    check(
      '(2a) leerBlobWorktree -> encoding utf8bom',
      w2.encoding === 'utf8bom',
      brief(w2)
    )
    check(
      '(2b) el contenido NO empieza por U+FEFF y el texto está intacto',
      !w2.contenido.startsWith(BOM) && w2.contenido.startsWith('hola áéíóú'),
      JSON.stringify(w2.contenido)
    )

    const c2 = await git.leerBlobEnCommit(head, 'conbom.txt')
    check(
      '(2c) leerBlobEnCommit -> mismo veredicto que el disco',
      c2.encoding === 'utf8bom' && !c2.contenido.startsWith(BOM),
      brief(c2)
    )

    // -----------------------------------------------------------------------
    // (3) Binario: antes se colaba como texto basura porque nadie preguntaba.
    // -----------------------------------------------------------------------
    hr('(3) archivo binario -> esBinario:true y contenido vacío en los tres lados')

    const w3 = await git.leerBlobWorktree('binario.bin')
    check('(3a) leerBlobWorktree -> esBinario:true, contenido vacío', w3.esBinario === true && w3.contenido === '', brief(w3))

    const i3 = await git.leerBlobIndice('binario.bin')
    check('(3b) leerBlobIndice -> esBinario:true, contenido vacío', i3.esBinario === true && i3.contenido === '', brief(i3))

    const c3 = await git.leerBlobEnCommit(head, 'binario.bin')
    check('(3c) leerBlobEnCommit -> esBinario:true, contenido vacío', c3.esBinario === true && c3.contenido === '', brief(c3))

    // -----------------------------------------------------------------------
    // (4) Tope de 2 MiB: REGRESIÓN. En gitBlob el tope se decide leyendo la
    //     cabecera de `cat-file --batch` y MATANDO el proceso antes de que
    //     vuelque megabytes; ese camino no debe haberse tocado.
    // -----------------------------------------------------------------------
    hr('(4) archivo > 2 MiB -> truncado:true y sin volcar contenido')

    const w4 = await git.leerBlobWorktree('grande.txt')
    check(
      '(4a) leerBlobWorktree -> truncado:true, contenido vacío, sin encoding',
      w4.truncado === true && w4.contenido === '' && w4.encoding === undefined,
      brief(w4)
    )

    const i4 = await git.leerBlobIndice('grande.txt')
    check(
      '(4b) leerBlobIndice -> truncado:true (el kill temprano de cat-file sigue vivo)',
      i4.truncado === true && i4.contenido === '',
      brief(i4)
    )

    // -----------------------------------------------------------------------
    // (5) ASCII normal: nada de lo que ya funcionaba puede haber cambiado.
    // -----------------------------------------------------------------------
    hr('(5) ASCII normal -> utf8 y contenido byte-exacto')

    const w5 = await git.leerBlobWorktree('plano.txt')
    check(
      '(5a) leerBlobWorktree -> utf8 y contenido exacto (versión del disco)',
      w5.encoding === 'utf8' && w5.contenido === 'linea uno\nlinea dos\nlinea tres\n',
      brief(w5)
    )

    const c5 = await git.leerBlobEnCommit(head, 'plano.txt')
    check(
      '(5b) leerBlobEnCommit -> utf8 y contenido exacto (versión del commit)',
      c5.encoding === 'utf8' && c5.contenido === 'linea uno\nlinea dos\n',
      brief(c5)
    )

    // -----------------------------------------------------------------------
    // (6) Inexistente: el caso "<rev> missing" de cat-file no debe confundirse
    //     con un blob vacío ni lanzar.
    // -----------------------------------------------------------------------
    hr('(6) ruta inexistente -> existe:false, sin lanzar')

    const c6 = await git.leerBlobEnCommit(head, 'no-existe.txt')
    check('(6a) leerBlobEnCommit de ruta inexistente -> existe:false', c6.existe === false, brief(c6))

    const w6 = await git.leerBlobWorktree('no-existe.txt')
    check('(6b) leerBlobWorktree de ruta inexistente -> existe:false', w6.existe === false, brief(w6))

    // -----------------------------------------------------------------------
    // (7) EL LOTE: varias revisiones en UN SOLO `cat-file --batch`.
    //
    // Es el camino que usa el diff de comprimidos para leer los dos lados de un
    // .jar con un arranque de git.exe en vez de dos (medido: 170 ms contra 480).
    // El parser es una máquina de estados que alterna cabecera/contenido sobre un
    // stream continuo, así que lo que hay que fijar es que NO se descoloque: que
    // cada respuesta caiga en su hueco pase lo que pase con las vecinas.
    // -----------------------------------------------------------------------
    hr('(7) blobsBytesLote: varias revisiones en un solo proceso')

    const lote = await git.blobsBytesLote([
      { origen: 'commit', hash: head, ruta: 'plano.txt' },
      { origen: 'commit', hash: head, ruta: 'binario.bin' },
      { origen: 'commit', hash: head, ruta: 'no-existe.txt' },
      { origen: 'worktree', ruta: 'plano.txt' },
      { origen: 'index', ruta: 'conbom.txt' }
    ])

    check(
      '(7a) devuelve tantos resultados como peticiones',
      lote.length === 5,
      `${lote.length} de 5`
    )
    check(
      '(7b) el texto del commit llega entero y byte-exacto',
      lote[0].existe &&
        Buffer.from(lote[0].bytes as Uint8Array).toString('utf8') === 'linea uno\nlinea dos\n',
      JSON.stringify(Buffer.from(lote[0].bytes ?? new Uint8Array()).toString('utf8'))
    )
    check(
      '(7c) el BINARIO de en medio no descoloca al siguiente (bytes exactos, con el NUL)',
      lote[1].existe &&
        lote[1].tamano === 10 &&
        (lote[1].bytes as Uint8Array)[4] === 0x00 &&
        (lote[1].bytes as Uint8Array)[9] === 0xfe,
      `size=${lote[1].tamano}`
    )
    check(
      '(7d) un "missing" en medio NO consume el hueco de los demás',
      lote[2].existe === false && lote[2].tamano === 0,
      JSON.stringify(lote[2])
    )
    check(
      '(7e) el lado de DISCO se resuelve sin git y en su hueco (3 líneas, no 2)',
      lote[3].existe &&
        Buffer.from(lote[3].bytes as Uint8Array).toString('utf8') ===
          'linea uno\nlinea dos\nlinea tres\n',
      `len=${lote[3].tamano}`
    )
    check(
      '(7f) el lado del ÍNDICE llega con su BOM intacto (son BYTES, no texto)',
      lote[4].existe &&
        (lote[4].bytes as Uint8Array)[0] === 0xef &&
        (lote[4].bytes as Uint8Array)[1] === 0xbb &&
        (lote[4].bytes as Uint8Array)[2] === 0xbf,
      `size=${lote[4].tamano}`
    )

    // El tope MATA el proceso a mitad del lote: lo que iba detrás no llegó a
    // leerse y se pide en otra tanda. Sin esa reanudación, pedir un archivo
    // grande dejaría sin respuesta a todos los que fueran después.
    const loteTope = await git.blobsBytesLote(
      [
        { origen: 'commit', hash: head, ruta: 'grande.txt' },
        { origen: 'commit', hash: head, ruta: 'plano.txt' }
      ],
      2 * 1024 * 1024
    )
    check(
      '(7g) el que se pasa del tope sale truncado, con su tamaño real y sin bytes',
      loteTope[0].existe && loteTope[0].truncado && loteTope[0].tamano === 3 * 1024 * 1024,
      JSON.stringify({ ...loteTope[0], bytes: undefined })
    )
    check(
      '(7h) Y EL QUE IBA DETRÁS SE RECUPERA en otra tanda',
      loteTope[1].existe &&
        !loteTope[1].truncado &&
        Buffer.from(loteTope[1].bytes as Uint8Array).toString('utf8') === 'linea uno\nlinea dos\n',
      `size=${loteTope[1].tamano}`
    )

    // Un objeto de 3 MiB seguido de otros dos: el stream llega en decenas de trozos
    // y hay que recomponerlo sin descolocar nada.
    //
    // OJO CON LO QUE ESTE CASO **NO** PRUEBA. El fallo que se vio en vivo —el salto
    // separador llegando en el trozo siguiente— depende de dónde corte el sistema
    // operativo, y aquí eso no se elige: se comprobó que este mismo caso pasaba CON
    // y SIN el arreglo. Quien lo fija es `test:cat-file-lote`, que alimenta al
    // parser con los cortes puestos a mano. Éste se queda porque cubre la otra
    // mitad —que el camino real, con git de verdad, recompone bien lo grande—.
    const loteGrande = await git.blobsBytesLote(
      [
        { origen: 'commit', hash: head, ruta: 'grande.txt' },
        { origen: 'commit', hash: head, ruta: 'plano.txt' },
        { origen: 'commit', hash: head, ruta: 'acentos.txt' }
      ],
      8 * 1024 * 1024
    )
    check(
      '(7i) un objeto de 3 MiB se lee entero y no descoloca a los que van detrás',
      loteGrande[0].existe &&
        !loteGrande[0].truncado &&
        loteGrande[0].tamano === 3 * 1024 * 1024 &&
        loteGrande[1].existe &&
        Buffer.from(loteGrande[1].bytes as Uint8Array).toString('utf8') ===
          'linea uno\nlinea dos\n' &&
        loteGrande[2].existe &&
        loteGrande[2].tamano > 0,
      `${loteGrande[0].tamano} / ${loteGrande[1].tamano} / ${loteGrande[2].tamano}`
    )

    const vacio = await git.blobsBytesLote([])
    check('(7j) un lote vacío no arranca ningún proceso', vacio.length === 0, '[]')
  } finally {
    hr('PASO FINAL - limpieza (borrar el fixture temporal)')
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      console.log('fixture temporal eliminado:', repo)
    } catch (err) {
      console.log('AVISO: no se pudo borrar el temporal (no afecta al veredicto):', String(err))
    }
  }

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
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

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
