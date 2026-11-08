#!/usr/bin/env node
// =============================================================================
// Prueba de la huella de un servidor SSH nuevo (npm run test:ssh-huella-nueva): qué servidor de la cadena se
// reconoce (los bastiones primero), qué significa lo que dejó la conexión que la trae, las pendientes (un
// solo uso, caducidad, tope) y el controlador con un ssh falso: la línea no manda credenciales, el
// `known_hosts` de la conexión no se toca hasta confirmar, confirmar escribe solo las líneas del host y avisa,
// y descartar no deja nada.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SSH_CHANNELS, type SshReconocimiento } from '../../shared/ssh-ipc.ts'
import { crearConfigSaltos } from './adaptadores/configSaltos.ts'
import type { BinariosSsh } from './binariosSsh.ts'
import { ConexionesSsh } from './ConexionesSsh.ts'
import { ControladorSsh } from './ControladorSsh.ts'
import type { SalidaSsh } from './controlador/pruebaSsh.ts'
import { HuellasPendientes, MAX_PENDIENTES, crearTemporalHuellas, desenlaceReconocer, siguienteSinHuella } from './controlador/reconocimientoHuella.ts'
import { lineasDeKnownHosts } from './huellasSsh.ts'

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

/** Un blob de clave Ed25519 de mentira, válido para el cálculo de la huella. */
function blob(relleno: number): string {
  const cadena = (b: Buffer): Buffer => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b])
  return Buffer.concat([cadena(Buffer.from('ssh-ed25519')), cadena(Buffer.alloc(32, relleno))]).toString('base64')
}
const BLOB = blob(42)
const patron = (host: string, puerto: number): string => (puerto === 22 ? host : `[${host}]:${puerto}`)
const salida = (codigo: number | null, errores: string, agotado = false): SalidaSsh => ({ codigo, salida: '', errores, agotado })
const DENEGADO = 'pruebas@192.0.2.10: Permission denied (password).\r\n'

