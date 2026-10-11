#!/usr/bin/env node
// =============================================================================
// Prueba de los túneles SSH de las bases (npm run test:gestor-tuneles): `GestorTuneles` con un ssh
// y un reloj de mentira (abrir, compartir, reabrir si muere o si cambia la conexión, el error de
// ssh, el tope), la línea `-L` de `lineaSsh`, las reglas de guardado del túnel y la huella.
// Sin red ni procesos: la conexión real la prueba `scripts/pruebas/tunel-bd.sh`.
// Decisiones: docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================

import { GestorTuneles, TOPE_APERTURA_MS, ultimaLinea, type LineaTunel, type ProcesoTunel } from './GestorTuneles.ts'
import { argumentosSsh } from '../../ssh/lineaSsh.ts'
import { opcionalesAGuardar, validarOpcional } from '../opcionalesConexion.ts'
import { huellaDestino } from '../huellaDestino.ts'
import { MOTORES } from '../../../shared/motores/index.ts'

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

/** Un ssh de mentira: escucha cuando se le dice, sale cuando se le dice. */
class SshFalso implements ProcesoTunel {
  escuchando = false
  salido = false
  matado = false
  stderr = ''
  private cbs: Array<() => void> = []
  alSalir(cb: () => void): void {
    if (this.salido) cb()
    else this.cbs.push(cb)
  }
  errores(): string {
    return this.stderr
  }
  enSesion(): boolean {
    return this.escuchando
  }
  matar(): void {
    this.matado = true
    this.salir()
  }
  salir(): void {
    if (this.salido) return
    this.salido = true
    for (const cb of this.cbs) cb()
  }
}

function montar(opc: { alAbrir?: (p: SshFalso, n: number) => void; preparar?: () => void; otroEnElPuerto?: boolean } = {}) {
  let reloj = 0
  let puertos = 40000
  const lanzados: SshFalso[] = []
  const preparados: Array<{ sshId: string; host: string; puerto: number; local: number }> = []
  const conectados: number[] = []
  const g = new GestorTuneles({
    preparar: (_perfil, sshId, destino, local) => {
      opc.preparar?.()
      preparados.push({ sshId, host: destino.host, puerto: destino.puerto, local })
      const n = preparados.length
      const linea: LineaTunel = { exe: 'ssh', args: [], env: {}, alConectar: () => conectados.push(n) }
      return linea
    },
    aliasSsh: (id) => (id === 'borrada' ? null : `Bastión ${id}`),
    lanzar: () => {
      const p = new SshFalso()
      lanzados.push(p)
      opc.alAbrir?.(p, lanzados.length)
      return p
    },
    puertoLibre: async () => ++puertos,
    escucha: async () => opc.otroEnElPuerto === true || (lanzados[lanzados.length - 1]?.escuchando === true && !lanzados[lanzados.length - 1].salido),
    esperar: async (ms) => {
      reloj += ms
    },
    ahora: () => reloj,
    log: () => {}
  })
  return { g, lanzados, preparados, conectados }
}

const con = { id: 'bd1', profileId: 'p1', alias: 'Ventas', host: 'pg.interno', port: 5432, tunelSsh: { conexionId: 's1' } }

