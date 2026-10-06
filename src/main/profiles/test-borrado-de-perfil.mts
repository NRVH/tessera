#!/usr/bin/env node
// =============================================================================
// Prueba del borrado de un perfil (`profiles/borradoDePerfil.ts`, npm run test:borrado-de-perfil): cada
// paso irreversible mira la lista de ESE momento, así que un perfil recreado (mismo id) a mitad conserva
// contenedor, conexiones SSH, sesiones y carpetas; el candado hace esperar a lo que lo recrea; en disco
// van a la papelera las dos carpetas del perfil y solo esas (cada dueño con su papelera inyectada). Y
// preparar la carpeta de un perfil recién creado espera, con tope, al guardado que lo trae. Con dobles
// y carpetas temporales.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  borrarCarpetasDelPerfil,
  borrarPerfiles,
  perfilVuelveAExistir,
  type CarpetaDePerfil,
  type DepsBorradoCompleto,
  type DepsBorradoDePerfil
} from './borradoDePerfil.ts'
import { CandadoDeBorrado } from './candadoDeBorrado.ts'
import { LlegadaDePerfiles } from './llegadaDePerfiles.ts'
import type { APapelera } from '../util/carpetaDePerfil.ts'
import { EspacioTerminal, espacioParaIpc } from '../ssh/controlador/espacioTerminal.ts'
import { EspacioDatos } from '../db/controlador/espacioDatos.ts'
import { registrarIpcBd } from '../db/ipc.ts'
import { DB_CHANNELS } from '../../shared/db-ipc.ts'
import type { SshListaConexiones } from '../../shared/ssh-ipc.ts'

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

/** El registro SSH de un perfil sin conexiones: lo que pide `EspacioTerminal` para nacer. */
const SIN_CONEXIONES: SshListaConexiones = { formatoAjeno: false, grupos: [], ajenas: [], conexiones: [] }

/** Una carpeta de perfil con notas y una subcarpeta. */
function sembrarCarpeta(dir: string): void {
  mkdirSync(path.join(dir, 'notas'), { recursive: true })
  writeFileSync(path.join(dir, 'CLAUDE.md'), '# notas del usuario\n')
  writeFileSync(path.join(dir, 'notas', 'red.md'), 'router 192.0.2.1\n')
}

/**
 * Un escenario con dobles: `lista` es la de perfiles vivos, y `crear` la SUSTITUYE por otra con un
 * perfil más, como hace un guardado con `perfiles.lista = next` (no la muta: una lista capturada al
 * empezar no se enteraría). Cada paso apunta lo que hace en `pasos`; `alCerrar` y `alBorrar` simulan
 * lo que pasa mientras tanto.
 */
function escenario(opciones: {
  lista: string[]
  alCerrar?: (crear: (id: string) => void) => void
  alBorrar?: (cual: string, crear: (id: string) => void) => void
}): { deps: DepsBorradoDePerfil; pasos: string[]; vivosVistos: string[][] } {
  const pasos: string[] = []
  const vivosVistos: string[][] = []
  const crear = (id: string): void => {
    opciones.lista = [...opciones.lista, id]
  }
  const carpeta = (cual: string): CarpetaDePerfil => [
    cual,
    {
      borrar: async (id, vivos) => {
        pasos.push(`borrar ${cual} ${id}`)
        vivosVistos.push([...vivos()])
        opciones.alBorrar?.(cual, crear)
        return 'en-la-papelera'
      }
    }
  ]
  const deps: DepsBorradoDePerfil = {
    idsVivos: () => opciones.lista,
    cerrarSesiones: async (id) => {
      pasos.push(`cerrar ${id}`)
      opciones.alCerrar?.(crear)
    },
    carpetas: [carpeta('terminal'), carpeta('datos')],
    log: () => {},
    error: () => {}
  }
  return { deps, pasos, vivosVistos }
}

