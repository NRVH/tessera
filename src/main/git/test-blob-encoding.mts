#!/usr/bin/env node
// =============================================================================
// Prueba de la detección de codificación en los tres lados del diff (npm run test:blob-encoding):
// `blobAtCommit` (commit), `indexBlob` (índice) y `workingBlob` (disco) con el MISMO archivo deben
// coincidir. Casos: latin-1 legible, UTF-8 con BOM, bytes NUL (`binary`), más de 2 MiB
// (`truncated`, con el corte temprano de `cat-file`), ASCII byte-exacto e inexistente. Fixture temporal.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { BlobResult } from '../../shared/git-ipc.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { GitService } = await import('./GitService.ts')

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

/** Resumen legible de un BlobResult (los contenidos largos se recortan). */
function brief(b: BlobResult): string {
  const head = b.content.length > 48 ? b.content.slice(0, 48) + '…' : b.content
  return JSON.stringify({
    exists: b.exists,
    encoding: b.encoding,
    binary: b.binary,
    truncated: b.truncated,
    len: b.content.length,
    head
  })
}

// -----------------------------------------------------------------------------
// Texto latin-1 con la muestra de acentos. Se repite para dar material a jschardet
// (con dos palabras sueltas su confianza no llega al umbral y cae al fallback; el
// fallback TAMBIÉN es correcto, pero así se ejercita el camino de verdad).
// -----------------------------------------------------------------------------
const LATIN_TEXT =
  'La función de configuración añade el número de sesión.\n' +
  'Días: lunes, miércoles, sábado. Año 2025. Señor Muñoz.\n' +
  'Corrección ortográfica: camión, después, jamás, según.\n'

/** Un blob se considera BIEN decodificado si los acentos volvieron intactos. */
function acentosOk(content: string): boolean {
  return (
    content.includes('función') &&
    content.includes('añade') &&
    content.includes('miércoles') &&
    !content.includes('�') // U+FFFD = el rombo de "byte no representable"
  )
}

