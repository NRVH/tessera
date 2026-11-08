// =============================================================================
// Protocolo SSH: límites, mensajes completos y rechazo de operaciones ajenas a listar y firmar.
// Ejercita tramas fragmentadas y concatenadas para detectar errores de encuadre y validación del transporte.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { cadena, entero, decodificar, identidades, respuestaFirma, Lector, TOPE_MENSAJE, comprobarPublica } from './protocolo.ts'
import { createRequire } from 'node:module'
const { enmarcar, extraerTrama } = createRequire(import.meta.url)('../../../tssh/ssh-agente.cjs') as { enmarcar: (datos: Buffer) => Buffer; extraerTrama: (datos: Buffer) => { mensaje: Buffer; resto: Buffer } | null }
let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
hr('Mensajes del agente')
const trama = enmarcar(Buffer.from([11]))
for (let longitud = 0; longitud < trama.length; longitud++) check('fragmento espera el resto de la trama', extraerTrama(trama.subarray(0, longitud)) === null)
const dos = extraerTrama(Buffer.concat([trama, trama]))!
check('tramas concatenadas', dos.mensaje.equals(Buffer.from([11])) && extraerTrama(dos.resto)?.mensaje.equals(Buffer.from([11])) === true)
for (const datos of [entero(0), entero(TOPE_MENSAJE + 1)]) {
  let rechazo = false
  try { extraerTrama(datos) } catch { rechazo = true }
  check('longitud de trama fuera del límite', rechazo)
}
check('listar', decodificar(Buffer.from([11])).tipo === 'listar')
const publica = Buffer.from('pública')
const datos = Buffer.from('datos')
const mensaje = Buffer.concat([Buffer.from([13]), cadena(publica), cadena(datos), entero(4)])
const peticion = decodificar(mensaje)
check('firma', peticion.tipo === 'firmar' && peticion.publica.equals(publica) && peticion.datos.equals(datos) && peticion.flags === 4)
for (const tipo of [1, 7, 17, 18, 19, 20, 21, 22, 25, 27]) check(`rechaza ${tipo}`, decodificar(Buffer.from([tipo])).tipo === 'fallo')
for (const invalido of [Buffer.alloc(0), Buffer.from([11, 0]), mensaje.subarray(0, -1), Buffer.concat([mensaje, Buffer.from([0])]), Buffer.alloc(TOPE_MENSAJE + 1), Buffer.from([13, 255, 255, 255, 255])]) {
  let rechazo = false
  try { decodificar(invalido) } catch { rechazo = true }
  check('mensaje malformado', rechazo)
}
const lista = new Lector(identidades([{ publica, nombre: 'clave' }]))
check('respuesta de identidades', lista.bytes(1)[0] === 12 && lista.entero() === 1 && lista.cadena().equals(publica) && lista.texto() === 'clave')
lista.terminar()
const firma = new Lector(respuestaFirma(datos))
check('respuesta de firma', firma.bytes(1)[0] === 14 && firma.cadena().equals(datos))
firma.terminar()
const publicaValida = Buffer.concat([cadena('ssh-ed25519'), cadena(Buffer.alloc(32, 7))])
check('pública válida', comprobarPublica(publicaValida).equals(publicaValida))
for (const publicaInvalida of [Buffer.concat([publicaValida, Buffer.from('datos ajenos')]), Buffer.concat([cadena('ssh-ed25519'), cadena(Buffer.alloc(31))]), Buffer.concat([cadena('ssh-dss'), cadena(Buffer.alloc(32))])]) {
  let rechazo = false
  try { comprobarPublica(publicaInvalida) } catch { rechazo = true }
  check('pública malformada o no admitida', rechazo)
}
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
