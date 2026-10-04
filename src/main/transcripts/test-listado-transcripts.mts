#!/usr/bin/env node
// =============================================================================
// Prueba de listadoTranscripts (node src/main/transcripts/test-listado-transcripts.mts), con
// un sistema de archivos falso que cuenta las llamadas: lo que se fija es CUÁNTO disco se
// toca (la carpeta que no pasa la criba ni se lee) y qué cuenta como transcript.
// Decisiones: docs/decisiones/agentes/conversaciones-criba-por-carpeta.md
// =============================================================================

import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'
import { conFechas, rolloutsCodex, transcriptsClaude, type FsListado } from './listadoTranscripts.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Un árbol en memoria: una carpeta es un objeto y un archivo, su tamaño. */
type Arbol = { [nombre: string]: Arbol | number }

interface FsFalso extends FsListado {
  /** Carpetas leídas, en orden y relativas a la raíz, con `/`. */
  leidas: string[]
  stats: number
  /** Mayor número de `stat` en vuelo a la vez. */
  picoStat: number
}

const RAIZ = path.resolve('/falso')
const rel = (p: string): string => path.relative(RAIZ, p).split(path.sep).join('/')

function fsFalso(arbol: Arbol, desaparecidos: readonly string[] = []): FsFalso {
  const nodo = (ruta: string): Arbol | number | undefined => {
    let actual: Arbol | number | undefined = arbol
    for (const tramo of rel(ruta).split('/').filter(Boolean)) {
      if (typeof actual !== 'object') return undefined
      actual = actual[tramo]
    }
    return actual
  }
  let enVuelo = 0
  const fs: FsFalso = {
    leidas: [],
    stats: 0,
    picoStat: 0,
    readdir: async (dir) => {
      fs.leidas.push(rel(dir))
      const n = nodo(dir)
      if (typeof n !== 'object') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return Object.entries(n).map(
        ([name, hijo]) =>
          ({ name, isFile: () => typeof hijo === 'number', isDirectory: () => typeof hijo === 'object' }) as Dirent
      )
    },
    stat: async (ruta) => {
      fs.stats++
      enVuelo++
      fs.picoStat = Math.max(fs.picoStat, enVuelo)
      await new Promise((r) => setTimeout(r, 1))
      enVuelo--
      const n = nodo(ruta)
      if (typeof n !== 'number' || desaparecidos.includes(rel(ruta))) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return { mtimeMs: n * 1000, size: n } as Stats
    }
  }
  return fs
}

const ID = '11111111-1111-4111-8111-111111111111'
const CLAUDE: Arbol = {
  cuenta: {
    projects: {
      'D--trabajo-alfa': { [`${ID}.jsonl`]: 10, 'otra.jsonl': 20, [ID]: { subagents: { 'agent-x.jsonl': 5 } }, memory: { 'MEMORY.md': 1 } },
      'D--trabajo-beta': { 'b.jsonl': 30, 'notas.txt': 1 },
      'D--trabajo-vacia': { memory: { 'x.md': 1 } },
      'suelto.jsonl': 7
    },
    'file-history': { x: { projects: { 'D--trabajo-alfa': { 'fuera.jsonl': 9 } } } }
  }
}
const base = path.join(RAIZ, 'cuenta')
const nombres = (rutas: readonly string[]): string => rutas.map(rel).sort().join(' , ')

