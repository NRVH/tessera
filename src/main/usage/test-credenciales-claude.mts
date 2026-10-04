#!/usr/bin/env node
// =============================================================================
// Prueba de `credencialesClaude.ts`: de dónde sale el token OAuth de Claude Code. (node
// src/main/usage/test-credenciales-claude.mts)
// La plataforma y el lector del llavero son parámetros: las dos ramas se comprueban desde cualquier
// sistema.
// Fija que el llavero solo entra en macOS y en modo host (con base propia el orden se invierte), el
// parseo del token, que `ausente` y `fallo` no son lo mismo y que un llavero que falla cae al
// fichero.
// El llavero real de macOS queda sin verificar desde Windows.
// =============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  esBaseNativaClaude,
  FICHERO_CREDENCIALES,
  leerCredencialesClaude,
  origenCredenciales,
  tokenDeCredenciales,
  type LectorLlavero
} from './credencialesClaude.ts'

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

/** El bloque tal y como lo escribe el CLI, en el fichero y en el llavero. */
function bloque(token: string): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: 'r-' + token,
      expiresAt: Date.now() + 3_600_000,
      scopes: ['user:inference'],
      subscriptionType: 'max'
    }
  })
}

/** Un lector de llavero de mentira que además CUENTA cuántas veces lo llaman. */
function llaveroDe(valor: string | null): { lector: LectorLlavero; veces: () => number } {
  let n = 0
  return {
    lector: async () => {
      n++
      return valor === null ? { clase: 'ausente' } : { clase: 'ok', texto: valor }
    },
    veces: () => n
  }
}

