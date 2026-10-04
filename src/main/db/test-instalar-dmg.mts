#!/usr/bin/env node
// =============================================================================
// Prueba de la instalación del Instant Client desde un .dmg (`instalarDmg.ts`) con un sistema de archivos
// en memoria y un ejecutor falso, así corre en Windows: las órdenes exactas (`hdiutil`, `cp -R -P -X`,
// `codesign`), el orden y el «desmontar siempre», la limpieza en cada fallo y el barrido de arranque.
// (node src/main/db/test-instalar-dmg.mts) `hdiutil`, `cp` y `codesign` de verdad, sin verificar en Mac aquí.
// Decisiones: docs/decisiones/bd/drivers-instalar-desde-dmg.md
// =============================================================================

import path from 'node:path'
import {
  CODESIGN,
  CP,
  HDIUTIL,
  barrerArranque,
  barrerMontajes,
  barrerRestos,
  entradasACopiar,
  esCopiaAMedias,
  esPuntoDeMontaje,
  huellaCoincide,
  instalarDesdeDmg,
  ordenCopiar,
  ordenDesmontar,
  ordenMontar,
  ordenVerificarFirma,
  requisitoFirma,
  rutasInstalacionDmg,
  type DepsInstalarDmg,
  type OrdenExterna,
  type PackDmg
} from './instalarDmg.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

