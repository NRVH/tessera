// =============================================================================
// El servicio de configuración de un agente contra carpetas temporales: qué archivos toca, cómo
// valida, cómo protege un cambio ajeno y que un enlace plantado desde el contenedor no recibe nada.
// Sin Electron: el servicio recibe por parámetro de dónde sale cada carpeta.
// =============================================================================

import { crearCarpetaTemporal } from '../../../../scripts/pruebas/temporales.mts'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { MAX_BYTES_CONFIG_AGENTE, type RefConfigAgente } from '../../../shared/configAgente-ipc.ts'
import { esWindows } from '../../../shared/plataforma.ts'
import { ServicioConfigAgente } from './ServicioConfigAgente.ts'

let pasan = 0
let total = 0
function check(nombre: string, ok: boolean): void {
  total++
  if (ok) pasan++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}`)
}
function hr(titulo: string): void {
  console.log(`\n--- ${titulo} ---`)
}

const raiz = crearCarpetaTemporal(join(os.tmpdir(), 'tessera-config-agente-'))
const carpeta = join(raiz, 'cuenta')
const secreto = join(raiz, 'secreto.txt')
writeFileSync(secreto, 'NO-TOCAR')

const codex: RefConfigAgente = { agente: 'codex', cuentaId: 'c1' }
const claude: RefConfigAgente = { agente: 'claude-code', cuentaId: 'c1' }
const servicio = new ServicioConfigAgente({
  carpetaDe: (ref) => (ref.cuentaId === 'no-existe' ? null : carpeta),
  sesionesAbiertas: () => 2
})

try {
  hr('leer')
  const vacia = await servicio.leer(codex)
  check('sin archivos, los dos vacíos y sin versión', vacia?.archivos.configuracion.version === null && vacia?.archivos.instrucciones.contenido === '')
  check('nombra config.toml y AGENTS.md en Codex', vacia?.archivos.configuracion.nombre === 'config.toml' && vacia?.archivos.instrucciones.nombre === 'AGENTS.md')
  check('cuenta las sesiones abiertas', vacia?.sesionesAbiertas === 2)
  check('leer no crea la carpeta', !existsSync(carpeta))
  const lClaude = await servicio.leer(claude)
  check('nombra settings.json y CLAUDE.md en Claude Code', lClaude?.archivos.configuracion.nombre === 'settings.json' && lClaude?.archivos.instrucciones.nombre === 'CLAUDE.md')
  check('una cuenta que no existe da null', (await servicio.leer({ agente: 'codex', cuentaId: 'no-existe' })) === null)
  check('un agente manual no se atiende', (await servicio.leer({ agente: 'm-propio', cuentaId: 'c1' })) === null)

  hr('guardar y validar')
  const primero = await servicio.guardar({ ref: codex, tipo: 'configuracion', contenido: 'model = "x"\n', versionLeida: null })
  if (!esWindows()) check('un archivo nuevo solo lo lee quien lo crea', (statSync(join(carpeta, 'config.toml')).mode & 0o777) === 0o600)
  check('crea el archivo que no existe',primero.estado === 'guardado' && readFileSync(join(carpeta, 'config.toml'), 'utf8') === 'model = "x"\n')
  check('el primer guardado no deja versión anterior', primero.estado === 'guardado' && !primero.archivo.hayAnterior)
  const version = primero.estado === 'guardado' ? primero.archivo.version : null

  const malToml = await servicio.guardar({ ref: codex, tipo: 'configuracion', contenido: 'a = 1\nb = = 2\n', versionLeida: version })
  check('TOML inválido: indica la línea', malToml.estado === 'sintaxis' && malToml.linea === 2)
  check('TOML inválido: el archivo no cambia', readFileSync(join(carpeta, 'config.toml'), 'utf8') === 'model = "x"\n')
  const malJson = await servicio.guardar({ ref: claude, tipo: 'configuracion', contenido: '{\n  "a": 1,\n}\n', versionLeida: null })
  check('JSON inválido: indica la línea', malJson.estado === 'sintaxis' && malJson.linea === 3)
  const raizJson = await servicio.guardar({ ref: claude, tipo: 'configuracion', contenido: '[]', versionLeida: null })
  check('JSON sin objeto en la raíz: se rechaza', raizJson.estado === 'raiz-json')
  check('las instrucciones no se validan', (await servicio.guardar({ ref: claude, tipo: 'instrucciones', contenido: 'b = = {', versionLeida: null })).estado === 'guardado')
  const grande = await servicio.guardar({ ref: codex, tipo: 'instrucciones', contenido: 'x'.repeat(MAX_BYTES_CONFIG_AGENTE + 1), versionLeida: null })
  check('demasiado grande: se rechaza', grande.estado === 'demasiado-grande')

  hr('no pisar y versión anterior')
  writeFileSync(join(carpeta, 'config.toml'), 'model = "del-agente"\n[projects."/w"]\ntrust_level = "trusted"\n')
  const pisar = await servicio.guardar({ ref: codex, tipo: 'configuracion', contenido: 'model = "mio"\n', versionLeida: version })
  check('un cambio ajeno no se pisa', pisar.estado === 'cambio-externo' && readFileSync(join(carpeta, 'config.toml'), 'utf8').includes('del-agente'))
  const forzado = await servicio.guardar({ ref: codex, tipo: 'configuracion', contenido: 'model = "mio"\n', versionLeida: version, sobrescribir: true })
  check('sobrescribir sí guarda', forzado.estado === 'guardado' && readFileSync(join(carpeta, 'config.toml'), 'utf8') === 'model = "mio"\n')
  check('marca que hay versión anterior', forzado.estado === 'guardado' && forzado.archivo.hayAnterior)
  check('la versión anterior es lo que había', (await servicio.leerAnterior(codex, 'configuracion'))?.includes('del-agente') === true)
  check('sobrescribir conserva lo que escribió el agente solo en la anterior', !readFileSync(join(carpeta, 'config.toml'), 'utf8').includes('projects'))
  check('sin temporales al terminar', !readdirSync(carpeta).some((n) => n.endsWith('.tmp')))

  hr('avisos')
  const aviso = await servicio.guardar({ ref: codex, tipo: 'instrucciones', contenido: 'developer_instructions = "x"', versionLeida: null })
  check('el texto de las instrucciones no avisa', aviso.estado === 'guardado' && aviso.archivo.avisos.length === 0)
  const v = (await servicio.leer(codex))?.archivos.configuracion.version ?? null
  const conClave = await servicio.guardar({ ref: codex, tipo: 'configuracion', contenido: 'developer_instructions = "x"\n', versionLeida: v })
  check('developer_instructions avisa', conClave.estado === 'guardado' && conClave.archivo.avisos.includes('developer-instructions'))

  hr('texto que no es UTF-8')
  const carpetaLatin = join(raiz, 'latin')
  const conLatin = new ServicioConfigAgente({ carpetaDe: () => carpetaLatin, sesionesAbiertas: () => 0 })
  mkdirSync(carpetaLatin)
  const bytes = Buffer.from('caf\xe9', 'latin1')
  writeFileSync(join(carpetaLatin, 'AGENTS.md'), bytes)
  const leidoLatin = await conLatin.leer(codex)
  check('no se abre', leidoLatin?.archivos.instrucciones.bloqueo === 'no-utf8' && leidoLatin.archivos.instrucciones.contenido === '')
  const guardadoLatin = await conLatin.guardar({ ref: codex, tipo: 'instrucciones', contenido: 'otro', versionLeida: null, sobrescribir: true })
  check('no se sobrescribe y los bytes siguen intactos', guardadoLatin.estado === 'no-utf8' && readFileSync(join(carpetaLatin, 'AGENTS.md')).equals(bytes))

  hr('permisos')
  if (process.platform !== 'win32') {
    const ruta = join(carpeta, 'settings.json')
    writeFileSync(ruta, '{}', { mode: 0o600 })
    const vp = (await servicio.leer(claude))?.archivos.configuracion.version ?? null
    await servicio.guardar({ ref: claude, tipo: 'configuracion', contenido: '{"a":1}', versionLeida: vp })
    check('conserva los permisos', (statSync(ruta).mode & 0o777) === 0o600)
  } else {
    console.log('PLATAFORMA: en Windows no aplican los permisos POSIX')
  }

  hr('enlaces plantados')
  let hayEnlaces = true
  const carpetaEnlace = join(raiz, 'enlaces')
  const conEnlaces = new ServicioConfigAgente({ carpetaDe: () => carpetaEnlace, sesionesAbiertas: () => 0 })
  mkdirSync(carpetaEnlace)
  try {
    symlinkSync(secreto, join(carpetaEnlace, 'config.toml'))
    symlinkSync(secreto, join(carpetaEnlace, 'AGENTS.md.tessera-anterior'))
  } catch {
    hayEnlaces = false
    console.log('PLATAFORMA: este usuario no puede crear enlaces simbólicos; se comprueba en Linux y macOS')
  }
  if (hayEnlaces) {
    const leido = await conEnlaces.leer(codex)
    check('un enlace no se lee', leido?.archivos.configuracion.bloqueo === 'no-regular' && leido.archivos.configuracion.contenido === '')
    const escrito = await conEnlaces.guardar({ ref: codex, tipo: 'configuracion', contenido: 'a = 1', versionLeida: null })
    check('un enlace no se escribe', escrito.estado === 'no-regular' && readFileSync(secreto, 'utf8') === 'NO-TOCAR')
    writeFileSync(join(carpetaEnlace, 'AGENTS.md'), 'antes')
    const versionInstrucciones = (await conEnlaces.leer(codex))?.archivos.instrucciones.version ?? null
    const conAnterior = await conEnlaces.guardar({ ref: codex, tipo: 'instrucciones', contenido: 'despues', versionLeida: versionInstrucciones })
    check('la copia anterior sustituye al enlace en vez de seguirlo', conAnterior.estado === 'guardado' && readFileSync(secreto, 'utf8') === 'NO-TOCAR')

    // La nativa: el enlace es del usuario, y se edita su destino sin romperlo.
    const real = join(raiz, 'dotfiles-CLAUDE.md')
    const carpetaNativa = join(raiz, 'nativa')
    mkdirSync(carpetaNativa)
    writeFileSync(real, 'mis notas')
    symlinkSync(real, join(carpetaNativa, 'CLAUDE.md'))
    const nativa = new ServicioConfigAgente({ carpetaDe: () => carpetaNativa, sesionesAbiertas: () => 0 })
    const refNativa: RefConfigAgente = { agente: 'claude-code', cuentaId: null }
    const lNativa = await nativa.leer(refNativa)
    check('en la nativa, un enlace se abre', lNativa?.archivos.instrucciones.contenido === 'mis notas' && lNativa.archivos.instrucciones.bloqueo === null)
    await nativa.guardar({ ref: refNativa, tipo: 'instrucciones', contenido: 'editadas', versionLeida: lNativa?.archivos.instrucciones.version ?? null })
    check('en la nativa, guardar escribe el destino y conserva el enlace', readFileSync(real, 'utf8') === 'editadas' && lstatSync(join(carpetaNativa, 'CLAUDE.md')).isSymbolicLink())
  }
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

console.log(`\nVEREDICTO: ${pasan}/${total} PASS`)
process.exit(pasan === total ? 0 : 1)
