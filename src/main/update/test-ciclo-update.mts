#!/usr/bin/env node
// =============================================================================
// Prueba del CICLO de actualización con un `SistemaUpdate` falso (npm run test:ciclo-update):
// el ciclo sin inicializar (`planDeCierre` da «ninguno» y no lanza), `sembrarDesdeMarcador` con
// un marcador real en una `userData` temporal (preparada, aplicada y fallida) y `planDeCierre`
// empaquetada con y sin descarga lista, `anticiparRelevo` (cuándo lanza el relevo y que un cierre
// abortado lo cancela) y la vuelta a la versión anterior desde la copia del relevo, con robocopy de
// verdad en un temporal. Sin `electron`: las rutas entran por `fijarInfoApp` y el
// resto por el doble; el resolver-hook solo reintenta con `.ts` los imports sin extensión.
// =============================================================================

import { register } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('el ciclo de actualización importó electron desde ' + ctx.parentURL)
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))

const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-ciclo-update-'))
// La copia del relevo vive en LOCALAPPDATA: la de la prueba, en el temporal y no en la del usuario.
process.env.LOCALAPPDATA = path.join(raiz, 'local')

const { ciclo, fijarSistema, motor, sistema, seAplicaAlCerrarAhora } = await import('./nucleo.ts')
const { anticiparRelevo, cancelarRelevoAnticipado, planDeCierre, runInstaller } = await import('./instalacion.ts')
const { restaurarAnterior } = await import('../relevo/supervisor.ts')
const { ENCARGO_VERSION } = await import('../../shared/relevo.ts')
const { dirRelevo, exeRelevo, NOMBRE_ENCARGO } = await import('./stagingRelevo.ts')
const { sembrarDesdeMarcador } = await import('./arranque.ts')
await import('./chequeo.ts')
await import('./preparacionMac.ts')
const { guardarMarcador, leerMarcador, rutaMarcador } = await import('./marcadorUpdate.ts')
const { nuevoMarcador, marcadorConIntento } = await import('./marcadorUpdatePuro.ts')
const { fijarInfoApp } = await import('../util/infoApp.ts')
const { initialUpdateState } = await import('../../shared/update-ipc.ts')
const { capacidades, esMac, esWindows } = await import('../../shared/plataforma.ts')
type SistemaUpdate = import('./adaptadores/sistemaElectron.ts').SistemaUpdate

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
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const j = (v: unknown): string => JSON.stringify(v)

const userData = path.join(raiz, 'userData')
mkdirSync(userData, { recursive: true })
// En Mac la regla «¿se puede sustituir el .app?» mira el bundle del ejecutable: uno en el temporal.
const exe = esMac() ? path.join(raiz, 'Tessera.app', 'Contents', 'MacOS', 'Tessera') : path.join(raiz, 'Tessera.exe')
mkdirSync(path.dirname(exe), { recursive: true })
fijarInfoApp({
  rutaUserData: () => userData,
  rutaAppData: () => path.join(raiz, 'appData'),
  rutaExe: () => exe,
  rutaAppPath: () => path.join(raiz, 'resources', 'app.asar'),
  versionApp: () => '1.2.0',
  appEmpaquetada: () => true
})

/** El doble: lo que el ciclo difunde se apunta, y las dos lecturas de la raíz se controlan. */
function sistemaFalso(o: { version: string; aplicarAlCerrar?: () => boolean; trasActualizar?: boolean }): SistemaUpdate & {
  difundidos: unknown[]
} {
  const difundidos: unknown[] = []
  return {
    difundidos,
    empaquetada: true,
    version: () => o.version,
    motor: () => {
      throw new Error('esta prueba no usa el motor')
    },
    salir: () => {},
    difundir: (_canal, carga) => void difundidos.push(carga),
    hayVentanaEnfocada: () => false,
    alEnfocar: () => {},
    quitarAlEnfocar: () => {},
    alDesenfocar: () => {},
    quitarAlDesenfocar: () => {},
    alSuspender: () => {},
    alReanudar: () => {},
    abrirExterno: async () => {},
    peticionGet: () => {
      throw new Error('esta prueba no usa la red')
    },
    leerAplicarAlCerrar: o.aplicarAlCerrar ?? (() => true),
    esArranqueTrasActualizar: () => o.trasActualizar ?? false,
    revelarEnCarpeta: () => {},
    abrirRuta: async () => ''
  }
}

/** Deja el ciclo como al empezar una sesión empaquetada, con el sistema dado. */
function reiniciarCiclo(s: SistemaUpdate): void {
  fijarSistema(s)
  ciclo.state = initialUpdateState(s.version(), true)
  ciclo.marcador = null
  ciclo.motorArmado = false
  ciclo.chequeoConcluido = false
}

