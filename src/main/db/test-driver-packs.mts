#!/usr/bin/env node
// =============================================================================
// Prueba de los packs de driver por plataforma (`driverPacks.ts` y `DriverManager`): las dos plataformas
// por parámetro con sus mitades negativas, el `catalogo.json` con el centinela como string, el pack de Mac
// (.dmg, huella, macOS 12 sin descarga), la descarga compartida y el barrido de arranque, sin red.
// (node src/main/db/test-driver-packs.mts) El flujo del .dmg vive en `test-instalar-dmg.mts`.
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import {
  DRIVER_PACKS,
  avisoSoporte,
  disponibilidadPack,
  macosDeDarwin,
  packById,
  packParaServidor,
  packsDePlataforma
} from './driverPacks.ts'
import { DriverManager } from './DriverManager.ts'
import type { OrdenExterna } from './instalarDmg.ts'

// `oracle.cjs` es CommonJS y es el lector real del catálogo; se carga como lo hace
// `test-oracle-thin.mts`. Solo pide `oracledb` dentro de `abrir`, que aquí no se usa.
const aqui = path.dirname(fileURLToPath(import.meta.url))
const oracleCjs = createRequire(import.meta.url)(path.join(aqui, '..', '..', 'tdb', 'oracle.cjs')) as {
  packParaServidor: (packs: unknown[], version: number | null) => unknown
  avisoDeSoporte: (pack: unknown, version: number | null) => string | null
  versionDeNumero: (n: unknown) => number | null
  mensajeRequiereCliente: (
    alias: string,
    limite: { code: string; motivo: string },
    version: number | null,
    pack: unknown
  ) => string
}

/** Un macOS 14 (Darwin 23) y un macOS 12 (Darwin 21), como los da `os.release()`. */
const SONOMA = '23.6.0'
const MONTEREY = '21.6.0'

/** Ejecutor de órdenes que no ejecuta nada y apunta lo que le piden. */
function ejecutorFalso(): { ordenes: OrdenExterna[]; ejecutar: (o: OrdenExterna) => Promise<void> } {
  const ordenes: OrdenExterna[] = []
  return {
    ordenes,
    ejecutar: async (o) => {
      ordenes.push(o)
    }
  }
}

/** `fetch` falso: cuenta las llamadas y sirve `cuerpo` con su content-length. */
function fetchFalso(cuerpo: Uint8Array<ArrayBuffer>): { llamadas: string[]; fetch: typeof fetch } {
  const llamadas: string[] = []
  const f = (async (url: string | URL | Request) => {
    llamadas.push(String(url))
    return new Response(cuerpo, { status: 200, headers: { 'content-length': String(cuerpo.length) } })
  }) as typeof fetch
  return { llamadas, fetch: f }
}

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

/**
 * Una promesa con un tope de 5 s: si no se resuelve, rechaza con «COLGADA». Así una
 * descarga que se quedara esperando para siempre sale como un
 * FAIL y no como un test que no termina.
 */
function conTope<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rechazar) => {
      const t = setTimeout(() => rechazar(new Error('COLGADA: no terminó en 5 s')), 5000)
      void p.finally(() => clearTimeout(t)).catch(() => {})
    })
  ])
}