hr('(1) Sin carrera: se cierran las sesiones y se borran las dos carpetas')
{
  const { deps, pasos, vivosVistos } = escenario({ lista: ['beta'] })
  await borrarCarpetasDelPerfil(deps, 'trabajo')
  check('(1a) cierra y borra las dos, en orden', pasos.join(' | ') === 'cerrar trabajo | borrar terminal trabajo | borrar datos trabajo', pasos.join(' | '))
  check('(1b) cada carpeta recibe los vivos', vivosVistos.every((v) => v.join() === 'beta'), JSON.stringify(vivosVistos))
}

hr('(2) El perfil ya existe otra vez al empezar: no se toca nada')
{
  const { deps, pasos } = escenario({ lista: ['beta', 'trabajo'] })
  await borrarCarpetasDelPerfil(deps, 'trabajo')
  check('(2a) ni sesiones ni carpetas', pasos.length === 0, JSON.stringify(pasos))
}

hr('(3) Se recrea mientras se cierran las sesiones: no se borra ninguna carpeta')
{
  const { deps, pasos } = escenario({ lista: ['beta'], alCerrar: (crear) => crear('trabajo') })
  await borrarCarpetasDelPerfil(deps, 'trabajo')
  check('(3a) solo el cierre, que ya había empezado', pasos.join(' | ') === 'cerrar trabajo', pasos.join(' | '))
}

hr('(4) Se recrea entre las dos carpetas: la segunda no se toca')
{
  const { deps, pasos } = escenario({
    lista: ['beta'],
    alBorrar: (cual, crear) => {
      if (cual === 'terminal') crear('trabajo')
    }
  })
  await borrarCarpetasDelPerfil(deps, 'trabajo')
  check('(4a) se para tras la primera', pasos.join(' | ') === 'cerrar trabajo | borrar terminal trabajo', pasos.join(' | '))
}

hr('(5) Los vivos se leen en cada paso, no una vez al empezar')
{
  const { deps, vivosVistos } = escenario({ lista: ['beta'], alCerrar: (crear) => crear('gamma') })
  await borrarCarpetasDelPerfil(deps, 'trabajo')
  check('(5a) las carpetas ven el perfil creado mientras tanto', vivosVistos.every((v) => v.join() === 'beta,gamma'), JSON.stringify(vivosVistos))
}

hr('(6) Un fallo no impide lo demás')
{
  const pasos: string[] = []
  const errores: string[] = []
  await borrarCarpetasDelPerfil(
    {
      idsVivos: () => [],
      cerrarSesiones: async () => {
        throw new Error('pty colgado')
      },
      carpetas: [
        [
          'terminal',
          {
            borrar: async () => {
              throw new Error('EBUSY')
            }
          }
        ],
        [
          'datos',
          {
            borrar: async (id) => {
              pasos.push(`borrar datos ${id}`)
              return 'en-la-papelera'
            }
          }
        ]
      ],
      log: () => {},
      error: (m) => errores.push(m)
    },
    'trabajo'
  )
  check('(6a) se registran los dos fallos y se borra la otra carpeta', errores.length === 2 && pasos.join() === 'borrar datos trabajo', `${errores.length} errores, ${pasos.join()}`)
}