async function main(): Promise<void> {
  hr('(1) Claude sin proyecto: todas las carpetas, un readdir por carpeta y sin bajar')
  {
    const fs = fsFalso(CLAUDE)
    const t = await transcriptsClaude(base, { respaldo: 'todas', fs })
    check(
      'solo los `.jsonl` de primer nivel de cada carpeta de proyecto',
      nombres(t) ===
        `cuenta/projects/D--trabajo-alfa/${ID}.jsonl , cuenta/projects/D--trabajo-alfa/otra.jsonl , cuenta/projects/D--trabajo-beta/b.jsonl`,
      nombres(t)
    )
    check('1 readdir de `projects` + 1 por carpeta (3)', fs.leidas.length === 4, fs.leidas.join(' | '))
    check('no se baja a `<sessionId>/subagents` ni a `memory`', !fs.leidas.some((d) => d.split('/').length > 3), fs.leidas.join(' | '))
    check('ni se sale de `<base>/projects`', !fs.leidas.some((d) => d.includes('file-history')), 'sin file-history')
    check('y sin ningún stat', fs.stats === 0, `stats=${fs.stats}`)
  }

  hr('(2) Con proyecto: la carpeta que no pasa la criba NI SE LEE')
  {
    const fs = fsFalso(CLAUDE)
    const t = await transcriptsClaude(base, { nombreProyecto: 'alfa', respaldo: 'ninguna', fs })
    check('devuelve solo los de la carpeta cribada', t.length === 2 && t.every((p) => rel(p).includes('D--trabajo-alfa')), nombres(t))
    check('2 readdir: `projects` y la carpeta cribada', fs.leidas.length === 2, fs.leidas.join(' | '))
    const insensible = await transcriptsClaude(base, { nombreProyecto: 'ALFA', respaldo: 'ninguna', fs: fsFalso(CLAUDE) })
    check('la criba no distingue mayúsculas', insensible.length === 2, `n=${insensible.length}`)
  }

  hr('(3) Los dos respaldos cuando lo cribado no da ningún transcript')
  {
    for (const nombre of ['no-existe', 'vacia']) {
      const fsNinguna = fsFalso(CLAUDE)
      const ninguna = await transcriptsClaude(base, { nombreProyecto: nombre, respaldo: 'ninguna', fs: fsNinguna })
      check(`«${nombre}», respaldo 'ninguna': vacío y sin leer el resto`, ninguna.length === 0 && fsNinguna.leidas.length <= 2, fsNinguna.leidas.join(' | '))
      const fsTodas = fsFalso(CLAUDE)
      const todas = await transcriptsClaude(base, { nombreProyecto: nombre, respaldo: 'todas', fs: fsTodas })
      check(`«${nombre}», respaldo 'todas': se miran las demás`, todas.length === 3, nombres(todas))
      check(`«${nombre}»: ninguna carpeta se lee dos veces`, new Set(fsTodas.leidas).size === fsTodas.leidas.length, fsTodas.leidas.join(' | '))
    }
  }

  hr('(4) Cuenta sin estrenar: sin `projects` ni `sessions` no lanza')
  {
    const fs = fsFalso({ cuenta: {} })
    const claude = await transcriptsClaude(base, { respaldo: 'todas', fs })
    const codex = await rolloutsCodex(base, fs)
    check('listas vacías', claude.length === 0 && codex.length === 0, `claude=${claude.length} codex=${codex.length}`)
  }

  hr('(5) Codex: solo bajo `<base>/sessions`')
  {
    const fs = fsFalso({
      cuenta: {
        sessions: { '2026': { '07': { '09': { 'rollout-a.jsonl': 1, 'otro.jsonl': 2 }, '10': { 'rollout-b.jsonl': 3 } } } },
        '.tmp': { sessions: { 'rollout-tmp.jsonl': 4 } },
        archived_sessions: { 'rollout-viejo.jsonl': 5 }
      }
    })
    const r = await rolloutsCodex(base, fs)
    check(
      'los rollouts de `sessions/`, a cualquier profundidad, y solo `rollout-*.jsonl`',
      nombres(r) === 'cuenta/sessions/2026/07/09/rollout-a.jsonl , cuenta/sessions/2026/07/10/rollout-b.jsonl',
      nombres(r)
    )
    check('`.tmp/` y `archived_sessions/` ni se leen', !fs.leidas.some((d) => d.includes('.tmp') || d.includes('archived')), fs.leidas.join(' | '))
  }

  hr('(6) conFechas: tope de concurrencia y archivos que desaparecen')
  {
    const muchos: Arbol = {}
    for (let i = 0; i < 40; i++) muchos[`t${i}.jsonl`] = i + 1
    const fs = fsFalso({ c: muchos }, ['c/t3.jsonl', 'c/t7.jsonl'])
    const archivos = Object.keys(muchos).map((n) => path.join(RAIZ, 'c', n))
    const fechados = await conFechas(archivos, fs, 4)
    check('un stat por archivo', fs.stats === 40, `stats=${fs.stats}`)
    check('nunca más de 4 a la vez', fs.picoStat <= 4 && fs.picoStat > 1, `pico=${fs.picoStat}`)
    check('los dos que desaparecieron se omiten', fechados.length === 38, `n=${fechados.length}`)
    check('en el orden de entrada y con su fecha', rel(fechados[0].archivo) === 'c/t0.jsonl' && fechados[0].st.mtimeMs === 1000, rel(fechados[0].archivo))
    const conCero = await conFechas(archivos.slice(0, 3), fsFalso({ c: muchos }), 0)
    check('un tope de 0 no deja la tanda sin hacer (se trata como 1)', conCero.length === 3 && conCero.every((x) => x.st !== undefined), `n=${conCero.length}`)
  }

  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
