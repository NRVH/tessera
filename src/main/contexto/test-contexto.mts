// =============================================================================
// Prueba del contexto de los agentes (npm run test:contexto): cómo se combinan el global y el del perfil (con
// y sin el global, documentos sin repetir), lo que se acepta de fuera, el almacén en disco (normaliza, no
// escribe si no cambia, avisa, rechaza lo que pasa del tope y recupera un archivo roto de su respaldo) y el modelo
// del diálogo (secciones por nivel, sección inicial, identidad de los niveles y el archivo que edita cada uno).
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { contextoEfectivo, leerContextoGlobal } from '../../shared/contexto.ts'
import { MAX_REGLAS_PERFIL, reglasCercaDelTope, UMBRAL_AVISO_REGLAS } from '../../shared/reglasPerfil.ts'
import { refConfig, type RefConfigAgente } from '../../shared/configAgente-ipc.ts'
import { claveNivel, largoReglas, mismoNivel, nivelDelRiel, perfilDelNivel, refConfiguracion, seccionesDe, seccionInicial, type NivelContexto } from '../../renderer/src/features/agentes/contexto/modeloContexto.ts'
import { AlmacenContextoGlobal } from './contextoGlobal.ts'

let pasan = 0
let total = 0
function check(nombre: string, ok: boolean, evidencia = ''): void {
  total++
  if (ok) pasan++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}${evidencia ? ` -> ${evidencia}` : ''}`)
}
function hr(titulo: string): void {
  console.log(`\n--- ${titulo} ---`)
}
const j = (v: unknown): string => JSON.stringify(v)

const raiz = mkdtempSync(join(os.tmpdir(), 'tessera-contexto-'))
try {
  hr('contexto efectivo')
  const global = { reglas: 'Responde en español.', documentos: ['E:/Guias', 'E:/Comun'] }
  const c = contextoEfectivo({ reglas: 'Rama de trabajo.', documentos: ['E:/Proyecto', 'e:/guias'] }, global)
  check('un perfil recibe las reglas globales y las suyas por separado', c.usaGlobal && c.reglasGlobales === global.reglas && c.reglasPerfil === 'Rama de trabajo.')
  check('los documentos: primero los globales y sin repetir', j(c.documentos) === j(['E:/Guias', 'E:/Comun', 'E:/Proyecto']), j(c.documentos))
  const sin = contextoEfectivo({ reglas: 'Propia.', documentos: ['E:/Proyecto'], contextoGlobal: false }, global)
  check('sin el global, solo lo del perfil', !sin.usaGlobal && sin.reglasGlobales === '' && j(sin.documentos) === j(['E:/Proyecto']))
  check('un perfil sin nada propio recibe el global', j(contextoEfectivo({}, global).documentos) === j(global.documentos) && contextoEfectivo({}, global).reglasPerfil === '')
  check('el tamaño suma los dos niveles', largoReglas(c) === global.reglas.length + 'Rama de trabajo.'.length)

  hr('lo que se acepta de fuera')
  check('NEGATIVO: lo que no tiene forma, vacío', j(leerContextoGlobal(null)) === j({ reglas: '', documentos: [] }) && j(leerContextoGlobal({ reglas: 5, documentos: 'x' })) === j({ reglas: '', documentos: [] }))
  check('las reglas se normalizan', leerContextoGlobal({ reglas: '\n\nUna\r\nDos  \n' }).reglas === 'Una\nDos')
  check('NEGATIVO: unas reglas que pasan del tope no entran', leerContextoGlobal({ reglas: 'x'.repeat(MAX_REGLAS_PERFIL + 1) }).reglas === '')
  check(
    'el aviso de tamaño salta al 80 % y no cuando ya pasó del tope (entonces manda el error)',
    !reglasCercaDelTope(UMBRAL_AVISO_REGLAS) && reglasCercaDelTope(UMBRAL_AVISO_REGLAS + 1) && reglasCercaDelTope(MAX_REGLAS_PERFIL) && !reglasCercaDelTope(MAX_REGLAS_PERFIL + 1) && UMBRAL_AVISO_REGLAS === 4800
  )
  check('las carpetas, sin vacías ni repetidas', j(leerContextoGlobal({ documentos: ['  ', 'E:/A', 'e:/a', 3] }).documentos) === j(['E:/A']))

  hr('el almacén')
  const ruta = join(raiz, 'contexto-global.json')
  const avisos: unknown[] = []
  const a = new AlmacenContextoGlobal({ ruta })
  a.alCambiar((x) => avisos.push(x))
  check('sin archivo, vacío', j(a.leer()) === j({ reglas: '', documentos: [] }))
  const guardado = a.guardar({ reglas: 'Una regla.  ', documentos: ['E:/A'] })
  check('guarda lo normalizado, lo escribe y avisa', guardado.reglas === 'Una regla.' && existsSync(ruta) && avisos.length === 1)
  a.guardar({ reglas: 'Una regla.', documentos: ['E:/A'] })
  check('lo mismo otra vez no escribe ni avisa', avisos.length === 1)
  a.guardar({ documentos: ['E:/B'] })
  check('guardar solo los documentos no vacía las reglas', a.leer().reglas === 'Una regla.' && j(a.leer().documentos) === j(['E:/B']))
  a.guardar({ reglas: 'Otra.' })
  check('y guardar solo las reglas no vacía los documentos', j(a.leer()) === j({ reglas: 'Otra.', documentos: ['E:/B'] }))
  a.guardar({ reglas: 'Una regla.', documentos: ['E:/A'] })
  check('se lee de disco al crearlo', j(new AlmacenContextoGlobal({ ruta }).leer()) === j(a.leer()))
  let rechazo = ''
  try {
    a.guardar({ reglas: 'x'.repeat(MAX_REGLAS_PERFIL + 1) })
  } catch (err) {
    rechazo = String(err)
  }
  check('NEGATIVO: guardar unas reglas que pasan del tope se rechaza y no las vacía', rechazo !== '' && a.leer().reglas === 'Una regla.', rechazo)
  const respaldo = readFileSync(`${ruta}.bak`, 'utf8')
  writeFileSync(ruta, '{ roto')
  const registros: string[] = []
  const recuperado = new AlmacenContextoGlobal({ ruta, log: (m) => registros.push(m) }).leer()
  check('un archivo roto se recupera del respaldo y lo registra', j(recuperado) === j(leerContextoGlobal(JSON.parse(respaldo))) && recuperado.reglas !== '' && registros.length === 2, j(recuperado))
  check('y no se pisa hasta que se guarde', readFileSync(ruta, 'utf8') === '{ roto')
  rmSync(`${ruta}.bak`)
  check('NEGATIVO: sin respaldo, un archivo roto no tumba nada: queda vacío', j(new AlmacenContextoGlobal({ ruta }).leer()) === j({ reglas: '', documentos: [] }))

  hr('el modelo del diálogo')
  check('el global: reglas, documentos y Docker', j(seccionesDe({ tipo: 'global' })) === j(['reglas', 'documentos', 'docker']))
  check('un perfil, las mismas: lo que recibe un agente es una vista previa, no una sección', j(seccionesDe({ tipo: 'perfil', perfilId: 'p' })) === j(['reglas', 'documentos', 'docker']))
  check('una cuenta y el equipo solo tienen sus archivos', seccionesDe({ tipo: 'equipo', agente: 'codex' }).length === 0 && seccionInicial({ tipo: 'equipo', agente: 'codex' }) === null)
  check('la sección pedida si el nivel la tiene; si no, la primera', seccionInicial({ tipo: 'perfil', perfilId: 'p' }, 'docker') === 'docker' && seccionInicial({ tipo: 'equipo', agente: 'codex' }, 'docker') === null)
  check('cada nivel tiene su identidad', claveNivel({ tipo: 'perfil', perfilId: 'p' }) !== claveNivel({ tipo: 'global' }) && mismoNivel({ tipo: 'equipo', agente: 'codex' }, { tipo: 'equipo', agente: 'codex' }) && !mismoNivel({ tipo: 'equipo', agente: 'codex' }, { tipo: 'equipo', agente: 'claude-code' }))
  check('el global y el perfil editan su capa; la cuenta y el equipo, sus archivos', j(refConfiguracion({ tipo: 'global' }, 'codex')) === j({ agente: 'codex', cuentaId: null, capa: { tipo: 'global' } }) && j(refConfiguracion({ tipo: 'perfil', perfilId: 'p' }, 'claude-code').capa) === j({ tipo: 'perfil', perfilId: 'p' }) && j(refConfiguracion({ tipo: 'cuenta', perfilId: 'p', agente: 'codex', cuentaId: 'c1' }, 'claude-code')) === j({ agente: 'codex', cuentaId: 'c1' }) && j(refConfiguracion({ tipo: 'equipo', agente: 'codex' }, 'claude-code')) === j({ agente: 'codex', cuentaId: null }))
  const cuenta: NivelContexto = { tipo: 'cuenta', perfilId: 'p', agente: 'codex', cuentaId: 'c1' }
  check(
    'una cuenta es un ámbito de su perfil: se ve en Docker, con las pestañas del perfil, y el riel marca el perfil',
    seccionInicial(cuenta, 'reglas') === 'docker' && j(seccionesDe(cuenta)) === j(seccionesDe({ tipo: 'perfil', perfilId: 'p' })) && j(nivelDelRiel(cuenta)) === j({ tipo: 'perfil', perfilId: 'p' }) && perfilDelNivel(cuenta) === 'p' && perfilDelNivel({ tipo: 'equipo', agente: 'codex' }) === null
  )
  // El editor rehace la referencia de sus partes: si pierde la capa, el main entiende la carpeta nativa.
  const niveles: NivelContexto[] = [{ tipo: 'global' }, { tipo: 'perfil', perfilId: 'p' }, { tipo: 'cuenta', perfilId: 'p', agente: 'codex', cuentaId: 'c1' }, { tipo: 'equipo', agente: 'codex' }]
  const rehecha = (r: RefConfigAgente): RefConfigAgente => refConfig(r.agente, r.cuentaId, r.capa?.tipo ?? null, r.capa?.tipo === 'perfil' ? r.capa.perfilId : null)
  check('NEGATIVO: rehacer la referencia de cada nivel conserva su capa', niveles.every((n) => j(rehecha(refConfiguracion(n, 'codex'))) === j(refConfiguracion(n, 'codex'))))
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

console.log(`\nVEREDICTO: ${pasan}/${total} PASS`)
process.exit(pasan === total ? 0 : 1)
