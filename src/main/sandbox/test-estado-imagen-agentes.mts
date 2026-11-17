#!/usr/bin/env node
// =============================================================================
// Prueba de las versiones de la imagen de Docker y de su actualización (npm run test:estado-imagen-agentes): la lectura
// se guarda por imagen, con Docker apagado no se ejecuta nada, y actualizar no detiene nada hasta tener la imagen nueva.
// Decisiones: docs/decisiones/sandbox/imagen-y-extras.md
// =============================================================================
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actualizarImagenAgentes } from './actualizarImagenAgentes.ts'
import { crearRegistroLecturaImagen, leerEstadoAgentesDocker, type DependenciasEstadoImagen, type LecturaImagen } from './estadoImagenAgentes.ts'

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

function banco(ajustes: Partial<DependenciasEstadoImagen> = {}, inicial: LecturaImagen | null = null): { deps: DependenciasEstadoImagen; lecturas: () => number; guardada: () => LecturaImagen | null } {
  let lecturas = 0
  let guardada = inicial
  const deps: DependenciasEstadoImagen = {
    dockerActivo: async () => true,
    idImagen: async () => 'sha:1',
    versionesImagen: async () => {
      lecturas++
      return { claude: '2.1.318 (Claude Code)', codex: 'codex-cli 0.167.0' }
    },
    ultimas: async () => ({ claude: '2.1.321', codex: '0.167.0' }),
    uso: () => ({ cuentas: 3, perfiles: 2, sesiones: [], tareas: [], conCapas: false, extrasVetados: false }),
    registro: { leer: () => guardada, escribir: (l) => { guardada = l } },
    ahora: () => 1000,
    ...ajustes
  }
  return { deps, lecturas: () => lecturas, guardada: () => guardada }
}

async function probarEstado(): Promise<void> {
  hr('Versiones de la imagen')
  const b = banco()
  const e = await leerEstadoAgentesDocker(b.deps)
  check('lee la versión de la salida real de cada CLI y detecta la nueva', e.claude.instalada === '2.1.318' && e.claude.hayNueva && e.codex.instalada === '0.167.0' && !e.codex.hayNueva, e)
  await leerEstadoAgentesDocker(b.deps)
  check('con la misma imagen no vuelve a ejecutarla', b.lecturas() === 1, b.lecturas())
  await leerEstadoAgentesDocker({ ...b.deps, idImagen: async () => 'sha:2' })
  check('una imagen nueva se vuelve a leer', b.lecturas() === 2 && b.guardada()?.idImagen === 'sha:2', b.guardada())
  const previa = { idImagen: 'sha:1', claude: '2.1.300', codex: '0.160.0', en: 500 }
  let tocada = false
  const apagado = banco({ dockerActivo: async () => false, idImagen: async () => { tocada = true; return null } }, previa)
  const ea = await leerEstadoAgentesDocker(apagado.deps)
  check('NEGATIVO: con Docker apagado usa la última lectura sin tocar Docker', !ea.dockerActivo && ea.claude.instalada === '2.1.300' && ea.leidoEn === 500 && !tocada && apagado.lecturas() === 0, ea)
  const sinRed = await leerEstadoAgentesDocker(banco({ ultimas: async () => { throw new Error('sin red') } }).deps)
  check('sin red no se afirma ninguna versión nueva', sinRed.claude.ultima === null && !sinRed.claude.hayNueva && sinRed.claude.instalada === '2.1.318', sinRed.claude)
  const sinImagen = await leerEstadoAgentesDocker(banco({ idImagen: async () => null }, previa).deps)
  check('sin imagen no presume versiones de una imagen que ya no existe', sinImagen.claude.instalada === null && sinImagen.leidoEn === null, sinImagen.claude)
  const rara = banco({ versionesImagen: async () => ({ claude: 'error', codex: '?' }) })
  const er = await leerEstadoAgentesDocker(rara.deps)
  check('NEGATIVO: una salida sin versión no se guarda', er.claude.instalada === null && rara.guardada() === null, er.claude)
  const raiz = mkdtempSync(join(tmpdir(), 'estado-imagen-'))
  try {
    const ruta = join(raiz, 'lectura.json')
    const reg = crearRegistroLecturaImagen(ruta)
    reg.escribir(previa)
    check('la lectura sobrevive en disco', JSON.stringify(reg.leer()) === JSON.stringify(previa), reg.leer())
    writeFileSync(ruta, '{"idImagen":"x","claude":"$(id)","codex":"1.0.0","en":1}')
    check('NEGATIVO: una lectura con otra forma se ignora', reg.leer() === null, 'forma')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

async function probarActualizar(): Promise<void> {
  hr('Actualizar')
  type S = Parameters<typeof actualizarImagenAgentes>[0]
  const hechos: string[] = []
  const sandbox = (cambios: Partial<S> = {}): S => ({
    asegurarDocker: async () => {
      hechos.push('docker')
      return { ok: true, detalle: '' }
    },
    reconstruirImagen: async () => {
      hechos.push('imagen')
    },
    leerVersionesImagenAgentes: async () => ({ codex: 'c', claude: 'a' }),
    detenerTodosLosContenedores: async () => {
      hechos.push('parar')
      return 0
    },
    ...cambios
  })
  const parar = async (): Promise<void> => {
    hechos.push('tareas')
  }
  const ok = await actualizarImagenAgentes(sandbox(), () => undefined, parar)
  check('orden: Docker, imagen, tareas y contenedores', ok.ok && hechos.join() === 'docker,imagen,tareas,parar', hechos)
  hechos.length = 0
  const sinImagen = await actualizarImagenAgentes(sandbox({ reconstruirImagen: async () => { throw new Error('sin espacio') } }), () => undefined, parar)
  check('NEGATIVO: si la imagen falla no se detiene nada', !sinImagen.ok && sinImagen.error === 'sin espacio' && !hechos.includes('parar') && !hechos.includes('tareas'), hechos)
  hechos.length = 0
  const sinDocker = await actualizarImagenAgentes(sandbox({ asegurarDocker: async () => ({ ok: false, detalle: 'No arrancó.\nQué verificar' }) }), () => undefined, parar)
  check('si Docker no arranca, lo dice y no reconstruye nada', !sinDocker.ok && sinDocker.error === 'No arrancó.' && hechos.length === 0, sinDocker)
}

async function main(): Promise<void> {
  await probarEstado()
  await probarActualizar()
  const pasan = resultados.filter(Boolean).length
  hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${pasan === resultados.length ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(pasan === resultados.length ? 0 : 1)
}

void main()