async function falla(fn: () => unknown): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  hr('(1) packsDePlataforma: qué ve cada plataforma')
  // -------------------------------------------------------------------------
  const win = packsDePlataforma('windows')
  const mac = packsDePlataforma('mac')
  const otra = packsDePlataforma('otra')
  check(
    'windows: los dos Instant Client de siempre, en el mismo orden',
    win.map((p) => p.id).join(',') === 'oracle-ic-19,oracle-ic-12.1',
    win.map((p) => p.id).join(',')
  )
  check(
    'mac: solo el Instant Client 23 arm64',
    mac.map((p) => p.id).join(',') === 'oracle-ic-23-macos-arm64',
    mac.map((p) => p.id).join(',')
  )
  check('otra: ningún pack (thin basta y nadie pidió thick)', otra.length === 0, `${otra.length}`)
  check(
    'NEGATIVA: el zip de Windows no existe en Mac',
    packById('oracle-ic-19', 'mac') === undefined,
    String(packById('oracle-ic-19', 'mac'))
  )
  check(
    'NEGATIVA: el cliente de Mac no existe en Windows',
    packById('oracle-ic-23-macos-arm64', 'windows') === undefined,
    String(packById('oracle-ic-23-macos-arm64', 'windows'))
  )
  check(
    'centinela resuelto a string en las dos',
    [...win, ...mac].every((p) => typeof p.centinela === 'string'),
    [...win, ...mac].map((p) => `${p.id}=${JSON.stringify(p.centinela)}`).join(' ')
  )
  check(
    'windows: oci.dll',
    win.every((p) => p.centinela === 'oci.dll'),
    win.map((p) => p.centinela).join(',')
  )
  check('mac: libclntsh.dylib', mac[0]?.centinela === 'libclntsh.dylib', String(mac[0]?.centinela))
  const ic23 = packById('oracle-ic-23-macos-arm64', 'mac')
  check(
    'mac: el pack es el 23.26 VERSIONADO en .dmg (no el enlace «permanente», que sirve la 23.3)',
    ic23 !== undefined &&
      ic23.url ===
        'https://download.oracle.com/otn_software/mac/instantclient/2326200/instantclient-basiclite-macos.arm64-23.26.2.0.0.dmg' &&
      ic23.formato === 'dmg' &&
      ic23.sinDescarga === undefined &&
      !(ic23.url ?? '').endsWith('instantclient-basiclite-macos-arm64.dmg'),
    JSON.stringify({ url: ic23?.url, formato: ic23?.formato })
  )
  check(
    'mac: con la huella publicada por Oracle (64 hex) y la firma de su Team ID',
    ic23?.sha256 === '54defa9e957da0aef6219965da3cb2d22ac19bfb20f168741b424c89e90d47ea' &&
      ic23.firma?.teamId === 'VB5E2TV963' &&
      (ic23.firma?.archivos ?? []).includes(ic23.centinela),
    JSON.stringify({ sha: ic23?.sha256?.slice(0, 12), firma: ic23?.firma })
  )
  check(
    'mac: cubre 11.2+, avisa de 11.2–18c y lo que mide el .dmg real (66 MB, instantclient_23_26, macOS 13)',
    ic23 !== undefined &&
      ic23.cubre === 'Oracle 11.2 y superior' &&
      ic23.servidorDesde === 11.2 &&
      ic23.servidorHasta === 99 &&
      ic23.soporteOracleDesde === 19 &&
      ic23.aviso === '11.2–18c están fuera del soporte de Oracle; probado.' &&
      ic23.sizeMB === 66 &&
      ic23.carpetaInterna === 'instantclient_23_26' &&
      ic23.macosMinimo === 13,
    JSON.stringify({ cubre: ic23?.cubre, aviso: ic23?.aviso, sizeMB: ic23?.sizeMB })
  )
  check(
    'mac: quita lo que no es cliente (el install_ic.sh de Oracle y su README), como su guion',
    JSON.stringify(ic23?.sobrantes) === JSON.stringify(['install_ic.sh', 'INSTALL_IC_README.txt']),
    JSON.stringify(ic23?.sobrantes)
  )
  check(
    'windows: ningún pack gana formato, huella, firma, aviso ni mínimo de sistema',
    win.every(
      (p) =>
        p.formato === undefined &&
        p.sha256 === undefined &&
        p.firma === undefined &&
        p.aviso === undefined &&
        p.soporteOracleDesde === undefined &&
        p.macosMinimo === undefined &&
        p.sobrantes === undefined
    ),
    win.map((p) => Object.keys(p).length).join(',')
  )
  const ic19 = packById('oracle-ic-19', 'windows')
  check(
    'windows sin cambios: el 19 conserva URL, carpeta y rango',
    ic19 !== undefined &&
      (ic19.url ?? '').endsWith('instantclient-basiclite-windows.x64-19.28.0.0.0dbru.zip') &&
      ic19.carpetaInterna === 'instantclient_19_28' &&
      ic19.servidorDesde === 11.2 &&
      ic19.servidorHasta === 99,
    JSON.stringify({ carpeta: ic19?.carpetaInterna, desde: ic19?.servidorDesde })
  )
  check(
    'el dato fuente no se muta al resolver',
    DRIVER_PACKS.every((p) => typeof p.centinela === 'object'),
    DRIVER_PACKS.map((p) => JSON.stringify(p.centinela)).join(' ')
  )

  // -------------------------------------------------------------------------
  hr('(2) packParaServidor por plataforma')
  // -------------------------------------------------------------------------
  check('12.1+ -> thin basta (windows)', packParaServidor(19, 'windows') === null, 'null')
  check('12.1+ -> thin basta (mac)', packParaServidor(12.1, 'mac') === null, 'null')
  check(
    'windows 11.2 -> 19 (como antes)',
    packParaServidor(11.2, 'windows')?.id === 'oracle-ic-19',
    String(packParaServidor(11.2, 'windows')?.id)
  )
  check(
    'windows 10.2 -> 12.1 (como antes)',
    packParaServidor(10.2, 'windows')?.id === 'oracle-ic-12.1',
    String(packParaServidor(10.2, 'windows')?.id)
  )
  check(
    'windows versión desconocida -> 19 (como antes)',
    packParaServidor(null, 'windows')?.id === 'oracle-ic-19',
    String(packParaServidor(null, 'windows')?.id)
  )
  check(
    'windows versión fuera de rango -> 19 (mejor esfuerzo, como antes)',
    packParaServidor(9.0, 'windows')?.id === 'oracle-ic-19',
    String(packParaServidor(9.0, 'windows')?.id)
  )
  check(
    'mac 11.2 -> IC 23 (antes null: la 11.2 no tenía cliente en Mac)',
    packParaServidor(11.2, 'mac')?.id === 'oracle-ic-23-macos-arm64',
    String(packParaServidor(11.2, 'mac')?.id)
  )
  check(
    'mac 10.2 -> null: ningún pack de Mac alcanza por debajo de 11.2',
    packParaServidor(10.2, 'mac') === null,
    String(packParaServidor(10.2, 'mac'))
  )
  check(
    'mac versión desconocida (NJS-533/116) -> IC 23',
    packParaServidor(null, 'mac')?.id === 'oracle-ic-23-macos-arm64',
    String(packParaServidor(null, 'mac')?.id)
  )
  check('otra versión desconocida -> null', packParaServidor(null, 'otra') === null, 'null')

  // -------------------------------------------------------------------------
  hr('(2b) Aviso de soporte, versión de macOS y disponibilidad')
  // -------------------------------------------------------------------------
  const macPack = packById('oracle-ic-23-macos-arm64', 'mac')
  const avisos = [11.2, 12.1, 18, 18.3, 19, 23].map((v) => `${v}:${avisoSoporte(macPack, v) ? 'aviso' : '-'}`)
  check(
    'aviso del 23 de Mac en 11.2–18c y NO desde 19',
    avisos.join(' ') === '11.2:aviso 12.1:aviso 18:aviso 18.3:aviso 19:- 23:-',
    avisos.join(' ')
  )
  check(
    'versión desconocida -> sin aviso (NJS-533/116: no se sabe, no se alarma)',
    avisoSoporte(macPack, null) === null,
    String(avisoSoporte(macPack, null))
  )
  check(
    'NEGATIVA windows: el 19 y el 12.1 no avisan nunca',
    [11.2, 10.2, null].every(
      (v) =>
        avisoSoporte(packById('oracle-ic-19', 'windows'), v) === null &&
        avisoSoporte(packById('oracle-ic-12.1', 'windows'), v) === null
    ),
    'sin aviso'
  )
  check(
    'oracle.cjs: la versión de servidor desde oracleServerVersion (11.2.0.4.0 = 1102000400)',
    oracleCjs.versionDeNumero(1102000400) === 11.2 &&
      oracleCjs.versionDeNumero(1903000000) === 19.3 &&
      oracleCjs.versionDeNumero(2301000000) === 23.1 &&
      oracleCjs.versionDeNumero(undefined) === null &&
      oracleCjs.versionDeNumero(0) === null,
    `${oracleCjs.versionDeNumero(1102000400)} ${oracleCjs.versionDeNumero(1903000000)}`
  )
  // El «falta el cliente» de la escalada (lo leen el agente y el diálogo).
  const limite138 = { code: 'NJS-138', motivo: 'es anterior a Oracle 12.1' }
  const ic19Win = packById('oracle-ic-19', 'windows')
  const msgWin = oracleCjs.mensajeRequiereCliente('Alfa', limite138, 11.2, ic19Win)
  check(
    'windows: el mensaje de la escalada es el de siempre, letra por letra',
    msgWin ===
      'Alfa es anterior a Oracle 12.1 (Oracle 11.2) y necesita el cliente Oracle.\n' +
        'Falta: Oracle Instant Client 19.28 (Basic Light) (39 MB).\n' +
        'Instálalo con:  tdb driver install oracle-ic-19\n' +
        'o desde "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).',
    JSON.stringify(msgWin)
  )
  const msgMac = oracleCjs.mensajeRequiereCliente('Alfa', limite138, 11.2, macPack)
  check(
    'mac 11.2: sin «tdb driver install» (el .dmg lo instala Tessera) y con el aviso de soporte',
    !msgMac.includes('tdb driver install') &&
      msgMac.includes('Falta: Oracle Instant Client 23.26 (Basic Light) (66 MB).') &&
      msgMac.includes('Clientes de base de datos') &&
      msgMac.endsWith('\nOracle 11.2: 11.2–18c están fuera del soporte de Oracle; probado.'),
    JSON.stringify(msgMac)
  )
  const msgMac533 = oracleCjs.mensajeRequiereCliente(
    'PROD19',
    { code: 'NJS-533', motivo: 'exige cifrado nativo de red (Advanced Networking Option)' },
    null,
    macPack
  )
  check(
    'mac con cifrado nativo (versión desconocida): pide el 23 y NO avisa de soporte',
    msgMac533.includes('Oracle Instant Client 23.26') && !msgMac533.includes('fuera del soporte'),
    JSON.stringify(msgMac533)
  )
  check(
    'sin pack (10.2 en Mac): «No hay ningún cliente compatible», como antes',
    oracleCjs.mensajeRequiereCliente('VIEJA', limite138, 10.2, null).endsWith('No hay ningún cliente compatible en el catálogo.'),
    'ok'
  )
  const darwin = ['19.6.0', '20.1.0', '21.6.0', '22.1.0', '24.4.0', '25.0.0', '26.1.0', 'x', '']
    .map((r) => `${r || '∅'}=${macosDeDarwin(r)}`)
    .join(' ')
  check(
    'macosDeDarwin: 20–24 -> 11–15, 25 -> 26 (el salto de Apple), <20 -> 10, basura -> null',
    darwin === '19.6.0=10 20.1.0=11 21.6.0=12 22.1.0=13 24.4.0=15 25.0.0=26 26.1.0=27 x=null ∅=null',
    darwin
  )
  const dispMonterey = macPack ? disponibilidadPack(macPack, 'mac', MONTEREY) : { ok: true as const }
  check(
    'macOS 12: el pack NO está disponible y el motivo dice por qué (macOS 13) y qué hacer',
    !dispMonterey.ok &&
      dispMonterey.motivo.includes('macOS 13') &&
      dispMonterey.motivo.includes('macOS 12') &&
      dispMonterey.motivo.includes('Seleccionar carpeta'),
    dispMonterey.ok ? 'ok' : dispMonterey.motivo
  )
  check(
    'macOS 13, 14 y 26: disponible; una versión ilegible no bloquea',
    ['22.1.0', SONOMA, '25.0.0', 'desconocida'].every((r) => macPack !== undefined && disponibilidadPack(macPack, 'mac', r).ok),
    'ok'
  )
  check(
    'NEGATIVA: el mínimo de macOS no se aplica en Windows (ni con un release de Darwin)',
    DRIVER_PACKS.every((p) => disponibilidadPack(p, 'windows', MONTEREY).ok),
    'ok'
  )

  // -------------------------------------------------------------------------
  hr('(3) DriverManager: catálogo publicado, status, useExisting e install')
  // -------------------------------------------------------------------------
  const base = mkdtempSync(path.join(os.tmpdir(), 'tessera-driver-packs-'))
  try {
    for (const plataforma of ['windows', 'mac'] as const) {
      const userDataDir = path.join(base, plataforma)
      const dm = new DriverManager({
        userDataDir,
        plataforma,
        releaseSistema: SONOMA,
        ejecutar: ejecutorFalso().ejecutar,
        log: () => {}
      })
      const catalogo = JSON.parse(
        readFileSync(path.join(userDataDir, 'drivers', 'catalogo.json'), 'utf-8')
      ) as { packs: Array<{ id: string; centinela: unknown }>; externos: Record<string, string> }
      const esperados = packsDePlataforma(plataforma).map((p) => p.id)
      check(
        `${plataforma}: catalogo.json solo con los packs de la plataforma`,
        catalogo.packs.map((p) => p.id).join(',') === esperados.join(','),
        catalogo.packs.map((p) => p.id).join(',')
      )
      check(
        `${plataforma}: catalogo.json lleva centinela STRING (contrato con tdb/oracle.cjs)`,
        catalogo.packs.length > 0 && catalogo.packs.every((p) => typeof p.centinela === 'string'),
        catalogo.packs.map((p) => JSON.stringify(p.centinela)).join(',')
      )
      const status = dm.status()
      check(
        `${plataforma}: status lista solo los de la plataforma, ninguno instalado`,
        status.map((s) => s.id).join(',') === esperados.join(',') &&
          status.every((s) => !s.instalado),
        status.map((s) => `${s.id}:${s.instalado}`).join(',')
      )
      // El que decide de verdad al escalar a thick es `oracle.cjs`, leyendo ESTE
      // catálogo. Tiene que elegir lo mismo que el TS para cada versión.
      const versiones = [null, 9.0, 10.2, 11.2, 12.1, 19]
      const difieren = versiones.filter((v) => {
        const cjs = oracleCjs.packParaServidor(catalogo.packs, v) as { id: string } | null
        return (cjs?.id ?? null) !== (packParaServidor(v, plataforma)?.id ?? null)
      })
      check(
        `${plataforma}: oracle.cjs elige el mismo pack que el TS con el catálogo publicado`,
        difieren.length === 0,
        difieren.length === 0 ? `${versiones.length} versiones` : `difieren: ${difieren.join(',')}`
      )
      // Y el aviso: el que da la escalada (oracle.cjs, leyendo el catálogo) tiene que ser
      // el mismo que el del TS, para cada versión y con el pack que elegiría.
      const avisosDifieren = [null, 10.2, 11.2, 18, 19].filter((v) => {
        const pCjs = oracleCjs.packParaServidor(catalogo.packs, v) as { id: string } | null
        const pTs = packParaServidor(v, plataforma)
        const deCatalogo = catalogo.packs.find((p) => p.id === (pCjs?.id ?? ''))
        return oracleCjs.avisoDeSoporte(deCatalogo ?? null, v) !== avisoSoporte(pTs, v)
      })
      check(
        `${plataforma}: oracle.cjs da el mismo aviso de soporte que el TS con el catálogo publicado`,
        avisosDifieren.length === 0,
        avisosDifieren.length === 0 ? 'iguales' : `difieren: ${avisosDifieren.join(',')}`
      )
      if (plataforma === 'windows') {
        // «Windows no cambia»: el objeto de status tiene EXACTAMENTE las claves de antes.
        const claves = status.map((s) => Object.keys(s).sort().join(',')).join(' | ')
        const antes = 'cubre,descargable,externo,id,instalado,motor,nombre,ruta,sizeMB'
        check(
          'windows: status con las mismas claves de siempre (sin aviso ni noDisponible)',
          status.every((s) => Object.keys(s).sort().join(',') === antes),
          claves
        )
        check(
          'windows: el 19 descargable y el 12.1 no, como antes',
          status.find((s) => s.id === 'oracle-ic-19')?.descargable === true &&
            status.find((s) => s.id === 'oracle-ic-12.1')?.descargable === false,
          status.map((s) => `${s.id}:${s.descargable}`).join(',')
        )
      } else {
        const st23 = status.find((s) => s.id === 'oracle-ic-23-macos-arm64')
        check(
          'mac (macOS 14): el 23 es descargable, lleva su aviso y no noDisponible',
          st23?.descargable === true && st23.aviso === ic23?.aviso && st23.noDisponible === undefined,
          JSON.stringify({ descargable: st23?.descargable, aviso: st23?.aviso })
        )
        const catMac23 = catalogo.packs.find((p) => p.id === 'oracle-ic-23-macos-arm64') as
          | { formato?: string; sha256?: string; aviso?: string }
          | undefined
        check(
          'mac: el catálogo de tdb lleva formato, huella y aviso (tdb y oracle.cjs los leen)',
          catMac23?.formato === 'dmg' && catMac23.sha256 === ic23?.sha256 && catMac23.aviso === ic23?.aviso,
          JSON.stringify({ formato: catMac23?.formato })
        )
      }
    }

    // macOS 12: listado SIN descarga, con su porqué, e install lo rechaza sin bajar nada.
    {
      const f = fetchFalso(new Uint8Array([1, 2, 3]))
      const ej = ejecutorFalso()
      const dm12 = new DriverManager({
        userDataDir: path.join(base, 'mac12'),
        plataforma: 'mac',
        releaseSistema: MONTEREY,
        ejecutar: ej.ejecutar,
        fetch: f.fetch,
        log: () => {}
      })
      const st = dm12.status().find((s) => s.id === 'oracle-ic-23-macos-arm64')
      check(
        'macOS 12: status sin descarga y con noDisponible (no «Oracle ya no lo publica»)',
        st?.descargable === false && (st.noDisponible ?? '').includes('macOS 13') && st.aviso !== undefined,
        JSON.stringify({ descargable: st?.descargable, noDisponible: st?.noDisponible })
      )
      const progresos: string[] = []
      const dm12b = new DriverManager({
        userDataDir: path.join(base, 'mac12'),
        plataforma: 'mac',
        releaseSistema: MONTEREY,
        ejecutar: ej.ejecutar,
        fetch: f.fetch,
        onProgress: (p) => progresos.push(p.fase),
        log: () => {}
      })
      const err12 = await falla(() => dm12b.install('oracle-ic-23-macos-arm64'))
      check(
        'macOS 12: install se rechaza con el motivo, sin descargar ni montar nada',
        err12 !== null &&
          err12.includes('macOS 13') &&
          f.llamadas.length === 0 &&
          ej.ordenes.length === 0 &&
          progresos.join(',') === 'error',
        JSON.stringify({ err: err12, fetch: f.llamadas.length, ordenes: ej.ordenes.length, progresos })
      )
    }

    // Una descarga cuya huella no es la de Oracle: no se monta, no queda el .dmg.
    {
      const f = fetchFalso(new TextEncoder().encode('<html>portal cautivo</html>'))
      const ej = ejecutorFalso()
      const progresos: string[] = []
      const dirHuella = path.join(base, 'mac-huella')
      const dmH = new DriverManager({
        userDataDir: dirHuella,
        plataforma: 'mac',
        releaseSistema: SONOMA,
        ejecutar: ej.ejecutar,
        fetch: f.fetch,
        onProgress: (p) => progresos.push(p.fase),
        log: () => {}
      })
      const errH = await falla(() => dmH.install('oracle-ic-23-macos-arm64'))
      const descargas = path.join(dirHuella, 'drivers', '.descargas')
      const restos = existsSync(descargas) ? readdirSync(descargas) : []
      check(
        'huella distinta: falla con SHA-256 y la alternativa, SIN ninguna orden (ni hdiutil)',
        errH !== null &&
          errH.includes('SHA-256') &&
          errH.includes('Seleccionar carpeta') &&
          f.llamadas.length === 1 &&
          f.llamadas[0] === ic23?.url &&
          ej.ordenes.length === 0,
        JSON.stringify({ err: errH, ordenes: ej.ordenes.map((o) => o.args[0]) })
      )
      check(
        'huella distinta: no queda el .dmg ni se da por instalado; el progreso acaba en error',
        restos.length === 0 &&
          !existsSync(path.join(dirHuella, 'drivers', 'oracle', 'oracle-ic-23-macos-arm64')) &&
          progresos[progresos.length - 1] === 'error' &&
          progresos.includes('descargando'),
        JSON.stringify({ restos, progresos: [...new Set(progresos)] })
      )
    }

    // El zip de Windows baja por la MISMA descarga
    // que el .dmg (`descarga.ts`): con el `fetch` de las opciones (antes, el global), el
    // mismo progreso y el plazo de inactividad. Lo demás del zip no cambia: se aplana por
    // basename, sin META-INF, y con sus mensajes de siempre.
    {
      const ic19 = packById('oracle-ic-19', 'windows')
      const zip = zipSync({
        'instantclient_19_28/oci.dll': strToU8('dll'),
        'instantclient_19_28/oraociei19.dll': strToU8('x'),
        'instantclient_19_28/META-INF/MANIFEST.MF': strToU8('m')
      })
      const f = fetchFalso(zip as Uint8Array<ArrayBuffer>)
      const progresos: string[] = []
      const dirZip = path.join(base, 'win-zip')
      const dmZ = new DriverManager({
        userDataDir: dirZip,
        plataforma: 'windows',
        fetch: f.fetch,
        onProgress: (p) => {
          if (progresos[progresos.length - 1] !== p.fase) progresos.push(p.fase)
        },
        log: () => {}
      })
      const stZ = await conTope(dmZ.install('oracle-ic-19'))
      const destinoZip = path.join(dirZip, 'drivers', 'oracle', 'oracle-ic-19')
      const archivosZip = existsSync(destinoZip) ? readdirSync(destinoZip).sort() : []
      check(
        'windows: el zip baja por el `fetch` de las opciones (la descarga compartida) y se instala como siempre',
        stZ.instalado && f.llamadas.length === 1 && f.llamadas[0] === ic19?.url && progresos.join(',') === 'descargando,descomprimiendo,listo',
        JSON.stringify({ llamadas: f.llamadas.length, progresos })
      )
      check(
        'windows: aplanado por basename y sin META-INF, como antes',
        archivosZip.join(',') === 'oci.dll,oraociei19.dll',
        archivosZip.join(',')
      )
      const html = fetchFalso(new TextEncoder().encode('<html>portal cautivo</html>'))
      const dmHtml = new DriverManager({ userDataDir: path.join(base, 'win-html'), plataforma: 'windows', fetch: html.fetch, log: () => {} })
      const errHtml = await falla(() => conTope(dmHtml.install('oracle-ic-19')))
      check(
        'windows: una página de error sigue diciendo «no es un ZIP», con la alternativa',
        errHtml !== null && errHtml.includes('no es un ZIP') && errHtml.includes('Seleccionar carpeta'),
        String(errHtml)
      )

      // Un CDN que se calla a mitad: antes, «Descargando…» para siempre y `enVuelo` sin
      // resolver (ni siquiera se podía reintentar). Ahora, error con su motivo.
      let intentos = 0
      const colgado = (async () => {
        intentos++
        let enviado = false
        const cuerpo = new ReadableStream<Uint8Array>({
          async pull(c) {
            if (!enviado) {
              enviado = true
              c.enqueue(new Uint8Array([0x50, 0x4b, 3, 4]))
              return
            }
            await new Promise(() => {}) // Se calla, sin atender la señal.
          }
        })
        return new Response(cuerpo, { headers: { 'content-length': '1000' } })
      }) as typeof fetch
      const progresosCol: string[] = []
      const dmCol = new DriverManager({
        userDataDir: path.join(base, 'win-colgado'),
        plataforma: 'windows',
        fetch: colgado,
        plazoInactividadMs: 60,
        onProgress: (p) => progresosCol.push(p.fase),
        log: () => {}
      })
      const errCol = await falla(() => conTope(dmCol.install('oracle-ic-19')))
      check(
        'windows: una descarga que se PARA acaba en error de inactividad (con la alternativa), no en espera eterna',
        errCol !== null &&
          errCol.includes('sin enviar datos') &&
          errCol.includes('Seleccionar carpeta') &&
          !errCol.includes('COLGADA') &&
          progresosCol[progresosCol.length - 1] === 'error',
        String(errCol)
      )
      const errCol2 = await falla(() => conTope(dmCol.install('oracle-ic-19')))
      check(
        '… y se puede volver a intentar (la instalación en vuelo se resolvió)',
        errCol2 !== null && errCol2.includes('sin enviar datos') && intentos === 2,
        `${intentos} intentos`
      )
    }

    // El barrido de arranque de Mac borra los restos
    // de una instalación que murió (el .dmg de `.descargas`, la copia `.instalando`) y no
    // toca un pack instalado; en Windows no hay barrido y no se toca nada.
    for (const plataforma of ['mac', 'windows'] as const) {
      const dirRestos = path.join(base, `restos-${plataforma}`)
      const drivers = path.join(dirRestos, 'drivers')
      const dmgViejo = path.join(drivers, '.descargas', 'oracle-ic-23-macos-arm64.dmg')
      const aMedias = path.join(drivers, 'oracle', '.oracle-ic-23-macos-arm64.instalando')
      const instalado = path.join(drivers, 'oracle', 'oracle-ic-19', 'oci.dll')
      mkdirSync(path.dirname(dmgViejo), { recursive: true })
      mkdirSync(aMedias, { recursive: true })
      mkdirSync(path.dirname(instalado), { recursive: true })
      writeFileSync(dmgViejo, 'imagen')
      writeFileSync(path.join(aMedias, 'libclntsh.dylib.23.1'), 'binario')
      writeFileSync(instalado, 'dll')
      const ej = ejecutorFalso()
      new DriverManager({ userDataDir: dirRestos, plataforma, releaseSistema: SONOMA, ejecutar: ej.ejecutar, log: () => {} })
      for (let i = 0; i < 100 && plataforma === 'mac' && (existsSync(dmgViejo) || existsSync(aMedias)); i++) {
        await new Promise((r) => setTimeout(r, 10))
      }
      if (plataforma === 'windows') await new Promise((r) => setTimeout(r, 50))
      const quedan = { dmg: existsSync(dmgViejo), instalando: existsSync(aMedias), instalado: existsSync(instalado) }
      check(
        plataforma === 'mac'
          ? 'mac: el arranque borra el .dmg y la copia .instalando de una instalación muerta; el pack instalado se queda'
          : 'NEGATIVO windows: sin barrido de arranque, no se toca nada',
        plataforma === 'mac'
          ? !quedan.dmg && !quedan.instalando && quedan.instalado && ej.ordenes.length === 0
          : quedan.dmg && quedan.instalando && quedan.instalado && ej.ordenes.length === 0,
        JSON.stringify({ ...quedan, ordenes: ej.ordenes.length })
      )
    }

    // useExisting en Mac: acepta la carpeta con libclntsh.dylib (y su padre). La carpeta
    // interna es la que deja el install_ic.sh de la 23.26.
    const macDir = path.join(base, 'mac')
    const dmMac = new DriverManager({
      userDataDir: macDir,
      plataforma: 'mac',
      releaseSistema: SONOMA,
      ejecutar: ejecutorFalso().ejecutar,
      log: () => {}
    })
    const icMac = path.join(base, 'descargas', 'instantclient_23_26')
    mkdirSync(icMac, { recursive: true })
    writeFileSync(path.join(icMac, 'libclntsh.dylib'), '')
    const st = dmMac.useExisting('oracle-ic-23-macos-arm64', path.dirname(icMac))
    check(
      'mac: useExisting acepta el padre de la carpeta con libclntsh.dylib',
      st.instalado && st.externo === true && st.ruta === icMac,
      JSON.stringify({ instalado: st.instalado, externo: st.externo })
    )
    const catMac = JSON.parse(
      readFileSync(path.join(macDir, 'drivers', 'catalogo.json'), 'utf-8')
    ) as { externos: Record<string, string> }
    check(
      'mac: el externo registrado llega al catálogo de tdb',
      catMac.externos['oracle-ic-23-macos-arm64'] === icMac,
      String(catMac.externos['oracle-ic-23-macos-arm64'] === icMac)
    )

    const soloDll = path.join(base, 'soloDll')
    mkdirSync(soloDll, { recursive: true })
    writeFileSync(path.join(soloDll, 'oci.dll'), '')
    const errDll = await falla(() => dmMac.useExisting('oracle-ic-23-macos-arm64', soloDll))
    check(
      'NEGATIVA mac: una carpeta con oci.dll no vale como cliente de Mac',
      errDll !== null && errDll.includes('libclntsh.dylib'),
      String(errDll)
    )
    const errWinEnMac = await falla(() => dmMac.useExisting('oracle-ic-19', soloDll))
    check(
      'NEGATIVA mac: el pack de Windows no se puede registrar en Mac',
      errWinEnMac !== null && errWinEnMac.includes('no está disponible en este sistema'),
      String(errWinEnMac)
    )
    const errInstWin = await falla(() => dmMac.install('oracle-ic-19'))
    check(
      'NEGATIVA mac: install del zip de Windows se rechaza sin descargar',
      errInstWin !== null && errInstWin.includes('no está disponible en este sistema'),
      String(errInstWin)
    )
    const errInstMac = await falla(() => dmMac.install('oracle-ic-23-macos-arm64'))
    // Ya está registrado como externo: install es idempotente y no intenta nada.
    check(
      'mac: install de un pack ya registrado devuelve su estado sin descargar',
      errInstMac === null,
      String(errInstMac)
    )
    dmMac.forgetExisting('oracle-ic-23-macos-arm64')
    check(
      'mac: olvidado el externo, vuelve a no estar instalado y a ser descargable',
      dmMac.status().some((s) => s.id === 'oracle-ic-23-macos-arm64' && !s.instalado && s.descargable),
      'ok'
    )
    check(
      'NEGATIVA: un id inexistente sigue siendo "desconocido"',
      ((await falla(() => dmMac.install('no-existe'))) ?? '').includes('Driver desconocido'),
      'Driver desconocido'
    )

    // Windows: useExisting con oci.dll sigue igual; una carpeta de Mac no vale.
    const dmWin = new DriverManager({
      userDataDir: path.join(base, 'windows'),
      plataforma: 'windows',
      log: () => {}
    })
    const stWin = dmWin.useExisting('oracle-ic-19', soloDll)
    check(
      'windows: useExisting con oci.dll como antes',
      stWin.instalado && stWin.ruta === soloDll,
      JSON.stringify({ instalado: stWin.instalado })
    )
    const errDylib = await falla(() => dmWin.useExisting('oracle-ic-12.1', path.dirname(icMac)))
    check(
      'NEGATIVA windows: una carpeta con libclntsh.dylib no vale',
      errDylib !== null && errDylib.includes('oci.dll'),
      String(errDylib)
    )
    const err121 = await falla(() => dmWin.install('oracle-ic-12.1'))
    check(
      'windows: el 12.1 sin URL conserva el mensaje de siempre',
      err121 !== null && err121.includes('Oracle ya no publica Oracle Instant Client 12.1'),
      String(err121)
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

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