// =============================================================================
// Fixture: repo con los cinco archivos, cada uno en su estado (commiteado,
// staged y modificado en disco) para que los tres lados tengan versión propia.
// =============================================================================
function buildFixture(): string {
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
  writeFileSync(path.join(repo, 'acentos.txt'), Buffer.from(LATIN_TEXT, 'latin1'))
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
    Buffer.from(LATIN_TEXT + 'Línea añadida sólo en el disco.\n', 'latin1')
  )
  writeFileSync(path.join(repo, 'plano.txt'), 'linea uno\nlinea dos\nlinea tres\n', 'utf8')

  return repo
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  hr('PASO 0 - construir el fixture en un dir temporal del SO')
  const repo = buildFixture()
  console.log('repo:', repo)

  const gitCli = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env } })
  const head = gitCli(['rev-parse', 'HEAD']).trim()
  console.log('HEAD:', head)

  try {
    const silent = (): void => {}
    const git = new GitService({ projectRoot: repo, log: silent })
    git.setProjectRoot(repo)

    // -----------------------------------------------------------------------
    // (1) latin-1 en los TRES lados. El del disco es el que fallaba de verdad.
    // -----------------------------------------------------------------------
    hr('(1) archivo latin-1: los tres lados lo decodifican con acentos legibles')

    const c1 = await git.blobAtCommit(head, 'acentos.txt')
    check(
      '(1a) blobAtCommit -> encoding no-utf8 y acentos intactos',
      c1.exists && c1.encoding !== undefined && c1.encoding !== 'utf8' && acentosOk(c1.content),
      brief(c1)
    )

    const i1 = await git.indexBlob('acentos.txt')
    check(
      '(1b) indexBlob -> encoding no-utf8 y acentos intactos',
      i1.exists && i1.encoding !== undefined && i1.encoding !== 'utf8' && acentosOk(i1.content),
      brief(i1)
    )

    const w1 = await git.workingBlob('acentos.txt')
    check(
      '(1c) workingBlob -> encoding no-utf8 y acentos intactos (ESTE fallaba antes)',
      w1.exists && w1.encoding !== undefined && w1.encoding !== 'utf8' && acentosOk(w1.content),
      brief(w1)
    )

    check(
      '(1d) el disco tiene la línea extra que no está en el commit (los lados son distintos)',
      w1.content.includes('sólo en el disco') && !c1.content.includes('sólo en el disco'),
      `disco=${w1.content.length}B commit=${c1.content.length}B`
    )

    check(
      '(1e) commit e índice coinciden entre sí (mismo blob, misma detección)',
      c1.content === i1.content && c1.encoding === i1.encoding,
      `commit=${c1.encoding} indice=${i1.encoding} iguales=${c1.content === i1.content}`
    )

    // -----------------------------------------------------------------------
    // (2) UTF-8 con BOM: el id lo delata y el BOM NO debe llegar al contenido
    //     (decodeText hace stripBOM; si se colara, el diff pintaría un cambio
    //     fantasma en la primera línea).
    // -----------------------------------------------------------------------
    hr('(2) UTF-8 con BOM -> id utf8bom y contenido sin el BOM')

    const w2 = await git.workingBlob('conbom.txt')
    check(
      '(2a) workingBlob -> encoding utf8bom',
      w2.encoding === 'utf8bom',
      brief(w2)
    )
    check(
      '(2b) el contenido NO empieza por U+FEFF y el texto está intacto',
      !w2.content.startsWith(BOM) && w2.content.startsWith('hola áéíóú'),
      JSON.stringify(w2.content)
    )

    const c2 = await git.blobAtCommit(head, 'conbom.txt')
    check(
      '(2c) blobAtCommit -> mismo veredicto que el disco',
      c2.encoding === 'utf8bom' && !c2.content.startsWith(BOM),
      brief(c2)
    )

    // -----------------------------------------------------------------------
    // (3) Binario: antes se colaba como texto basura porque nadie preguntaba.
    // -----------------------------------------------------------------------
    hr('(3) archivo binario -> binary:true y content vacío en los tres lados')

    const w3 = await git.workingBlob('binario.bin')
    check('(3a) workingBlob -> binary:true, content vacío', w3.binary === true && w3.content === '', brief(w3))

    const i3 = await git.indexBlob('binario.bin')
    check('(3b) indexBlob -> binary:true, content vacío', i3.binary === true && i3.content === '', brief(i3))

    const c3 = await git.blobAtCommit(head, 'binario.bin')
    check('(3c) blobAtCommit -> binary:true, content vacío', c3.binary === true && c3.content === '', brief(c3))

    // -----------------------------------------------------------------------
    // (4) Tope de 2 MiB: REGRESIÓN. En gitBlob el tope se decide leyendo la
    //     cabecera de `cat-file --batch` y MATANDO el proceso antes de que
    //     vuelque megabytes; ese camino no debe haberse tocado.
    // -----------------------------------------------------------------------
    hr('(4) archivo > 2 MiB -> truncated:true y sin volcar contenido')

    const w4 = await git.workingBlob('grande.txt')
    check(
      '(4a) workingBlob -> truncated:true, content vacío, sin encoding',
      w4.truncated === true && w4.content === '' && w4.encoding === undefined,
      brief(w4)
    )

    const i4 = await git.indexBlob('grande.txt')
    check(
      '(4b) indexBlob -> truncated:true (el kill temprano de cat-file sigue vivo)',
      i4.truncated === true && i4.content === '',
      brief(i4)
    )

    // -----------------------------------------------------------------------
    // (5) ASCII normal: nada de lo que ya funcionaba puede haber cambiado.
    // -----------------------------------------------------------------------
    hr('(5) ASCII normal -> utf8 y contenido byte-exacto')

    const w5 = await git.workingBlob('plano.txt')
    check(
      '(5a) workingBlob -> utf8 y contenido exacto (versión del disco)',
      w5.encoding === 'utf8' && w5.content === 'linea uno\nlinea dos\nlinea tres\n',
      brief(w5)
    )

    const c5 = await git.blobAtCommit(head, 'plano.txt')
    check(
      '(5b) blobAtCommit -> utf8 y contenido exacto (versión del commit)',
      c5.encoding === 'utf8' && c5.content === 'linea uno\nlinea dos\n',
      brief(c5)
    )

    // -----------------------------------------------------------------------
    // (6) Inexistente: el caso "<rev> missing" de cat-file no debe confundirse
    //     con un blob vacío ni lanzar.
    // -----------------------------------------------------------------------
    hr('(6) ruta inexistente -> exists:false, sin lanzar')

    const c6 = await git.blobAtCommit(head, 'no-existe.txt')
    check('(6a) blobAtCommit de ruta inexistente -> exists:false', c6.exists === false, brief(c6))

    const w6 = await git.workingBlob('no-existe.txt')
    check('(6b) workingBlob de ruta inexistente -> exists:false', w6.exists === false, brief(w6))

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
      { source: 'commit', hash: head, path: 'plano.txt' },
      { source: 'commit', hash: head, path: 'binario.bin' },
      { source: 'commit', hash: head, path: 'no-existe.txt' },
      { source: 'worktree', path: 'plano.txt' },
      { source: 'index', path: 'conbom.txt' }
    ])

    check(
      '(7a) devuelve tantos resultados como peticiones',
      lote.length === 5,
      `${lote.length} de 5`
    )
    check(
      '(7b) el texto del commit llega entero y byte-exacto',
      lote[0].exists &&
        Buffer.from(lote[0].bytes as Uint8Array).toString('utf8') === 'linea uno\nlinea dos\n',
      JSON.stringify(Buffer.from(lote[0].bytes ?? new Uint8Array()).toString('utf8'))
    )
    check(
      '(7c) el BINARIO de en medio no descoloca al siguiente (bytes exactos, con el NUL)',
      lote[1].exists &&
        lote[1].size === 10 &&
        (lote[1].bytes as Uint8Array)[4] === 0x00 &&
        (lote[1].bytes as Uint8Array)[9] === 0xfe,
      `size=${lote[1].size}`
    )
    check(
      '(7d) un "missing" en medio NO consume el hueco de los demás',
      lote[2].exists === false && lote[2].size === 0,
      JSON.stringify(lote[2])
    )
    check(
      '(7e) el lado de DISCO se resuelve sin git y en su hueco (3 líneas, no 2)',
      lote[3].exists &&
        Buffer.from(lote[3].bytes as Uint8Array).toString('utf8') ===
          'linea uno\nlinea dos\nlinea tres\n',
      `len=${lote[3].size}`
    )
    check(
      '(7f) el lado del ÍNDICE llega con su BOM intacto (son BYTES, no texto)',
      lote[4].exists &&
        (lote[4].bytes as Uint8Array)[0] === 0xef &&
        (lote[4].bytes as Uint8Array)[1] === 0xbb &&
        (lote[4].bytes as Uint8Array)[2] === 0xbf,
      `size=${lote[4].size}`
    )

    // El tope MATA el proceso a mitad del lote: lo que iba detrás no llegó a
    // leerse y se pide en otra tanda. Sin esa reanudación, pedir un archivo
    // grande dejaría sin respuesta a todos los que fueran después.
    const loteTope = await git.blobsBytesLote(
      [
        { source: 'commit', hash: head, path: 'grande.txt' },
        { source: 'commit', hash: head, path: 'plano.txt' }
      ],
      2 * 1024 * 1024
    )
    check(
      '(7g) el que se pasa del tope sale truncado, con su tamaño real y sin bytes',
      loteTope[0].exists && loteTope[0].truncated && loteTope[0].size === 3 * 1024 * 1024,
      JSON.stringify({ ...loteTope[0], bytes: undefined })
    )
    check(
      '(7h) Y EL QUE IBA DETRÁS SE RECUPERA en otra tanda',
      loteTope[1].exists &&
        !loteTope[1].truncated &&
        Buffer.from(loteTope[1].bytes as Uint8Array).toString('utf8') === 'linea uno\nlinea dos\n',
      `size=${loteTope[1].size}`
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
        { source: 'commit', hash: head, path: 'grande.txt' },
        { source: 'commit', hash: head, path: 'plano.txt' },
        { source: 'commit', hash: head, path: 'acentos.txt' }
      ],
      8 * 1024 * 1024
    )
    check(
      '(7i) un objeto de 3 MiB se lee entero y no descoloca a los que van detrás',
      loteGrande[0].exists &&
        !loteGrande[0].truncated &&
        loteGrande[0].size === 3 * 1024 * 1024 &&
        loteGrande[1].exists &&
        Buffer.from(loteGrande[1].bytes as Uint8Array).toString('utf8') ===
          'linea uno\nlinea dos\n' &&
        loteGrande[2].exists &&
        loteGrande[2].size > 0,
      `${loteGrande[0].size} / ${loteGrande[1].size} / ${loteGrande[2].size}`
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
