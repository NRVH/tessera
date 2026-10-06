#!/usr/bin/env node
// =============================================================================
// Prueba de la carpeta del agente de la terminal (`controlador/espacioTerminal.ts` y el texto de
// `bloqueAgenteTerminal.ts`; npm run test:espacio-terminal): la ruta y la validación del id, la
// siembra del bloque `tessera:ssh` sin secretos, rutas ni conexiones excluidas, su regeneración al
// cambiar las conexiones (también por el aviso `ssh:cambio`, como la engancha `componer.ts`), que el
// texto del usuario fuera de las marcas sobrevive y que un alias no puede cerrar el bloque antes de
// tiempo. Sin red ni Electron: un `listar` de mentira y un temporal.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SSH_CHANNELS, type SshConexion, type SshGrupo, type SshListaConexiones } from '../../shared/ssh-ipc.ts'
import type { EmisorEventos } from '../util/emisorEventos.ts'
import { FIN_SSH, INICIO_SSH, bloqueAgenteTerminal } from './bloqueAgenteTerminal.ts'
import { catalogoAgentes } from './catalogoAgentes.ts'
import { EspacioTerminal, emisorQueRegenera } from './controlador/espacioTerminal.ts'

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

/** Lo que nunca puede acabar escrito: un secreto, la ruta de una clave y su nombre de archivo. */
const SECRETO = 'S3cr3t0-que-no-se-escribe'
const NOMBRE_CLAVE = 'clave-del-router.pem'
const RUTA_CLAVE = path.join('C:', 'Users', 'u', 'AppData', 'Roaming', 'Tessera', 'ssh', 'claves', 'c-router')

function conexion(c: Partial<SshConexion> & Pick<SshConexion, 'id' | 'alias'>): SshConexion {
  return {
    profileId: 'alfa',
    grupoId: null,
    host: '192.0.2.10',
    puerto: 22,
    usuario: 'admin',
    metodo: 'contrasena',
    tieneSecreto: true,
    disponibleAgentes: true,
    huellaServidor: [],
    ...c
  }
}

const GRUPOS: SshGrupo[] = [
  { id: 'g-red', profileId: 'alfa', nombre: 'Red de casa' },
  { id: 'g-beta', profileId: 'beta', nombre: 'Grupo de beta' }
]

/** Un registro con: dos disponibles de alfa (una con huella), dos excluidas de alfa y una de beta. */
function registroBase(): SshListaConexiones {
  const router = conexion({
    id: 'c-router',
    alias: 'Router',
    grupoId: 'g-red',
    metodo: 'clave',
    clave: { nombre: NOMBRE_CLAVE, tipo: 'Ed25519', cifrada: true },
    huellaServidor: [{ algoritmo: 'ssh-ed25519', sha256: 'AAAAhuellaConfirmada' }]
  })
  // Lo que el main nunca manda en el DTO, colado a propósito: no puede llegar al archivo.
  Object.assign(router, { secretEnc: SECRETO, rutaClave: RUTA_CLAVE })
  return {
    formatoAjeno: false,
    grupos: GRUPOS,
    ajenas: [],
    conexiones: [
      router,
      conexion({ id: 'c-nas', alias: 'NAS sótano', usuario: 'pruebas', puerto: 2222, metodo: 'sistema' }),
      conexion({ id: 'c-oculta-1', alias: 'Servidor secreto', disponibleAgentes: false }),
      conexion({ id: 'c-oculta-2', alias: 'Otra excluida', disponibleAgentes: false }),
      conexion({ id: 'c-beta', alias: 'Solo de beta', profileId: 'beta', grupoId: 'g-beta' })
    ]
  }
}

