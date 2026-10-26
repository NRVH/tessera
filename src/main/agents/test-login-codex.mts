// =============================================================================
// Prueba del puente del login de Codex (npm run test:login-codex), sin Docker: un servidor
// local hace de Codex del contenedor y el navegador es una petición HTTP al puerto del puente.
// Un solo login a la vez; termina con la credencial nueva (no con una vieja), al cerrar la sesión o
// en su tope; avisa si no puede tomar el puerto (salvo el reenvío de Docker en red host); y el
// detector ve el enlace de login en la salida aunque llegue partido.
// Decisiones: docs/decisiones/sandbox/contenedor-por-cuenta.md
// =============================================================================

import net from 'node:net'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PuenteLoginCodex, crearDetectorLoginCodex, type DatosLogin } from './loginCodex.ts'

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
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
function falla(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

function puertoLibre(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

/** Lo que contesta el puente a una petición del «navegador», o el error. */
function pedir(puerto: number, ruta: string): Promise<string> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: ruta, agent: false }, (res) => {
      let cuerpo = ''
      res.on('data', (d: Buffer) => (cuerpo += d.toString('utf8')))
      res.on('end', () => resolve(cuerpo))
    })
    req.on('error', (err: NodeJS.ErrnoException) => resolve(`ERROR ${err.code ?? err.message}`))
    req.setTimeout(3000, () => req.destroy(new Error('tope')))
  })
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera-login-codex-'))
const servidores: http.Server[] = []
try {
  // Dos «Codex de contenedor»: cada uno contesta con su nombre y escribe su credencial al volver el navegador.
  const codex = new Map<string, number>()
  for (const nombre of ['cont-a', 'cont-b']) {
    const puerto = await puertoLibre()
    const srv = http.createServer((req, res) => {
      if (req.url?.startsWith('/auth/callback?code=fin')) writeFileSync(path.join(dir, `${nombre}.json`), '{}')
      res.end(`${nombre} ${req.url}`)
    })
    await new Promise<void>((r) => srv.listen(puerto, '127.0.0.1', r))
    servidores.push(srv)
    codex.set(nombre, puerto)
  }
  const puertoPuente = await puertoLibre()
  const conexiones: string[] = []
  const avisos: string[] = []
  const puente = new PuenteLoginCodex({
    // Como el `docker exec` real: une la conexión con el «1455» del contenedor.
    conectar: (contenedor, socket) => {
      conexiones.push(contenedor)
      const u = net.connect(codex.get(contenedor)!, '127.0.0.1')
      socket.pipe(u)
      u.pipe(socket)
      u.on('error', () => socket.destroy())
      socket.on('error', () => u.destroy())
    },
    avisarPuertoOcupado: (d) => void avisos.push(d.cuenta),
    intervaloMs: 50,
    graciaMs: 400,
    puerto: puertoPuente
  })
  const datos = (cont: string, cuenta: string, redHost = false): DatosLogin => ({
    contenedor: cont,
    profileId: 'p1',
    cuenta,
    perfil: 'Perfil uno',
    credencial: path.join(dir, `${cont}.json`),
    redHost
  })

  hr('(1) un login pendiente: el navegador llega al Codex de su contenedor')
  const ra = puente.reservar(datos('cont-a', 'Trabajo'))
  ra.asignar('s-a')
  await dormir(50)
  const r1 = await pedir(puertoPuente, '/auth/callback?code=1&state=x')
  check('la vuelta del navegador llega al contenedor de la cuenta, con su ruta y su consulta', r1 === 'cont-a /auth/callback?code=1&state=x' && conexiones.at(-1) === 'cont-a', r1)

  hr('(2) un solo login a la vez')
  const negado = falla(() => puente.reservar(datos('cont-b', 'Personal'), 's-b'))
  check('NEGATIVO: otra sesión no puede empezar otro login; el error nombra la cuenta y el perfil pendientes', negado !== null && negado.includes('Trabajo') && negado.includes('Perfil uno'), String(negado))
  const misma = falla(() => puente.reservar(datos('cont-a', 'Trabajo'), 's-a2'))
  check('NEGATIVO: la misma cuenta en otra pestaña tampoco, con un mensaje que dice que ya está iniciando sesión en otra', misma !== null && misma.includes('otra pestaña') && !misma.includes('Perfil uno'), String(misma))
  check('la misma sesión (recargar) lo conserva', falla(() => puente.reservar(datos('cont-a', 'Trabajo'), 's-a')) === null && puente.enCurso()?.contenedor === 'cont-a', 'ok')

  hr('(3) termina al aparecer la credencial, con gracia para la página de «listo»')
  const fin = await pedir(puertoPuente, '/auth/callback?code=fin')
  await dormir(150)
  check('el Codex del contenedor recibe la vuelta final y guarda su credencial', fin === 'cont-a /auth/callback?code=fin', fin)
  check('con la credencial, ya no hay login pendiente', puente.enCurso() === null, String(puente.enCurso()?.cuenta))
  const r2 = await pedir(puertoPuente, '/success')
  check('durante la gracia el navegador aún llega a la página de «listo»', r2 === 'cont-a /success', r2)
  await dormir(500)
  const r3 = await pedir(puertoPuente, '/success')
  check('pasada la gracia el puerto queda libre', r3.startsWith('ERROR') && !puente.escuchando(), r3)
  check('y otra cuenta ya puede iniciar sesión', falla(() => puente.reservar(datos('cont-b', 'Personal'), 's-b')) === null, 'ok')

  hr('(4) cerrar la sesión suelta su login')
  puente.soltarSesion('s-otra')
  check('cerrar otra sesión no lo suelta', puente.enCurso()?.contenedor === 'cont-b', 'ok')
  puente.soltarSesion('s-b')
  await dormir(50)
  check('cerrar la suya sí, y el puerto se libera en el acto', puente.enCurso() === null && !puente.escuchando() && (await pedir(puertoPuente, '/x')).startsWith('ERROR'), 'ok')

  hr('(5) una apertura que falla suelta la reserva')
  const rf = puente.reservar(datos('cont-a', 'Trabajo'))
  rmSync(path.join(dir, 'cont-a.json'), { force: true })
  rf.soltar()
  check('soltar la reserva sin sesión deja libre el login', puente.enCurso() === null && falla(() => puente.reservar(datos('cont-b', 'Personal'), 's-b2')) === null, 'ok')
  puente.soltarSesion('s-b2')

  hr('(6) el puerto ocupado por otro programa')
  const ocupa = net.createServer()
  await new Promise<void>((r) => ocupa.listen(puertoPuente, '127.0.0.1', r))
  rmSync(path.join(dir, 'cont-b.json'), { force: true })
  puente.reservar(datos('cont-b', 'Personal'), 's-b3')
  await dormir(100)
  check('avisa nombrando la cuenta, y el login sigue reservado (el siguiente se rechaza igual)', avisos.at(-1) === 'Personal' && falla(() => puente.reservar(datos('cont-a', 'Trabajo'), 's-z')) !== null, avisos.join())
  puente.soltarSesion('s-b3')
  await new Promise<void>((r) => ocupa.close(() => r()))

  hr('(7) red del anfitrión: el puente se abre igual, y el puerto tomado por Docker no se avisa')
  rmSync(path.join(dir, 'cont-a.json'), { force: true })
  puente.reservar(datos('cont-a', 'Trabajo', true), 's-h')
  await dormir(50)
  const rh = await pedir(puertoPuente, '/auth/callback?code=1')
  check('con el puerto libre el puente lleva la vuelta (por si Docker no reenvía), y el login sigue siendo uno a la vez', rh === 'cont-a /auth/callback?code=1' && falla(() => puente.reservar(datos('cont-b', 'Personal'), 's-y')) !== null, rh)
  puente.soltarSesion('s-h')
  const ocupaDocker = net.createServer()
  await new Promise<void>((r) => ocupaDocker.listen(puertoPuente, '127.0.0.1', r))
  const avisosAntes = avisos.length
  puente.reservar(datos('cont-a', 'Trabajo', true), 's-h2')
  await dormir(100)
  check('con el puerto ya tomado (el reenvío de Docker) no avisa', avisos.length === avisosAntes && puente.enCurso()?.contenedor === 'cont-a', avisos.join())
  await new Promise<void>((r) => ocupaDocker.close(() => r()))
  puente.cerrar()
  check('cerrar el puente lo deja todo libre', puente.enCurso() === null && !puente.escuchando(), 'ok')

  hr('(8) sesión caducada: la credencial vieja no cuenta como login terminado')
  writeFileSync(path.join(dir, 'cont-a.json'), '{"viejo":true}')
  puente.reservar(datos('cont-a', 'Trabajo'), 's-cad')
  await dormir(150)
  check('con una credencial vieja el login sigue pendiente y el puente escucha', puente.enCurso()?.contenedor === 'cont-a' && puente.escuchando(), 'ok')
  const finCad = await pedir(puertoPuente, '/auth/callback?code=fin')
  await dormir(150)
  check('al reescribirla el login nuevo termina', finCad === 'cont-a /auth/callback?code=fin' && puente.enCurso() === null, finCad)
  puente.cerrar()
  const breve = new PuenteLoginCodex({ conectar: () => {}, avisarPuertoOcupado: () => {}, intervaloMs: 30, topeMs: 100, puerto: puertoPuente })
  breve.reservar(datos('cont-b', 'Personal'), 's-tope')
  await dormir(250)
  check('un login abandonado se suelta al pasar su tope', breve.enCurso() === null && !breve.escuchando(), 'ok')
  breve.reservar(datos('cont-b', 'Personal'), 's-renueva')
  await dormir(70)
  breve.reservar(datos('cont-b', 'Personal'), 's-renueva')
  await dormir(70)
  check('volver a reservar desde la misma sesión (recargar, un enlace nuevo) renueva el plazo', breve.enCurso()?.contenedor === 'cont-b', 'ok')
  breve.cerrar()

  hr('(9) el detector de un login que empieza el propio Codex')
  const url =
    'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&state=abc'
  const d1 = crearDetectorLoginCodex()
  // Partida en trozos, con colores, saltos de línea y el marco de una interfaz de terminal en medio.
  const trozos = ['\x1b[2mSign in\x1b[0m: ', url.slice(0, 70), '\x1b[0m\r\n│ ', url.slice(70, 95), ' │\r\n▌ ', url.slice(95)]
  check('encuentra el enlace aunque llegue en trozos, partido en líneas y con colores y marcos', trozos.map((t) => d1(t)).filter(Boolean).length === 1, 'ok')
  const d2 = crearDetectorLoginCodex()
  check('también el aviso de «servidor de login» de `codex login`', d2('Starting local login server on http://localhost:1455.\r\n'), 'ok')
  const d3 = crearDetectorLoginCodex()
  check('NEGATIVO: una conversación que cita localhost:1455 no lo dispara', !d3('El servidor escucha en http://localhost:1455/auth/callback según la doc.\n'), 'ok')
  check('NEGATIVO: otro puerto tampoco', !crearDetectorLoginCodex()(url.replace('1455', '1456')), 'ok')
} finally {
  for (const s of servidores) s.close()
  rmSync(dir, { recursive: true, force: true })
}

hr('RESULTADO (PASS/FAIL)')
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${passed === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === results.length ? 0 : 1)
