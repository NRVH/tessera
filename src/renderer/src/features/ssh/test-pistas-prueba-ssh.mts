#!/usr/bin/env node
// =============================================================================
// Prueba de cómo se cuenta el resultado de «Probar» una conexión SSH (npm run test:pistas-prueba-ssh):
// «Conectó en N ms», la huella como la enseña ssh-keygen, la pista de cada motivo (credenciales, VPN,
// algoritmos, huella cambiada) y la de la red local de macOS solo allí, con «No route to host» hacia
// una dirección privada y nombrando el sistema por `nombresSistema`. La plataforma, por parámetro.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { nombresSistema } from '../../../../shared/nombresSistema.ts'
import type { SshResultadoPrueba } from '../../../../shared/ssh-ipc.ts'
import { esIpPrivada, etiquetaAlgoritmo, lineasHuella, textoHuella, textoResultadoPrueba } from './pistasPruebaSsh.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const HUELLA = { algoritmo: 'ssh-ed25519', sha256: 'kut/iZvVLGHNjTf24VrWM0HGUS7PQ1Otwffu9xav2xw' }
const fallo = (motivo: Extract<SshResultadoPrueba, { ok: false }>['motivo'], detalle = '', extra: Partial<Extract<SshResultadoPrueba, { ok: false }>> = {}): SshResultadoPrueba => ({
  ok: false,
  ms: 40,
  huellas: [HUELLA],
  motivo,
  detalle,
  ...extra
})

hr('1 - Conectó, o solo se llegó')
{
  const ok = textoResultadoPrueba({ ok: true, ms: 181, huellas: [HUELLA], soloAlcance: false }, 'srv', 'windows')
  check('(1a) «Conectó en N ms», sin pista', ok.titulo === 'Conectó en 181 ms.' && ok.pista === null && ok.detalle === null, j(ok))
  const alcance = textoResultadoPrueba({ ok: true, ms: 60, huellas: [HUELLA], soloAlcance: true }, 'srv', 'windows')
  check('(1b) sin la contraseña guardada: el servidor responde y la pedirá la terminal', alcance.titulo === 'El servidor responde (60 ms).' && alcance.pista?.includes('la pedirá la terminal') === true, j(alcance))
  check('(1c) la huella del servidor, como ssh-keygen', j(lineasHuella({ ok: true, ms: 1, huellas: [HUELLA], soloAlcance: false })) === j([`Huella del servidor: ED25519 SHA256:${HUELLA.sha256}`]), lineasHuella({ ok: true, ms: 1, huellas: [HUELLA], soloAlcance: false })[0])
}

hr('2 - El tipo de la clave del servidor')
{
  const casos: Array<[string, string]> = [
    ['ssh-ed25519', 'ED25519'],
    ['ED25519', 'ED25519'],
    ['ecdsa-sha2-nistp256', 'ECDSA'],
    ['ssh-rsa', 'RSA'],
    ['rsa-sha2-512', 'RSA'],
    ['sk-ssh-ed25519@openssh.com', 'ED25519-SK'],
    ['sk-ecdsa-sha2-nistp256@openssh.com', 'ECDSA-SK'],
    ['ssh-dss', 'DSA'],
    ['raro', 'RARO']
  ]
  const mal = casos.filter(([a, e]) => etiquetaAlgoritmo(a) !== e)
  check('(2a) nueve tipos, como los enseña ssh', mal.length === 0, mal.length === 0 ? casos.map(([, e]) => e).join(' ') : j(mal))
  check('(2b) textoHuella', textoHuella({ algoritmo: 'ecdsa-sha2-nistp256', sha256: 'abc' }) === 'ECDSA SHA256:abc', textoHuella({ algoritmo: 'ecdsa-sha2-nistp256', sha256: 'abc' }))
}

