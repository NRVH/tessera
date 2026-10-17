// =============================================================================
// Pruebas de `cifradoFrase.ts`: ida y vuelta con la frase, la frase equivocada, una cabecera o
// unos datos tocados (fallan, nunca dan basura), una versión más nueva y unos parámetros de cifrado
// que pedirían demasiada memoria.
// Uso: node src/main/configuracion/test-cifrado-frase.mts
// =============================================================================

import { VERSION_ARCHIVO, cifrarCopia, copiaSinCifrar, descifrarCopia, leerArchivoCopia } from './cifradoFrase.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const CONTENIDO = JSON.stringify({ perfiles: [{ id: 'p', nombre: 'Ñandú ✓' }], secreto: 'contraseña-de-prueba' })
const FRASE = 'una frase de prueba'

async function idaYVuelta(): Promise<void> {
  hr('(1) Ida y vuelta')
  const t0 = Date.now()
  const archivo = await cifrarCopia(CONTENIDO, FRASE, { plataforma: 'mac', app: '9.9.9' })
  const ms = Date.now() - t0
  const texto = JSON.stringify(archivo)
  check('el contenido no se lee en claro en el archivo', !texto.includes('contraseña-de-prueba') && !texto.includes('Ñandú'), `${texto.length} bytes`)
  check('la cabecera dice versión, plataforma y app', archivo.version === VERSION_ARCHIVO && archivo.plataforma === 'mac' && archivo.app === '9.9.9', '')
  check('derivar la clave cuesta (scrypt), pero no demasiado', ms > 20 && ms < 10_000, `${ms} ms`)
  const leido = leerArchivoCopia(texto)
  const d = leido.ok ? await descifrarCopia(leido.archivo, FRASE) : null
  check('con la frase vuelve igual', d?.ok === true && d.contenido === CONTENIDO, JSON.stringify(d).slice(0, 80))
  const otra = leido.ok ? await descifrarCopia(leido.archivo, 'otra frase cualquiera') : null
  check('NEGATIVO: con otra frase, error (no basura)', otra?.ok === false, JSON.stringify(otra))
  const dos = await cifrarCopia(CONTENIDO, FRASE, { plataforma: 'mac', app: '9.9.9' })
  check('cada copia lleva su sal y su iv', dos.cifrado?.sal !== archivo.cifrado?.sal && dos.cifrado?.iv !== archivo.cifrado?.iv && dos.datos !== archivo.datos, '')
}

async function sinFrase(): Promise<void> {
  hr('(1b) Sin frase, solo si se pide')
  const a = copiaSinCifrar(CONTENIDO, { plataforma: 'windows', app: '9.9.9' })
  const texto = JSON.stringify(a)
  check('la cabecera lo dice: sin cifrado', a.cifrado === null && a.version === VERSION_ARCHIVO, texto.slice(0, 120))
  const leido = leerArchivoCopia(texto)
  check('se lee como una copia válida', leido.ok, JSON.stringify(leido).slice(0, 120))
  const d = leido.ok ? await descifrarCopia(leido.archivo, '') : null
  check('y da el contenido sin pedir frase', d?.ok === true && d.contenido === CONTENIDO, JSON.stringify(d).slice(0, 80))
  const sinCampo = leerArchivoCopia(JSON.stringify({ ...a, cifrado: undefined }))
  check('NEGATIVO: sin el campo `cifrado` (ni null) no es una copia', !sinCampo.ok, JSON.stringify(sinCampo))
}

async function manipulado(): Promise<void> {
  hr('(2) Un archivo tocado no se acepta')
  const a = await cifrarCopia(CONTENIDO, FRASE, { plataforma: 'windows', app: '1.0.0' })
  const cabecera = await descifrarCopia({ ...a, app: '2.0.0' }, FRASE)
  check('la cabecera cambiada hace fallar el descifrado', !cabecera.ok, JSON.stringify(cabecera))
  const bytes = Buffer.from(a.datos, 'base64')
  bytes[5] ^= 0xff
  const datos = await descifrarCopia({ ...a, datos: bytes.toString('base64') }, FRASE)
  check('un byte cambiado en los datos también', !datos.ok, JSON.stringify(datos))
  const corto = await descifrarCopia({ ...a, datos: 'AAAA' }, FRASE)
  check('unos datos cortados, también', !corto.ok, JSON.stringify(corto))
}

async function cabeceras(): Promise<void> {
  hr('(3) La cabecera')
  const a = await cifrarCopia(CONTENIDO, FRASE, { plataforma: 'linux', app: '1.0.0' })
  const nuevo = leerArchivoCopia(JSON.stringify({ ...a, version: VERSION_ARCHIVO + 1 }))
  check('una versión más nueva se rechaza con su motivo', !nuevo.ok && nuevo.error.includes('más nueva'), JSON.stringify(nuevo))
  const memoria = leerArchivoCopia(JSON.stringify({ ...a, cifrado: { ...a.cifrado, N: 2 ** 30 } }))
  check('unos parámetros que pedirían gigas de memoria se rechazan antes de derivar', !memoria.ok, JSON.stringify(memoria))
  const noPotencia = leerArchivoCopia(JSON.stringify({ ...a, cifrado: { ...a.cifrado, N: 1000 } }))
  check('N que no es potencia de dos: no', !noPotencia.ok, JSON.stringify(noPotencia))
  const grande = leerArchivoCopia(JSON.stringify({ ...a, cifrado: { ...a.cifrado, N: 2 ** 20, r: 8 } }))
  check('N y r que no caben en el tope de scrypt se rechazan (no parecen una frase mala)', !grande.ok && grande.error.includes('memoria'), JSON.stringify(grande))
  // Un archivo de una versión futura escrito en una plataforma que esta no conoce.
  const futura = await cifrarCopia(CONTENIDO, FRASE, { plataforma: 'otra' as never, app: '1.0.0' })
  const reescrito = leerArchivoCopia(JSON.stringify(futura))
  const dFutura = reescrito.ok ? await descifrarCopia(reescrito.archivo, FRASE) : null
  check('una plataforma desconocida se lee tal cual y descifra con su frase', reescrito.ok && reescrito.archivo.plataforma === 'otra' && dFutura?.ok === true, JSON.stringify(dFutura).slice(0, 80))
  const otraCosa = leerArchivoCopia(JSON.stringify({ tessera: 'agente', version: 1 }))
  check('otro JSON de Tessera no es una copia', !otraCosa.ok, JSON.stringify(otraCosa))
  check('un texto que no es JSON tampoco', !leerArchivoCopia('hola').ok, '')
}

await idaYVuelta()
await sinFrase()
await manipulado()
await cabeceras()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