/** Un instalador «descargado» y su marcador en la `userData` temporal. */
function prepararMarcador(versionDestino: string): string {
  const instalador = path.join(userData, 'pending', `Tessera-Setup-${versionDestino}.exe`)
  mkdirSync(path.dirname(instalador), { recursive: true })
  writeFileSync(instalador, 'instalador de mentira')
  guardarMarcador(
    nuevoMarcador({ versionDestino, versionOrigen: '1.2.0', rutaInstalador: instalador, ahora: new Date(), motor: esMac() ? 'relevo-mac' : 'nsis' })
  )
  return instalador
}

try {
  // ---------------------------------------------------------------------------------
  hr('(1) Sin inicializar: el sistema inerte')
  {
    check('antes de initAutoUpdate el sistema no está empaquetado', sistema().empaquetada === false, `empaquetada=${sistema().empaquetada}`)
    let plan: unknown = null
    let lanzo: unknown = null
    try {
      plan = planDeCierre()
    } catch (e) {
      lanzo = e
    }
    check(
      'planDeCierre() da «ninguno» y no lanza (el cierre no se queda a medias)',
      lanzo === null && (plan as { tipo?: string })?.tipo === 'ninguno',
      lanzo === null ? j(plan) : String(lanzo)
    )
    check('seAplicaAlCerrarAhora() es false', seAplicaAlCerrarAhora() === false, String(seAplicaAlCerrarAhora()))
    let errMotor = ''
    try {
      motor()
    } catch (e) {
      errMotor = e instanceof Error ? e.message : String(e)
    }
    check('el motor sin inicializar lanza con un motivo claro', /no está inicializado/.test(errMotor), errMotor || 'no lanzó')
  }

  // ---------------------------------------------------------------------------------
  hr('(2) sembrarDesdeMarcador: una actualización preparada en un arranque anterior')
  {
    const s = sistemaFalso({ version: '1.2.0' })
    reiniciarCiclo(s)
    const instalador = prepararMarcador('1.3.0')
    check('el marcador vive en la userData inyectada', rutaMarcador() === path.join(userData, 'pending_update.json') && existsSync(rutaMarcador()), rutaMarcador())
    sembrarDesdeMarcador()
    if (capacidades().autoInstalarUpdate) {
      check(
        'se siembra «ready», preparada desde el arranque y con el instalador',
        ciclo.state.status === 'ready' &&
          ciclo.state.newVersion === '1.3.0' &&
          ciclo.state.preparadaDesdeArranque &&
          ciclo.state.installerPath === instalador,
        j({ status: ciclo.state.status, v: ciclo.state.newVersion, desdeArranque: ciclo.state.preparadaDesdeArranque })
      )
      check('el marcador queda en memoria y en disco', ciclo.marcador?.versionDestino === '1.3.0' && leerMarcador() !== null, j(ciclo.marcador?.versionDestino))
      check('sin motor armado, la UI no promete aplicarla al cerrar', ciclo.state.seAplicaAlCerrar === false && ciclo.state.aplicable === false, j({ seAplica: ciclo.state.seAplicaAlCerrar, aplicable: ciclo.state.aplicable }))
      check('cada transición se difunde por el sistema inyectado', s.difundidos.length > 0, `${s.difundidos.length} difusión(es)`)
    } else {
      check('donde no se auto-instala, el marcador «listo» se descarta', ciclo.marcador === null && leerMarcador() === null, j(ciclo.state.status))
    }
  }

  // ---------------------------------------------------------------------------------
  hr('(3) planDeCierre empaquetada: con y sin descarga lista')
  if (capacidades().autoInstalarUpdate) {
    // Viene del (2): `ready` sembrado del marcador y el motor sin armar.
    const sinRevalidar = planDeCierre()
    check(
      'un ready sin revalidar NO monta el cierre: «ninguno» con el motivo',
      sinRevalidar.tipo === 'ninguno' && /revalidado/.test(sinRevalidar.motivo),
      j(sinRevalidar)
    )
    // Lo que hace `update-downloaded`: el motor tiene la descarga en la mano.
    ciclo.motorArmado = true
    const lista = planDeCierre()
    check(
      'con la descarga lista y el motor armado: instalar al cerrar, sin relanzar',
      lista.tipo === 'instalar' && lista.origen === 'cierre' && lista.relanzar === false && lista.marcador?.versionDestino === '1.3.0',
      j(lista)
    )
    check('y la UI lo promete', seAplicaAlCerrarAhora() === true, String(seAplicaAlCerrarAhora()))
    // La preferencia se lee del sistema en el momento, sin caché.
    fijarSistema(sistemaFalso({ version: '1.2.0', aplicarAlCerrar: () => false }))
    const sinQuerer = planDeCierre()
    check('con «aplicar al cerrar» apagado: «ninguno»', sinQuerer.tipo === 'ninguno' && /no quiere/.test(sinQuerer.motivo), j(sinQuerer))
    fijarSistema(
      sistemaFalso({
        version: '1.2.0',
        aplicarAlCerrar: () => {
          throw new Error('workspace-state.json ilegible')
        }
      })
    )
    check('si el ajuste no se puede leer, vale el default (aplicar)', planDeCierre().tipo === 'instalar', j(planDeCierre()))
  }
  {
    // Sin nada descargado: `idle`, sin marcador.
    reiniciarCiclo(sistemaFalso({ version: '1.2.0' }))
    const nada = planDeCierre()
    check('sin descarga lista (idle): «ninguno» por el estado', nada.tipo === 'ninguno' && /idle/.test(nada.motivo), j(nada))
  }

  // ---------------------------------------------------------------------------------
  hr('(4) sembrarDesdeMarcador: el desenlace de la sesión anterior')
  {
    // Aplicada: ya corre la versión destino. El marcador se borra al sembrar.
    const s = sistemaFalso({ version: '1.3.0', trasActualizar: true })
    reiniciarCiclo(s)
    prepararMarcador('1.3.0')
    sembrarDesdeMarcador()
    check(
      'aplicada: aviso «desde → hasta» y marcador borrado',
      ciclo.state.avisoAplicada?.desde === '1.2.0' && ciclo.state.avisoAplicada?.hasta === '1.3.0' && ciclo.marcador === null && !existsSync(rutaMarcador()),
      j(ciclo.state.avisoAplicada)
    )
  }
  {
    // Fallida: se cedió el control (intento sellado) y se volvió a arrancar en la vieja.
    reiniciarCiclo(sistemaFalso({ version: '1.2.0' }))
    const instalador = prepararMarcador('1.3.0')
    const conIntento = marcadorConIntento(leerMarcador()!, { iniciadoEn: new Date().toISOString(), origen: 'cierre', relanzar: false })
    guardarMarcador(conIntento)
    sembrarDesdeMarcador()
    check(
      'fallida: aviso con la versión esperada y el intento consumido',
      ciclo.state.avisoFallo?.versionEsperada === '1.3.0' && ciclo.state.avisoFallo?.intentos === 1 && ciclo.state.installerPath === instalador,
      j(ciclo.state.avisoFallo)
    )
    check('el marcador NO se borra: el siguiente arranque sigue sabiendo de esta versión', leerMarcador()?.intentos === 1, j(leerMarcador()?.intentos))
  }

  // ---------------------------------------------------------------------------------
  hr('(5) anticiparRelevo: el relevo sale al empezar el cierre, y solo cuando toca')
  {
    reiniciarCiclo(sistemaFalso({ version: '1.2.0' }))
    const instalador = prepararMarcador('1.3.0')
    ciclo.marcador = leerMarcador()
    ciclo.state = { ...ciclo.state, status: 'installing', newVersion: '1.3.0', installerPath: instalador }
    ciclo.motorArmado = true
    ciclo.chequeoConcluido = true
    if (!esWindows()) {
      check('fuera de Windows no se lanza nada', anticiparRelevo() === false, process.platform)
    } else {
      // La copia del relevo, en un LOCALAPPDATA temporal: un ejecutable inocuo con el nombre de la app.
      const encargo = path.join(dirRelevo(), NOMBRE_ENCARGO)
      check('sin copia preparada, no se lanza', anticiparRelevo() === false && !existsSync(encargo), dirRelevo())
      mkdirSync(dirRelevo(), { recursive: true })
      copyFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), exeRelevo())
      writeFileSync(path.join(dirRelevo(), 'version.txt'), '1.2.0')
      // Al cerrar con una preparada también sale: sin ventana, el usuario se queda sin la app
      // y sin saber qué pasa mientras dura.
      ciclo.state = { ...ciclo.state, status: 'ready' }
      check('al cerrar con una preparada (sin relanzar), también se lanza', anticiparRelevo() === true && existsSync(encargo), 'ready')
      cancelarRelevoAnticipado()
      check('y cancelarlo borra su encargo', !existsSync(encargo), 'cancelado')
      ciclo.state = { ...ciclo.state, status: 'installing' }
      ciclo.motorArmado = false
      check('si el feed no la confirmó, no se lanza (abortará antes de ceder nada)', anticiparRelevo() === false && !existsSync(encargo), 'motor sin armar')
      ciclo.motorArmado = true
      const lanzado = anticiparRelevo()
      const leido = existsSync(encargo) ? (JSON.parse(readFileSync(encargo, 'utf8')) as { pidPadre?: number; versionNueva?: string; instalador?: string }) : null
      check(
        '«Actualizar ahora» con todo listo: se lanza, con el encargo de ESTE proceso',
        lanzado && leido?.pidPadre === process.pid && leido?.versionNueva === '1.3.0' && leido?.instalador === instalador,
        j(leido)
      )
      check('una segunda llamada no lanza otro', anticiparRelevo() === true, 'idempotente')
      // Un pre-vuelo que aborta deja la app viva: el relevo esperando su muerte se cancela.
      rmSync(instalador, { force: true })
      writeFileSync(encargo, '{}')
      const r = await runInstaller({ relanzar: true, origen: 'manual' })
      check('si el cierre se aborta, el relevo se cancela (y su encargo se borra)', r === false && !existsSync(encargo), j({ r, encargo: existsSync(encargo) }))
      writeFileSync(instalador, 'instalador de mentira')
      check('cancelado, el siguiente «Actualizar ahora» lo vuelve a lanzar', anticiparRelevo() === true && existsSync(encargo), 'relanzado')
    }
  }

  // ---------------------------------------------------------------------------------
  hr('(6) volver a la versión anterior: la copia del relevo se repone EXACTA en la carpeta de instalación')
  if (!esWindows()) {
    check('fuera de Windows no hay copia que reponer', true, process.platform)
  } else {
    const copia = path.join(raiz, 'reponer', 'relevo')
    const destino = path.join(raiz, 'reponer', 'Programs', 'Tessera')
    mkdirSync(path.join(copia, 'resources'), { recursive: true })
    writeFileSync(path.join(copia, 'Tessera.exe'), 'version vieja')
    writeFileSync(path.join(copia, 'resources', 'app.asar'), 'asar viejo')
    writeFileSync(path.join(copia, 'version.txt'), '1.2.0')
    writeFileSync(path.join(copia, 'encargo.json'), '{}')
    const encargoReponer = {
      version: ENCARGO_VERSION,
      instalador: path.join(raiz, 'Setup.exe'),
      raizInstalacion: destino,
      exeApp: path.join(destino, 'Tessera.exe'),
      pidPadre: 1,
      versionActual: '1.2.0',
      versionNueva: '1.3.0',
      log: path.join(raiz, 'relevo.log')
    }
    const nada = (): void => {}

    // El instalador quitó la carpeta entera y no puso la nueva.
    const tras1 = await restaurarAnterior(encargoReponer, copia, nada)
    check(
      'sin carpeta: la crea con la versión anterior, sin el marcador ni el encargo de la copia',
      tras1 &&
        readFileSync(path.join(destino, 'Tessera.exe'), 'utf8') === 'version vieja' &&
        existsSync(path.join(destino, 'resources', 'app.asar')) &&
        !existsSync(path.join(destino, 'version.txt')) &&
        !existsSync(path.join(destino, 'encargo.json')),
      destino
    )

    // El instalador dejó la nueva a medias, en una carpeta donde el usuario tiene algo suyo.
    writeFileSync(path.join(destino, 'Tessera.exe'), 'version nueva a medias')
    writeFileSync(path.join(destino, 'notas-del-usuario.txt'), 'suyo')
    rmSync(path.join(destino, 'resources'), { recursive: true, force: true })
    const tras2 = await restaurarAnterior(encargoReponer, copia, nada)
    check(
      'a medias: repone lo cambiado y lo que falta, y NO borra lo que no es de la copia',
      tras2 &&
        readFileSync(path.join(destino, 'Tessera.exe'), 'utf8') === 'version vieja' &&
        existsSync(path.join(destino, 'resources', 'app.asar')) &&
        readFileSync(path.join(destino, 'notas-del-usuario.txt'), 'utf8') === 'suyo',
      destino
    )

    // La prueba de renombrado la dejó apartada: se devuelve a su nombre, sin copiar nada.
    rmSync(destino, { recursive: true, force: true })
    mkdirSync(`${destino}.relevo-tmp`, { recursive: true })
    writeFileSync(path.join(`${destino}.relevo-tmp`, 'Tessera.exe'), 'la apartada')
    const tras4 = await restaurarAnterior(encargoReponer, copia, nada)
    check(
      'apartada como .relevo-tmp: vuelve a su nombre (es la versión anterior entera)',
      tras4 &&
        readFileSync(path.join(destino, 'Tessera.exe'), 'utf8') === 'la apartada' &&
        !existsSync(`${destino}.relevo-tmp`),
      destino
    )

    // Un destino peligroso no se toca: /MIR borraría lo que sobra en él.
    const tras3 = await restaurarAnterior({ ...encargoReponer, raizInstalacion: path.parse(raiz).root }, copia, nada)
    check('sobre la raíz de la unidad no repone nada', tras3 === false, path.parse(raiz).root)
  }
} finally {
  // Con reintentos: el relevo de mentira de (5) puede seguir saliendo con su cwd en el temporal.
  rmSync(raiz, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}

const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
