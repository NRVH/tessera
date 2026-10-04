// =============================================================================
// `git cat-file --batch`: un proceso que lee N revisiones por stdin y las devuelve pegadas, con
// tope por objeto. FUERA de la cola de git, sin techo de tiempo; lo mata `child.kill()`.
// El formato lo interpreta `./catFileLote`. Lo usan las lecturas de blobs del servicio, y la
// versión filtrada de un blob (`--filters`, uno por proceso) la comparación de un descarte.
// Decisiones: docs/decisiones/git/main-lecturas-y-cache.md
// =============================================================================

import { spawn } from 'node:child_process'
import { ParserCatFile, type BlobBruto, type EstadoParser } from './catFileLote'

/**
 * Una tanda de `cat-file --batch` en `cwd`: lee hasta completar `revs` o hasta un objeto que
 * supere `maxBytes`, y devuelve en `cortadoEn` el índice del que cortó (-1 si ninguno).
 */
export function leerLoteCatFile(
  revs: readonly string[],
  cwd: string,
  maxBytes: number
): Promise<{ resultados: BlobBruto[]; cortadoEn: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd })
    const parser = new ParserCatFile(revs.length, maxBytes)
    const errChunks: Buffer[] = []
    let settled = false

    const done = (cortadoEn: number): void => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ resultados: parser.resultados, cortadoEn })
    }
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      child.kill()
      reject(err)
    }
    const atender = (estado: EstadoParser): void => {
      if (estado.tipo === 'listo') done(-1)
      else if (estado.tipo === 'cortado') done(estado.indice)
      else if (estado.tipo === 'error') fail(new Error(estado.mensaje))
    }

    child.stdout.on('data', (buf: Buffer) => {
      if (!settled) atender(parser.trozo(buf))
    })
    // Un flujo que termina sin las respuestas completas NO se resuelve: 'close' lo trata como
    // error, porque entregar un archivo a medias pintaría un diff falso.
    child.stdout.on('end', () => {
      if (!settled && parser.fin().tipo === 'listo') done(-1)
    })

    child.stderr.on('data', (b: Buffer) => errChunks.push(b))
    child.on('error', (err) => fail(err))
    child.on('close', (code) => {
      if (settled) return
      // Cerró sin completar: repo roto o no-repo. El stderr va como `.stderr`, igual que execFile.
      const stderr = Buffer.concat(errChunks).toString('utf8').trim()
      const err = new Error(stderr || `git cat-file salió con código ${code}`) as Error & {
        stderr?: string
      }
      err.stderr = stderr
      fail(err)
    })

    // EPIPE si matamos el proceso temprano (tope/completado): esperado, se ignora.
    child.stdin.on('error', () => {})
    child.stdin.write(revs.join('\n') + '\n')
    child.stdin.end()
  })
}

/** Techo de `leerBlobFiltrado`: un filtro externo colgado no puede retener el candado del repo. */
const TECHO_FILTRADO_MS = 60_000

/**
 * Los bytes que `checkout` escribiría de un blob en `ruta` (filtros, fin de línea, codificación):
 * `git cat-file --filters --path`. `null` si pasan de `maxBytes`, y ahí se corta. Un fallo lleva
 * `code` (la salida de git) o `killed` (el techo), como un error de `execFile`.
 */
export function leerBlobFiltrado(oid: string, ruta: string, cwd: string, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--filters', `--path=${ruta}`, oid], { cwd })
    const trozos: Buffer[] = []
    const errChunks: Buffer[] = []
    let total = 0
    let settled = false
    const techo = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(Object.assign(new Error('git cat-file --filters: sin respuesta'), { killed: true }))
    }, TECHO_FILTRADO_MS)
    const acabar = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(techo)
      fn()
    }
    child.stdout.on('data', (buf: Buffer) => {
      if (settled) return
      total += buf.length
      if (total > maxBytes) {
        child.kill()
        acabar(() => resolve(null))
        return
      }
      trozos.push(buf)
    })
    child.stderr.on('data', (b: Buffer) => errChunks.push(b))
    child.on('error', (err) => acabar(() => reject(err)))
    child.on('close', (code) => {
      if (code === 0) {
        acabar(() => resolve(Buffer.concat(trozos, total)))
        return
      }
      const stderr = Buffer.concat(errChunks).toString('utf8').trim()
      const err = Object.assign(new Error(stderr || `git cat-file salió con código ${code}`), { stderr, code })
      acabar(() => reject(err))
    })
  })
}
