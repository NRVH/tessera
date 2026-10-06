#!/usr/bin/env node
// =============================================================================
// Prueba de la retirada de las carpetas de un perfil (`util/carpetaDePerfil.ts`, npm run
// test:carpeta-de-perfil) con carpetas temporales de verdad y una papelera falsa que las mueve: va a la
// papelera la del perfil borrado y nada más, nunca se borra en firme (ni con la papelera fallando), un
// id peligroso lanza sin tocar el disco, un perfil vivo con la misma carpeta la protege y los enlaces no
// arrastran su destino; los vivos se leen antes de cada intento. También los dos dueños y que
// `ESPACIO_ASEGURAR` no cree carpeta de más.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { esWindows, type Plataforma } from '../../shared/plataforma.ts'
import { hijaDirectaALaPapelera, rutaHijaDirecta, rutasHijas, type APapelera } from './carpetaDePerfil.ts'
import { EspacioTerminal, espacioParaIpc } from '../ssh/controlador/espacioTerminal.ts'
import { EspacioDatos } from '../db/controlador/espacioDatos.ts'
import { CandadoDeBorrado } from '../profiles/candadoDeBorrado.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Todo lo que hay bajo `dir`, como rutas relativas ordenadas: la foto que se compara antes y después. */
function foto(dir: string): string[] {
  if (!existsSync(dir)) return []
  return (readdirSync(dir, { recursive: true }) as string[]).map((r) => r.replace(/\\/g, '/')).sort()
}

/** Una carpeta de perfil con notas, una subcarpeta y un archivo dentro. */
function sembrar(dir: string): void {
  mkdirSync(path.join(dir, 'notas'), { recursive: true })
  writeFileSync(path.join(dir, 'CLAUDE.md'), '# notas del usuario\n')
  writeFileSync(path.join(dir, 'notas', 'red.md'), 'router 192.0.2.1\n')
}

/** Lanza la promesa y dice si falló (sin dejar que el fallo tumbe la prueba). */
async function falla(p: () => Promise<unknown>): Promise<boolean> {
  try {
    await p()
    return false
  } catch {
    return true
  }
}

/**
 * Los borrados en firme de `node:fs/promises`, espiados: se apuntan y se hacen de verdad, así que
 * volver al `rm` lo cazan dos veces (aquí y en el disco). `syncBuiltinESMExports` lleva el espía a los
 * `import { rm }` ya enlazados del módulo bajo prueba.
 */
const borradosEnFirme: string[] = []
const fspMutable = fsp as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
for (const nombre of ['rm', 'rmdir', 'unlink']) {
  const original = fspMutable[nombre]
  fspMutable[nombre] = (...args: unknown[]) => {
    borradosEnFirme.push(`${nombre} ${String(args[0])}`)
    return original(...args)
  }
}
syncBuiltinESMExports()

/** La papelera falsa: MUEVE la entrada a `dir` (como la del sistema) y apunta lo que recibe. */
function papeleraEn(dir: string): { papelera: APapelera; recibidas: string[] } {
  mkdirSync(dir, { recursive: true })
  const recibidas: string[] = []
  return {
    recibidas,
    papelera: async (ruta) => {
      recibidas.push(ruta)
      renameSync(ruta, path.join(dir, `${recibidas.length}-${path.basename(ruta)}`))
    }
  }
}

/** Una papelera que falla las `fallos` primeras veces (`Infinity`: siempre) y luego mueve como `papeleraEn`. */
function papeleraQueFalla(dir: string, fallos: number, alFallar?: () => void): { papelera: APapelera; llamadas: () => number } {
  const real = papeleraEn(dir)
  let llamadas = 0
  return {
    llamadas: () => llamadas,
    papelera: async (ruta) => {
      llamadas++
      if (llamadas <= fallos) {
        alFallar?.()
        throw new Error('Operation was aborted')
      }
      await real.papelera(ruta)
    }
  }
}

/** La validación del id es lógica pura con la plataforma como parámetro: se fijan las dos desde aquí. */
const PLATAFORMAS: readonly Plataforma[] = ['windows', 'mac']

/** Ningún perfil vivo, como función: la carpeta lee los vivos de cada momento. */
const ninguno = (): readonly string[] => []