hr('(7) En disco: borrar «Trabajo» y recrearlo enseguida no pierde la carpeta nueva')
const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-borrado-perfil-'))
try {
  const base = path.join(raiz, 'terminal')
  let lista: readonly string[] = ['beta']
  const papelera7: string[] = []
  mkdirSync(path.join(base, 'trabajo'), { recursive: true })
  writeFileSync(path.join(base, 'trabajo', 'CLAUDE.md'), '# del perfil viejo\n')
  await borrarCarpetasDelPerfil(
    {
      idsVivos: () => lista,
      // Mientras se cierran las sesiones del viejo, el usuario crea otra vez «Trabajo» y su carpeta
      // se siembra de nuevo (ESPACIO_ASEGURAR), con notas que ya son del perfil nuevo.
      cerrarSesiones: async () => {
        lista = [...lista, 'trabajo']
        writeFileSync(path.join(base, 'trabajo', 'CLAUDE.md'), '# del perfil NUEVO\n')
      },
      carpetas: [
        [
          'del agente de la terminal',
          new EspacioTerminal({
            userDataDir: raiz,
            listar: () => SIN_CONEXIONES,
            papelera: async (ruta) => {
              papelera7.push(ruta)
            },
            log: () => {}
          })
        ]
      ],
      log: () => {},
      error: () => {}
    },
    'trabajo'
  )
  check('(7a) la carpeta del perfil recreado sigue ahí', existsSync(path.join(base, 'trabajo', 'CLAUDE.md')), 'terminal/trabajo/CLAUDE.md')
  check('(7b) y no se ha mandado a la papelera', papelera7.length === 0, JSON.stringify(papelera7))

  hr('(9) En disco: a la papelera van las dos carpetas del perfil borrado y solo esas')
  const userData = path.join(raiz, 'userData')
  for (const rel of ['terminal/trabajo', 'conexiones/trabajo', 'terminal/beta', 'conexiones/beta']) sembrarCarpeta(path.join(userData, rel))
  const enPapelera = path.join(raiz, 'papelera')
  mkdirSync(enPapelera)
  const recibidas: string[] = []
  // Los dueños de verdad, cada uno con la papelera inyectada al nacer, como en la app.
  const carpetasDe = (papelera: APapelera): DepsBorradoDePerfil['carpetas'] => [
    ['del agente de la terminal', new EspacioTerminal({ userDataDir: userData, listar: () => SIN_CONEXIONES, papelera, log: () => {} })],
    ['del espacio de datos', new EspacioDatos(userData, { listaCompleta: () => ({ conexiones: [], formatoAjeno: false, aviso: '' }) } as never, papelera, () => {})]
  ]
  const carpetasReales = carpetasDe(async (ruta) => {
    recibidas.push(path.relative(userData, ruta).replace(/\\/g, '/'))
    renameSync(ruta, path.join(enPapelera, String(recibidas.length)))
  })
  const registro: string[] = []
  await borrarCarpetasDelPerfil(
    {
      idsVivos: () => ['beta'],
      cerrarSesiones: async () => {},
      carpetas: carpetasReales,
      log: (m) => registro.push(m),
      error: (m) => registro.push(m)
    },
    'trabajo'
  )
  check('(9a) la papelera recibe terminal/trabajo y conexiones/trabajo, en orden', recibidas.join() === 'terminal/trabajo,conexiones/trabajo', recibidas.join())
  check(
    '(9b) las de «beta» siguen en su sitio',
    existsSync(path.join(userData, 'terminal', 'beta', 'CLAUDE.md')) && existsSync(path.join(userData, 'conexiones', 'beta', 'CLAUDE.md')),
    'terminal/beta, conexiones/beta'
  )
  check('(9c) el registro dice «en-la-papelera»', registro.length === 2 && registro.every((m) => m.endsWith('en-la-papelera')), JSON.stringify(registro))

  hr('(10) En disco: si la papelera falla, las carpetas se quedan y se registra')
  sembrarCarpeta(path.join(userData, 'terminal', 'caido'))
  sembrarCarpeta(path.join(userData, 'conexiones', 'caido'))
  const errores10: string[] = []
  await borrarCarpetasDelPerfil(
    {
      idsVivos: () => [],
      cerrarSesiones: async () => {},
      carpetas: carpetasDe(async () => {
        throw new Error('Operation was aborted')
      }),
      log: () => {},
      error: (m) => errores10.push(m)
    },
    'caido'
  )
  check(
    '(10a) las dos carpetas siguen enteras en disco',
    existsSync(path.join(userData, 'terminal', 'caido', 'notas', 'red.md')) && existsSync(path.join(userData, 'conexiones', 'caido', 'notas', 'red.md')),
    'terminal/caido, conexiones/caido'
  )
  check('(10b) y se registra que se quedan en su sitio, una vez por carpeta', errores10.length === 2 && errores10.every((m) => m.includes('se queda en su sitio')), JSON.stringify(errores10))
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

hr('(11) perfilVuelveAExistir')
check('(11a) sí si está en la lista', perfilVuelveAExistir(['beta', 'trabajo'], 'trabajo'), 'trabajo')
check('(11b) no si no está', !perfilVuelveAExistir(['beta'], 'trabajo'), 'beta')
// El mismo criterio que la carpeta y el candado: sin caja ni forma Unicode.
check('(11c) sí si vuelve con otra caja', perfilVuelveAExistir(['beta', 'Trabajo'], 'trabajo'), 'Trabajo')
check('(11d) sí si vuelve en otra forma Unicode (NFD)', perfilVuelveAExistir(['méxico'], 'méxico'), 'NFD contra NFC')
check('(11e) NEGATIVO: un id parecido no es el mismo', !perfilVuelveAExistir(['trabajo-2', 'trabaj'], 'trabajo'), 'trabajo-2, trabaj')

/** Una promesa que se resuelve a mano: un paso que tarda (parar el contenedor) hasta que la prueba quiera. */
function aMano(): { promesa: Promise<void>; soltar: () => void } {
  let soltar = (): void => {}
  const promesa = new Promise<void>((r) => {
    soltar = r
  })
  return { promesa, soltar }
}

/** Deja correr lo encolado (microtareas y algún temporizador) antes de mirar. */
const respirar = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

/**
 * El borrado ENTERO con dobles: la lista viva se SUSTITUYE al recrear (como `perfiles.lista = next`),
 * cada paso irreversible apunta lo que hace en `pasos`, y `durante` simula lo que pasa mientras dura
 * cada uno (con `crear`, el usuario recrea un perfil). `parar` puede quedarse esperando a mano.
 */
function escenarioCompleto(opciones: {
  lista: string[]
  durante?: (paso: string, id: string, crear: (id: string) => void) => void
  parar?: (id: string) => Promise<void>
  candado?: CandadoDeBorrado
}): { deps: DepsBorradoCompleto<{ id: string }>; pasos: string[]; lista: () => readonly string[]; crear: (id: string) => void } {
  const pasos: string[] = []
  let lista: readonly string[] = opciones.lista
  const crear = (id: string): void => {
    lista = [...lista, id]
  }
  const paso = (nombre: string, id: string): void => {
    pasos.push(`${nombre} ${id}`)
    opciones.durante?.(nombre, id, crear)
  }
  const carpeta = (cual: string): CarpetaDePerfil => [
    cual,
    {
      borrar: async (id, vivos) => {
        if (perfilVuelveAExistir(vivos(), id)) return 'en-uso'
        paso(`papelera-${cual}`, id)
        return 'en-la-papelera'
      }
    }
  ]
  const deps: DepsBorradoCompleto<{ id: string }> = {
    idsVivos: () => lista,
    candado: opciones.candado ?? new CandadoDeBorrado(),
    pararContenedor: async (p) => {
      paso('parar', p.id)
      await opciones.parar?.(p.id)
    },
    borrarHistorial: async (id) => paso('historial', id),
    borrarConexionesSsh: (id) => paso('ssh', id),
    cerrarSesiones: async (id) => paso('cerrar', id),
    carpetas: [carpeta('terminal'), carpeta('datos')],
    log: () => {},
    error: () => {}
  }
  return { deps, pasos, lista: () => lista, crear }
}

hr('(12) El borrado entero, sin carrera: todos los pasos, en orden (las sesiones, lo primero)')
{
  const { deps, pasos } = escenarioCompleto({ lista: ['beta'] })
  await borrarPerfiles(deps, [{ id: 'trabajo' }])
  check(
    '(12a) sesiones, contenedor, historial, SSH y las dos carpetas',
    pasos.join(' | ') === 'cerrar trabajo | parar trabajo | historial trabajo | ssh trabajo | papelera-terminal trabajo | papelera-datos trabajo',
    pasos.join(' | ')
  )
  // Una SSH viva (incluirSsh) seguiría usando las claves y el known_hosts que borra `ssh`.
  check('(12b) las sesiones se cierran ANTES de borrar sus conexiones SSH, y solo una vez', pasos.indexOf('cerrar trabajo') === 0 && pasos.filter((p) => p.startsWith('cerrar')).length === 1, pasos.join(' | '))
}

hr('(13) Recreado mientras se para su contenedor: ni historial, ni SSH, ni carpetas')
{
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    durante: (paso, id, crear) => {
      if (paso === 'parar') crear(id)
    }
  })
  await borrarPerfiles(deps, [{ id: 'trabajo' }])
  check('(13a) solo el cierre y la parada, que ya había empezado', pasos.join(' | ') === 'cerrar trabajo | parar trabajo', pasos.join(' | '))
}

