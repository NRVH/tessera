#!/usr/bin/env node
// =============================================================================
// Prueba del CICLO de actualización con un `SistemaUpdate` falso (npm run test:ciclo-update):
// el ciclo sin inicializar (`planDeCierre` da «ninguno» y no lanza), `sembrarDesdeMarcador` con
// un marcador real en una `userData` temporal (preparada, aplicada y fallida) y `planDeCierre`
// empaquetada con y sin descarga lista. Sin `electron`: las rutas entran por `fijarInfoApp` y el
// resto por el doble; el resolver-hook solo reintenta con `.ts` los imports sin extensión.
// =============================================================================

import { register } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const { ciclo, fijarSistema, motor, sistema, seAplicaAlCerrarAhora } = await import('./nucleo.ts')
const { planDeCierre } = await import('./instalacion.ts')
const { sembrarDesdeMarcador } = await import('./arranque.ts')
await import('./chequeo.ts')
await import('./preparacionMac.ts')
const { guardarMarcador, leerMarcador, rutaMarcador } = await import('./marcadorUpdate.ts')
const { nuevoMarcador, marcadorConIntento } = await import('./marcadorUpdatePuro.ts')
const { fijarInfoApp } = await import('../util/infoApp.ts')
const { initialUpdateState } = await import('../../shared/update-ipc.ts')
const { capacidades, esMac } = await import('../../shared/plataforma.ts')
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

const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-ciclo-update-'))
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
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const pasadas = results.filter((r) => r.pass).length
const allPass = pasadas === results.length
hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
