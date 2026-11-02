// =============================================================================
// Pruebas de lo puro del historial en la copia: qué entra (una carpeta de cuenta con credenciales, ajustes,
// instantáneas, cachés y enlaces solo aporta sus conversaciones), la guarda de rutas al importar, cómo se
// empareja un proyecto por el nombre de su carpeta y la regla de no pisar.
// Uso: node src/main/configuracion/test-historial-copia.mts
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { conCarpeta, destinoProyecto } from './emparejarProyectos.ts'
import { accionImportar, rutaDentro } from './historialCopia.ts'
import { esConversacion, esPrincipal, listarConCache, listarConversaciones } from './inclusionHistorial.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const TMP = mkdtempSync(path.join(os.tmpdir(), 'tessera-prueba-historial-'))

function archivo(base: string, rel: string, texto = '{}\n'): void {
  const abs = path.join(base, ...rel.split('/'))
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, texto)
}

/** Un enlace a una carpeta (una unión en Windows, que no pide permisos) o a un archivo; false si el sistema no deja. */
function enlace(destino: string, ruta: string, tipo: 'dir' | 'file'): boolean {
  try {
    mkdirSync(path.dirname(ruta), { recursive: true })
    symlinkSync(destino, ruta, tipo === 'dir' ? 'junction' : 'file')
    return true
  } catch {
    return false
  }
}

async function inclusion(): Promise<void> {
  hr('(1) Qué entra: solo conversaciones, por lista de inclusión')
  const fuera = path.join(TMP, 'fuera')
  archivo(fuera, 'robado.jsonl', '{"secreto":1}\n')
  archivo(fuera, 'dir/robado.jsonl', '{"secreto":1}\n')
  const claude = path.join(TMP, 'claude')
  for (const rel of [
    '.credentials.json', 'settings.json', 'settings.local.json', '.claude.json', 'history.jsonl',
    'file-history/s1/abc@v1', 'file-history/s1/copia.jsonl', 'todos/s1.json', 'statsig/x', 'shell-snapshots/a.sh',
    'projects/-ejemplo/notas.txt', 'projects/-ejemplo/s1/tool-results/r.jsonl', 'projects/-ejemplo/s1.jsonl.bak',
    'projects/-ejemplo/s1.jsonl', 'projects/-ejemplo/s1/subagents/agent-a.jsonl', 'projects/-ejemplo/s1/subagents/x/agent-b.jsonl',
    'projects/-otro/s2.jsonl'
  ]) archivo(claude, rel)
  const conEnlaceDir = enlace(path.join(fuera, 'dir'), path.join(claude, 'projects', '-enlazado'), 'dir')
  const conEnlaceArchivo = enlace(path.join(fuera, 'robado.jsonl'), path.join(claude, 'projects', '-ejemplo', 'enlace.jsonl'), 'file')
  const deClaude = (await listarConversaciones('claude-code', claude)).map((a) => a.rel)
  const esperado = ['projects/-ejemplo/s1.jsonl', 'projects/-ejemplo/s1/subagents/agent-a.jsonl', 'projects/-ejemplo/s1/subagents/x/agent-b.jsonl', 'projects/-otro/s2.jsonl']
  check('Claude Code: solo los transcripts y los de sus subagentes', JSON.stringify(deClaude) === JSON.stringify(esperado), deClaude.join(', '))
  check(`ni credenciales, ni ajustes, ni file-history, ni enlaces (carpeta ${conEnlaceDir ? 'sí' : 'no'} creada, archivo ${conEnlaceArchivo ? 'sí' : 'no'})`,
    !deClaude.some((r) => /credentials|settings|file-history|enlace|robado|tool-results|history\.jsonl/.test(r)), '')
  const codex = path.join(TMP, 'codex')
  for (const rel of [
    'auth.json', 'config.toml', 'history.jsonl', 'archived_sessions/rollout-viejo.jsonl', 'sessions/2026/01/02/notas.json',
    'sessions/2026/01/02/rollout-a.jsonl', 'sessions/2026/01/03/rollout-b.jsonl.zst', 'log/codex-tui.log'
  ]) archivo(codex, rel)
  const deCodex = (await listarConversaciones('codex', codex)).map((a) => a.rel)
  check('Codex: solo los rollouts de sessions, planos o comprimidos', JSON.stringify(deCodex) === JSON.stringify(['sessions/2026/01/02/rollout-a.jsonl', 'sessions/2026/01/03/rollout-b.jsonl.zst']), deCodex.join(', '))
  check('una cuenta sin carpeta no aporta nada', (await listarConversaciones('codex', path.join(TMP, 'no-existe'))).length === 0, '')
  let reloj = 0
  const listar = listarConCache(() => reloj)
  const primera = await listar('codex', codex)
  archivo(codex, 'sessions/2026/01/04/rollout-c.jsonl')
  const enCache = await listar('codex', codex)
  reloj += 60_000
  const caducada = await listar('codex', codex)
  check('la vista previa reutiliza la lista un rato y luego la rehace', enCache === primera && caducada.length === primera.length + 1, `${primera.length} → ${enCache.length} → ${caducada.length}`)
  check('se cuenta la conversación, no el hilo del subagente', esPrincipal('claude-code', 'projects/-a/s.jsonl') && !esPrincipal('claude-code', 'projects/-a/s/subagents/a.jsonl'), '')
}