hr('(13b) Recreado mientras se cierran sus sesiones: ni su contenedor ni nada más')
{
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    durante: (paso, id, crear) => {
      if (paso === 'cerrar') crear(id)
    }
  })
  await borrarPerfiles(deps, [{ id: 'trabajo' }])
  check('(13c) solo el cierre, que ya había empezado', pasos.join(' | ') === 'cerrar trabajo', pasos.join(' | '))
}

hr('(14) Recreado entre el historial y las conexiones SSH: sus conexiones (en firme) no se tocan')
{
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    durante: (paso, id, crear) => {
      if (paso === 'historial') crear(id)
    }
  })
  await borrarPerfiles(deps, [{ id: 'trabajo' }])
  check('(14a) se para tras el historial: ni SSH ni carpetas', pasos.join(' | ') === 'cerrar trabajo | parar trabajo | historial trabajo', pasos.join(' | '))
}

hr('(15) Recreado tras las conexiones SSH: ni sus carpetas')
{
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    durante: (paso, id, crear) => {
      if (paso === 'ssh') crear(id)
    }
  })
  await borrarPerfiles(deps, [{ id: 'trabajo' }])
  check('(15a) se para tras SSH', pasos.join(' | ') === 'cerrar trabajo | parar trabajo | historial trabajo | ssh trabajo', pasos.join(' | '))
}