const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-carpeta-perfil-'))
try {
  const base = path.join(raiz, 'terminal')
  // Lo que vive FUERA de la base y no se puede tocar nunca: un hermano de la base y la raíz.
  const fuera = path.join(raiz, 'fuera')
  sembrar(fuera)
  writeFileSync(path.join(raiz, 'hermano.txt'), 'no tocar\n')
  const { papelera, recibidas } = papeleraEn(path.join(raiz, 'papelera'))

  hr('(1) La ruta: hija directa de la base, o lanza')
  check('(1a) un id normal da base/id', rutaHijaDirecta(base, 'alfa') === path.join(path.resolve(base), 'alfa'), rutaHijaDirecta(base, 'alfa'))
  // Las rutas absolutas apuntan DENTRO del temporal: si la validación faltara, la mutación no
  // podría borrar nada de la máquina.
  const peligrosos = [
    '', '.', '..', '...', '../fuera', 'a/b', 'a\\b', fuera, path.join(raiz, 'hermano.txt'), 'C:', 'a:b',
    'a\u0000b', 'a\tb', 'alfa.', 'alfa ', '..\\fuera'
  ]
  // Nombres de dispositivo: peligrosos solo en Windows; en macOS son carpetas normales.
  const reservados = ['CON', 'nul.txt', 'Com1', 'lpt9.log', 'aux', 'prn']
  const aceptadosEn = (plataforma: Plataforma, ids: readonly string[]): string[] =>
    ids.filter((id) => {
      try {
        rutaHijaDirecta(base, id, plataforma)
        return true
      } catch {
        return false
      }
    })
  for (const plataforma of PLATAFORMAS) {
    const aceptados = aceptadosEn(plataforma, peligrosos)
    check(`(1b) [${plataforma}] los ids peligrosos se rechazan todos`, aceptados.length === 0, `aceptados=${JSON.stringify(aceptados)}`)
  }
  const reservadosWin = aceptadosEn('windows', reservados)
  check('(1e) [windows] los nombres de dispositivo se rechazan', reservadosWin.length === 0, `aceptados=${JSON.stringify(reservadosWin)}`)
  const reservadosMac = aceptadosEn('mac', reservados)
  check(
    '(1f) [mac] los nombres de dispositivo son carpetas normales (el perfil «Aux» tiene carpeta)',
    reservadosMac.length === reservados.length && rutaHijaDirecta(base, 'aux', 'mac') === path.join(path.resolve(base), 'aux'),
    `aceptados=${JSON.stringify(reservadosMac)}`
  )
  check(
    '(1g) rutasHijas: «aux» se omite en Windows y se conserva en macOS',
    Object.keys(rutasHijas(base, ['aux', 'alfa'], 'windows')).join() === 'alfa' && Object.keys(rutasHijas(base, ['aux', 'alfa'], 'mac')).join() === 'aux,alfa',
    'aux,alfa'
  )
  let mensaje = ''
  try {
    rutaHijaDirecta(base, '../fuera')
  } catch (err) {
    mensaje = String(err)
  }
  check('(1c) el error no lleva la ruta', mensaje !== '' && !mensaje.includes(raiz), mensaje)
  const rutas = rutasHijas(base, ['alfa', '..', 'beta-2'])
  check('(1d) rutasHijas omite el inválido y conserva los demás', Object.keys(rutas).join() === 'alfa,beta-2', JSON.stringify(Object.keys(rutas)))

  hr('(2) A la papelera va la carpeta del perfil borrado y solo esa')
  sembrar(path.join(base, 'alfa'))
  sembrar(path.join(base, 'beta'))
  sembrar(path.join(base, 'gamma'))
  writeFileSync(path.join(base, 'suelto.txt'), 'de la base\n')
  const antesBase = foto(base)
  const r2 = await hijaDirectaALaPapelera(base, 'alfa', () => ['beta', 'gamma'], papelera)
  const tras2 = foto(base)
  check('(2a) devuelve «en-la-papelera»', r2 === 'en-la-papelera', r2)
  check('(2b) la papelera recibe exactamente base/alfa, una vez', JSON.stringify(recibidas) === JSON.stringify([path.join(path.resolve(base), 'alfa')]), JSON.stringify(recibidas))
  check('(2c) y allí está entera, con sus notas', foto(path.join(raiz, 'papelera', '1-alfa')).join() === 'CLAUDE.md,notas,notas/red.md', foto(path.join(raiz, 'papelera')).join())
  check(
    '(2d) las de los demás perfiles y lo suelto de la base siguen enteros',
    JSON.stringify(tras2) === JSON.stringify(antesBase.filter((r) => r !== 'alfa' && !r.startsWith('alfa/'))),
    JSON.stringify(tras2)
  )
  check('(2e) fuera de la base no se toca nada', foto(fuera).length === 3 && existsSync(path.join(raiz, 'hermano.txt')), JSON.stringify(foto(fuera)))
  check('(2f) ningún borrado en firme', borradosEnFirme.length === 0, JSON.stringify(borradosEnFirme))
  if (!esWindows()) {
    // En disco solo fuera de Windows: allí `aux` no puede ser una carpeta.
    sembrar(path.join(base, 'aux'))
    const r2g = await hijaDirectaALaPapelera(base, 'aux', () => ['beta', 'gamma'], papelera, 'mac')
    check('(2g) [mac, en disco] la carpeta del perfil «Aux» va a la papelera al borrarlo', r2g === 'en-la-papelera' && !existsSync(path.join(base, 'aux')), r2g)
  }

  hr('(3) Si no existe, no falla ni llama a la papelera')
  const antes3 = recibidas.length
  check('(3a) un perfil sin carpeta da «no-existia»', (await hijaDirectaALaPapelera(base, 'delta', () => ['beta'], papelera)) === 'no-existia', 'delta')
  check('(3b) sin la base siquiera, tampoco', (await hijaDirectaALaPapelera(path.join(raiz, 'no-hay'), 'alfa', ninguno, papelera)) === 'no-existia', 'no-hay')
  check('(3c) la papelera no recibe nada', recibidas.length === antes3, `${recibidas.length - antes3} llamadas`)

  hr('(4) Un id peligroso lanza ANTES de tocar el disco')
  const antesRaiz = foto(raiz)
  const antes4 = recibidas.length
  const noLanzan: string[] = []
  for (const plataforma of PLATAFORMAS) {
    for (const id of peligrosos) {
      if (!(await falla(() => hijaDirectaALaPapelera(base, id, ninguno, papelera, plataforma)))) noLanzan.push(`${plataforma}:${id}`)
    }
  }
  for (const id of reservados) {
    if (!(await falla(() => hijaDirectaALaPapelera(base, id, ninguno, papelera, 'windows')))) noLanzan.push(`windows:${id}`)
  }
  check('(4a) todos lanzan (y en Windows también los nombres de dispositivo)', noLanzan.length === 0, `no lanzan=${JSON.stringify(noLanzan)}`)
  check('(4b) y el disco queda igual (la base, sus perfiles, el hermano y «fuera»)', JSON.stringify(foto(raiz)) === JSON.stringify(antesRaiz), `${foto(raiz).length} entradas`)
  check('(4c) y la papelera no recibe nada', recibidas.length === antes4, `${recibidas.length - antes4} llamadas`)

  hr('(5) Un perfil VIVO con la misma carpeta la protege')
  const antes5 = recibidas.length
  check(
    '(5a) el mismo id entre los vivos: «en-uso» y no se toca',
    (await hijaDirectaALaPapelera(base, 'beta', () => ['beta'], papelera)) === 'en-uso' && existsSync(path.join(base, 'beta', 'CLAUDE.md')),
    'beta'
  )
  check(
    '(5b) otra caja del mismo id (misma carpeta en Windows y macOS): «en-uso»',
    (await hijaDirectaALaPapelera(base, 'Gamma', () => ['gamma'], papelera)) === 'en-uso' && existsSync(path.join(base, 'gamma', 'CLAUDE.md')),
    'Gamma/gamma'
  )
  check('(5c) la papelera no recibe nada', recibidas.length === antes5, `${recibidas.length - antes5} llamadas`)

  hr('(6) Los enlaces no arrastran su destino')
  // Una unión en Windows (no pide permisos de administrador) y un enlace simbólico en macOS.
  const tipoEnlace = esWindows() ? 'junction' : 'dir'
  sembrar(path.join(base, 'epsilon'))
  symlinkSync(fuera, path.join(base, 'epsilon', 'enlace-a-fuera'), tipoEnlace)
  const r6 = await hijaDirectaALaPapelera(base, 'epsilon', ninguno, papelera)
  check('(6a) una carpeta con un enlace DENTRO va a la papelera', r6 === 'en-la-papelera' && !existsSync(path.join(base, 'epsilon')), r6)
  check('(6b) y el destino del enlace sigue entero', foto(fuera).length === 3, JSON.stringify(foto(fuera)))
  symlinkSync(fuera, path.join(base, 'zeta'), tipoEnlace)
  const r6c = await hijaDirectaALaPapelera(base, 'zeta', ninguno, papelera)
  const enPapelera = path.join(raiz, 'papelera', `${recibidas.length}-zeta`)
  check(
    '(6c) si la carpeta del perfil ES un enlace, va el enlace (no su destino)',
    r6c === 'en-la-papelera' && !existsSync(path.join(base, 'zeta')) && lstatSync(enPapelera).isSymbolicLink(),
    r6c
  )
  check('(6d) y su destino sigue entero en su sitio', foto(fuera).length === 3, JSON.stringify(foto(fuera)))
  check('(6e) ningún borrado en firme', borradosEnFirme.length === 0, JSON.stringify(borradosEnFirme))

  hr('(7) Los dueños: cada uno manda a la papelera en su base')
  const userData = path.join(raiz, 'userData')
  sembrar(path.join(userData, 'terminal', 'alfa'))
  sembrar(path.join(userData, 'conexiones', 'alfa'))
  sembrar(path.join(userData, 'terminal', 'beta'))
  // Cada dueño recibe la papelera UNA vez, al nacer; `borrar` ya no la pide.
  const terminal = new EspacioTerminal({ userDataDir: userData, listar: () => ({ formatoAjeno: false, grupos: [], ajenas: [], conexiones: [] }), papelera, log: () => {} })
  const datos = new EspacioDatos(userData, { listaCompleta: () => ({ conexiones: [], formatoAjeno: false, aviso: '' }) } as never, papelera, () => {})
  check(
    '(7a) EspacioTerminal manda terminal/alfa',
    (await terminal.borrar('alfa', () => ['beta'])) === 'en-la-papelera' && recibidas.at(-1) === path.join(path.resolve(userData, 'terminal'), 'alfa'),
    String(recibidas.at(-1))
  )
  check('(7b) y no toca conexiones/alfa ni terminal/beta', existsSync(path.join(userData, 'conexiones', 'alfa', 'CLAUDE.md')) && existsSync(path.join(userData, 'terminal', 'beta', 'CLAUDE.md')), 'conexiones/alfa, terminal/beta')
  check(
    '(7c) EspacioDatos manda conexiones/alfa',
    (await datos.borrar('alfa', () => ['beta'])) === 'en-la-papelera' && recibidas.at(-1) === path.join(path.resolve(userData, 'conexiones'), 'alfa'),
    String(recibidas.at(-1))
  )
  check('(7d) los dos rechazan un id peligroso', (await falla(() => terminal.borrar('..', ninguno))) && (await falla(() => datos.borrar('..', ninguno))) && existsSync(userData), '..')
  sembrar(path.join(userData, 'conexiones', 'beta'))
  const antes7e = recibidas.length
  check(
    '(7e) los dos miran los vivos que les pasan: un perfil vivo da «en-uso» y su carpeta no va a la papelera',
    (await terminal.borrar('beta', () => ['beta'])) === 'en-uso' &&
      (await datos.borrar('beta', () => ['beta'])) === 'en-uso' &&
      recibidas.length === antes7e &&
      existsSync(path.join(userData, 'terminal', 'beta', 'CLAUDE.md')) &&
      existsSync(path.join(userData, 'conexiones', 'beta', 'CLAUDE.md')),
    `${recibidas.length - antes7e} a la papelera`
  )

  hr('(8) ESPACIO_ASEGURAR solo prepara la carpeta de un perfil que existe')
  const canal = espacioParaIpc(terminal, () => [{ id: 'beta', nombre: 'Beta del main' }], new CandadoDeBorrado())
  let error8 = ''
  try {
    await canal.asegurar('fantasma')
  } catch (err) {
    error8 = err instanceof Error ? err.message : String(err)
  }
  check('(8a) un perfil que no existe se rechaza con un error claro', /no existe/.test(error8), error8)
  check('(8b) y no se crea su carpeta', !existsSync(path.join(userData, 'terminal', 'fantasma')), 'terminal/fantasma')
  const ref = await canal.asegurar('beta')
  check('(8c) uno que existe se prepara, como siempre', ref.projectHostPath === path.join(path.resolve(userData, 'terminal'), 'beta') && ref.name === 'Terminal', JSON.stringify(ref))

  hr('(9) Si la papelera falla, la carpeta SE QUEDA: nunca un borrado en firme')
  sembrar(path.join(base, 'eta'))
  const antes9 = foto(path.join(base, 'eta'))
  const siempre = papeleraQueFalla(path.join(raiz, 'papelera-9'), Infinity)
  let error9: unknown
  try {
    await hijaDirectaALaPapelera(base, 'eta', ninguno, siempre.papelera)
  } catch (err) {
    error9 = err
  }
  check('(9a) lanza, con el fallo de la papelera como causa y sin la ruta', error9 instanceof Error && error9.cause instanceof Error && !error9.message.includes(raiz), String(error9))
  check('(9b) tras reintentar poco (1 + 3 intentos)', siempre.llamadas() === 4, `${siempre.llamadas()} llamadas`)
  check('(9c) y la carpeta sigue entera en su sitio', JSON.stringify(foto(path.join(base, 'eta'))) === JSON.stringify(antes9), JSON.stringify(foto(path.join(base, 'eta'))))
  check('(9d) ningún borrado en firme', borradosEnFirme.length === 0, JSON.stringify(borradosEnFirme))
  const transitorio = papeleraQueFalla(path.join(raiz, 'papelera-9'), 2)
  const r9e = await hijaDirectaALaPapelera(base, 'eta', ninguno, transitorio.papelera)
  check('(9e) un bloqueo pasajero (falla 2 veces) acaba en la papelera', r9e === 'en-la-papelera' && transitorio.llamadas() === 3 && !existsSync(path.join(base, 'eta')), `${r9e}, ${transitorio.llamadas()} llamadas`)
  sembrar(path.join(base, 'theta'))
  // Alguien se la lleva entre dos intentos: no es un error.
  const seVa = papeleraQueFalla(path.join(raiz, 'papelera-9'), Infinity, () => renameSync(path.join(base, 'theta'), path.join(raiz, 'theta-movida')))
  const r9f = await hijaDirectaALaPapelera(base, 'theta', ninguno, seVa.papelera)
  check('(9f) si desaparece entre intentos, «no-existia» sin lanzar', r9f === 'no-existia' && seVa.llamadas() === 1, `${r9f}, ${seVa.llamadas()} llamadas`)

  hr('(10) Los vivos se leen antes de CADA intento: un perfil recreado a mitad conserva su carpeta')
  sembrar(path.join(base, 'iota'))
  // El usuario recrea «iota» mientras la papelera falla (una sesión aún cerrándose): el reintento ya
  // no puede llevarse la carpeta, que es del perfil nuevo.
  let vivos10: readonly string[] = []
  const recreaAlFallar = papeleraQueFalla(path.join(raiz, 'papelera-10'), 1, () => {
    vivos10 = [...vivos10, 'iota']
  })
  const r10 = await hijaDirectaALaPapelera(base, 'iota', () => vivos10, recreaAlFallar.papelera)
  check('(10a) recreado durante un reintento: «en-uso», sin otro intento', r10 === 'en-uso' && recreaAlFallar.llamadas() === 1, `${r10}, ${recreaAlFallar.llamadas()} llamadas`)
  check('(10b) y su carpeta sigue entera en su sitio', foto(path.join(base, 'iota')).join() === 'CLAUDE.md,notas,notas/red.md', JSON.stringify(foto(path.join(base, 'iota'))))
  // Y entre la primera comprobación y el primer intento (mientras se mira el disco): la segunda lectura
  // de los vivos ya lo trae.
  sembrar(path.join(base, 'kappa'))
  let lecturas = 0
  const cuentaLecturas = papeleraEn(path.join(raiz, 'papelera-10b'))
  const r10c = await hijaDirectaALaPapelera(base, 'kappa', () => (++lecturas === 1 ? [] : ['kappa']), cuentaLecturas.papelera)
  check(
    '(10c) recreado antes del primer intento: «en-uso» y la papelera no recibe nada',
    r10c === 'en-uso' && cuentaLecturas.recibidas.length === 0 && existsSync(path.join(base, 'kappa', 'CLAUDE.md')),
    `${r10c}, ${cuentaLecturas.recibidas.length} recibidas`
  )
  check('(10d) y en toda la prueba, ningún borrado en firme', borradosEnFirme.length === 0, JSON.stringify(borradosEnFirme))
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log(`\nVEREDICTO: ${passed}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