hr('(1) Abrir, compartir y reabrir')
{
  const { g, lanzados, preparados, conectados } = montar({ alAbrir: (p) => (p.escuchando = true) })
  check('(1a) sin túnel: null, sin lanzar nada', g.destino({ ...con, tunelSsh: undefined }) === null && lanzados.length === 0, '')
  const d1 = await g.destino(con)!
  check('(1b) abre: 127.0.0.1 y el puerto libre', j(d1) === j({ host: '127.0.0.1', port: 40001 }), j(d1))
  check('(1c) el reenvío va al host y puerto de la base, por la conexión SSH elegida', j(preparados[0]) === j({ sshId: 's1', host: 'pg.interno', puerto: 5432, local: 40001 }), j(preparados[0]))
  check('(1d) al abrir se suelta la ficha del programa de contraseñas', j(conectados) === '[1]', j(conectados))
  const d2 = await g.destino(con)!
  check('(1e) la segunda petición comparte el túnel (un solo ssh)', j(d2) === j(d1) && lanzados.length === 1, `${lanzados.length} ssh`)
  lanzados[0].salir()
  const d3 = await g.destino(con)!
  check('(1f) si el ssh muere, la siguiente petición abre otro', lanzados.length === 2 && d3.port === 40002, `${lanzados.length} ssh, puerto ${d3.port}`)
  await g.destino({ ...con, host: 'otro.interno' })
  check(
    '(1g) si cambia el destino, se abre otro y el de antes SIGUE vivo (lo que ya iba por él no se corta)',
    !lanzados[1].matado && lanzados.length === 3 && g.vivosRetirados === 1,
    `matado=${lanzados[1].matado} retirados=${g.vivosRetirados}`
  )
  g.cerrar('bd1')
  check('(1h) cerrar (base borrada) mata el ssh y lo olvida', lanzados[2].matado && g.abiertos === 0, `abiertos=${g.abiertos}`)
  g.marcarViejos()
  await g.destino(con)
  await g.destino({ ...con, id: 'bd2' })
  g.marcarViejos()
  const antes = lanzados.length
  await g.destino(con)
  check('(1k) una conexión SSH cambió: la siguiente petición abre otro sin matar el viejo', lanzados.length === antes + 1 && !lanzados[antes - 2].matado, `${lanzados.length - antes} nuevo`)
  g.cerrarTodos()
  check('(1l) cerrarTodos mata también los retirados', lanzados.every((p) => p.matado) && g.vivosRetirados === 0, `retirados=${g.vivosRetirados}`)
}
{
  const { g, lanzados } = montar({ alAbrir: (p) => (p.escuchando = true) })
  const a = g.destino(con)
  const b = g.destino(con)
  await Promise.all([a, b])
  check('(1i) dos peticiones a la vez: un solo ssh', lanzados.length === 1, `${lanzados.length} ssh`)
  await g.destino({ ...con, id: 'bd2' })
  g.cerrarTodos()
  check('(1j) cerrarTodos los mata a todos', lanzados.every((p) => p.matado) && g.abiertos === 0, `${lanzados.length} ssh`)
}

hr('(2) Lo que no abre')
{
  const { g, lanzados, conectados } = montar({
    alAbrir: (p) => {
      p.stderr = 'debug1: algo\nPermission denied (publickey,password).\n'
      p.salir()
    }
  })
  let error = ''
  await g.destino(con)!.catch((e: Error) => (error = e.message))
  check('(2a) ssh sale: el mensaje dice por qué conexión y la última línea de ssh', error === 'No se pudo abrir el túnel SSH por «Bastión s1»: Permission denied (publickey,password).', error)
  check('(2b) y la ficha se suelta igual', j(conectados) === '[1]', j(conectados))
  check('(2c) un túnel que no abrió no se queda', g.abiertos === 0 && lanzados.length === 1, `abiertos=${g.abiertos}`)
}
{
  const { g, lanzados } = montar()
  let error = ''
  await g.destino(con)!.catch((e: Error) => (error = e.message))
  check(`(2d) no escucha en ${TOPE_APERTURA_MS / 1000} s: lo dice y mata el ssh`, error.includes('no se abrió en 25 s') && lanzados[0].matado, error)
}
{
  const { g, lanzados } = montar()
  let error = ''
  await g.destino({ ...con, tunelSsh: { conexionId: 'borrada' } })!.catch((e: Error) => (error = e.message))
  check('(2e) la conexión SSH ya no existe: lo dice sin lanzar nada', error.includes('ya no existe') && lanzados.length === 0, error)
}
{
  const { g, lanzados } = montar({
    preparar: () => {
      throw new Error('La huella del servidor SSH de «Bastión» no está confirmada.')
    }
  })
  let error = ''
  await g.destino(con)!.catch((e: Error) => (error = e.message))
  check('(2f) el error de preparar (huella sin confirmar) sale tal cual', error.startsWith('La huella del servidor SSH') && lanzados.length === 0, error)
}
{
  // Otro proceso tomó el puerto: la sonda conecta, pero el ssh no empezó la sesión (con el puerto ocupado sale).
  // El ssh aún se autentica (ni sesión ni salida) y el puerto ya acepta conexiones: no es suyo.
  const { g, lanzados } = montar({ otroEnElPuerto: true })
  let error = ''
  let destino: unknown = null
  await g.destino(con)!.then((d) => (destino = d), (e: Error) => (error = e.message))
  check(
    '(2h) SEGURIDAD: un puerto que escucha sin la sesión del ssh no se da como destino (no recibe la contraseña de la base)',
    destino === null && error.includes('no se abrió') && lanzados[0].matado,
    error || JSON.stringify(destino)
  )
}
check(
  '(2g) ultimaLinea: la última con texto, sin las de `ssh -v`',
  ultimaLinea('a\r\nb\n\n') === 'b' && ultimaLinea('') === '' && ultimaLinea('Permission denied (publickey).\ndebug1: Exit status 255\n') === 'Permission denied (publickey).',
  ''
)