hr('(16) Dos perfiles en el mismo guardado: el segundo, recreado antes de su parada, no se para')
{
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    // Mientras se borra «uno», el usuario recrea «dos»: su contenedor ya sería el del perfil nuevo.
    durante: (paso, id, crear) => {
      if (paso === 'parar' && id === 'uno') crear('dos')
    }
  })
  await borrarPerfiles(deps, [{ id: 'uno' }, { id: 'dos' }])
  check('(16a) «uno» se borra entero', pasos.filter((p) => p.endsWith(' uno')).length === 6, pasos.join(' | '))
  check('(16b) de «dos» no se toca nada, ni su contenedor', !pasos.some((p) => p.endsWith(' dos')), pasos.join(' | '))
  check('(16c) y van uno detrás de otro (nada de «dos» antes de acabar «uno»)', pasos.at(-1) === 'papelera-datos uno', String(pasos.at(-1)))
}

hr('(17) El candado: preparar la carpeta del perfil recreado (ESPACIO_ASEGURAR) espera al borrado')
{
  const candado = new CandadoDeBorrado()
  const parada = aMano()
  const { deps, pasos, lista, crear } = escenarioCompleto({ lista: ['beta'], candado, parar: async () => parada.promesa })
  const espacio = {
    asegurar: (id: string) => {
      pasos.push(`asegurar ${id}`)
      return { projectHostPath: `terminal/${id}`, name: 'Terminal' }
    },
    rutas: () => ({})
  }
  const canal = espacioParaIpc(espacio, () => lista().map((id) => ({ id, nombre: id })), candado)
  const borrado = borrarPerfiles(deps, [{ id: 'trabajo' }])
  await respirar()
  // Mientras se para el contenedor, el usuario recrea «Trabajo» y su pestaña pide la carpeta.
  crear('trabajo')
  const asegurado = canal.asegurar('trabajo')
  let sesionAbierta = false
  const sesion = candado.esperar('trabajo').then(() => {
    sesionAbierta = true
  })
  const otro = await canal.asegurar('beta')
  await respirar()
  check('(17a) mientras dura el borrado, la carpeta del recreado NO se prepara', !pasos.includes('asegurar trabajo'), pasos.join(' | '))
  check('(17b) ni se abre su sesión (espera al candado)', !sesionAbierta, `sesionAbierta=${sesionAbierta}`)
  check('(17c) otro perfil no espera nada', otro.projectHostPath === 'terminal/beta' && pasos.includes('asegurar beta'), pasos.join(' | '))
  parada.soltar()
  const ref = await asegurado
  await Promise.all([borrado, sesion])
  check('(17d) al soltar el candado se prepara, y el borrado no tocó nada más', ref.projectHostPath === 'terminal/trabajo' && pasos.filter((p) => p.endsWith(' trabajo')).join(' | ') === 'cerrar trabajo | parar trabajo | asegurar trabajo', pasos.join(' | '))
  check('(17e) y la sesión se abre después', sesionAbierta, `sesionAbierta=${sesionAbierta}`)
}

