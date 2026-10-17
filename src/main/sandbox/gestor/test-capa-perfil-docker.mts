// =============================================================================
// La capa de imagen por perfil contra un Docker de verdad (`capaPerfil.ts`): construir encima de
// una base, comprobar que el programa quedó en el PATH, avisar del que falta, fallar sin capa si
// una orden falla, no reconstruir con el mismo sello, recordar lo aplicado en su registro y borrar
// la imagen al olvidar el perfil. La base es una imagen ligera de Debian (su guion crea el usuario
// del sandbox); se baja si falta. Necesita Docker.
// Uso: node src/main/sandbox/gestor/test-capa-perfil-docker.mts
// =============================================================================

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CapaPerfilSandbox } from './capaPerfil.ts'
import { nombreImagenCapa, type InstalacionAgente } from '../../../shared/capaPerfil.ts'
import { runDocker } from '../adaptadores/docker.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { ImagenSandbox } from './imagen.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const BASE = 'debian:bookworm-slim'
const PERFIL = 'pruebas-capa'
/** El usuario del sandbox y un programa de prueba, como haría un `npm install -g`. */
const CREAR = ['useradd -m agente', "printf '#!/bin/sh\\necho eco\\n' > /usr/local/bin/eco-agente", 'chmod +x /usr/local/bin/eco-agente'].join('\n')
const ECO: InstalacionAgente = { id: 'm-eco', nombre: 'Eco', programa: 'eco-agente', instalacion: CREAR }

async function main(): Promise<void> {
  const docker = await runDocker(['version', '--format', '{{.Server.Version}}'])
  if (docker.status !== 0) {
    console.log('Docker no responde: la prueba necesita Docker levantado.')
    process.exit(1)
  }
  if ((await runDocker(['image', 'inspect', BASE])).status !== 0) await runDocker(['pull', BASE], { timeoutMs: 600_000 })
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-capa-'))
  const registro = path.join(dir, 'capas-perfil.json')
  const lineas: string[] = []
  const nucleo = { imagen: BASE } as unknown as NucleoSandbox
  const imagen = { ensureImage: async () => {} } as unknown as ImagenSandbox
  const capa = new CapaPerfilSandbox(nucleo, imagen)
  capa.usarRegistro(registro)
  try {
    await casos(capa, registro, nucleo, imagen, lineas)
  } finally {
    await runDocker(['image', 'rm', '-f', nombreImagenCapa(PERFIL)])
    rmSync(dir, { recursive: true, force: true })
  }
}

async function casos(capa: CapaPerfilSandbox, registro: string, nucleo: NucleoSandbox, imagen: ImagenSandbox, lineas: string[]): Promise<void> {
  hr('(1) Construir y comprobar')
  const r1 = await capa.aplicar(PERFIL, [ECO], (l) => lineas.push(l))
  check('construye y el programa quedó', r1.ok && r1.faltan.length === 0, JSON.stringify(r1))
  // El eco del guion puede no salir (el paso puede venir de la caché de Docker): se mira la línea de Tessera y el build.
  check('el progreso llega línea a línea', lineas[0]?.startsWith('Instalando los agentes manuales') === true && lineas.length > 1, `${lineas.length} línea(s)`)
  check('el contenedor nacerá de la capa', (await capa.imagenPara(PERFIL)) === nombreImagenCapa(PERFIL), '')
  check('lo aplicado queda en el registro', JSON.parse(readFileSync(registro, 'utf8')).perfiles[PERFIL][0].id === 'm-eco', '')

  hr('(2) Mismo sello: no se reconstruye; otro proceso lo recuerda')
  const antes = lineas.length
  await capa.imagenPara(PERFIL, (l) => lineas.push(l))
  check('sin cambios no hay build', lineas.length === antes, `${lineas.length - antes} línea(s) nuevas`)
  const otra = new CapaPerfilSandbox(nucleo, imagen)
  otra.usarRegistro(registro)
  check('al arrancar, el registro dice qué capa usa el perfil', (await otra.imagenPara(PERFIL)) === nombreImagenCapa(PERFIL), '')
  check('un perfil sin capa nace de la base', (await otra.imagenPara('otro-perfil')) === 'debian:bookworm-slim', '')

  hr('(3) Lo que falta y lo que falla')
  const sinPrograma: InstalacionAgente = { id: 'm-fantasma', nombre: 'Fantasma', programa: 'no-esta', instalacion: 'true' }
  const r2 = await capa.aplicar(PERFIL, [ECO, sinPrograma], () => {})
  check('se instala, pero avisa del programa que no está', r2.ok && JSON.stringify(r2.faltan) === '["no-esta"]', JSON.stringify(r2))
  const r3 = await capa.aplicar(PERFIL, [{ ...ECO, instalacion: `${CREAR}\nexit 3` }], () => {})
  check('una orden que falla: no ok, con su error', !r3.ok && typeof r3.error === 'string', JSON.stringify(r3))
  const tras: string[] = []
  const imgFallo = await capa.imagenPara(PERFIL, (l) => tras.push(l))
  const rebuild = tras.some((l) => l.startsWith('Instalando'))
  check('tras el fallo, crear el contenedor no repite el build: nace de la base', imgFallo === 'debian:bookworm-slim' && !rebuild, JSON.stringify(tras))
  const releida = new CapaPerfilSandbox(nucleo, imagen)
  releida.usarRegistro(registro)
  const tras2: string[] = []
  await releida.imagenPara(PERFIL, (l) => tras2.push(l))
  check('…tampoco al arrancar otra vez (el fallo queda en el registro)', !tras2.some((l) => l.startsWith('Instalando')), JSON.stringify(tras2))

  hr('(4) Olvidar el perfil')
  await capa.aplicar(PERFIL, [ECO], () => {})
  capa.olvidar(PERFIL)
  await new Promise((r) => setTimeout(r, 3000))
  const queda = await runDocker(['image', 'inspect', nombreImagenCapa(PERFIL)])
  check('su imagen se borra', queda.status !== 0, `inspect salió con ${queda.status}`)
  check('y sale del registro', JSON.parse(readFileSync(registro, 'utf8')).perfiles[PERFIL] === undefined, '')
}

await main()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
