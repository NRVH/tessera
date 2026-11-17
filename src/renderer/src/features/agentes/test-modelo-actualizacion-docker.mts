#!/usr/bin/env node
// =============================================================================
// Prueba de la sección de Docker del actualizador (npm run test:actualizacion-docker): cuándo hay novedades, cuándo hay
// que confirmar y qué dice cada acción.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================
import type { EstadoAgentesDocker } from '../../../../shared/agents-update-ipc.ts'
import { anadirConTope, dockerAlDia, entradaBotonDocker, hayNovedadesDocker, necesitaConfirmar, nombreSesionDocker, seccionDockerVisible, textoAccionDocker, textoAccionTodo, textoConfirmar } from './modeloActualizacionDocker.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: unknown): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${JSON.stringify(evidencia)}`)
}

const alDia = { instalada: '1.0.0', ultima: '1.0.0', hayNueva: false }
const nueva = { instalada: '1.0.0', ultima: '1.1.0', hayNueva: true }
const base: EstadoAgentesDocker = { cuentas: 2, perfiles: 1, dockerActivo: true, claude: alDia, codex: alDia, leidoEn: 1, sesiones: [], tareas: [], conCapas: false, extrasVetados: false }
const sesion = (extra = {}): EstadoAgentesDocker['sesiones'][number] => ({ sesionId: 's', perfilId: 'p', rutaHostProyecto: '/r/api', nombreAgente: 'Codex', trabajando: false, esperandoRespuesta: false, ...extra })
const tarea = { id: 't', cuenta: 'C', resumen: 'Revise' }

hr('Novedades')
check('sin cuentas no hay sección', !seccionDockerVisible({ ...base, cuentas: 0 }) && !seccionDockerVisible(null), 'sin cuentas')
check('sin cuentas tampoco hay novedades', !hayNovedadesDocker({ ...base, cuentas: 0, claude: nueva }), 'sin cuentas')
check('una versión nueva es una novedad', hayNovedadesDocker({ ...base, codex: nueva }), 'nueva')
check('todo conocido e igual: al día', dockerAlDia(base), base.claude)
check('NEGATIVO: con paquetes que no entraron en la imagen sigue habiendo qué reconstruir', !dockerAlDia({ ...base, extrasVetados: true }), 'vetados')
check('NEGATIVO: sin saber lo instalado no se afirma que esté al día', !dockerAlDia({ ...base, claude: { instalada: null, ultima: '1.0.0', hayNueva: false } }), 'sin instalada')
check('NEGATIVO: sin saber lo publicado no se afirma que esté al día', !dockerAlDia({ ...base, codex: { instalada: '1.0.0', ultima: null, hayNueva: false } }), 'sin ultima')

hr('Confirmación')
check('sesiones inactivas: se reinician solas', !necesitaConfirmar({ ...base, sesiones: [sesion()] }), 'inactiva')
check('una sesión trabajando pide confirmar', necesitaConfirmar({ ...base, sesiones: [sesion({ trabajando: true })] }), 'trabajando')
check('una que espera respuesta pide confirmar', necesitaConfirmar({ ...base, sesiones: [sesion({ esperandoRespuesta: true })] }), 'espera')
check('una tarea en marcha pide confirmar', necesitaConfirmar({ ...base, tareas: [tarea] }), 'tarea')
const enUso = { ...base, sesiones: [sesion(), sesion()], tareas: [tarea] }
check('el botón dice qué detiene', textoConfirmar(enUso, 'docker') === 'Detener 2 agentes y 1 tarea, y actualizar', textoConfirmar(enUso, 'docker'))
check('actualizar todo también lo dice', textoConfirmar(enUso, 'todo') === 'Detener 2 agentes y 1 tarea, y actualizar todo', textoConfirmar(enUso, 'todo'))
const soloTarea = textoConfirmar({ ...base, tareas: [tarea] }, 'docker')
check('solo con tareas no nombra agentes', soloTarea === 'Detener 1 tarea, y actualizar', soloTarea)

hr('Rótulos')
const apagado = { ...base, dockerActivo: false }
check('con Docker encendido', textoAccionDocker(base) === 'Actualizar Docker' && textoAccionTodo(base) === 'Actualizar todo', textoAccionTodo(base))
check('con Docker apagado se avisa de que lo enciende', textoAccionDocker(apagado) === 'Iniciar Docker y actualizar' && textoAccionTodo(apagado) === 'Actualizar todo e iniciar Docker', textoAccionTodo(apagado))
const info = { perfiles: new Map([['p', { nombre: 'Trabajo', color: null }]]), nombresProyecto: {} }
check('nombre de sesión: perfil, carpeta y agente', nombreSesionDocker(sesion(), info) === 'Trabajo · api · Codex', nombreSesionDocker(sesion(), info))
const conNombre = { ...info, nombresProyecto: { 'p|/r/api': 'API' } }
check('con nombre de proyecto, lo usa', nombreSesionDocker(sesion(), conNombre) === 'Trabajo · API · Codex', nombreSesionDocker(sesion(), conNombre))

hr('Botón y salida')
check('corriendo y novedades se reportan al botón', JSON.stringify(entradaBotonDocker({ ...base, claude: nueva }, true, null, true)) === JSON.stringify({ novedades: true, corriendo: true, error: false, okSinVer: false }), 'entrada')
const fallo = { ok: false, error: 'x', actualizados: { claude: false, codex: false } }
check('un error permanece aunque se haya visto', entradaBotonDocker(base, false, fallo, true).error, 'error')
const bien = { ...fallo, ok: true }
check('un resultado bueno se retira al verlo', entradaBotonDocker(base, false, bien, false).okSinVer && !entradaBotonDocker(base, false, bien, true).okSinVer, 'ok')
const largas = Array.from({ length: 600 }).reduce<string[]>((a, _, i) => anadirConTope(a, String(i)), [])
check('la salida del build no crece sin tope', largas.length === 500 && largas.at(-1) === '599', largas.length)

const pasan = resultados.filter(Boolean).length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${pasan === resultados.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(pasan === resultados.length ? 0 : 1)
