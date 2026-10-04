#!/usr/bin/env node
// =============================================================================
// Prueba de la descarga de un cliente de base de datos (`descarga.ts`), sin red: SHA-256 y bytes, progreso
// una vez por punto, mensajes del servidor, plazo de inactividad (también con un `fetch` que no atiende
// la señal de aborto y la mitad negativa: una descarga lenta pero viva no se corta) y cierre del escritor.
// (node src/main/db/test-descarga.mts)
// =============================================================================

import { createHash } from 'node:crypto'
import { PLAZO_INACTIVIDAD_DESCARGA_MS, descargarConHuella, mensajeInactividad, type EscritorDescarga } from './descarga.ts'

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

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Un escritor que apunta lo que recibe y si se cerró. */
function escritorFalso(op: { alEscribir?: () => Promise<void>; alCerrar?: () => Promise<void> } = {}) {
  const estado = { bytes: 0, trozos: 0, cerrado: false }
  const escritor: EscritorDescarga = {
    escribir: async (t) => {
      if (op.alEscribir) await op.alEscribir()
      estado.bytes += t.length
      estado.trozos++
    },
    cerrar: async () => {
      estado.cerrado = true
      if (op.alCerrar) await op.alCerrar()
    }
  }
  return { escritor, estado }
}

/** Un cuerpo que manda `trozos` trozos, uno cada `cadaMs`, y luego (si `colgar`) se queda callado. */
function cuerpoGoteo(trozos: number, tam: number, cadaMs: number, colgar = false): ReadableStream<Uint8Array> {
  let enviados = 0
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (enviados >= trozos) {
        if (colgar) await new Promise(() => {}) // Nunca más: ni datos ni fin. No atiende la señal.
        c.close()
        return
      }
      if (enviados > 0) await esperar(cadaMs)
      enviados++
      c.enqueue(new Uint8Array(tam).fill(enviados))
    }
  })
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  hr('(1) Lo de siempre: huella, bytes, progreso y errores del servidor')
  // -------------------------------------------------------------------------
  {
    const cuerpo = new Uint8Array(250_000).map((_, i) => (i * 31) % 256)
    const esperado = createHash('sha256').update(cuerpo).digest('hex')
    const { escritor, estado } = escritorFalso()
    const pcts: number[] = []
    const f = (async () =>
      new Response(cuerpo, { status: 200, headers: { 'content-length': String(cuerpo.length) } })) as typeof fetch
    const r = await descargarConHuella(f, 'https://ejemplo/x.dmg', escritor, (p) => pcts.push(p))
    check(
      'SHA-256 de lo escrito, todos los bytes, y el escritor cerrado',
      r.sha256 === esperado && r.bytes === cuerpo.length && estado.bytes === cuerpo.length && estado.cerrado,
      `${r.sha256.slice(0, 12)} ${r.bytes}`
    )
    check(
      'progreso creciente, sin repetir, hasta 100',
      pcts.length > 0 && pcts[pcts.length - 1] === 100 && pcts.every((p, i) => i === 0 || p > pcts[i - 1]),
      `${pcts.length} avisos, último ${pcts[pcts.length - 1]}`
    )
    const sinTam = escritorFalso()
    const pctsSinTam: number[] = []
    await descargarConHuella((async () => new Response(cuerpo)) as typeof fetch, 'https://ejemplo/x', sinTam.escritor, (p) =>
      pctsSinTam.push(p)
    )
    check('sin content-length: ningún porcentaje inventado', pctsSinTam.length === 0 && sinTam.estado.bytes === cuerpo.length, String(pctsSinTam.length))

    const e404 = escritorFalso()
    const err404 = await falla(() =>
      descargarConHuella(
        (async () => new Response('no', { status: 404, statusText: 'Not Found' })) as typeof fetch,
        'https://ejemplo/x.dmg',
        e404.escritor,
        () => {}
      )
    )
    check('404: el mensaje de siempre, con el estado', err404 === 'El servidor respondió 404 Not Found.', String(err404))
    check('404: el escritor se cierra IGUAL (quien llama abrió el archivo y tiene que poder borrarlo)', e404.estado.cerrado, String(e404.estado.cerrado))
    const eRed = escritorFalso()
    const errRed = await falla(() =>
      descargarConHuella(
        (async () => {
          throw new Error('getaddrinfo ENOTFOUND download.oracle.com')
        }) as typeof fetch,
        'https://ejemplo/x.dmg',
        eRed.escritor,
        () => {}
      )
    )
    check('sin red: el error de la red llega tal cual y el escritor se cierra', errRed !== null && errRed.includes('ENOTFOUND') && eRed.estado.cerrado, String(errRed))
    let senal: AbortSignal | undefined
    await descargarConHuella(
      (async (_u: unknown, init?: RequestInit) => {
        senal = init?.signal ?? undefined
        return new Response('ok')
      }) as typeof fetch,
      'https://ejemplo/x',
      escritorFalso().escritor,
      () => {}
    )
    check('al `fetch` le llega una señal de aborto (el real suelta el socket al vencer el plazo)', senal instanceof AbortSignal && !senal.aborted, String(senal?.aborted))
  }

  // -------------------------------------------------------------------------
  hr('(2) Plazo de inactividad: lo parado se corta, lo lento no')
  // -------------------------------------------------------------------------
  {
    const PLAZO = 80
    check('por defecto, 60 s', PLAZO_INACTIVIDAD_DESCARGA_MS === 60_000, String(PLAZO_INACTIVIDAD_DESCARGA_MS))
    check(
      'el mensaje dice cuánto y qué hacer, sin nombrar el sistema',
      mensajeInactividad(60_000).includes('60 s sin enviar datos') &&
        mensajeInactividad(60_000).includes('Vuelve a intentarlo') &&
        !/Windows|macOS|Mac\b/.test(mensajeInactividad(60_000)),
      mensajeInactividad(60_000)
    )

    // Un servidor que nunca contesta, con un `fetch` que NO atiende la señal.
    const mudo = escritorFalso()
    const t0 = Date.now()
    const errMudo = await falla(() =>
      descargarConHuella((() => new Promise<Response>(() => {})) as typeof fetch, 'https://ejemplo/x', mudo.escritor, () => {}, {
        inactividadMs: PLAZO
      })
    )
    const tMudo = Date.now() - t0
    check(
      'servidor que no contesta: error de inactividad al vencer el plazo (no se queda esperando)',
      errMudo === mensajeInactividad(PLAZO) && tMudo >= PLAZO - 10 && tMudo < PLAZO + 2000,
      `${errMudo} (${tMudo} ms)`
    )
    check('… y el escritor se cierra', mudo.estado.cerrado, String(mudo.estado.cerrado))

    // Manda tres trozos y se calla a mitad (un CDN atascado).
    const atascado = escritorFalso()
    const pcts: number[] = []
    let senal: AbortSignal | undefined
    const errAtascado = await falla(() =>
      descargarConHuella(
        (async (_u: unknown, init?: RequestInit) => {
          senal = init?.signal ?? undefined
          return new Response(cuerpoGoteo(3, 1000, 5, true), { headers: { 'content-length': '10000' } })
        }) as typeof fetch,
        'https://ejemplo/x',
        atascado.escritor,
        (p) => pcts.push(p),
        { inactividadMs: PLAZO }
      )
    )
    check(
      'se calla a MITAD (30 %): error de inactividad, lo recibido escrito, el escritor cerrado',
      errAtascado === mensajeInactividad(PLAZO) &&
        atascado.estado.bytes === 3000 &&
        pcts[pcts.length - 1] === 30 &&
        atascado.estado.cerrado,
      `${errAtascado} · ${atascado.estado.bytes} bytes · ${pcts.join(',')}`
    )
    check('… y la petición se aborta (la señal que recibió el `fetch` queda abortada)', senal?.aborted === true, String(senal?.aborted))

    // NEGATIVO: lenta pero viva. Diez trozos cada 40 ms con un plazo de 80: 400 ms en total.
    const lenta = escritorFalso()
    const t1 = Date.now()
    const rLenta = await descargarConHuella(
      (async () => new Response(cuerpoGoteo(10, 100, 40))) as typeof fetch,
      'https://ejemplo/x',
      lenta.escritor,
      () => {},
      { inactividadMs: PLAZO }
    )
    const tLenta = Date.now() - t1
    check(
      'NEGATIVO: una descarga LENTA pero viva, que dura más que el plazo, no se corta',
      rLenta.bytes === 1000 && tLenta > PLAZO && lenta.estado.cerrado,
      `${rLenta.bytes} bytes en ${tLenta} ms`
    )

    // NEGATIVO: el disco tarda en escribir más que el plazo. No es el servidor callado.
    const discoLento = escritorFalso({ alEscribir: () => esperar(PLAZO * 2) })
    const rDisco = await descargarConHuella(
      (async () => new Response(cuerpoGoteo(2, 100, 1))) as typeof fetch,
      'https://ejemplo/x',
      discoLento.escritor,
      () => {},
      { inactividadMs: PLAZO }
    )
    check('NEGATIVO: un disco lento al escribir no cuenta como inactividad', rDisco.bytes === 200, String(rDisco.bytes))
  }

  // -------------------------------------------------------------------------
  hr('(3) Cerrar el escritor no tapa el error')
  // -------------------------------------------------------------------------
  {
    const e = escritorFalso({
      alCerrar: async () => {
        throw new Error('EBADF: bad file descriptor, close')
      }
    })
    const err = await falla(() =>
      descargarConHuella(
        (async () => new Response('no', { status: 503, statusText: 'Service Unavailable' })) as typeof fetch,
        'https://ejemplo/x',
        e.escritor,
        () => {}
      )
    )
    check(
      'la descarga falla (503) y el cierre también: manda el 503, que es el que explica qué pasó',
      err === 'El servidor respondió 503 Service Unavailable.' && e.estado.cerrado,
      String(err)
    )
    const bien = escritorFalso({
      alCerrar: async () => {
        throw new Error('EIO: i/o error, close')
      }
    })
    const errBien = await falla(() =>
      descargarConHuella((async () => new Response('hola')) as typeof fetch, 'https://ejemplo/x', bien.escritor, () => {})
    )
    check(
      'la descarga va bien pero el cierre falla: se lanza el del cierre (el archivo puede estar incompleto)',
      errBien !== null && errBien.includes('EIO'),
      String(errBien)
    )
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