/** Un llavero que responde con un FALLO (código raro, timeout, cancelación). */
function llaveroQueFalla(detalle: string): { lector: LectorLlavero; veces: () => number } {
  let n = 0
  return {
    lector: async () => {
      n++
      return { clase: 'fallo', detalle }
    },
    veces: () => n
  }
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-cred-'))
  try {
    await correr(tmp)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
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

async function correr(tmp: string): Promise<void> {
  // -------------------------------------------------------------------------
  hr('(1) origenCredenciales: el llavero sólo en macOS Y en host')
  // -------------------------------------------------------------------------
  check(
    '(1a) mac + host + base por defecto -> llavero primero',
    origenCredenciales('host', true, 'mac') === 'llavero-luego-fichero',
    origenCredenciales('host', true, 'mac')
  )
  check(
    '(1b) mac + container -> SÓLO fichero (el llavero seria el token de otra cuenta)',
    origenCredenciales('container', true, 'mac') === 'solo-fichero' &&
      origenCredenciales('container', false, 'mac') === 'solo-fichero',
    `${origenCredenciales('container', true, 'mac')} | ${origenCredenciales('container', false, 'mac')}`
  )
  check(
    '(1c) windows, en los dos modos -> sólo fichero',
    origenCredenciales('host', true, 'windows') === 'solo-fichero' &&
      origenCredenciales('container', true, 'windows') === 'solo-fichero',
    `${origenCredenciales('host', true, 'windows')} | ${origenCredenciales('container', true, 'windows')}`
  )
  check(
    '(1d) linux/otra -> sólo fichero',
    origenCredenciales('host', true, 'otra') === 'solo-fichero',
    origenCredenciales('host', true, 'otra')
  )
  // Con CLAUDE_CONFIG_DIR el ítem del llavero no está atado a esa carpeta, así que el
  // fichero manda; pero el llavero SIGUE consultándose después, porque el caso normal en
  // un Mac es justamente que esa carpeta no tenga credenciales.
  check(
    '(1e) mac + host + base propia (CLAUDE_CONFIG_DIR) -> fichero primero, llavero después',
    origenCredenciales('host', false, 'mac') === 'fichero-luego-llavero',
    origenCredenciales('host', false, 'mac')
  )
  const home = path.join(tmp, 'home')
  check(
    '(1f) esBaseNativaClaude: `<home>/.claude` sí; cualquier otra, no',
    esBaseNativaClaude(path.join(home, '.claude'), home) &&
      esBaseNativaClaude(path.join(home, '.claude') + '/', home) &&
      !esBaseNativaClaude(path.join(home, 'otro-claude'), home),
    path.join(home, '.claude')
  )

  // -------------------------------------------------------------------------
  hr('(2) tokenDeCredenciales: las tres clases')
  // -------------------------------------------------------------------------
  const conToken = tokenDeCredenciales(bloque('tok-abc'))
  check(
    '(2a) bloque completo -> token',
    conToken.clase === 'token' && conToken.token === 'tok-abc',
    JSON.stringify(conToken)
  )
  check(
    '(2b) JSON sin bloque OAuth -> sin-oauth (cuenta por API key)',
    tokenDeCredenciales('{"otraCosa":1}').clase === 'sin-oauth',
    tokenDeCredenciales('{"otraCosa":1}').clase
  )
  check(
    '(2c) bloque OAuth con accessToken vacío -> sin-oauth, no un token de cero letras',
    tokenDeCredenciales('{"claudeAiOauth":{"accessToken":""}}').clase === 'sin-oauth',
    tokenDeCredenciales('{"claudeAiOauth":{"accessToken":""}}').clase
  )
  for (const [nombre, texto] of [
    ['null', null],
    ['cadena vacía', ''],
    ['sólo espacios', '   \n'],
    ['no es JSON', 'esto no es json'],
    ['JSON que no es objeto', '"hola"']
  ] as Array<[string, string | null]>) {
    check(
      `(2d·${nombre}) -> ausente, sin lanzar`,
      tokenDeCredenciales(texto).clase === 'ausente',
      tokenDeCredenciales(texto).clase
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) macOS + host: el llavero manda; el fichero es el respaldo')
  // -------------------------------------------------------------------------
  // `conFichero` ES la base por defecto de ese home de mentira, que es lo que hace que
  // el llavero vaya primero. Ver el bloque (8) para la base propia.
  const conFichero = path.join(home, '.claude')
  fs.mkdirSync(conFichero, { recursive: true })
  fs.writeFileSync(path.join(conFichero, FICHERO_CREDENCIALES), bloque('tok-de-fichero'))

  const l1 = llaveroDe(bloque('tok-de-llavero'))
  const gana = await leerCredencialesClaude(conFichero, 'host', 'mac', l1.lector, home)
  check(
    '(3a) con los DOS, gana el llavero (es el almacén bueno del CLI en macOS)',
    gana.clase === 'token' && gana.token === 'tok-de-llavero',
    JSON.stringify(gana)
  )
  const l2 = llaveroDe(null)
  const respaldo = await leerCredencialesClaude(conFichero, 'host', 'mac', l2.lector, home)
  check(
    '(3b) llavero vacío -> cae al fichero',
    respaldo.clase === 'token' && respaldo.token === 'tok-de-fichero',
    JSON.stringify(respaldo)
  )

  // -------------------------------------------------------------------------
  hr('(4) Fuera de macOS el llavero NI SE LLAMA')
  // -------------------------------------------------------------------------
  const l3 = llaveroDe(bloque('tok-de-llavero'))
  const win = await leerCredencialesClaude(conFichero, 'host', 'windows', l3.lector, home)
  check(
    '(4a) Windows/host: token del fichero y CERO llamadas al llavero',
    win.clase === 'token' && win.token === 'tok-de-fichero' && l3.veces() === 0,
    `${JSON.stringify(win)} | llamadas=${l3.veces()}`
  )
  const l4 = llaveroDe(bloque('tok-de-llavero'))
  const cont = await leerCredencialesClaude(conFichero, 'container', 'mac', l4.lector, home)
  check(
    '(4b) mac/container: token del fichero MONTADO y cero llamadas al llavero',
    cont.clase === 'token' && cont.token === 'tok-de-fichero' && l4.veces() === 0,
    `${JSON.stringify(cont)} | llamadas=${l4.veces()}`
  )

  // -------------------------------------------------------------------------
  hr('(5) Un llavero que falla no rompe nada')
  // -------------------------------------------------------------------------
  // El caso de verdad es el diálogo del llavero que el usuario cancela. Esto NO puede
  // propagarse: se llama desde el sondeo del footer, y una excepción no se leería como
  // «no hay credenciales» sino como un fallo genérico con otro texto en la UI.
  const queLanza: LectorLlavero = async () => {
    throw new Error('el usuario canceló el diálogo del llavero')
  }
  let exploto = false
  let trasFallo: Awaited<ReturnType<typeof leerCredencialesClaude>> = { clase: 'ausente' }
  try {
    trasFallo = await leerCredencialesClaude(conFichero, 'host', 'mac', queLanza, home)
  } catch {
    exploto = true
  }
  check(
    '(5a) el lector del llavero LANZA -> no se propaga y se sigue al fichero',
    !exploto && trasFallo.clase === 'token' && trasFallo.token === 'tok-de-fichero',
    exploto ? 'lanzó (mal)' : JSON.stringify(trasFallo)
  )
  const basura = llaveroDe('esto no es json')
  const trasBasura = await leerCredencialesClaude(conFichero, 'host', 'mac', basura.lector, home)
  check(
    '(5b) el llavero devuelve basura -> se ignora y manda el fichero',
    trasBasura.clase === 'token' && trasBasura.token === 'tok-de-fichero',
    JSON.stringify(trasBasura)
  )

  // -------------------------------------------------------------------------
  hr('(6) EL CASO REAL: carpeta sin .credentials.json + llavero con el bloque')
  // -------------------------------------------------------------------------
  // Es exactamente `~/.claude` en un Mac: transcripts sí, fichero de credenciales no.
  const homeReal = path.join(tmp, 'home-real')
  const comoEnMac = path.join(homeReal, '.claude')
  fs.mkdirSync(path.join(comoEnMac, 'projects'), { recursive: true })
  check(
    '(6·fixture) la carpeta NO tiene .credentials.json, como en un Mac de verdad',
    !fs.existsSync(path.join(comoEnMac, FICHERO_CREDENCIALES)),
    comoEnMac
  )
  const l5 = llaveroDe(bloque('tok-del-mac'))
  const real = await leerCredencialesClaude(comoEnMac, 'host', 'mac', l5.lector, homeReal)
  check(
    '(6a) macOS/host: hay token (antes de este módulo esto era `no-credentials`)',
    real.clase === 'token' && real.token === 'tok-del-mac',
    JSON.stringify(real)
  )
  const l6 = llaveroDe(bloque('tok-del-mac'))
  const mismaCarpetaEnWin = await leerCredencialesClaude(
    comoEnMac,
    'host',
    'windows',
    l6.lector,
    homeReal
  )
  check(
    '(6b) …y la MISMA carpeta en Windows sigue siendo `ausente`: nada cambió allí',
    mismaCarpetaEnWin.clase === 'ausente' && l6.veces() === 0,
    `${mismaCarpetaEnWin.clase} | llamadas=${l6.veces()}`
  )

  // -------------------------------------------------------------------------
  hr('(7) Un FALLO del llavero no es «no has iniciado sesión»')
  // -------------------------------------------------------------------------
  // El hallazgo de la segunda revisión. En un Mac en host NO hay fichero al que caer,
  // así que si un fallo pasajero se contara como `ausente`, `readClaudeUsage` devolvería
  // `no-credentials` — que `UsageReader` NO trata como transitorio, y por tanto no sirve
  // el último dato bueno. Unas barras correctas se borrarían para decir, encima, algo
  // falso. Con `fallo` acaba en `error`, que sí conserva lo anterior.
  const f1 = llaveroQueFalla('el llavero no respondió en 10 s')
  const soloLlaveroRoto = await leerCredencialesClaude(comoEnMac, 'host', 'mac', f1.lector, homeReal)
  check(
    '(7a) llavero que falla y NADA de fichero -> `fallo` (no `ausente`), con su motivo',
    soloLlaveroRoto.clase === 'fallo' && soloLlaveroRoto.detalle.includes('no respondió'),
    JSON.stringify(soloLlaveroRoto)
  )
  const f2 = llaveroQueFalla('el llavero no dejó leer la credencial (51)')
  const roto = await leerCredencialesClaude(conFichero, 'host', 'mac', f2.lector, home)
  check(
    '(7b) …pero si hay fichero con token, el fallo NO se enseña: manda el token',
    roto.clase === 'token' && roto.token === 'tok-de-fichero',
    JSON.stringify(roto)
  )
  // El item que NO está (código 44) sigue siendo `ausente`: eso sí es un estado, y la UI
  // debe poder decir «esta cuenta aún no ha iniciado sesión».
  const l7 = llaveroDe(null)
  const sinNada = await leerCredencialesClaude(comoEnMac, 'host', 'mac', l7.lector, homeReal)
  check(
    '(7c) llavero SIN el ítem y sin fichero -> `ausente`, que es un estado de la cuenta',
    sinNada.clase === 'ausente',
    JSON.stringify(sinNada)
  )
  // Y un estado comprobado (cuenta por API key) manda sobre un accidente.
  const apiKey = path.join(tmp, 'home-apikey', '.claude')
  fs.mkdirSync(apiKey, { recursive: true })
  fs.writeFileSync(path.join(apiKey, FICHERO_CREDENCIALES), '{"otraCosa":1}')
  const f3 = llaveroQueFalla('cancelado por el usuario')
  const conApiKey = await leerCredencialesClaude(
    apiKey,
    'host',
    'mac',
    f3.lector,
    path.join(tmp, 'home-apikey')
  )
  check(
    '(7d) fichero de cuenta por API key + llavero roto -> `sin-oauth` (lo comprobado gana)',
    conApiKey.clase === 'sin-oauth',
    JSON.stringify(conApiKey)
  )

  // -------------------------------------------------------------------------
  hr('(8) Base propia (CLAUDE_CONFIG_DIR): el llavero no tapa sus credenciales')
  // -------------------------------------------------------------------------
  // El ítem del llavero es uno solo por usuario del Mac y no está atado a ninguna
  // carpeta, así que si una base propia trae las suyas, son ESAS.
  const propia = path.join(tmp, 'config-propia')
  fs.mkdirSync(propia, { recursive: true })
  fs.writeFileSync(path.join(propia, FICHERO_CREDENCIALES), bloque('tok-de-la-propia'))
  const l8 = llaveroDe(bloque('tok-del-llavero-global'))
  const gana8 = await leerCredencialesClaude(propia, 'host', 'mac', l8.lector, homeReal)
  check(
    '(8a) base propia CON credenciales -> las suyas, no las del llavero global',
    gana8.clase === 'token' && gana8.token === 'tok-de-la-propia',
    JSON.stringify(gana8)
  )
  // Y el caso NORMAL en un Mac: la carpeta propia no tiene fichero, así que el llavero
  // sigue siendo el respaldo. Quitarlo aquí habría roto el arreglo entero.
  const propiaVacia = path.join(tmp, 'config-propia-vacia')
  fs.mkdirSync(propiaVacia, { recursive: true })
  const l9 = llaveroDe(bloque('tok-del-llavero-global'))
  const gana9 = await leerCredencialesClaude(propiaVacia, 'host', 'mac', l9.lector, homeReal)
  check(
    '(8b) base propia SIN credenciales -> cae al llavero (el caso normal en un Mac)',
    gana9.clase === 'token' && gana9.token === 'tok-del-llavero-global',
    JSON.stringify(gana9)
  )
}

void main()