hr('(18) Los candados de TODOS los perfiles del guardado se toman al llamar')
{
  const candado = new CandadoDeBorrado()
  const parada = aMano()
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    candado,
    parar: async (id) => {
      if (id === 'uno') await parada.promesa
    }
  })
  const borrado = borrarPerfiles(deps, [{ id: 'uno' }, { id: 'dos' }])
  await respirar()
  // Mientras se para «uno», algo pide preparar «dos» (recreado): su borrado aún no ha empezado, pero
  // su candado ya está tomado.
  let asegurado = false
  const espera = candado.trasElBorrado('dos', () => {
    asegurado = true
  })
  await respirar()
  check('(18a) lo de «dos» espera aunque su borrado no haya empezado', !asegurado && !pasos.some((p) => p.endsWith(' dos')), `asegurado=${asegurado}`)
  parada.soltar()
  await Promise.all([borrado, espera])
  check('(18b) y corre cuando termina el borrado de «dos»', asegurado && pasos.some((p) => p === 'parar dos'), pasos.join(' | '))
}

hr('(19) El candado: preparar el espacio de datos del recreado (WORKSPACE_ENSURE) espera al borrado')
{
  const candado = new CandadoDeBorrado()
  const parada = aMano()
  const { deps, pasos, crear } = escenarioCompleto({ lista: ['beta'], candado, parar: async () => parada.promesa })
  const handlers = new Map<string, (evento: unknown, req: unknown) => unknown>()
  const bd = {
    ensureWorkspace: (id: string) => {
      pasos.push(`espacio ${id}`)
      return { projectHostPath: `conexiones/${id}`, name: 'Datos' }
    }
  }
  registrarIpcBd({ ipc: { handle: (canal: string, fn: (evento: unknown, req: unknown) => unknown) => void handlers.set(canal, fn) } as never, bd: bd as never, borrados: candado })
  const borrado = borrarPerfiles(deps, [{ id: 'trabajo' }])
  await respirar()
  crear('trabajo')
  const asegurado = Promise.resolve(handlers.get(DB_CHANNELS.WORKSPACE_ENSURE)?.(null, { profileId: 'trabajo', nombrePerfil: 'Trabajo' }))
  await respirar()
  check('(19a) mientras dura el borrado, el espacio del recreado NO se prepara', !pasos.includes('espacio trabajo'), pasos.join(' | '))
  parada.soltar()
  await Promise.all([borrado, asegurado])
  check('(19b) al soltar el candado se prepara, y el borrado no tocó nada más', pasos.join(' | ') === 'cerrar trabajo | parar trabajo | espacio trabajo', pasos.join(' | '))
}

hr('(20) Recreado con otra caja entre el historial y las conexiones SSH: es el mismo perfil y no se tocan')
{
  const { deps, pasos } = escenarioCompleto({
    lista: ['beta'],
    durante: (paso, _id, crear) => {
      if (paso === 'historial') crear('Trabajo')
    }
  })
  await borrarPerfiles(deps, [{ id: 'trabajo' }])
  check(
    '(20a) se para tras el historial, como con el mismo id: ni SSH (en firme) ni carpetas',
    pasos.join(' | ') === 'cerrar trabajo | parar trabajo | historial trabajo',
    pasos.join(' | ')
  )
}

