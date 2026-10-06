#!/usr/bin/env node
// =============================================================================
// Prueba del explorador SFTP del main (npm run test:sftp): el protocolo (troceado, atributos, permisos), las
// rutas remotas que se aceptan y, con TESSERA_TEST_SSH (`bash scripts/pruebas/ssh.sh correr npm run -s
// test:sftp`), las sesiones de verdad sobre el ssh del sistema: contraseña guardada y clave, listar, crear,
// renombrar sin pisar, subir y bajar binarios y carpetas, los conflictos, cancelar sin dejar restos, borrar
// carpetas enteras, nombres con comillas y asteriscos, y una contraseña mala.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esWindows, plataformaActual } from '../../../shared/plataforma.ts'
import { SFTP_CHANNELS, type SftpInicioTransferencia, type SftpProgreso, type SftpResultado } from '../../../shared/sftp-ipc.ts'
import { DbBridge } from '../../db/dbBridge.ts'
import { escribirLanzadorAskpass } from '../adaptadores/lanzadorAskpass.ts'
import { asegurarCarpetaProtegida, ejecutarCorto, escribirClaveProtegida } from '../adaptadores/permisosClave.ts'
import { resolverBinariosSsh } from '../binariosSsh.ts'
import { ConexionesSsh } from '../ConexionesSsh.ts'
import { ControladorSsh } from '../ControladorSsh.ts'
import { AskpassSsh } from '../controlador/askpassSsh.ts'
import { ClavesImportadas } from '../controlador/clavesImportadas.ts'
import { FichasAskpass } from '../fichasAskpass.ts'
import { argumentosSsh } from '../lineaSsh.ts'
import { lanzadorAskpassSh, rutaGuionAskpass, rutaProgramaAskpass } from '../programaAskpass.ts'
import { Escritor, Lector, TIPO, Troceador, textoPermisos, tipoDeModo } from './protocoloSftp.ts'
import { SesionesSftp } from './SesionesSftp.ts'
import { bajar, baseRemota, carpetaRemota, rutaRemotaValida, unirRemota } from './transferenciasSftp.ts'
import type { ClienteSftp } from './ClienteSftp.ts'

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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const plataforma = plataformaActual()
const temporales: string[] = []
function temporal(prefijo: string, base = os.tmpdir()): string {
  const d = mkdtempSync(path.join(base, prefijo))
  temporales.push(d)
  return d
}

const cifradoFalso = {
  disponible: (): boolean => true,
  cifrar: (p: string): Buffer => Buffer.from(`ENC:${p}`),
  descifrar: (b: Buffer): string => {
    const t = b.toString('utf-8')
    if (!t.startsWith('ENC:')) throw new Error('ilegible')
    return t.slice(4)
  }
}