hr('(3) La línea de ssh del túnel')
{
  const args = argumentosSsh(
    { host: 'bastion', puerto: 22, usuario: 'u', metodo: 'contrasena' },
    { modo: 'agente', rutaHuellas: '/h/kh', plataforma: 'linux', conAskpass: true, reenvioBd: { puertoLocal: 40001, host: 'pg.interno', puerto: 5432 } }
  )
  const s = args.join(' ')
  check('(3a) -N -T -n y el reenvío solo en 127.0.0.1', s.includes('-N -T -n -L 127.0.0.1:40001:pg.interno:5432 --'), s)
  check('(3b) huella estricta y sale si no puede reenviar', s.includes('StrictHostKeyChecking=yes') && s.includes('ExitOnForwardFailure=yes'), '')
  check('(3c) NEGATIVO: sin ClearAllForwardings (anularía el propio reenvío)', !s.includes('ClearAllForwardings'), '')
  const v6 = argumentosSsh(
    { host: 'b', puerto: 22, usuario: 'u', metodo: 'sistema' },
    { modo: 'agente', rutaHuellas: '/h', plataforma: 'linux', reenvioBd: { puertoLocal: 1, host: 'fd00::5', puerto: 5432 } }
  ).join(' ')
  check('(3d) una IPv6 de destino va entre corchetes', v6.includes('127.0.0.1:1:[fd00::5]:5432'), '')
  check('(3e) sin programa de contraseñas, BatchMode', v6.includes('BatchMode=yes'), '')
}

hr('(4) Guardar el túnel')
{
  const t = { conexionId: 's1' }
  check('(4a) PG guarda el túnel como objeto nuevo con solo su id', j(opcionalesAGuardar(MOTORES.postgres, { tunelSsh: { conexionId: 's1', otra: 1 } as never })) === j({ tunelSsh: t }), '')
  check('(4b) NEGATIVO: SQLite no lo guarda', j(opcionalesAGuardar(MOTORES.sqlite, { tunelSsh: t })) === '{}', '')
  check('(4c) un túnel mal formado se rechaza', validarOpcional('tunelSsh', { tunelSsh: { conexionId: '' } as never }) === 'El túnel SSH de la conexión no es válido.', '')
  check('(4d) MongoDB SRV con túnel: se rechaza', (validarOpcional('tunelSsh', { tunelSsh: t, srv: true }) ?? '').includes('SRV'), '')
  check('(4e) MongoDB con varios servidores: se rechaza', (validarOpcional('tunelSsh', { tunelSsh: t, host: 'a:1,b:2' }) ?? '').includes('un solo servidor'), '')
  check('(4f) MongoDB con replicaSet: se rechaza', (validarOpcional('tunelSsh', { tunelSsh: t, opcionesUri: 'authSource=admin&replicaSet=rs0' }) ?? '').includes('replicaSet'), '')
  check('(4i) MongoDB con directConnection=false: se rechaza', (validarOpcional('tunelSsh', { tunelSsh: t, opcionesUri: 'directConnection=false' }) ?? '').includes('directConnection=false'), '')
  check('(4g) SQL Server con instancia: se rechaza', (validarOpcional('tunelSsh', { tunelSsh: t, instancia: 'SQLEXPRESS' }) ?? '').includes('instancia'), '')
  check('(4h) un servidor suelto con túnel vale', validarOpcional('tunelSsh', { tunelSsh: t, host: 'pg.interno' }) === null, '')
}

hr('(5) La huella del destino')
{
  const base = { motor: 'postgres', host: 'h', port: 5432, database: 'd', sid: undefined, user: 'u' }
  check('(5a) sin túnel, la de siempre (no cambia)', huellaDestino(base) === huellaDestino({ ...base, tunelSsh: undefined }), '')
  check('(5b) con túnel, otra', huellaDestino(base) !== huellaDestino({ ...base, tunelSsh: { conexionId: 's1' } }), '')
  check('(5c) otro túnel, otra', huellaDestino({ ...base, tunelSsh: { conexionId: 's1' } }) !== huellaDestino({ ...base, tunelSsh: { conexionId: 's2' } }), '')
}

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