async function falla(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// --- Un Mac de mentira -------------------------------------------------------

/**
 * Lo que trae la raíz del volumen del .dmg de Oracle (medido), en pequeño, y lo que el
 * sistema pone en la raíz de CUALQUIER volumen (lo que empieza por punto), que no es
 * del cliente y no se tiene que copiar.
 */
const CONTENIDO_DMG: Record<string, string | { enlace: string }> = {
  'libclntsh.dylib': { enlace: 'libclntsh.dylib.23.1' },
  'libclntsh.dylib.23.1': 'binario',
  'libclntshcore.dylib': { enlace: 'libclntshcore.dylib.23.1' },
  'libclntshcore.dylib.23.1': 'binario',
  'libnnz.dylib': 'binario',
  'install_ic.sh': 'guion',
  'INSTALL_IC_README.txt': 'léeme',
  BASIC_LITE_LICENSE: 'licencia',
  network: 'dir',
  'network/admin': 'dir',
  'network/admin/README': 'léeme',
  '.fseventsd': 'dir',
  '.fseventsd/fseventsd-uuid': 'x',
  '.Trashes': 'dir',
  '.DS_Store': 'x'
}
const OCULTAS_DMG = ['.fseventsd', '.Trashes', '.DS_Store']

interface Guion {
  fallaAttach?: boolean
  fallaCopia?: boolean
  fallaDetach?: boolean
  fallaDetachForzado?: boolean
  fallaFirma?: string
  sinCentinela?: boolean
  /** El volumen solo trae lo que pone el sistema (nada visible). */
  soloOcultas?: boolean
}

/**
 * Sistema de archivos en memoria (rutas -> 'dir' | contenido) con enlaces, y un
 * ejecutor que «hace» lo que harían hdiutil, cp y codesign sobre él. Cada volumen
 * montado es OTRO dispositivo (2); el resto del disco, el 1.
 */
function macFalso(guion: Guion = {}) {
  const nodos = new Map<string, string>()
  const enlaces = new Map<string, string>()
  const ordenes: OrdenExterna[] = []
  const logs: string[] = []
  const montados = new Set<string>()
  /** Rutas cuyo lstat falla (una carpeta que no se puede examinar). */
  const ilegibles = new Set<string>()

  const hijos = (dir: string): string[] =>
    [...nodos.keys()].filter((k) => path.dirname(k) === dir).map((k) => path.basename(k))
  const bajo = (dir: string): string[] => [...nodos.keys()].filter((k) => k === dir || k.startsWith(dir + path.sep))
  const dentroDeMontaje = (r: string): boolean => [...montados].some((m) => r === m || r.startsWith(m + path.sep))

  const deps: DepsInstalarDmg = {
    ejecutar: async (o) => {
      ordenes.push(o)
      const [verbo] = o.args
      if (o.cmd === HDIUTIL && verbo === 'attach') {
        if (guion.fallaAttach) throw new Error('hdiutil attach: no mountable file systems')
        const montaje = o.args[o.args.indexOf('-mountpoint') + 1]
        montados.add(montaje)
        for (const [nombre, c] of Object.entries(CONTENIDO_DMG)) {
          if (guion.sinCentinela && nombre === 'libclntsh.dylib') continue
          if (guion.soloOcultas && !nombre.startsWith('.')) continue
          const r = path.join(montaje, ...nombre.split('/'))
          if (typeof c === 'string') nodos.set(r, c)
          else {
            nodos.set(r, 'enlace')
            enlaces.set(r, path.join(montaje, c.enlace))
          }
        }
        return
      }
      if (o.cmd === CP) {
        const opciones = o.args.filter((a) => a.startsWith('-'))
        const rutas = o.args.filter((a) => !a.startsWith('-'))
        const destino = rutas[rutas.length - 1]
        const fuentes = rutas.slice(0, -1)
        if (opciones.join(' ') !== '-R -P -X') throw new Error(`cp: opciones inesperadas ${opciones.join(' ')}`)
        if (!nodos.has(destino)) throw new Error(`cp: ${destino}: No such file or directory`)
        if (guion.fallaCopia) {
          nodos.set(path.join(destino, 'a-medias'), 'x')
          throw new Error('cp: No space left on device')
        }
        // `.Trashes` de un volumen real suele venir sin permiso de lectura.
        if (fuentes.some((f) => path.basename(f) === '.Trashes')) throw new Error('cp: .Trashes: Permission denied')
        for (const fuente of fuentes) {
          // Cada fuente, DENTRO del destino con su nombre; con -P, un enlace sigue siendo enlace.
          const base = path.join(destino, path.basename(fuente))
          for (const k of bajo(fuente)) {
            const nuevo = base + k.slice(fuente.length)
            nodos.set(nuevo, nodos.get(k)!)
            const e = enlaces.get(k)
            if (e) enlaces.set(nuevo, path.join(destino, path.relative(path.dirname(fuente), e)))
          }
        }
        return
      }
      if (o.cmd === HDIUTIL && verbo === 'detach') {
        const forzado = o.args.includes('-force')
        if (!forzado && guion.fallaDetach) throw new Error('hdiutil detach: resource busy')
        if (forzado && guion.fallaDetachForzado) throw new Error('hdiutil detach: no se pudo')
        const montaje = o.args[1]
        if (!montados.has(montaje)) throw new Error('hdiutil detach: no such file or directory')
        montados.delete(montaje)
        for (const k of bajo(montaje)) if (k !== montaje) nodos.delete(k)
        return
      }
      if (o.cmd === CODESIGN) {
        const archivo = o.args[o.args.length - 1]
        if (guion.fallaFirma && archivo.endsWith(guion.fallaFirma)) {
          throw new Error(`${archivo}: code object is not signed at all`)
        }
        return
      }
      throw new Error(`orden inesperada: ${o.cmd}`)
    },
    existe: (r) => {
      const real = enlaces.get(r)
      return real !== undefined ? nodos.has(real) : nodos.has(r)
    },
    crearCarpeta: (r) => {
      nodos.set(r, 'dir')
    },
    borrar: (r) => {
      if (montados.has(r)) throw new Error('PELIGRO: borrado recursivo sobre un montaje')
      for (const k of bajo(r)) {
        nodos.delete(k)
        enlaces.delete(k)
      }
    },
    quitarCarpetaVacia: (r) => {
      if (!nodos.has(r)) throw new Error('ENOENT')
      if (enlaces.has(r)) throw new Error('ENOTDIR')
      if (bajo(r).length > 1) throw new Error('ENOTEMPTY')
      nodos.delete(r)
    },
    renombrar: (de, a) => {
      for (const k of bajo(de)) {
        const nuevo = a + k.slice(de.length)
        nodos.set(nuevo, nodos.get(k)!)
        nodos.delete(k)
        const e = enlaces.get(k)
        if (e) {
          enlaces.set(nuevo, a + e.slice(de.length))
          enlaces.delete(k)
        }
      }
    },
    rutaReal: (r) => enlaces.get(r) ?? r,
    listar: (r) => hijos(r),
    // lstat: un ENLACE es del disco en el que está, aunque apunte a un volumen montado.
    dispositivo: (r) => {
      if (ilegibles.has(r)) throw new Error(`EACCES: ${r}`)
      if (enlaces.has(r)) return 1
      return dentroDeMontaje(r) ? 2 : 1
    },
    log: (m) => logs.push(m)
  }
  return { deps, nodos, enlaces, ordenes, logs, montados, ilegibles }
}

const DRIVERS = path.join('/Users/ana/Library/Application Support/Tessera', 'drivers')
const PACK = { id: 'oracle-ic-23-macos-arm64', motor: 'oracle' }
const PACK_DMG: PackDmg = {
  centinela: 'libclntsh.dylib',
  firma: { teamId: 'VB5E2TV963', archivos: ['libclntsh.dylib', 'libclntshcore.dylib', 'libnnz.dylib'] },
  sobrantes: ['install_ic.sh', 'INSTALL_IC_README.txt']
}

/** Una instalación con el .dmg ya descargado (lo que deja `DriverManager`). */
function preparar(guion: Guion = {}) {
  const m = macFalso(guion)
  const rutas = rutasInstalacionDmg(DRIVERS, PACK)
  m.nodos.set(rutas.dmg, 'imagen')
  return { ...m, rutas }
}

const resumen = (os: OrdenExterna[]): string =>
  os.map((o) => `${path.basename(o.cmd)} ${o.args[0]}${o.args.includes('-force') ? ' -force' : ''}`).join(' > ')

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  hr('(1) Las órdenes: rutas absolutas, sin shell, un argumento por ruta')
  // -------------------------------------------------------------------------
  const rutas = rutasInstalacionDmg(DRIVERS, PACK)
  check(
    'rutas: destino el de siempre (<drivers>/oracle/<id>), montaje y descarga bajo carpetas propias',
    rutas.destino === path.join(DRIVERS, 'oracle', PACK.id) &&
      rutas.montaje === path.join(DRIVERS, '.montajes', PACK.id) &&
      rutas.dmg === path.join(DRIVERS, '.descargas', `${PACK.id}.dmg`) &&
      path.dirname(rutas.destinoTmp) === path.dirname(rutas.destino) &&
      esCopiaAMedias(path.basename(rutas.destinoTmp)),
    JSON.stringify(rutas)
  )
  const montar = ordenMontar(rutas.dmg, rutas.montaje)
  check(
    'attach: /usr/bin/hdiutil, solo lectura, sin Finder ni ventana, en NUESTRO punto (no /Volumes)',
    montar.cmd === '/usr/bin/hdiutil' &&
      JSON.stringify(montar.args) ===
        JSON.stringify(['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', rutas.montaje, rutas.dmg]) &&
      !montar.args.some((a) => a.startsWith('/Volumes')),
    montar.args.join(' | ')
  )
  check(
    'la ruta con espacios va ENTERA en un argumento (sin shell no hay entrecomillado que romper)',
    montar.args.includes(rutas.montaje) && rutas.montaje.includes('Application Support'),
    rutas.montaje
  )
  const copiar = ordenCopiar(rutas.montaje, ['libclntsh.dylib', 'network'], rutas.destinoTmp)
  check(
    'copia: /bin/cp -R -P -X (enlaces intactos, sin atributos ni cuarentena), una ruta por entrada y el destino al final',
    copiar.cmd === '/bin/cp' &&
      JSON.stringify(copiar.args) ===
        JSON.stringify([
          '-R',
          '-P',
          '-X',
          path.join(rutas.montaje, 'libclntsh.dylib'),
          path.join(rutas.montaje, 'network'),
          rutas.destinoTmp
        ]),
    copiar.args.join(' | ')
  )
  check(
    'entradas a copiar: solo las VISIBLES y en orden estable (como el `*` del install_ic.sh de Oracle)',
    JSON.stringify(entradasACopiar(['libnnz.dylib', '.fseventsd', '.Trashes', '.DS_Store', 'BASIC_LITE_LICENSE', '', '.VolumeIcon.icns', 'network'])) ===
      JSON.stringify(['BASIC_LITE_LICENSE', 'libnnz.dylib', 'network']),
    JSON.stringify(entradasACopiar(['libnnz.dylib', '.fseventsd', '.Trashes', 'network']))
  )
  check(
    'detach normal y forzado',
    JSON.stringify(ordenDesmontar('/m', false)) === JSON.stringify({ cmd: '/usr/bin/hdiutil', args: ['detach', '/m'] }) &&
      JSON.stringify(ordenDesmontar('/m', true)) ===
        JSON.stringify({ cmd: '/usr/bin/hdiutil', args: ['detach', '/m', '-force'] }),
    'ok'
  )
  const firma = ordenVerificarFirma('/x/libclntsh.dylib.23.1', 'VB5E2TV963')
  check(
    'codesign: --verify --strict contra ancla de Apple Y Team ID de Oracle, como TEXTO (=)',
    firma.cmd === '/usr/bin/codesign' &&
      JSON.stringify(firma.args) ===
        JSON.stringify([
          '--verify',
          '--strict',
          '-R',
          '=anchor apple generic and certificate leaf[subject.OU] = "VB5E2TV963"',
          '/x/libclntsh.dylib.23.1'
        ]) &&
      requisitoFirma('ABC').startsWith('=anchor apple generic and '),
    firma.args.join(' | ')
  )

  // -------------------------------------------------------------------------
  hr('(2) Instalación completa')
  // -------------------------------------------------------------------------
  {
    const m = preparar()
    await instalarDesdeDmg(m.deps, m.rutas, PACK_DMG)
    check(
      'orden: attach > cp > detach > codesign ×3 (tras desmontar: se firma la COPIA)',
      resumen(m.ordenes) === 'hdiutil attach > cp -R > hdiutil detach > codesign --verify > codesign --verify > codesign --verify',
      resumen(m.ordenes)
    )
    const cent = path.join(m.rutas.destino, 'libclntsh.dylib')
    check(
      'el centinela queda en el destino COMO ENLACE a libclntsh.dylib.23.1',
      m.nodos.get(cent) === 'enlace' && m.enlaces.get(cent) === path.join(m.rutas.destino, 'libclntsh.dylib.23.1'),
      String(m.enlaces.get(cent))
    )
    const firmados = m.ordenes.filter((o) => o.cmd === CODESIGN).map((o) => path.basename(o.args[o.args.length - 1]))
    check(
      'la firma se comprueba sobre el binario REAL de cada enlace',
      firmados.join(',') === 'libclntsh.dylib.23.1,libclntshcore.dylib.23.1,libnnz.dylib',
      firmados.join(',')
    )
    check(
      'sin install_ic.sh ni su README; la licencia y la subcarpeta network/admin se quedan',
      !m.nodos.has(path.join(m.rutas.destino, 'install_ic.sh')) &&
        !m.nodos.has(path.join(m.rutas.destino, 'INSTALL_IC_README.txt')) &&
        m.nodos.has(path.join(m.rutas.destino, 'BASIC_LITE_LICENSE')) &&
        m.nodos.has(path.join(m.rutas.destino, 'network', 'admin', 'README')),
      'ok'
    )
    const cp = m.ordenes.find((o) => o.cmd === CP)
    const ocultasEnDestino = m.deps.listar(m.rutas.destino).filter((n) => n.startsWith('.'))
    check(
      'NI .fseventsd, ni .Trashes, ni .DS_Store: ni en la orden de copia ni en el destino',
      cp !== undefined &&
        !cp.args.some((a) => OCULTAS_DMG.includes(path.basename(a))) &&
        ocultasEnDestino.length === 0,
      JSON.stringify({ args: cp?.args.map((a) => path.basename(a)), ocultasEnDestino })
    )
    check(
      'limpio: sin .instalando, sin .dmg, desmontado y sin la carpeta del montaje',
      !m.deps.existe(m.rutas.destinoTmp) &&
        !m.nodos.has(m.rutas.dmg) &&
        m.montados.size === 0 &&
        !m.nodos.has(m.rutas.montaje),
      JSON.stringify({ montados: m.montados.size })
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) Fallos: desmontar SIEMPRE y no dejar nada a medias')
  // -------------------------------------------------------------------------
  {
    const m = preparar({ fallaCopia: true })
    const err = await falla(() => instalarDesdeDmg(m.deps, m.rutas, PACK_DMG))
    check(
      'la copia falla: se desmonta IGUAL y el error lo dice',
      err !== null && err.includes('No se pudo copiar') && resumen(m.ordenes) === 'hdiutil attach > cp -R > hdiutil detach',
      `${err} :: ${resumen(m.ordenes)}`
    )
    check(
      '… y no queda .instalando, ni .dmg, ni destino, ni montaje',
      !m.nodos.has(m.rutas.destinoTmp) &&
        !m.nodos.has(path.join(m.rutas.destinoTmp, 'a-medias')) &&
        !m.nodos.has(m.rutas.dmg) &&
        !m.nodos.has(m.rutas.destino) &&
        m.montados.size === 0,
      'limpio'
    )
  }
  {
    const m = preparar({ soloOcultas: true })
    const err = await falla(() => instalarDesdeDmg(m.deps, m.rutas, PACK_DMG))
    check(
      'un volumen sin nada visible: «vacía», ninguna copia, y se desmonta igual',
      err !== null && err.includes('vacía') && resumen(m.ordenes) === 'hdiutil attach > hdiutil detach' && m.montados.size === 0,
      `${err} :: ${resumen(m.ordenes)}`
    )
  }
  {
    const m = preparar({ fallaDetach: true })
    await instalarDesdeDmg(m.deps, m.rutas, PACK_DMG)
    check(
      'detach falla: se fuerza, y la instalación sigue (la copia estaba bien)',
      resumen(m.ordenes).startsWith('hdiutil attach > cp -R > hdiutil detach > hdiutil detach -force > codesign') &&
        m.deps.existe(path.join(m.rutas.destino, 'libclntsh.dylib')) &&
        m.montados.size === 0,
      resumen(m.ordenes)
    )
  }
  {
    const m = preparar({ fallaDetach: true, fallaDetachForzado: true })
    await instalarDesdeDmg(m.deps, m.rutas, PACK_DMG)
    check(
      'ni forzando: instala igual, NO borra el punto de montaje (sigue montado) y lo deja para el barrido',
      m.deps.existe(path.join(m.rutas.destino, 'libclntsh.dylib')) &&
        m.montados.has(m.rutas.montaje) &&
        m.nodos.has(m.rutas.montaje) &&
        m.logs.some((l) => l.includes('barrido')),
      JSON.stringify(m.logs)
    )
  }
  {
    const m = preparar({ fallaAttach: true })
    const err = await falla(() => instalarDesdeDmg(m.deps, m.rutas, PACK_DMG))
    check(
      'attach falla: ni copia ni detach, error «montar», y se quitan el punto de montaje y el .dmg',
      err !== null &&
        err.includes('No se pudo montar') &&
        resumen(m.ordenes) === 'hdiutil attach' &&
        !m.nodos.has(m.rutas.montaje) &&
        !m.nodos.has(m.rutas.dmg),
      `${err} :: ${resumen(m.ordenes)}`
    )
  }
  {
    const m = preparar({ fallaFirma: 'libnnz.dylib' })
    const err = await falla(() => instalarDesdeDmg(m.deps, m.rutas, PACK_DMG))
    check(
      'firma que no es de Oracle: falla nombrando el archivo y el Team ID; nada instalado',
      err !== null &&
        err.includes('libnnz.dylib') &&
        err.includes('VB5E2TV963') &&
        !m.nodos.has(m.rutas.destino) &&
        !m.nodos.has(m.rutas.destinoTmp) &&
        !m.nodos.has(m.rutas.dmg) &&
        m.montados.size === 0,
      String(err)
    )
  }
  {
    const m = preparar({ sinCentinela: true })
    const err = await falla(() => instalarDesdeDmg(m.deps, m.rutas, PACK_DMG))
    check(
      'imagen sin libclntsh.dylib: falla con el centinela y sin llegar a firmar',
      err !== null && err.includes('libclntsh.dylib') && !m.ordenes.some((o) => o.cmd === CODESIGN) && !m.nodos.has(m.rutas.destino),
      String(err)
    )
  }
  {
    // Un destino previo (una instalación rota que ya no tiene centinela): solo se
    // sustituye cuando TODO pasó.
    const m = preparar({ fallaFirma: 'libclntsh.dylib.23.1' })
    m.nodos.set(m.rutas.destino, 'dir')
    m.nodos.set(path.join(m.rutas.destino, 'viejo.txt'), 'x')
    await falla(() => instalarDesdeDmg(m.deps, m.rutas, PACK_DMG))
    check(
      'un fallo no toca lo que hubiera en el destino (el renombrado es lo último)',
      m.nodos.has(path.join(m.rutas.destino, 'viejo.txt')),
      'intacto'
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) Montajes huérfanos: solo se desmonta lo que ES un punto de montaje')
  // -------------------------------------------------------------------------
  {
    // Una app que murió entre montar y desmontar: el siguiente intento lo desmonta ANTES.
    const m = preparar()
    m.nodos.set(m.rutas.montaje, 'dir')
    m.montados.add(m.rutas.montaje)
    m.nodos.set(path.join(m.rutas.montaje, 'libnnz.dylib'), 'binario')
    await instalarDesdeDmg(m.deps, m.rutas, PACK_DMG)
    check(
      'resto de un intento anterior MONTADO: detach -force de NUESTRO montaje antes del attach',
      resumen(m.ordenes).startsWith('hdiutil detach -force > hdiutil attach') &&
        m.ordenes[0].args[1] === m.rutas.montaje &&
        m.deps.existe(path.join(m.rutas.destino, 'libclntsh.dylib')),
      resumen(m.ordenes)
    )
  }
  {
    // Lo normal tras un fallo: la carpeta quedó, VACÍA y sin nada montado.
    const m = preparar()
    m.nodos.set(m.rutas.montaje, 'dir')
    await instalarDesdeDmg(m.deps, m.rutas, PACK_DMG)
    check(
      'resto de un intento anterior SIN montar: ningún detach (solo rmdir) y la instalación sigue',
      resumen(m.ordenes).startsWith('hdiutil attach > cp -R') &&
        m.deps.existe(path.join(m.rutas.destino, 'libclntsh.dylib')),
      resumen(m.ordenes)
    )
  }
  {
    const m = macFalso()
    const dir = path.join(DRIVERS, '.montajes')
    const a = path.join(dir, 'a')
    const b = path.join(dir, 'b')
    const c = path.join(dir, 'c')
    const enlace = path.join(dir, 'enlace')
    const ilegible = path.join(dir, 'ilegible')
    const volumenUsuario = '/Volumes/Usuario'
    m.nodos.set(dir, 'dir')
    m.nodos.set(a, 'dir')
    m.nodos.set(b, 'dir')
    m.nodos.set(c, 'dir')
    m.nodos.set(path.join(c, 'algo.txt'), 'x')
    m.montados.add(a)
    m.nodos.set(path.join(a, 'x'), 'x')
    // Un enlace a un volumen del usuario: lstat no lo sigue, así que NO es un punto de montaje.
    m.montados.add(volumenUsuario)
    m.nodos.set(volumenUsuario, 'dir')
    m.nodos.set(enlace, 'enlace')
    m.enlaces.set(enlace, volumenUsuario)
    m.nodos.set(ilegible, 'dir')
    m.ilegibles.add(ilegible)
    const n = await barrerMontajes(m.deps, dir)
    check(
      'barrido: desmonta lo montado y quita su carpeta',
      n === 1 && !m.montados.has(a) && !m.nodos.has(a),
      `${n} :: ${resumen(m.ordenes)}`
    )
    check(
      'NEGATIVO: una carpeta NORMAL, un enlace a otro volumen o una que no se puede examinar NO reciben hdiutil detach',
      m.ordenes.length === 1 && m.ordenes[0].args[1] === a,
      m.ordenes.map((o) => `${o.args.join(' ')}`).join(' ; ')
    )
    check(
      '… la vacía se quita con rmdir; la que tiene algo, el enlace y la ilegible se quedan como estaban, y el volumen del usuario sigue montado',
      !m.nodos.has(b) &&
        m.nodos.has(path.join(c, 'algo.txt')) &&
        m.nodos.has(enlace) &&
        m.nodos.has(ilegible) &&
        m.montados.has(volumenUsuario),
      JSON.stringify({ b: m.nodos.has(b), c: m.nodos.has(c), enlace: m.nodos.has(enlace), usuario: m.montados.has(volumenUsuario) })
    )
    check(
      'esPuntoDeMontaje: sí / no / no se sabe',
      esPuntoDeMontaje({ dispositivo: (r) => (r.endsWith('m') ? 2 : 1) }, path.join('/d', 'm')) === true &&
        esPuntoDeMontaje({ dispositivo: () => 1 }, path.join('/d', 'm')) === false &&
        esPuntoDeMontaje(
          {
            dispositivo: () => {
              throw new Error('EACCES')
            }
          },
          path.join('/d', 'm')
        ) === null,
      'ok'
    )
    const vacio = macFalso()
    check(
      'barrido sin carpeta de montajes: 0 y ninguna orden',
      (await barrerMontajes(vacio.deps, dir)) === 0 && vacio.ordenes.length === 0,
      'ok'
    )
  }

  // -------------------------------------------------------------------------
  hr('(5) Restos de una instalación que murió: el barrido de arranque los borra')
  // -------------------------------------------------------------------------
  {
    const m = macFalso()
    const descargas = path.join(DRIVERS, '.descargas')
    const oracle = path.join(DRIVERS, 'oracle')
    const instalado = path.join(oracle, PACK.id)
    const aMedias = path.join(oracle, `.${PACK.id}.instalando`)
    const otroMotor = path.join(DRIVERS, 'postgres', '.pg.instalando')
    const ajenoOculto = path.join(oracle, '.notas')
    const montaje = path.join(DRIVERS, '.montajes', PACK.id)
    const fuera = path.join(path.dirname(DRIVERS), '.descargas', 'no-es-nuestro.dmg')
    for (const d of [DRIVERS, descargas, oracle, instalado, aMedias, path.dirname(otroMotor), otroMotor, path.dirname(montaje), montaje, path.dirname(fuera)]) {
      m.nodos.set(d, 'dir')
    }
    m.nodos.set(path.join(descargas, `${PACK.id}.dmg`), 'imagen')
    m.nodos.set(path.join(instalado, 'libclntsh.dylib.23.1'), 'binario')
    m.nodos.set(path.join(aMedias, 'libclntsh.dylib.23.1'), 'binario')
    m.nodos.set(path.join(otroMotor, 'x'), 'x')
    m.nodos.set(ajenoOculto, 'x')
    m.nodos.set(path.join(DRIVERS, 'catalogo.json'), '{}')
    m.nodos.set(fuera, 'imagen')
    m.montados.add(montaje)
    m.nodos.set(path.join(montaje, 'libnnz.dylib'), 'binario')
    const r = await barrerArranque(m.deps, DRIVERS)
    check(
      'borra el .dmg de .descargas y las copias .<pack>.instalando de cada motor',
      !m.nodos.has(path.join(descargas, `${PACK.id}.dmg`)) && !m.nodos.has(aMedias) && !m.nodos.has(otroMotor) && r.restos.length === 3,
      JSON.stringify(r.restos.map((x) => path.relative(DRIVERS, x)))
    )
    check(
      'NEGATIVO: el pack INSTALADO, otros ocultos que no son .instalando, catalogo.json y lo de FUERA de drivers se quedan',
      m.nodos.has(path.join(instalado, 'libclntsh.dylib.23.1')) &&
        m.nodos.has(ajenoOculto) &&
        m.nodos.has(path.join(DRIVERS, 'catalogo.json')) &&
        m.nodos.has(fuera),
      'intactos'
    )
    check(
      'primero desmonta (lo montado deja de estarlo) y nunca borra en recursivo un montaje',
      r.montajes === 1 && m.montados.size === 0 && !m.logs.some((l) => l.includes('PELIGRO')),
      JSON.stringify({ montajes: r.montajes, logs: m.logs })
    )
    const vacio = macFalso()
    const r0 = await barrerArranque(vacio.deps, DRIVERS)
    check(
      'sin carpeta de drivers: nada que hacer, ni órdenes ni errores',
      r0.montajes === 0 && r0.restos.length === 0 && vacio.ordenes.length === 0,
      JSON.stringify(r0)
    )
    const falloBorrar = macFalso()
    falloBorrar.nodos.set(path.join(DRIVERS, '.descargas'), 'dir')
    falloBorrar.nodos.set(path.join(DRIVERS, '.descargas', 'x.dmg'), 'imagen')
    falloBorrar.deps.borrar = () => {
      throw new Error('EBUSY')
    }
    check(
      'un borrado que falla no lanza: se registra y se sigue',
      barrerRestos(falloBorrar.deps, DRIVERS).length === 0 && falloBorrar.logs.some((l) => l.includes('EBUSY')),
      JSON.stringify(falloBorrar.logs)
    )
  }

  check(
    'huellaCoincide: sin caja ni espacios; exige 64 hex en la esperada',
    huellaCoincide('ABCDEF'.padEnd(64, '0'), ' abcdef'.padEnd(65, '0')) &&
      !huellaCoincide('a'.repeat(64), 'b'.repeat(64)) &&
      !huellaCoincide('', '') &&
      !huellaCoincide('zz', 'zz'),
    'ok'
  )

  // -------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