hr('(21) Un perfil recién creado pide su carpeta ANTES de que llegue el guardado que lo trae (E66)')
{
  let lista: { id: string; nombre: string }[] = [{ id: 'beta', nombre: 'Beta' }]
  const llegada = new LlegadaDePerfiles(() => lista.map((p) => p.id), 1000)
  const pasos: string[] = []
  const espacio = {
    asegurar: (id: string, nombre: string) => {
      pasos.push(`asegurar ${id}|${nombre}`)
      return { projectHostPath: `terminal/${id}`, name: 'Terminal' }
    },
    rutas: () => ({})
  }
  const canal = espacioParaIpc(espacio, () => lista, new CandadoDeBorrado(), llegada)
  const handlers = new Map<string, (evento: unknown, req: unknown) => unknown>()
  const bd = {
    ensureWorkspace: (id: string, nombre: string) => {
      pasos.push(`espacio ${id}|${nombre}`)
      return { projectHostPath: `conexiones/${id}`, name: 'Datos' }
    }
  }
  registrarIpcBd({
    ipc: { handle: (canal: string, fn: (evento: unknown, req: unknown) => unknown) => void handlers.set(canal, fn) } as never,
    bd: bd as never,
    borrados: new CandadoDeBorrado(),
    perfiles: () => lista,
    llegada
  })
  const t0 = Date.now()
  const rechazos: string[] = []
  const anotarRechazo = (cual: string) => (err: unknown) => {
    rechazos.push(`${cual}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
  const terminal = canal.asegurar('nuevo').catch(anotarRechazo('terminal'))
  const datos = Promise.resolve(handlers.get(DB_CHANNELS.WORKSPACE_ENSURE)?.(null, { profileId: 'nuevo', nombrePerfil: 'Del renderer' })).catch(anotarRechazo('datos'))
  await respirar()
  check('(21a) mientras el guardado no llega, ninguno de los dos se prepara ni se rechaza', pasos.length === 0 && rechazos.length === 0, [...pasos, ...rechazos].join(' | '))
  // El guardado con debounce llega: `SAVE_PROFILES` sustituye la lista y avisa.
  lista = [...lista, { id: 'nuevo', nombre: 'Nuevo' }]
  llegada.cambiaron()
  const [r1, r2] = await Promise.all([terminal, datos])
  check(
    '(21b) en cuanto llega, los dos se preparan con el nombre del main, sin esperar al tope',
    (r1 as { projectHostPath: string } | null)?.projectHostPath === 'terminal/nuevo' &&
      (r2 as { projectHostPath: string } | null)?.projectHostPath === 'conexiones/nuevo' &&
      pasos.join(' | ') === 'asegurar nuevo|Nuevo | espacio nuevo|Nuevo' &&
      Date.now() - t0 < 900,
    `${pasos.join(' | ')} en ${Date.now() - t0} ms`
  )
}

hr('(22) La guarda sigue: un perfil que no llega se rechaza al agotar el tope, sin preparar nada')
{
  const lista = [{ id: 'beta', nombre: 'Beta' }]
  const llegada = new LlegadaDePerfiles(() => lista.map((p) => p.id), 60)
  const pasos: string[] = []
  const espacio = {
    asegurar: (id: string) => {
      pasos.push(`asegurar ${id}`)
      return { projectHostPath: `terminal/${id}`, name: 'Terminal' }
    },
    rutas: () => ({})
  }
  const canal = espacioParaIpc(espacio, () => lista, new CandadoDeBorrado(), llegada)
  const t0 = Date.now()
  let error = ''
  try {
    await canal.asegurar('fantasma')
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  const ms = Date.now() - t0
  check('(22a) «Ese perfil no existe» tras esperar el tope, y no se crea nada', /no existe/.test(error) && pasos.length === 0 && ms >= 50, `${error} (${ms} ms)`)
  const t1 = Date.now()
  const vivo = await canal.asegurar('beta')
  check('(22b) uno que ya existe no espera nada', vivo.projectHostPath === 'terminal/beta' && Date.now() - t1 < 50, `${Date.now() - t1} ms`)
  check('(22c) un id que no es texto no espera (lo rechaza la guarda)', (await Promise.race([llegada.esperar(7).then(() => 'ya'), new Promise((r) => setTimeout(() => r('esperando'), 30))])) === 'ya', 'esperar(7)')
}

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log(`\nVEREDICTO: ${passed}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
