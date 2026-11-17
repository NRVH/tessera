// =============================================================================
// `git cat-file --batch`: un proceso que lee N revisiones por stdin y las devuelve pegadas, con
// tope por objeto. FUERA de la cola de git, sin techo de tiempo; lo mata `proceso.kill()`.
// El formato lo interpreta `./catFileLote`. Lo usan las lecturas de blobs del servicio, y la
// versión filtrada de un blob (`--filters`, uno por proceso) la comparación de un descarte.
// Decisiones: docs/decisiones/git/main-lecturas-y-cache.md
// =============================================================================

import { spawn } from 'node:child_process'
import { AnalizadorObjetosGit, type BlobBruto, type EstadoParser } from './catFileLote'
import { entornoGit } from './configSegura'

/**
 * Una tanda de `cat-file --batch` en `cwd`: lee hasta completar `revs` o hasta un objeto que
 * supere `maxBytes`, y devuelve en `cortadoEn` el índice del que cortó (-1 si ninguno).
 */
export async function leerLoteObjetosGit(
  revs: readonly string[],
  cwd: string,
  maxBytes: number
): Promise<{ resultados: BlobBruto[]; cortadoEn: number }> {
  const env = await entornoGit(cwd)
  return new Promise((resolve, rechazar) => {
    const proceso = spawn('git', ['cat-file', '--batch'], { cwd, env })
    const parser = new AnalizadorObjetosGit(revs.length, maxBytes)
    const trozosError: Buffer[] = []
    let terminado = false

    const terminar = (cortadoEn: number): void => {
      if (terminado) return
      terminado = true
      proceso.kill()
      resolve({ resultados: parser.resultados, cortadoEn })
    }
    const fallar = (err: Error): void => {
      if (terminado) return
      terminado = true
      proceso.kill()
      rechazar(err)
    }
    const atender = (estado: EstadoParser): void => {
      if (estado.tipo === 'listo') terminar(-1)
      else if (estado.tipo === 'cortado') terminar(estado.indice)
      else if (estado.tipo === 'error') fallar(new Error(estado.mensaje))
    }

    proceso.stdout.on('data', (buf: Buffer) => {
      if (!terminado) atender(parser.trozo(buf))
    })
    // Un flujo que termina sin las respuestas completas NO se resuelve: 'close' lo trata como
    // error, porque entregar un archivo a medias pintaría un diff falso.
    proceso.stdout.on('end', () => {
      if (!terminado && parser.fin().tipo === 'listo') terminar(-1)
    })

    proceso.stderr.on('data', (b: Buffer) => trozosError.push(b))
    proceso.on('error', (err) => fallar(err))
    proceso.on('close', (codigo) => {
      if (terminado) return
      // Cerró sin completar: repo roto o no-repo. El stderr va como `.stderr`, igual que execFile.
      const stderr = Buffer.concat(trozosError).toString('utf8').trim()
      const err = new Error(stderr || `git cat-file salió con código ${codigo}`) as Error & {
        stderr?: string
      }
      err.stderr = stderr
      fallar(err)
    })

    // EPIPE si matamos el proceso temprano (tope/completado): esperado, se ignora.
    proceso.stdin.on('error', () => {})
    proceso.stdin.write(revs.join('\n') + '\n')
    proceso.stdin.end()
  })
}

/** Techo de `leerBlobFiltrado`: un filtro externo colgado no puede retener el candado del repo. */
const TECHO_FILTRADO_MS = 60_000

/**
 * Los bytes que `checkout` escribiría de un blob en `ruta` (filtros, fin de línea, codificación):
 * `git cat-file --filters --path`. `null` si pasan de `maxBytes`, y ahí se corta. Un fallo lleva
 * `code` (la salida de git) o `killed` (el techo), como un error de `execFile`.
 */
export async function leerBlobFiltrado(oid: string, ruta: string, cwd: string, maxBytes: number): Promise<Buffer | null> {
  // `--filters` pasa el blob por los filtros del repo: sin anular los locales, ejecutaría el suyo.
  const env = await entornoGit(cwd)
  return new Promise((resolve, rechazar) => {
    const proceso = spawn('git', ['cat-file', '--filters', `--path=${ruta}`, oid], { cwd, env })
    const trozos: Buffer[] = []
    const trozosError: Buffer[] = []
    let total = 0
    let terminado = false
    const techo = setTimeout(() => {
      if (terminado) return
      terminado = true
      proceso.kill('SIGKILL')
      rechazar(Object.assign(new Error('git cat-file --filters: sin respuesta'), { killed: true }))
    }, TECHO_FILTRADO_MS)
    const acabar = (fn: () => void): void => {
      if (terminado) return
      terminado = true
      clearTimeout(techo)
      fn()
    }
    proceso.stdout.on('data', (buf: Buffer) => {
      if (terminado) return
      total += buf.length
      if (total > maxBytes) {
        proceso.kill()
        acabar(() => resolve(null))
        return
      }
      trozos.push(buf)
    })
    proceso.stderr.on('data', (b: Buffer) => trozosError.push(b))
    proceso.on('error', (err) => acabar(() => rechazar(err)))
    proceso.on('close', (codigo) => {
      if (codigo === 0) {
        acabar(() => resolve(Buffer.concat(trozos, total)))
        return
      }
      const stderr = Buffer.concat(trozosError).toString('utf8').trim()
      const err = Object.assign(new Error(stderr || `git cat-file salió con código ${codigo}`), { stderr, code: codigo })
      acabar(() => rechazar(err))
    })
  })
}