hr('3 - El motivo y qué mirar')
{
  const auth = textoResultadoPrueba(fallo('ssh-autenticacion', 'pruebas@srv: Permission denied (password).'), 'srv', 'windows')
  check('(3a) autenticación: el servidor no aceptó las credenciales', auth.titulo.includes('no aceptó las credenciales') && auth.pista?.includes('usuario y la contraseña') === true && auth.detalle === 'pruebas@srv: Permission denied (password).', j(auth))
  const otp = textoResultadoPrueba(fallo('ssh-autenticacion', '', { preguntaSinContestar: true }), 'srv', 'windows')
  check('(3b) con una pregunta sin contestar: la terminal te lo preguntará', otp.pista?.includes('Tessera no contesta') === true && otp.detalle === null, j(otp))
  const vpn = textoResultadoPrueba(fallo('ssh-inalcanzable', 'ssh: connect to host 10.0.0.5 port 22: Connection timed out'), '10.0.0.5', 'windows')
  check('(3c) inalcanzable: el servidor no responde, ¿falta la VPN?', vpn.titulo === 'El servidor no responde.' && vpn.pista?.startsWith('¿Falta la VPN?') === true, j(vpn))
  const algos = textoResultadoPrueba(fallo('ssh-algoritmos'), 'srv', 'windows')
  check('(3d) algoritmos: equipos antiguos', algos.titulo.includes('algoritmos en común') && algos.pista === 'Pasa con equipos antiguos.', j(algos))
  const tiempo = textoResultadoPrueba(fallo('tiempo'), 'srv', 'windows')
  check('(3e) el tope de 20 s', tiempo.titulo === 'No terminó en 20 segundos.', j(tiempo))
  const otro = textoResultadoPrueba(fallo('otro', 'ssh salió con el código 1.'), 'srv', 'windows')
  check('(3f) otro: sin pista y con el detalle', otro.titulo === 'No se pudo probar.' && otro.pista === null && otro.detalle === 'ssh salió con el código 1.', j(otro))
  const cambiada = fallo('ssh-huella-cambiada', 'Host key verification failed.', { huellaNueva: { algoritmo: 'ED25519', sha256: 'nueva' } })
  const tc = textoResultadoPrueba(cambiada, 'srv', 'windows')
  check('(3g) huella cambiada: el título y que la olvide solo si sabe por qué', tc.titulo.includes('no es la que tienes guardada') && tc.pista?.includes('olvida la guardada') === true, j(tc))
  check(
    '(3h) con la huella cambiada se enseñan la guardada y la que presenta ahora',
    j(lineasHuella(cambiada)) === j([`Huella guardada: ED25519 SHA256:${HUELLA.sha256}`, 'Presenta ahora: ED25519 SHA256:nueva']),
    j(lineasHuella(cambiada))
  )
}

hr('4 - La red local de macOS: solo en Mac, con «No route to host» hacia una dirección privada')
{
  const sinRuta = 'ssh: connect to host 192.168.0.10 port 22: No route to host'
  const mac = textoResultadoPrueba(fallo('ssh-inalcanzable', sinRuta), '192.168.0.10', 'mac')
  check(
    '(4a) en Mac: la privacidad de red local, nombrando el sistema por nombresSistema',
    mac.pista?.includes(nombresSistema('mac').sistema) === true && mac.pista.includes('Ajustes del Sistema › Privacidad y seguridad › Red local'),
    String(mac.pista)
  )
  const win = textoResultadoPrueba(fallo('ssh-inalcanzable', sinRuta), '192.168.0.10', 'windows')
  check('(4b) en Windows, con lo mismo, la VPN (mitad negativa)', win.pista?.startsWith('¿Falta la VPN?') === true && !win.pista.includes('Red local'), String(win.pista))
  const publica = textoResultadoPrueba(fallo('ssh-inalcanzable', 'ssh: connect to host 8.8.8.8 port 22: No route to host'), '8.8.8.8', 'mac')
  check('(4c) en Mac hacia una dirección pública, la VPN', publica.pista?.startsWith('¿Falta la VPN?') === true, String(publica.pista))
  const otraCausa = textoResultadoPrueba(fallo('ssh-inalcanzable', 'ssh: connect to host 192.168.0.10 port 22: Connection refused'), '192.168.0.10', 'mac')
  check('(4d) en Mac hacia la red local pero rechazada (no es el permiso), la VPN', otraCausa.pista?.startsWith('¿Falta la VPN?') === true, String(otraCausa.pista))
  const privadas = ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.0.1', 'fd12::1', 'fe80::1']
  const publicas = ['8.8.8.8', '172.32.0.1', '11.0.0.1', 'srv.ejemplo', '2001:db8::1']
  check('(4e) qué es red local', privadas.every(esIpPrivada) && !publicas.some(esIpPrivada), `${privadas.filter((h) => !esIpPrivada(h)).join(',')} | ${publicas.filter(esIpPrivada).join(',')}`)
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