function guarda(): void {
  hr('(2) La guarda al importar: el mismo criterio y nada fuera de la cuenta')
  const malas = [
    '.credentials.json', 'auth.json', 'settings.json', 'projects/../.credentials.json', 'projects/-a/../../x.jsonl', '../projects/-a/s.jsonl',
    'projects/-a/s.txt', 'projects/C:/s.jsonl', 'projects/-a\\..\\s.jsonl', 'projects//s.jsonl', 'projects/-a/s1/tool-results/r.jsonl',
    '/projects/-a/s.jsonl', 'projects/con/s.jsonl', 'projects/-a./s.jsonl', 'projects/-a/s.jsonl/'
  ]
  const aceptadas = malas.filter((r) => esConversacion('claude-code', r))
  check('NEGATIVO: ninguna ruta mala pasa por conversación de Claude Code', aceptadas.length === 0, aceptadas.join(', ') || `${malas.length} rechazadas`)
  const malasCodex = ['auth.json', 'sessions/../auth.json', 'sessions/rollout-a.json', 'archived_sessions/rollout-a.jsonl', 'sessions/x/../../rollout-a.jsonl']
  check('NEGATIVO: ni en Codex', malasCodex.every((r) => !esConversacion('codex', r)), '')
  const base = path.join(TMP, 'cuenta')
  const dentro = rutaDentro('claude-code', base, 'projects/-a/s.jsonl')
  check('una buena queda dentro de su cuenta', dentro !== null && dentro.startsWith(path.resolve(base) + path.sep), String(dentro))
  check('NEGATIVO: rutaDentro rechaza subir', rutaDentro('claude-code', base, 'projects/-a/../../../x.jsonl') === null, '')
}

function emparejar(): void {
  hr('(3) Proyectos en otra ruta: por el nombre de su carpeta, solo si hay uno')
  const aqui = ['D:\\nuevo\\tessera-demo', '/home/ana/otro', 'E:\\a\\repetido', 'E:\\b\\repetido']
  const c = destinoProyecto('C:\\origen\\tessera-demo', aqui)
  check('uno con el mismo nombre: la carpeta de la ruta de aquí', c.tipo === 'cambiada' && c.carpeta === 'D--nuevo-tessera-demo', JSON.stringify(c))
  const mac = destinoProyecto('/Users/ana/proyectos/Tessera-Demo', aqui)
  check('de otro sistema y sin distinguir mayúsculas', mac.tipo === 'cambiada' && mac.carpeta === 'D--nuevo-tessera-demo', JSON.stringify(mac))
  check('la misma ruta (aunque cambie la caja): se queda', destinoProyecto('d:/nuevo/tessera-demo', aqui).tipo === 'igual', '')
  check('la del contenedor vale en cualquier equipo: se queda', destinoProyecto('/workspace/tessera-demo', aqui).tipo === 'igual', '')
  check('sin cwd: se queda', destinoProyecto(null, aqui).tipo === 'igual', '')
  const ninguno = destinoProyecto('C:\\origen\\nadie', aqui)
  check('ninguno: se queda y se dice', ninguno.tipo === 'sinProyecto' && ninguno.nombre === 'nadie', JSON.stringify(ninguno))
  check('varios con ese nombre: se queda y se dice', destinoProyecto('C:\\x\\repetido', aqui).tipo === 'varios', '')
  const origenes = ['C:\\a\\tessera-demo', 'C:\\b\\Tessera-Demo', '/workspace/otro', 'C:\\c\\otro']
  check('NEGATIVO: dos de origen con el mismo nombre no se reasignan', destinoProyecto('C:\\a\\tessera-demo', aqui, origenes).tipo === 'variosOrigen' && destinoProyecto('C:\\b\\Tessera-Demo', aqui, origenes).tipo === 'variosOrigen', '')
  check('la misma de origen repetida (otra caja) cuenta como una', destinoProyecto('C:\\a\\tessera-demo', aqui, ['C:\\a\\tessera-demo', 'c:/a/tessera-demo']).tipo === 'cambiada', '')
  check('la del contenedor no compite con la del equipo', destinoProyecto('C:\\c\\otro', aqui, origenes).tipo === 'cambiada', '')
  check('el mismo proyecto abierto en dos perfiles cuenta como uno', destinoProyecto('C:\\x\\otro', ['/home/ana/otro', '/home/ana/otro']).tipo === 'cambiada', '')
  check('demasiado larga para Claude Code: se queda', destinoProyecto('C:\\x\\largo', [`D:\\${'a'.repeat(220)}\\largo`]).tipo === 'larga', '')
  check('la ruta cambia solo la carpeta del proyecto', conCarpeta('projects/C--origen-tessera-demo/s1/subagents/a.jsonl', 'D--nuevo') === 'projects/D--nuevo/s1/subagents/a.jsonl', '')
}

function noPisar(): void {
  hr('(4) No pisar')
  check('no está: se escribe', accionImportar('falta', false) === 'escribir', '')
  check('aquí está su principio: se pone al día', accionImportar('prefijo', false) === 'actualizar', '')
  check('igual: no se toca', accionImportar('igual', false) === 'alDia', '')
  check('aquí siguió más: no se toca', accionImportar('distinto', true) === 'alDia', '')
  check('otra cosa: se conserva la de aquí', accionImportar('distinto', false) === 'conservar', '')
}

try {
  await inclusion()
  guarda()
  emparejar()
  noPisar()
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

const pasan = resultados.filter((r) => r.pasa).length
console.log(`\nVEREDICTO: ${pasan}/${resultados.length} PASS`)
process.exit(pasan === resultados.length ? 0 : 1)
