// =============================================================================
// Pruebas de `contexto.ts`: la orden que corre en el contenedor (con la casa del agente y la
// ruta citada), la ruta del archivo en el equipo en cada plataforma, el final de un archivo
// grande y la lectura de verdad con un comando en la shell nativa de esta máquina.
// Uso: node src/main/agents/manuales/test-contexto.mts
// =============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { leerContextoDeSesion, leerFinal, ordenEnContenedor, rutaNativa, rutaParaSh, type DepsContexto, type SesionConContexto } from './contexto.ts'
import { ejecutarEnShellNativa } from '../ejecutorShell.ts'
import { citarPowerShell, citarSh } from '../../../shared/citarShell.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const aqui = plataformaActual()
const enWindows = aqui === 'windows'
const citar = (v: string): string => (enWindows ? citarPowerShell(v) : citarSh(v))
const NODE = enWindows ? `& ${citarPowerShell(process.execPath)}` : citarSh(process.execPath)
const fuente = { origen: 'archivo' as const, valor: '~/uso.json', usado: 'ctx.usado', maximo: 'ctx.max' }

function contenedor(): void {
  hr('(1) La orden en el contenedor')
  check('«~/…»: la casa sin citar, el resto citado', rutaParaSh(`~/a b/c'd.json`) === `"$HOME"/'a b/c'\\''d.json'`, rutaParaSh(`~/a b/c'd.json`))
  check('«~» solo', rutaParaSh('~') === '"$HOME"', rutaParaSh('~'))
  check('una ruta con «$» no se expande', rutaParaSh('/tmp/$x.json') === `'/tmp/$x.json'`, rutaParaSh('/tmp/$x.json'))
  const entorno = `export HOME='/h' PATH='/h/.local/bin':/home/agente/.local/bin:"$PATH"; exec timeout -k 2 10 bash -c `
  const archivo = ordenEnContenedor(fuente, '/h')
  check('archivo: HOME y PATH del agente, con tope, y tail del final', archivo === `${entorno}'tail -c 262144 -- "$HOME"/'\\''uso.json'\\'''`, archivo)
  const comando = ordenEnContenedor({ ...fuente, origen: 'comando', valor: 'x stats --json' }, '/h')
  check('comando: HOME y PATH del agente, con tope, y el comando tal cual', comando === `${entorno}'x stats --json'`, comando)
}

function rutas(): void {
  hr('(2) La ruta del archivo en el equipo')
  check('Windows: «~/…» en la carpeta personal', rutaNativa('~/.x/uso.json', 'C:\\Users\\u', 'D:\\p', 'windows') === 'C:\\Users\\u\\.x\\uso.json', rutaNativa('~/.x/uso.json', 'C:\\Users\\u', 'D:\\p', 'windows'))
  check('Windows: «~\\…» también', rutaNativa('~\\uso.json', 'C:\\Users\\u', 'D:\\p', 'windows') === 'C:\\Users\\u\\uso.json', '')
  check('Windows: relativa, del proyecto', rutaNativa('logs\\uso.json', 'C:\\Users\\u', 'D:\\p', 'windows') === 'D:\\p\\logs\\uso.json', '')
  check('Windows: absoluta, tal cual', rutaNativa('E:\\uso.json', 'C:\\Users\\u', 'D:\\p', 'windows') === 'E:\\uso.json', '')
  check('Mac: «~/…» y relativa', rutaNativa('~/u.json', '/Users/u', '/p', 'mac') === '/Users/u/u.json' && rutaNativa('u.json', '/Users/u', '/p', 'mac') === '/p/u.json', '')
  check('Linux: absoluta, tal cual', rutaNativa('/var/u.json', '/home/u', '/p', 'linux') === '/var/u.json', '')
}

async function deVerdad(dir: string): Promise<void> {
  hr(`(3) De verdad, en esta plataforma (${aqui})`)
  const grande = path.join(dir, 'grande.jsonl')
  const linea = (n: number): string => JSON.stringify({ ctx: { usado: n, max: 1000 }, relleno: 'x'.repeat(200) })
  fs.writeFileSync(grande, Array.from({ length: 3000 }, (_, i) => linea(i % 900)).join('\n') + '\n' + linea(500) + '\n', 'utf8')
  const final = await leerFinal(grande, 4096)
  check('el final de un archivo grande, sin pasar del tope', final.length <= 4096 && final.trimEnd().endsWith(linea(500)), `${final.length} bytes`)
  const sesion: SesionConContexto = { profileId: 'p', projectHostPath: dir, host: true, home: '', fuente: { ...fuente, valor: 'grande.jsonl' } }
  const deps: DepsContexto = {
    plataforma: aqui,
    homedir: os.homedir(),
    ejecutarNativo: async (orden, cwd) => {
      const r = await ejecutarEnShellNativa(orden, { plataforma: aqui, timeoutMs: 30_000, modo: 'sonda', cwd })
      return { ok: r.ok, salida: r.salida }
    },
    ejecutarEnContenedor: async () => ({ ok: false, salida: 'no debe llamarse' }),
    leerFinal
  }
  const archivo = await leerContextoDeSesion(sesion, deps)
  check('archivo relativo al proyecto, JSON Lines: la última línea (50 %)', archivo.ok && archivo.percent === 50, JSON.stringify(archivo))
  const script = `process.stdout.write(JSON.stringify({ctx:{usado:750,max:1000},cwd:process.cwd()}))`
  const comando = await leerContextoDeSesion({ ...sesion, fuente: { ...fuente, origen: 'comando', valor: `${NODE} -e ${citar(script)}` } }, deps)
  check('comando en la shell nativa: 75 %', comando.ok && comando.percent === 75, JSON.stringify(comando))
  const falla = await leerContextoDeSesion({ ...sesion, fuente: { ...fuente, origen: 'comando', valor: 'tessera-no-existe-xyz' } }, deps)
  check('un comando que no existe: error, no excepción', !falla.ok, JSON.stringify(falla))
  const sinArchivo = await leerContextoDeSesion({ ...sesion, fuente: { ...fuente, valor: 'no-existe.json' } }, deps)
  check('un archivo que no existe: error, no excepción', !sinArchivo.ok, JSON.stringify(sinArchivo))
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-ctx-manual-'))
try {
  contenedor()
  rutas()
  await deVerdad(dir)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
