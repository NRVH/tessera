// =============================================================================
// Claves reales generadas con ssh-keygen: formatos, cifrados y verificación de cada firma.
// Contrasta las firmas con verificaciones criptográficas para detectar errores de lectura o descifrado.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { execFileSync } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { leerClave, firmar } from './lectorClaves.ts'
import { Lector } from './protocolo.ts'

let correctas = 0
let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (valido) correctas++; else fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
const carpeta = mkdtempSync(path.join(tmpdir(), 'tessera-claves-'))
const datos = Buffer.from('Operación SSH de prueba')
try {
  for (const configuracion of [{ tipo: 'ed25519', bits: 256 }, { tipo: 'ecdsa', bits: 256 }, { tipo: 'ecdsa', bits: 384 }, { tipo: 'ecdsa', bits: 521 }, { tipo: 'rsa', bits: 2048 }]) {
    const { tipo, bits } = configuracion
    for (const formato of ['openssh', 'PEM']) {
      if (tipo === 'ed25519' && formato === 'PEM') continue
      for (const frase of ['', 'frase de prueba']) {
        for (const cifrado of formato === 'openssh' && frase ? ['aes256-ctr', 'aes256-cbc'] : ['predeterminado']) {
          const id = `${tipo}-${bits}-${formato}-${frase ? 'cifrada' : 'sin-frase'}-${cifrado}`
          hr(id)
          const ruta = path.join(carpeta, id)
          execFileSync('ssh-keygen', ['-q', '-t', tipo, ...(tipo === 'ed25519' ? [] : ['-b', String(bits)]), '-N', frase, '-f', ruta, ...(formato === 'PEM' ? ['-m', 'PEM'] : []), ...(cifrado !== 'predeterminado' ? ['-Z', cifrado] : [])], { windowsHide: true, stdio: 'pipe' })
          const texto = readFileSync(ruta, 'utf8')
          const clave = leerClave(texto, frase)
          for (const banderas of tipo === 'rsa' ? [2, 4, 6] : [0]) {
            const lector = new Lector(firmar(clave, datos, banderas))
            const algoritmo = lector.texto()
            let firma = lector.cadena()
            lector.terminar()
            if (tipo === 'ecdsa') {
              const par = new Lector(firma)
              const partes = [par.cadena(), par.cadena()].map((n) => n[0] === 0 ? n.subarray(1) : n)
              firma = Buffer.concat(partes.map((n) => Buffer.concat([Buffer.alloc(Math.ceil(bits / 8) - n.length), n])))
            }
            const resumen = tipo === 'ed25519' ? null : algoritmo.endsWith('512') || algoritmo.endsWith('521') ? 'sha512' : algoritmo.endsWith('384') ? 'sha384' : 'sha256'
            check(`${id} flags=${banderas}`, verify(resumen, datos, { key: createPublicKey(clave.privada), dsaEncoding: 'ieee-p1363' }, firma))
            check(`${id} mensaje alterado`, !verify(resumen, Buffer.from('Otro mensaje'), { key: createPublicKey(clave.privada), dsaEncoding: 'ieee-p1363' }, firma))
          }
          if (frase) {
            let rechazo = false
            try { leerClave(texto, 'incorrecta') } catch { rechazo = true }
            check(`${id} rechaza frase incorrecta`, rechazo)
          }
          let rechazoFlags = false
          try { firmar(clave, datos, 128) } catch { rechazoFlags = true }
          check(`${id} flags desconocidos`, rechazoFlags)
          if (tipo === 'ed25519') {
            const pem = clave.privada.export({ format: 'pem', type: 'pkcs8', ...(frase ? { cipher: 'aes-256-cbc', passphrase: frase } : {}) }).toString()
            const desdePem = leerClave(pem, frase)
            const firmaPem = new Lector(firmar(desdePem, datos, 0))
            check(`${id} PEM PKCS8`, firmaPem.texto() === 'ssh-ed25519' && verify(null, datos, createPublicKey(desdePem.privada), firmaPem.cadena()))
          }
        }
      }
    }
  }
} catch (error) { check(String(error), false) }
finally { rmSync(carpeta, { recursive: true, force: true }) }
console.log(`VEREDICTO: ${correctas} correctas, ${fallidas} fallidas`)
process.exit(fallidas ? 1 : 0)