try {
  hr('A - El protocolo: troceado, atributos y permisos')
  {
    const p1 = new Escritor().u32(7).cadena('hola ñ').paquete(TIPO.NAME)
    const p2 = new Escritor().u32(8).u32(0).paquete(TIPO.STATUS)
    const todo = Buffer.concat([p1, p2])
    const t = new Troceador()
    const trozos = [todo.subarray(0, 3), todo.subarray(3, 11), todo.subarray(11)]
    const paquetes = trozos.flatMap((x) => t.meter(x))
    const l = new Lector(paquetes[0]?.cuerpo ?? Buffer.alloc(0))
    check('(a1) dos paquetes partidos en trozos arbitrarios se recomponen', paquetes.length === 2 && paquetes[0].tipo === TIPO.NAME && l.u32() === 7 && l.cadena() === 'hola ñ' && paquetes[1].tipo === TIPO.STATUS, j(paquetes.map((p) => p.tipo)))
    let rechazo = false
    try {
      new Troceador().meter(Buffer.from([0x7f, 0xff, 0xff, 0xff, 1]))
    } catch {
      rechazo = true
    }
    check('(a2) un paquete que dice medir 2 GiB se rechaza (no es SFTP)', rechazo, String(rechazo))
    const attrs = Buffer.concat([new Escritor().u32(0x1 | 0x4 | 0x8).u64(5_000_000_000).u32(0o40755).u32(1).u32(1700000000).paquete(1)]).subarray(5)
    const a = new Lector(attrs).atributos()
    check('(a3) atributos: tamaño de 64 bits, modo y mtime', a.tamano === 5_000_000_000 && a.permisos === 0o40755 && a.mtime === 1700000000, j(a))
    check('(a4) tipo y permisos legibles (setuid, sticky)', tipoDeModo(0o40755) === 'carpeta' && tipoDeModo(0o100644) === 'archivo' && tipoDeModo(0o120777) === 'enlace' && textoPermisos(0o104755) === 'rwsr-xr-x' && textoPermisos(0o41777) === 'rwxrwxrwt', textoPermisos(0o104755) ?? '')
  }

  hr('B - Las rutas remotas que se aceptan')
  {
    const buenas = ['/home/u', '/tmp/a b/c"d*e', '/home/u/']
    const malas = ['/', 'relativa', '/a/../b', '/a/./b', '/a//b', `/a${String.fromCharCode(0)}b`, '']
    check('(b1) absolutas, sin `.`/`..`/vacíos/NUL, y nunca `/`', buenas.every(rutaRemotaValida) && !malas.some(rutaRemotaValida), j(malas.filter(rutaRemotaValida)))
    check('(b2) unir, base y carpeta', unirRemota('/', 'x') === '/x' && unirRemota('/a', 'x') === '/a/x' && baseRemota('/a/b/') === 'b' && carpetaRemota('/a/b') === '/a' && carpetaRemota('/a') === '/', 'ok')
    const linea = argumentosSsh({ host: 'h', puerto: 22, usuario: 'u', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: '/k', plataforma: 'mac', subsistemaSftp: true })
    check('(b3) la línea SFTP: sin terminal, -s, sftp tras el host y sin nadie que conteste, BatchMode', linea.join(' ').endsWith('-T -s -- h sftp') && linea.includes('BatchMode=yes'), linea.slice(-5).join(' '))
  }

  hr('B2 - Un servidor que anuncia un tamaño enorme no congela la bajada')
  {
    const destinoLocal = path.join(temporal('tessera-sftp-enorme-'), 'enorme.bin')
    const falso = {
      stat: async () => ({ tamano: 1e15, permisos: 0o100644, mtime: null }),
      abrir: async () => Buffer.from('h'),
      leer: async (_h: Buffer, desde: number) => (desde === 0 ? Buffer.from('hola') : null),
      cerrar: async () => {}
    } as unknown as ClienteSftp
    const avance = { sumar: () => {}, actual: () => {}, cancelada: false }
    const t0 = Date.now()
    const r = await Promise.race([bajar(falso, '/datos/enorme.bin', destinoLocal, plataforma, avance).then(() => 'ok', (e) => `error ${String(e)}`), sleep(5000).then(() => 'colgada')])
    check('(b4) 1e15 bytes anunciados y fin al primer tramo: acaba enseguida con lo que había', r === 'ok' && Date.now() - t0 < 5000 && readFileSync(destinoLocal, 'utf8') === 'hola', `${r} ${Date.now() - t0} ms`)
  }

  await real()
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

/** Espera a que una operación acabe (cualquier fase que no sea «en-curso»). */
async function finDe(eventos: SftpProgreso[], opId: string, ms = 60_000): Promise<SftpProgreso | null> {
  const limite = Date.now() + ms
  for (;;) {
    const fin = eventos.find((e) => e.opId === opId && e.fase !== 'en-curso')
    if (fin) return fin
    if (Date.now() > limite) return null
    await sleep(50)
  }
}

async function real(): Promise<void> {
  hr('C - REAL: sesiones sobre el ssh del sistema contra el servidor de pruebas')
  const destino = process.env.TESSERA_TEST_SSH
  const secretos = process.env.TESSERA_TEST_SSH_DIR
  const binarios = resolverBinariosSsh()
  if (!destino || !secretos) {
    console.log('  (sin TESSERA_TEST_SSH: corre con `bash scripts/pruebas/ssh.sh correr npm run -s test:sftp`)')
    return
  }
  if (!binarios.ssh || binarios.dePrueba || !binarios.sshKeygen) {
    check('(c0) hay cliente SSH del sistema', false, j(binarios))
    return
  }
  const [host, puertoTexto] = destino.split(':')
  const puerto = Number(puertoTexto)
  const contrasena = readFileSync(path.join(secretos, 'ssh-pw.txt'), 'utf8').trim()
  const raiz = temporal('tessera-sftp-real-', esWindows() ? (process.env.APPDATA ?? os.tmpdir()) : os.tmpdir())
  const dirHuellas = path.join(raiz, 'ssh', 'huellas')
  const dirClaves = path.join(raiz, 'ssh', 'claves')
  mkdirSync(dirHuellas, { recursive: true })
  let programa = rutaProgramaAskpass('windows', { appDir: RAIZ_REPO, userData: '' })
  if (!esWindows()) {
    programa = path.join(raiz, 'askpass', 'askpass')
    escribirLanzadorAskpass(programa, lanzadorAskpassSh(process.execPath, rutaGuionAskpass(plataforma, RAIZ_REPO)))
  }
  if (!existsSync(programa)) {
    check('(c0) hay programa de contraseñas (npm run compilar:askpass o predev)', false, programa)
    return
  }
  const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
  puente.start()
  for (let i = 0; i < 60 && !puente.listo; i++) await sleep(50)
  const fichas = new FichasAskpass()
  const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves, cifrado: cifradoFalso, log: () => {} })
  const askpass = new AskpassSsh({ puerta: puente, conexion: (id) => conexiones.conexion(id), secretoDe: (id) => conexiones.secretoDe(id), rutaClave: (id) => conexiones.rutaClave(id), programa, existe: existsSync, exe: process.execPath, plataforma, fichas, log: () => {} })
  const claves = new ClavesImportadas({
    dir: dirClaves,
    plataforma,
    elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
    sshKeygen: () => binarios.sshKeygen,
    permisos: { asegurarCarpeta: (d) => asegurarCarpetaProtegida(d, plataforma), escribirProtegida: (r, t) => escribirClaveProtegida(r, t, plataforma) },
    ejecutar: ejecutarCorto,
    log: () => {}
  })
  const ctrl = new ControladorSsh({ conexiones, eventos: { emitir: () => {}, hayDestino: () => true }, claves, askpass, ejecutar: ejecutarCorto, plataforma, log: () => {} })
  const idPw = ctrl.crear({ profileId: 'pa', alias: 'pruebas', grupoId: null, host, puerto, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, secreto: contrasena }).id
  const elegida = await claves.soltada(path.join(secretos, 'ssh', 'id_ed25519'), 'pa')
  const idClave = ctrl.crear({ profileId: 'pa', alias: 'clave', grupoId: null, host, puerto, usuario: 'clave', metodo: 'clave', clave: { tipo: 'elegida', token: elegida.token }, disponibleAgentes: true }).id
  const idMala = ctrl.crear({ profileId: 'pa', alias: 'mala', grupoId: null, host, puerto, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, secreto: 'no-es-esta' }).id

  const eventos: SftpProgreso[] = []
  const caidas: unknown[] = []
  const local = temporal('tessera-sftp-local-')
  let carpetaDescarga: string | null = path.join(local, 'bajadas')
  mkdirSync(carpetaDescarga)
  const sesiones = new SesionesSftp({
    linea: (p, c) => ctrl.prepararSftp(p, c),
    clasificar: (codigo, cola) => ctrl.clasificar(codigo, cola),
    elegirCarpetaDescarga: async () => carpetaDescarga,
    elegirParaSubir: async () => null,
    mostrarEnCarpeta: () => {},
    emitir: (canal, p) => {
      if (canal === SFTP_CHANNELS.EV_PROGRESO) eventos.push(p as SftpProgreso)
      if (canal === SFTP_CHANNELS.EV_CAIDA) caidas.push(p)
    },
    plataforma,
    log: () => {}
  })
  const op = async (r: SftpResultado<SftpInicioTransferencia | null>): Promise<SftpProgreso | null> => (r.ok && r.valor?.tipo === 'operacion' ? finDe(eventos, r.valor.opId) : null)
  try {
    const abierta = await sesiones.abrir('s1', 'pa', idPw)
    check('(c1) abre con la contraseña guardada (programa de contraseñas) y da la carpeta de inicio', abierta.ok && abierta.valor.inicio === '/home/pruebas', j(abierta))
    check('(c2) la ficha del programa de contraseñas se suelta al conectar', fichas.cuantas === 0, `${fichas.cuantas} vivas`)
    const base = `/tmp/sftp-${process.pid} ñ`
    const creada = await sesiones.crearCarpeta('s1', base)
    const listada = await sesiones.listar('s1', '/tmp')
    check('(c3) crea una carpeta con espacio y «ñ», y aparece como carpeta', creada.ok && listada.ok && listada.valor.entradas.some((e) => e.nombre === baseRemota(base) && e.tipo === 'carpeta'), j(creada))

    const binario = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) & 0xff))
    const arbol = path.join(local, 'arbol')
    mkdirSync(path.join(arbol, 'sub', 'vacia'), { recursive: true })
    writeFileSync(path.join(arbol, 'sub', 'datos.bin'), binario)
    writeFileSync(path.join(arbol, 'leeme.txt'), 'hola ñ\n')
    const sube = await op(await sesiones.subirSoltados('s1', base, [arbol]))
    const remotoSub = await sesiones.listar('s1', `${base}/arbol/sub`)
    check('(c4) sube una carpeta entera (binario de 300 KB, subcarpeta vacía)', sube?.fase === 'hecha' && remotoSub.ok && remotoSub.valor.entradas.some((e) => e.nombre === 'datos.bin' && e.tamano === binario.length) && remotoSub.valor.entradas.some((e) => e.nombre === 'vacia'), j(sube))
    check('(c5) el avance llega con el total en bytes', eventos.some((e) => e.opId === sube?.opId && e.total === binario.length + Buffer.byteLength('hola ñ\n')), j(eventos.filter((e) => e.opId === sube?.opId).map((e) => [e.hechos, e.total])))

    writeFileSync(path.join(arbol, 'leeme.txt'), 'cambiado\n')
    const otra = await sesiones.subirSoltados('s1', base, [arbol])
    check('(c6) volver a subirla: plan con el conflicto, sin tocar nada', otra.ok && otra.valor.tipo === 'plan' && j(otra.valor.conflictos) === j(['arbol']), j(otra))
    const plan = otra.ok && otra.valor.tipo === 'plan' ? otra.valor.planId : ''
    const confirmada = sesiones.confirmarPlan(plan, true)
    const fin = confirmada.ok && confirmada.valor ? await finDe(eventos, confirmada.valor.opId) : null
    check('(c7) confirmarlo reemplaza', fin?.fase === 'hecha', j(confirmada))

    const baja = await op(await sesiones.descargar('s1', [`${base}/arbol`]))
    const bajado = path.join(carpetaDescarga, 'arbol')
    const iguales = existsSync(path.join(bajado, 'sub', 'datos.bin')) && readFileSync(path.join(bajado, 'sub', 'datos.bin')).equals(binario) && readFileSync(path.join(bajado, 'leeme.txt'), 'utf8') === 'cambiado\n'
    check('(c8) baja la carpeta: el binario igual byte a byte y lo reemplazado', baja?.fase === 'hecha' && iguales && existsSync(path.join(bajado, 'sub', 'vacia')), j(baja))
    check('(c9) sin temporales a medias en el equipo', !readdirSync(path.join(bajado, 'sub')).some((n) => n.includes('tessera-parcial')), j(readdirSync(path.join(bajado, 'sub'))))
    writeFileSync(path.join(bajado, 'leeme.txt'), 'local')
    const deNuevo = await sesiones.descargar('s1', [`${base}/arbol`])
    const descartado = deNuevo.ok && deNuevo.valor?.tipo === 'plan' ? sesiones.confirmarPlan(deNuevo.valor.planId, false) : null
    check('(c10) bajar encima de lo que hay: plan; descartarlo no toca nada', deNuevo.ok && deNuevo.valor?.tipo === 'plan' && descartado?.ok === true && readFileSync(path.join(bajado, 'leeme.txt'), 'utf8') === 'local', j(deNuevo))
    carpetaDescarga = null
    const cancelado = await sesiones.descargar('s1', [`${base}/arbol`])
    check('(c11) cancelar el diálogo: null y nada en marcha', cancelado.ok && cancelado.valor === null, j(cancelado))

    const ren = await sesiones.renombrar('s1', `${base}/arbol/leeme.txt`, `${base}/arbol/sub/datos.bin`)
    const ren2 = await sesiones.renombrar('s1', `${base}/arbol/leeme.txt`, `${base}/arbol/lÉeme.txt`)
    check('(c12) renombrar no pisa lo que existe; a un nombre libre, sí', !ren.ok && ren.error.includes('Ya existe') && ren2.ok, `${j(ren)} ${j(ren2)}`)
    const raro = `${base}/a"b*c\\d [x]`
    const conRaro = await sesiones.crearCarpeta('s1', raro)
    const listaRaro = await sesiones.listar('s1', base)
    check('(c13) un nombre con comillas, asterisco, barra invertida y corchetes, tal cual', conRaro.ok && listaRaro.ok && listaRaro.valor.entradas.some((e) => e.nombre === 'a"b*c\\d [x]'), j(listaRaro.ok && listaRaro.valor.entradas.map((e) => e.nombre)))

    const grande = path.join(local, 'grande.bin')
    writeFileSync(grande, Buffer.alloc(64 * 1024 * 1024, 1))
    const lanzada = await sesiones.subirSoltados('s1', base, [grande])
    if (lanzada.ok && lanzada.valor.tipo === 'operacion') {
      await sleep(150)
      sesiones.cancelar(lanzada.valor.opId)
    }
    const finCancel = lanzada.ok && lanzada.valor.tipo === 'operacion' ? await finDe(eventos, lanzada.valor.opId) : null
    const tras = await sesiones.listar('s1', base)
    check('(c14) cancelar una subida: «cancelada», y ni el archivo ni su temporal quedan en el servidor', finCancel?.fase === 'cancelada' && tras.ok && !tras.valor.entradas.some((e) => e.nombre.includes('grande')), `${finCancel?.fase} ${j(tras.ok && tras.valor.entradas.map((e) => e.nombre))}`)

    const borrado = sesiones.borrar('s1', [base])
    const finBorrado = borrado.ok ? await finDe(eventos, borrado.valor.opId) : null
    const sinBase = await sesiones.listar('s1', '/tmp')
    check('(c15) borrar una carpeta con todo su contenido', finBorrado?.fase === 'hecha' && sinBase.ok && !sinBase.valor.entradas.some((e) => e.nombre === baseRemota(base)), j(finBorrado))
    check('(c16) `/` no se borra nunca (ni llega al servidor)', !sesiones.borrar('s1', ['/']).ok, 'rechazado')

    const conClave = await sesiones.abrir('s2', 'pa', idClave)
    check('(c17) abre con el archivo de clave importado', conClave.ok && conClave.valor.inicio === '/home/clave', j(conClave))
    const otraConexion = await sesiones.abrir('s1', 'pa', idClave)
    check('(c17b) la misma id con OTRA conexión no reutiliza la sesión viva: abre la suya', otraConexion.ok && otraConexion.valor.inicio === '/home/clave', j(otraConexion))
    await sesiones.abrir('s1', 'pa', idPw)
    const mala = await sesiones.abrir('s3', 'pa', idMala)
    check('(c18) una contraseña que no es: autenticación rechazada, y qué hacer', !mala.ok && mala.motivo === 'ssh-autenticacion' && mala.error.includes('contraseña'), j(mala))
    sesiones.cerrar('s1')
    await sleep(300)
    const cerrada = await sesiones.listar('s1', '/tmp')
    check('(c19) cerrada la sesión, pedirle algo dice que se reconecte (y no hay caída que avisar)', !cerrada.ok && cerrada.error.includes('reconéctala') && caidas.length === 0, `${j(cerrada)} caidas=${j(caidas)}`)
    check('(c20) ninguna ficha queda viva', fichas.cuantas === 0, `${fichas.cuantas}`)
  } finally {
    sesiones.cerrarTodas()
    puente.stop()
  }
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
