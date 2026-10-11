// =============================================================================
// Lo común al cifrado de las conexiones de red de `tdb` y de los procesos de sesión: las CA en
// las que se confía al VERIFICAR (las del paquete de Node y las del sistema), el error de
// certificado escondido en la cadena de causas y su mensaje. Lo usan los adaptadores de
// SQL Server, PostgreSQL, Oracle, MongoDB y Redis.
// Decisiones: docs/decisiones/bd/conexiones-cifrado.md
// =============================================================================

'use strict'

/**
 * Las CA en las que se confía al VERIFICAR el certificado del servidor: las del paquete de
 * Node y las del SISTEMA (almacén de Windows, llavero de macOS), sin repetir. `tlsMod` entra
 * por parámetro (el test lo sustituye). null si este Node no sabe leerlas (entonces cada
 * cliente usa las de Node).
 */
function certificadosDeConfianza(tlsMod) {
  const t = tlsMod || require('node:tls')
  if (!t || typeof t.getCACertificates !== 'function') return null
  const vistos = new Set()
  const salida = []
  for (const tipo of ['bundled', 'system']) {
    let lista
    try {
      lista = t.getCACertificates(tipo) || []
    } catch {
      lista = []
    }
    for (const c of lista) {
      if (!vistos.has(c)) {
        vistos.add(c)
        salida.push(c)
      }
    }
  }
  return salida.length > 0 ? salida : null
}

/**
 * El error de VERIFICACIÓN del certificado, buscado en la cadena de causas (los clientes lo
 * envuelven), o null si el error es otro.
 */
function causaTls(err) {
  let e = err
  for (let i = 0; i < 4 && e; i++) {
    const codigo = typeof e.code === 'string' ? e.code : ''
    const msg = typeof e.message === 'string' ? e.message : ''
    if (
      /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS/.test(codigo) ||
      /self[- ]signed certificate|unable to verify|certificate (has expired|is not yet valid)|Hostname\/IP does not match|server certificate unauthorized/i.test(
        msg
      )
    ) {
      return e
    }
    e = e.cause
  }
  return null
}

/** Sin cifrar: el valor por defecto de PostgreSQL y Oracle (`tlsPorDefecto` de su descriptor). */
const SIN_CIFRAR = Object.freeze({ cifrar: false, confiarCertificado: false })

/** El cifrado guardado de una conexión, o `porDefecto` si no lo trae o no tiene la forma de `DbTls`. */
function tlsDe(con, porDefecto) {
  const t = con && con.tls
  if (t && typeof t === 'object' && typeof t.cifrar === 'boolean' && typeof t.confiarCertificado === 'boolean') {
    return { cifrar: t.cifrar, confiarCertificado: t.confiarCertificado }
  }
  return { cifrar: porDefecto.cifrar, confiarCertificado: porDefecto.confiarCertificado }
}

/**
 * El mensaje de un certificado que no se pudo verificar. `admiteConfiar`: si el motor ofrece
 * «Confiar en el certificado del servidor» (Oracle no); si no, el remedio es instalar la CA.
 */
function mensajeCertificado(servidor, err, admiteConfiar) {
  // La última línea, que es la que dice la causa (oracledb la pone tras su NJS-), y sin la
  // coletilla de Node sobre `--use-system-ca`: Tessera ya confía en las CA del sistema.
  const lineas = String((err && (err.message || err.code)) || 'certificado no válido')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const causa = (lineas[lineas.length - 1] || 'certificado no válido').replace(/;\s*if the root CA is installed locally.*$/i, '')
  const remedio = admiteConfiar
    ? 'Si es un servidor de tu red con un certificado propio, marca «Confiar en el certificado del servidor» en la conexión, o instala su autoridad de certificación en el sistema.'
    : 'Si es un servidor de tu red con un certificado propio, instala su autoridad de certificación en el sistema.'
  return `No se pudo verificar el certificado de ${servidor} (${causa}). ${remedio}`
}

/**
 * Por túnel SSH el driver conecta a 127.0.0.1, pero el certificado es del servidor REAL
 * (`con.hostTls`): las opciones de `tls.connect` que lo verifican contra ese nombre (y lo
 * mandan por SNI si no es una IP). `{}` sin túnel.
 */
function identidadPorTunel(con) {
  const real = con && typeof con.hostTls === 'string' && con.hostTls !== '' ? con.hostTls : null
  if (real === null) return {}
  const tls = require('node:tls')
  const net = require('node:net')
  return {
    ...(net.isIP(real) ? {} : { servername: real }),
    checkServerIdentity: (_host, cert) => tls.checkServerIdentity(real, cert)
  }
}

/** El servidor como lo nombra un mensaje: el real si se llega por túnel SSH (el driver ve 127.0.0.1). */
function servidorDeMensaje(con) {
  if (con && typeof con.hostTls === 'string' && con.hostTls !== '') return `${con.hostTls} (por el túnel SSH)`
  return `${con.host}:${con.port}`
}

module.exports = { SIN_CIFRAR, certificadosDeConfianza, causaTls, tlsDe, mensajeCertificado, identidadPorTunel, servidorDeMensaje }
