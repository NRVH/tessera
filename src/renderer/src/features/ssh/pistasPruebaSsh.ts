// =============================================================================
// Cómo se cuenta el resultado de «Probar» una conexión SSH: la línea principal («Conectó en N ms» o el
// motivo), una pista de qué mirar (la VPN, las credenciales, la red local del sistema) y la huella del
// servidor como la enseña ssh-keygen. Puro, con la plataforma como PARÁMETRO (en el renderer no hay
// `process`): se fija bajo `node` (`test-pistas-prueba-ssh.mts`).
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { nombresSistema } from '../../../../shared/nombresSistema.ts'
import type { Plataforma } from '../../../../shared/plataforma.ts'
import type { SshHuella, SshResultadoPrueba } from '../../../../shared/ssh-ipc.ts'
import { txFormularioSsh } from './textosFormulario.ts'

/** Lo que pinta el resultado: la línea principal, qué mirar y el detalle de ssh (ya sin rutas). */
export interface TextoPrueba {
  titulo: string
  pista: string | null
  detalle: string | null
}

/** El tipo de una clave de servidor como lo enseña ssh-keygen (`ED25519`, `ECDSA`, `RSA`…). */
export function etiquetaAlgoritmo(algoritmo: string): string {
  const a = algoritmo.toLowerCase()
  const sk = a.startsWith('sk-') ? '-SK' : ''
  if (a.includes('ed25519')) return `ED25519${sk}`
  if (a.includes('ecdsa')) return `ECDSA${sk}`
  if (a.includes('rsa')) return 'RSA'
  if (a.includes('dss') || a === 'dsa') return 'DSA'
  return algoritmo.toUpperCase()
}

/** «ED25519 SHA256:…», como la enseña ssh al conectar. */
export function textoHuella(h: SshHuella): string {
  return `${etiquetaAlgoritmo(h.algoritmo)} SHA256:${h.sha256}`
}

/** ¿Es una dirección de la red local (privada o de enlace)? Es a lo que la privacidad de red local de macOS pone puerta. */
export function esIpPrivada(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  const h = host.toLowerCase()
  return h.includes(':') && (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h))
}

/** Qué mirar cuando el servidor no responde: en macOS, hacia la red local, el permiso de red local de la app. */
function pistaInalcanzable(detalle: string, host: string, plataforma: Plataforma): string {
  const t = txFormularioSsh()
  if (plataforma === 'mac' && /No route to host/i.test(detalle) && esIpPrivada(host)) {
    return t.sinRedLocal(nombresSistema(plataforma).sistema, t.rutaRedLocal)
  }
  return t.pistaVpn
}

/** El título y la pista de un fallo, por su motivo. */
function textoFallo(r: Extract<SshResultadoPrueba, { ok: false }>, host: string, plataforma: Plataforma): Omit<TextoPrueba, 'detalle'> {
  const t = txFormularioSsh()
  switch (r.motivo) {
    case 'ssh-autenticacion':
      return { titulo: t.authTitulo, pista: r.preguntaSinContestar ? t.authPreguntaPista : t.authPista }
    case 'ssh-inalcanzable':
      return { titulo: t.inalcanzableTitulo, pista: pistaInalcanzable(r.detalle, host, plataforma) }
    case 'ssh-huella-cambiada':
      return { titulo: t.huellaTitulo, pista: t.huellaPista }
    case 'ssh-algoritmos':
      return { titulo: t.algoritmosTitulo, pista: t.algoritmosPista }
    case 'tiempo':
      return { titulo: t.tiempoTitulo, pista: t.tiempoPista }
    default:
      return { titulo: t.noSePudoProbar, pista: null }
  }
}

/**
 * Las huellas que se enseñan: la del servidor si conectó; con la huella cambiada, la guardada y la que
 * presenta ahora (para compararla por otra vía antes de olvidar la guardada).
 */
export function lineasHuella(r: SshResultadoPrueba): string[] {
  const t = txFormularioSsh()
  const guardadas = r.huellas.map((h) => `${r.ok ? t.huellaServidor : t.huellaGuardada}: ${textoHuella(h)}`)
  if (r.ok || r.huellaNueva === undefined) return guardadas
  return [...guardadas, `${t.presentaAhora}: ${textoHuella(r.huellaNueva)}`]
}

/** El texto del resultado de «Probar». */
export function textoResultadoPrueba(r: SshResultadoPrueba, host: string, plataforma: Plataforma): TextoPrueba {
  if (r.ok) {
    const t = txFormularioSsh()
    return r.soloAlcance
      ? { titulo: t.servidorResponde(r.ms), pista: t.soloAlcancePista, detalle: null }
      : { titulo: t.conecto(r.ms), pista: null, detalle: null }
  }
  return { ...textoFallo(r, host, plataforma), detalle: r.detalle === '' ? null : r.detalle }
}
