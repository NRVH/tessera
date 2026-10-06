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
  if (plataforma === 'mac' && /No route to host/i.test(detalle) && esIpPrivada(host)) {
    return (
      `Puede que ${nombresSistema(plataforma).sistema} no deje a Tessera usar la red local: ` +
      'actívalo en Ajustes del Sistema › Privacidad y seguridad › Red local.'
    )
  }
  return '¿Falta la VPN? Comprueba también el host y el puerto.'
}

/** El título y la pista de un fallo, por su motivo. */
function textoFallo(r: Extract<SshResultadoPrueba, { ok: false }>, host: string, plataforma: Plataforma): Omit<TextoPrueba, 'detalle'> {
  switch (r.motivo) {
    case 'ssh-autenticacion':
      return {
        titulo: 'No entró: el servidor no aceptó las credenciales.',
        pista: r.preguntaSinContestar
          ? 'El servidor pidió algo más (un código, una confirmación) que Tessera no contesta: la terminal te lo preguntará a ti.'
          : 'Revisa el usuario y la contraseña (o la clave y su frase).'
      }
    case 'ssh-inalcanzable':
      return { titulo: 'El servidor no responde.', pista: pistaInalcanzable(r.detalle, host, plataforma) }
    case 'ssh-huella-cambiada':
      return {
        titulo: 'La huella del servidor no es la que tienes guardada.',
        pista: 'Puede que lo hayan reinstalado, o que alguien se esté haciendo pasar por él. Si sabes por qué cambió, olvida la guardada.'
      }
    case 'ssh-algoritmos':
      return { titulo: 'El servidor y este cliente SSH no tienen algoritmos en común.', pista: 'Pasa con equipos antiguos.' }
    case 'tiempo':
      return { titulo: 'No terminó en 20 segundos.', pista: '¿Falta la VPN? El servidor no contesta a tiempo.' }
    default:
      return { titulo: 'No se pudo probar.', pista: null }
  }
}

/**
 * Las huellas que se enseñan: la del servidor si conectó; con la huella cambiada, la guardada y la que
 * presenta ahora (para compararla por otra vía antes de olvidar la guardada).
 */
export function lineasHuella(r: SshResultadoPrueba): string[] {
  const guardadas = r.huellas.map((h) => `${r.ok ? 'Huella del servidor' : 'Huella guardada'}: ${textoHuella(h)}`)
  if (r.ok || r.huellaNueva === undefined) return guardadas
  return [...guardadas, `Presenta ahora: ${textoHuella(r.huellaNueva)}`]
}

/** El texto del resultado de «Probar». */
export function textoResultadoPrueba(r: SshResultadoPrueba, host: string, plataforma: Plataforma): TextoPrueba {
  if (r.ok) {
    return r.soloAlcance
      ? { titulo: `El servidor responde (${r.ms} ms).`, pista: 'Sin la contraseña (o la frase) guardada no se prueba a entrar: la pedirá la terminal.', detalle: null }
      : { titulo: `Conectó en ${r.ms} ms.`, pista: null, detalle: null }
  }
  return { ...textoFallo(r, host, plataforma), detalle: r.detalle === '' ? null : r.detalle }
}