const raiz = mkdtempSync(path.join(os.tmpdir(), 'tessera-test-huella-nueva-'))
try {
  // ---------------------------------------------------------------------------
  hr('A - Qué servidor de la cadena toca: desde este equipo hacia el destino')
  {
    // `cadena` va del bastión más cercano al destino al más lejano: se llega antes al último.
    const tiene = (con: string[]) => (x: string) => con.includes(x)
    const ninguno = siguienteSinHuella('destino', ['b1', 'b2'], tiene([]))
    check('(a1) sin ninguna huella, el bastión al que se llega directo, sin saltos', j(ninguno) === j({ objetivo: 'b2', saltos: [] }), j(ninguno))
    const uno = siguienteSinHuella('destino', ['b1', 'b2'], tiene(['b2']))
    check('(a2) luego el siguiente, a través del primero', j(uno) === j({ objetivo: 'b1', saltos: ['b2'] }), j(uno))
    const destino = siguienteSinHuella('destino', ['b1', 'b2'], tiene(['b1', 'b2']))
    check('(a3) por último el destino, con sus bastiones en su orden', j(destino) === j({ objetivo: 'destino', saltos: ['b1', 'b2'] }), j(destino))
    check('(a4) con todas, nada', siguienteSinHuella('destino', ['b1', 'b2'], tiene(['b1', 'b2', 'destino'])) === null, 'null')
    check('(a5) sin bastiones, el destino', j(siguienteSinHuella('destino', [], tiene([]))) === j({ objetivo: 'destino', saltos: [] }), 'destino')
  }

  // ---------------------------------------------------------------------------
  hr('B - Qué dejó la conexión que trae la huella')
  {
    const destino = { host: '192.0.2.10', puerto: 2222 }
    const ctx = { ms: 30, plataforma: 'windows' as const }
    const texto = [
      '# un comentario',
      `@revoked ${patron('192.0.2.10', 2222)} ssh-ed25519 ${blob(1)}`,
      `otro.ejemplo ssh-ed25519 ${blob(2)}`,
      `${patron('192.0.2.10', 2222)}   ssh-ed25519   ${BLOB}  comentario`,
      `${patron('192.0.2.10', 2222)} ssh-ed25519 ${BLOB}`
    ].join('\n')
    const nueva = desenlaceReconocer(salida(255, DENEGADO), texto, destino, ctx)
    check(
      '(b1) huella nueva: solo la línea del host, rehecha y sin repetir (ni comentarios, ni marcas, ni otros hosts)',
      nueva.tipo === 'nueva' && j(nueva.lineas) === j([`${patron('192.0.2.10', 2222)} ssh-ed25519 ${BLOB}`]) && nueva.huellas.length === 1,
      j(nueva)
    )
    const global = desenlaceReconocer(salida(255, DENEGADO), '', destino, ctx)
    check('(b2) sin línea nueva pero pidiendo credenciales: ssh ya lo conocía (el known_hosts del sistema)', global.tipo === 'conocida', j(global))
    const entra = desenlaceReconocer(salida(0, ''), '', destino, ctx)
    check('(b3) sin línea nueva y dejando entrar: también conocida', entra.tipo === 'conocida', j(entra))
    const lejos = desenlaceReconocer(salida(255, 'ssh: connect to host 192.0.2.10 port 2222: Connection timed out\r\n'), '', destino, ctx)
    check('(b4) sin llegar: el fallo, como el de «Probar»', lejos.tipo === 'fallo' && lejos.resultado.motivo === 'ssh-inalcanzable', j(lejos))
    const tope = desenlaceReconocer(salida(null, '', true), '', destino, ctx)
    check('(b5) con el tope: «tiempo»', tope.tipo === 'fallo' && tope.resultado.motivo === 'tiempo', j(tope))
    check('(b6) lineasDeKnownHosts: el puerto 22 sin corchetes', j(lineasDeKnownHosts(`srv.ejemplo ssh-ed25519 ${BLOB}\n[srv.ejemplo]:22 ssh-ed25519 ${BLOB}`, 'srv.ejemplo', 22)) === j([`srv.ejemplo ssh-ed25519 ${BLOB}`]), 'srv.ejemplo')
  }

  // ---------------------------------------------------------------------------
  hr('C - Las pendientes: un solo uso, caducidad y tope')
  {
    let ahora = 1_000
    let n = 0
    const p = new HuellasPendientes({ ahora: () => ahora, vidaMs: 100, nuevaFicha: () => `f${++n}` })
    const datos = { conexionId: 'c1', host: 'h', puerto: 22, lineas: ['h ssh-ed25519 X'] }
    const f1 = p.guardar(datos)
    check('(c1) tomarla la da una vez', j(p.tomar(f1)) === j(datos), f1)
    check('(c2) la segunda, nada', p.tomar(f1) === null, 'null')
    const f2 = p.guardar(datos)
    ahora += 100
    check('(c3) caducada, nada', p.tomar(f2) === null, `ahora=${ahora}`)
    const f3 = p.guardar(datos)
    p.descartar(f3)
    check('(c4) descartada, nada', p.tomar(f3) === null, 'null')
    const fichas = Array.from({ length: MAX_PENDIENTES + 2 }, () => p.guardar(datos))
    check('(c5) con tope: se van las más antiguas', p.tamano === MAX_PENDIENTES && p.tomar(fichas[0]) === null && p.tomar(fichas[fichas.length - 1]) !== null, `tamano=${p.tamano}`)
    const real = new HuellasPendientes()
    const a = real.guardar(datos)
    const b = real.guardar(datos)
    check('(c6) las fichas de verdad son largas y distintas', a !== b && a.length >= 32, `${a.length} caracteres`)
    const t = crearTemporalHuellas()
    writeFileSync(t.ruta, 'x')
    const leido = t.leer()
    t.borrar()
    check('(c7) el temporal se lee y se borra con su carpeta', leido === 'x' && !existsSync(path.dirname(t.ruta)), path.basename(path.dirname(t.ruta)))
  }

  // ---------------------------------------------------------------------------
  hr('D - El controlador con un ssh falso')
  {
    const dirHuellas = path.join(raiz, 'huellas')
    mkdirSync(dirHuellas, { recursive: true })
    const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves: path.join(raiz, 'claves'), log: () => {} })
    const emitidos: string[] = []
    const binarios = (): BinariosSsh => ({ ssh: { exe: 'ssh', args: [] }, scp: null, sshKeygen: null, origen: 'sistema', aviso: null, dePrueba: false })
    // Cómo responde cada host: deja su huella (como `accept-new` con un known_hosts vacío), ya lo conocía o no se llega.
    const comportamiento = new Map<string, 'nueva' | 'global' | 'lejos'>()
    const lanzados: Array<{ args: readonly string[]; env: Readonly<Record<string, string>> }> = []
    const temporales: string[] = []
    const ejecutar = async (_exe: string, args: readonly string[], o: { extraEnv?: Readonly<Record<string, string>> }): Promise<SalidaSsh> => {
      lanzados.push({ args, env: o.extraEnv ?? {} })
      const host = args[args.indexOf('--') + 1]
      const puerto = Number(args[args.indexOf('-p') + 1])
      const kh = args.find((a) => a.startsWith('UserKnownHostsFile='))?.slice('UserKnownHostsFile='.length).replace(/^"|"$/g, '').replace(/%%/g, '%') ?? ''
      temporales.push(kh)
      const que = comportamiento.get(host) ?? 'nueva'
      if (que === 'lejos') return salida(255, `ssh: connect to host ${host} port ${puerto}: Connection timed out\r\n`)
      if (que === 'nueva') writeFileSync(kh, `${patron(host, puerto)} ssh-ed25519 ${BLOB}\n`)
      return salida(255, DENEGADO)
    }
    const ctrl = new ControladorSsh({
      conexiones,
      eventos: { emitir: (c) => void emitidos.push(c), hayDestino: () => true },
      ejecutar,
      binarios,
      configSaltos: crearConfigSaltos(path.join(raiz, 'saltos')),
      plataforma: 'windows',
      log: () => {}
    })
    const alta = (alias: string, host: string, extra: Record<string, unknown> = {}): string =>
      ctrl.crear({ profileId: 'pa', alias, grupoId: null, host, puerto: 2222, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, ...extra } as never).id
    const texto = (id: string): string => conexiones.textoHuellas(id) ?? ''

    const id = alta('servidor-er', '192.0.2.10')
    const r = await ctrl.reconocerHuella({ id, profileId: 'pa' })
    const linea = lanzados[0]?.args ?? []
    check(
      '(d1) un servidor nuevo: su huella, su alias, su destino y su método, con una ficha',
      r.tipo === 'nueva' && r.alias === 'servidor-er' && r.host === '192.0.2.10' && r.puerto === 2222 && r.metodo === 'contrasena' && r.huellas.length === 1 && r.ficha.length >= 32 && r.bastionDe === undefined,
      j(r)
    )
    check(
      '(d2) la línea no manda credenciales: accept-new, solo «none», BatchMode y sin programa de contraseñas',
      ['StrictHostKeyChecking=accept-new', 'PreferredAuthentications=none', 'PubkeyAuthentication=no', 'PasswordAuthentication=no', 'BatchMode=yes'].every((o) => linea.includes(o)) && lanzados[0]?.env.SSH_ASKPASS === undefined,
      linea.join(' ')
    )
    check(
      '(d3) sobre un known_hosts temporal, que ya no existe, y el de la conexión sigue vacío',
      temporales[0] !== '' && !temporales[0].includes(dirHuellas.replace(/\\/g, '/')) && !existsSync(path.dirname(temporales[0])) && texto(id) === '',
      temporales[0]
    )
    const antes = emitidos.length
    if (r.tipo === 'nueva') ctrl.confiarHuella({ ficha: r.ficha })
    check('(d4) confiar escribe la línea del host en su known_hosts y avisa con ssh:cambio', texto(id) === `${patron('192.0.2.10', 2222)} ssh-ed25519 ${BLOB}\n` && emitidos.slice(antes).includes(SSH_CHANNELS.CAMBIO), j(texto(id)))
    const lanzadosAntes = lanzados.length
    const otra = await ctrl.reconocerHuella({ id })
    check('(d5) con la huella ya guardada: conocida, sin lanzar ssh', otra.tipo === 'conocida' && lanzados.length === lanzadosAntes, j(otra))
    let reuso = ''
    try {
      if (r.tipo === 'nueva') ctrl.confiarHuella({ ficha: r.ficha })
    } catch (e) {
      reuso = (e as Error).message
    }
    check('(d6) la ficha no vale dos veces', reuso.includes('caducó o ya se usó'), reuso)

    // Descartar: nada guardado.
    const idD = alta('descartada', '192.0.2.11')
    const rD = await ctrl.reconocerHuella({ id: idD })
    if (rD.tipo === 'nueva') ctrl.descartarHuella({ ficha: rD.ficha })
    let trasDescartar = ''
    try {
      if (rD.tipo === 'nueva') ctrl.confiarHuella({ ficha: rD.ficha })
    } catch (e) {
      trasDescartar = (e as Error).message
    }
    check('(d7) descartar no guarda nada y la ficha deja de valer', rD.tipo === 'nueva' && texto(idD) === '' && trasDescartar.includes('caducó'), trasDescartar)

    // La conexión cambia de host entre traer la huella y confirmarla.
    const idC = alta('cambiante', '192.0.2.12')
    const rC = await ctrl.reconocerHuella({ id: idC })
    ctrl.editar({ id: idC, input: { profileId: 'pa', alias: 'cambiante', grupoId: null, host: '192.0.2.13', puerto: 2222, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true } })
    let cambio = ''
    try {
      if (rC.tipo === 'nueva') ctrl.confiarHuella({ ficha: rC.ficha })
    } catch (e) {
      cambio = (e as Error).message
    }
    check('(d8) si la conexión cambió de destino, no se guarda la huella del anterior', cambio.includes('cambió') && texto(idC) === '', cambio)

    // Una huella de otro host en su known_hosts no cuenta (se editó el host): se reconoce el nuevo y se añade detrás.
    writeFileSync(conexiones.rutaHuellas(idC), `[192.0.2.12]:2222 ssh-ed25519 ${blob(9)}`)
    const rC2 = await ctrl.reconocerHuella({ id: idC })
    if (rC2.tipo === 'nueva') ctrl.confiarHuella({ ficha: rC2.ficha })
    check(
      '(d9) la de otro host no cuenta; confirmar la nueva conserva lo que había',
      rC2.tipo === 'nueva' && texto(idC) === `[192.0.2.12]:2222 ssh-ed25519 ${blob(9)}\n${patron('192.0.2.13', 2222)} ssh-ed25519 ${BLOB}\n`,
      j(texto(idC))
    )

    // Conocido por el sistema y no alcanzable.
    comportamiento.set('192.0.2.20', 'global')
    const idG = alta('del sistema', '192.0.2.20')
    const rG = await ctrl.reconocerHuella({ id: idG })
    check('(d10) ya conocido por el known_hosts del sistema: nada que confirmar', rG.tipo === 'conocida' && texto(idG) === '', j(rG))
    const idTrasGlobal = alta('destino tras conocido', '10.0.0.70', { saltoId: idG })
    const antesGlobal = lanzados.length
    const trasGlobal = await ctrl.reconocerHuella({ id: idTrasGlobal, profileId: 'pa' })
    check('(d10b) bastión conocido por el sistema permite reconocer destino nuevo', trasGlobal.tipo === 'nueva' && trasGlobal.host === '10.0.0.70' && lanzados.length === antesGlobal + 2 && texto(idG) === '', j(trasGlobal))
    comportamiento.set('192.0.2.21', 'lejos')
    const idL = alta('lejos', '192.0.2.21')
    const rL: SshReconocimiento = await ctrl.reconocerHuella({ id: idL, prueba: true })
    check('(d11) sin llegar: el fallo con su motivo, sin rutas', rL.tipo === 'fallo' && rL.resultado.motivo === 'ssh-inalcanzable' && !rL.resultado.detalle.includes('\\'), j(rL))

    // Con un bastión sin huella: primero él, directo; luego el destino a través de él.
    const idB = alta('bastion', '192.0.2.30')
    const idT = alta('tras el bastion', '10.0.0.5', { saltoId: idB })
    const n0 = lanzados.length
    const r1 = await ctrl.reconocerHuella({ id: idT, profileId: 'pa' })
    const l1 = lanzados[n0]?.args ?? []
    check(
      '(d12) primero el bastión, directo (sin ProxyCommand), diciendo a qué conexión lleva',
      r1.tipo === 'nueva' && r1.alias === 'bastion' && r1.bastionDe === 'tras el bastion' && l1[l1.indexOf('--') + 1] === '192.0.2.30' && !l1.some((a) => a.startsWith('ProxyCommand=')),
      j(r1)
    )
    if (r1.tipo === 'nueva') ctrl.confiarHuella({ ficha: r1.ficha })
    const r2 = await ctrl.reconocerHuella({ id: idT, profileId: 'pa' })
    const l2 = lanzados[n0 + 1]?.args ?? []
    const config = l2.find((a) => a.startsWith('ProxyCommand='))?.match(/-F "?([^"]+?)"? -W/)?.[1] ?? ''
    const textoConfig = config === '' ? '' : readFileSync(config.replace(/%%/g, '%'), 'utf8')
    check(
      '(d13) luego el destino, a través del bastión ya confirmado (estricto con él, en su known_hosts)',
      r2.tipo === 'nueva' && r2.alias === 'tras el bastion' && r2.bastionDe === undefined && l2[l2.indexOf('--') + 1] === '10.0.0.5' &&
        textoConfig.includes('StrictHostKeyChecking=yes') && !textoConfig.includes('accept-new') && textoConfig.includes(`huellas/${idB}`),
      `${l2.find((a) => a.startsWith('ProxyCommand='))} | ${textoConfig.replace(/\n/g, ' ¶ ')}`
    )
    if (r2.tipo === 'nueva') ctrl.confiarHuella({ ficha: r2.ficha })
    const r3 = await ctrl.reconocerHuella({ id: idT })
    check('(d14) con las dos confirmadas: conocida', r3.tipo === 'conocida' && texto(idT) !== '' && texto(idB) !== '', j(r3))

    let otroPerfil = ''
    try {
      await ctrl.reconocerHuella({ id, profileId: 'otro' })
    } catch (e) {
      otroPerfil = (e as Error).message
    }
    check('(d15) de otro perfil, no', otroPerfil.includes('no es de este perfil'), otroPerfil)
    const sinEjecutar = new ControladorSsh({ conexiones, eventos: { emitir: () => {}, hayDestino: () => true }, binarios, log: () => {} })
    let sinSsh = ''
    try {
      await sinEjecutar.reconocerHuella({ id })
    } catch (e) {
      sinSsh = (e as Error).message
    }
    check('(d16) sin con qué correr ssh: un error claro', sinSsh.includes('no puede comprobar la huella'), sinSsh)
  }
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