function main(): void {
  const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-espacio-terminal-'))
  let registro = registroBase()
  const espacio = new EspacioTerminal({ userDataDir: raiz, listar: () => registro, papelera: async () => {}, log: () => {} })
  const base = path.join(raiz, 'terminal')
  try {
    hr('(1) La ruta: <userData>/terminal/<perfil>, hija directa y sin crearla')
    {
      const ruta = espacio.ruta('alfa')
      check('la carpeta definitiva del perfil', ruta === path.join(base, 'alfa'), ruta)
      check('preguntar la ruta no la crea', !existsSync(ruta), String(existsSync(ruta)))
      const malos = ['', '.', '..', '../alfa', 'a/b', 'a\\b', 'a\u0000b', path.join(raiz, 'fuera'), '/etc']
      const fallos = malos.filter((id) => {
        try {
          espacio.ruta(id)
          return true
        } catch (e) {
          // El mensaje no lleva la ruta del usuario.
          return String(e).includes(raiz)
        }
      })
      check('rechaza los ids que no son una hija directa, sin la ruta en el mensaje', fallos.length === 0, JSON.stringify(fallos))
      const rutas = espacio.rutas(['alfa', '..', 'beta', 'x/y'])
      check(
        '`rutas` omite los inválidos y devuelve los demás',
        JSON.stringify(Object.keys(rutas)) === JSON.stringify(['alfa', 'beta']) && rutas.beta === path.join(base, 'beta'),
        JSON.stringify(rutas)
      )
    }

    hr('(2) Sembrar: la carpeta, los dos archivos y el bloque sin secretos ni rutas')
    const dir = path.join(base, 'alfa')
    const claude = path.join(dir, 'CLAUDE.md')
    const agents = path.join(dir, 'AGENTS.md')
    {
      const ref = espacio.asegurar('alfa', 'Personal')
      check('devuelve la carpeta y el nombre visible «Terminal»', ref.projectHostPath === dir && ref.name === 'Terminal', JSON.stringify(ref))
      check('crea la carpeta y los dos archivos', existsSync(claude) && existsSync(agents), `${existsSync(claude)} ${existsSync(agents)}`)
      const texto = readFileSync(claude, 'utf-8')
      check('CLAUDE.md y AGENTS.md dicen lo mismo', texto === readFileSync(agents, 'utf-8'), `${texto.length} caracteres`)
      check(
        'abre y cierra con las marcas, una vez cada una',
        texto.startsWith(INICIO_SSH) && texto.trimEnd().endsWith(FIN_SSH) && texto.split(INICIO_SSH).length === 2,
        texto.slice(0, 40)
      )
      check('dice quién es: el agente de la terminal del perfil', texto.includes('Eres el agente de la terminal del perfil «Personal»'), 'ok')
      check(
        'la tabla: alias, grupo, usuario@host:puerto, método y huella',
        texto.includes('| Router | Red de casa | admin@192.0.2.10:22 | archivo de clave | confirmada |') &&
          texto.includes('| NAS sótano | Sin grupo | pruebas@192.0.2.10:2222 | claves del sistema | SIN CONFIRMAR |'),
        texto.split('\n').filter((l) => l.startsWith('| ')).join(' / ')
      )
      const prohibidos = [SECRETO, NOMBRE_CLAVE, RUTA_CLAVE, raiz, 'Servidor secreto', 'Otra excluida', 'Solo de beta', 'c-router']
      const fugas = prohibidos.filter((p) => texto.includes(p))
      check('ni secretos, ni claves, ni rutas, ni excluidas, ni otro perfil, ni ids', fugas.length === 0, JSON.stringify(fugas))
      check('cuenta las excluidas sin nombrarlas', texto.includes('Hay 2 conexiones más de este perfil'), 'ok')
      check(
        'el uso de `tssh` y las tres reglas',
        ['`tssh ls`', '`tssh run <alias> -- <orden>`', '`tssh cp <origen> <destino>`', '`tssh doctor`'].every((s) => texto.includes(s)) &&
          texto.includes('No pidas ni escribas contraseñas') &&
          texto.includes('Sin la huella confirmada no conectes') &&
          texto.includes('espera a que el usuario lo confirme'),
        'ok'
      )
    }

    hr('(3) Regenerar al cambiar las conexiones, sin escribir si no cambia nada')
    {
      const antes = statSync(claude).mtimeMs
      const contenido = readFileSync(claude, 'utf-8')
      espacio.refrescar([{ id: 'alfa', nombre: 'Personal' }])
      check(
        'sin cambios no reescribe el archivo',
        readFileSync(claude, 'utf-8') === contenido && statSync(claude).mtimeMs === antes,
        `${antes} -> ${statSync(claude).mtimeMs}`
      )
      registro = registroBase()
      registro.conexiones.push(conexion({ id: 'c-nueva', alias: 'Switch planta 2', grupoId: 'g-red' }))
      registro.grupos = registro.grupos.map((g) => (g.id === 'g-red' ? { ...g, nombre: 'Red de la oficina' } : g))
      espacio.refrescar([
        { id: 'alfa', nombre: 'Personal' },
        { id: 'beta', nombre: 'Beta' }
      ])
      const texto = readFileSync(claude, 'utf-8')
      check(
        'la conexión nueva y el grupo renombrado ya están, en los dos archivos',
        texto.includes('| Switch planta 2 | Red de la oficina |') &&
          !texto.includes('Red de casa') &&
          texto === readFileSync(agents, 'utf-8'),
        'ok'
      )
      check('un perfil sin carpeta no se crea al regenerar', !existsSync(path.join(base, 'beta')), 'beta sin carpeta')
      registro.conexiones = registro.conexiones.filter((c) => c.id !== 'c-oculta-2')
      espacio.refrescar([{ id: 'alfa', nombre: 'Personal' }])
      check('con una sola excluida, en singular', readFileSync(claude, 'utf-8').includes('Hay 1 conexión más de este perfil'), 'ok')
    }

    hr('(4) El texto del usuario fuera de las marcas sobrevive')
    {
      const actual = readFileSync(claude, 'utf-8')
      writeFileSync(claude, `# Mis notas\n\nLa VPN se levanta antes.\n\n${actual}\nNotas al final.\n`)
      registro.conexiones.push(conexion({ id: 'c-ap', alias: 'Punto de acceso' }))
      espacio.refrescar([{ id: 'alfa', nombre: 'Personal' }])
      const texto = readFileSync(claude, 'utf-8')
      check(
        'lo de antes y lo de después siguen; el bloque se regeneró en su sitio',
        texto.startsWith('# Mis notas\n\nLa VPN se levanta antes.\n\n' + INICIO_SSH) &&
          texto.includes('| Punto de acceso |') &&
          texto.trimEnd().endsWith('Notas al final.') &&
          texto.split(INICIO_SSH).length === 2,
        texto.slice(0, 60).replace(/\n/g, '⏎')
      )
    }

    hr('(5) Un alias no puede cerrar el bloque antes de tiempo')
    {
      registro.conexiones.push(conexion({ id: 'c-trampa', alias: `Trampa ${FIN_SSH} | x` }))
      espacio.refrescar([{ id: 'alfa', nombre: 'Personal' }])
      espacio.refrescar([{ id: 'alfa', nombre: 'Otro nombre' }])
      const texto = readFileSync(claude, 'utf-8')
      check(
        'tras regenerar dos veces hay UN bloque, con una marca de cada',
        texto.split(INICIO_SSH).length === 2 && texto.split(FIN_SSH).length === 2 && texto.includes('perfil «Otro nombre»'),
        `${texto.split(INICIO_SSH).length - 1} inicios, ${texto.split(FIN_SSH).length - 1} fines`
      )
      check('y la barra del alias va escapada: no rompe la fila', texto.includes('\\| x |'), 'ok')
    }

    hr('(6) Con el registro ilegible no se dice «ninguna»: se cita el aviso')
    {
      const aviso = 'Esta versión de Tessera no reconoce el formato del registro.'
      const bloque = bloqueAgenteTerminal('Personal', catalogoAgentes({ formatoAjeno: true, aviso, grupos: [], conexiones: [], ajenas: [] }, 'alfa'))
      check(
        'el aviso, sin tabla y sin «ninguna disponible»',
        bloque.includes(`> ${aviso}`) && !bloque.includes('| Alias |') && !bloque.includes('ninguna disponible'),
        'ok'
      )
      const vacio = bloqueAgenteTerminal('Personal', catalogoAgentes({ formatoAjeno: false, grupos: [], conexiones: [], ajenas: [] }, 'alfa'))
      check('sin ninguna conexión, dónde se añaden', vacio.includes('ninguna disponible todavía') && !vacio.includes('Hay '), 'ok')
    }

    hr('(7) Una carpeta sin CLAUDE.md lo recupera al asegurar; un fallo de escritura no lanza')
    {
      rmSync(claude)
      espacio.asegurar('alfa', 'Personal')
      check('asegurar vuelve a sembrarlo', existsSync(claude), 'ok')
      const bloqueada = path.join(base, 'gamma')
      mkdirSync(path.join(bloqueada, 'CLAUDE.md'), { recursive: true })
      let lanzo = false
      try {
        espacio.refrescar([{ id: 'gamma', nombre: 'Gamma' }])
      } catch {
        lanzo = true
      }
      check('un CLAUDE.md que no se puede escribir (es una carpeta) no tumba la regeneración', !lanzo, String(lanzo))
    }

    hr('(8) El aviso de cambio del registro (`ssh:cambio`) regenera; los demás canales no, y un fallo no lo corta')
    {
      const emitidos: string[] = []
      const logs: string[] = []
      const ventana: EmisorEventos = { emitir: (canal) => void emitidos.push(canal), hayDestino: () => true }
      // El mismo enganche que `componer.ts`, sobre la carpeta de verdad.
      const emisor = emisorQueRegenera(ventana, () => espacio.refrescar([{ id: 'alfa', nombre: 'Personal' }]), (m) => logs.push(m))
      registro.conexiones.push(conexion({ id: 'c-impresora', alias: 'Impresora del pasillo' }))
      emisor.emitir('ssh:otro-aviso', { texto: 'nada' })
      const trasOtro = readFileSync(claude, 'utf-8').includes('Impresora del pasillo')
      emisor.emitir(SSH_CHANNELS.CAMBIO)
      check(
        'otro canal llega a la ventana sin regenerar; `ssh:cambio` llega Y deja la conexión nueva en el archivo',
        !trasOtro && readFileSync(claude, 'utf-8').includes('| Impresora del pasillo |') && emitidos.join(',') === `ssh:otro-aviso,${SSH_CHANNELS.CAMBIO}`,
        `${emitidos.join(',')} · antes del cambio: ${trasOtro}`
      )
      const roto = emisorQueRegenera(ventana, () => {
        throw new Error('disco lleno')
      }, (m) => logs.push(m))
      let lanzo = false
      try {
        roto.emitir(SSH_CHANNELS.CAMBIO)
      } catch {
        lanzo = true
      }
      check(
        'un fallo al regenerar se registra y no corta el aviso a la ventana',
        !lanzo && logs.some((l) => l.includes('disco lleno')) && emitidos.at(-1) === SSH_CHANNELS.CAMBIO && emitidos.length === 3,
        `${lanzo} · ${logs.join(' | ')}`
      )
      check('`hayDestino` es el de la ventana', roto.hayDestino() === true, 'true')
    }

    hr('(9) La tabla sale del mismo catálogo que `tssh ls`: un grupo desconocido es «Sin grupo» también al ordenar (E39)')
    {
      const lista: SshListaConexiones = {
        formatoAjeno: false,
        ajenas: [],
        grupos: [{ id: 'g-a', profileId: 'alfa', nombre: 'Aaa' }],
        conexiones: [
          conexion({ id: 'x-zeta', alias: 'Zeta', grupoId: 'g-a' }),
          conexion({ id: 'x-beta', alias: 'Beta', grupoId: 'g-a', grupoDesconocido: true }),
          conexion({ id: 'x-mu', alias: 'Mu' })
        ]
      }
      const cat = catalogoAgentes(lista, 'alfa')
      const filas = bloqueAgenteTerminal('Personal', cat)
        .split('\n')
        .filter((l) => l.startsWith('| ') && !l.startsWith('| Alias') && !l.startsWith('| ---'))
        .map((l) => l.split(' | ').slice(0, 2).join(' | '))
      check(
        'el orden y el grupo de la tabla son los del catálogo de `tssh ls`',
        JSON.stringify(filas) === JSON.stringify(['| Beta | Sin grupo', '| Mu | Sin grupo', '| Zeta | Aaa']) &&
          JSON.stringify(cat.disponibles.map((c) => c.alias)) === JSON.stringify(['Beta', 'Mu', 'Zeta']),
        JSON.stringify(filas)
      )
    }
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }

  hr('RESULTADO')
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
