#!/usr/bin/env node
// =============================================================================
// Prueba de «Exportar a OpenSSH…» (`exportarOpenSsh.ts` y `ControladorSsh.exportarOpenSsh`; npm run
// test:ssh-openssh-exportar): el nombre de cada `Host`, las comillas, la ruta del IdentityFile en las dos
// plataformas, los bastiones que se añaden, el texto por grupos, y de punta a punta contra el registro y las claves
// importadas de verdad: lo exportado vuelve a entrar igual con «Importar desde OpenSSH…». Con TESSERA_TEST_SSH
// (`scripts/pruebas/ssh.sh correr`), además, el config exportado conecta con ssh, directo y por un bastión.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { plataformaActual } from '../../shared/plataforma.ts'
import type { SshConexion } from '../../shared/ssh-ipc.ts'
import { asegurarCarpetaProtegida, escribirClaveProtegida } from './adaptadores/permisosClave.ts'
import { resolverBinariosSsh } from './binariosSsh.ts'
import { analizarConfigOpenSsh, argumentosOpenSsh, rutaIdentidad } from './configOpenSsh.ts'
import { ConexionesSsh } from './ConexionesSsh.ts'
import { ControladorSsh } from './ControladorSsh.ts'
import { ClavesImportadas } from './controlador/clavesImportadas.ts'
import { identidadOpenSsh, nombreHostOpenSsh, planOpenSsh, seleccionExportar, valorOpenSsh } from './exportarOpenSsh.ts'

function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}

const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : `\n         ${evidence}`}`)
}
const j = (v: unknown): string => JSON.stringify(v)

/** Una conexión de la lista con lo justo para exportarla. */
function conexion(id: string, alias: string, extra: Partial<SshConexion> = {}): SshConexion {
  return {
    id,
    profileId: 'pa',
    alias,
    grupoId: null,
    host: `${id}.ejemplo.com`,
    puerto: 22,
    usuario: 'ops',
    metodo: 'sistema',
    tieneSecreto: false,
    disponibleAgentes: true,
    huellaServidor: [],
    saltoId: null,
    tuneles: [],
    ...extra
  }
}

hr('A - Nombres de Host, comillas y la ruta del IdentityFile')
{
  const nombres = ['web', 'Mi servidor (prod)', '***', 'ñandú.local', '-raro-'].map(nombreHostOpenSsh)
  check('(a1) letras, cifras, «.», «_» y «-»; lo demás pasa a «-»; vacío = «conexion»', j(nombres) === j(['web', 'Mi-servidor-prod', 'conexion', 'ñandú.local', 'raro']), j(nombres))
  const valores = ['simple', 'con espacio', 'x"y', 'a\\b', '#nota']
  const vueltas = valores.map((v) => argumentosOpenSsh(valorOpenSsh(v)))
  check('(a2) cada valor vuelve igual por el analizador de OpenSSH', vueltas.every((a, i) => a.length === 1 && a[0] === valores[i]), j(vueltas))
  check('(a3) uno sin espacios ni signos va sin comillas', valorOpenSsh('192.0.2.1') === '192.0.2.1', valorOpenSsh('192.0.2.1'))

  const homeW = 'C:\\Users\\ana'
  const bajo = identidadOpenSsh('C:\\Users\\ana\\.ssh\\config-tessera-claves\\id_web', homeW, 'windows')
  const fuera = identidadOpenSsh('D:\\Mis Cosas\\100%\\id_web', homeW, 'windows')
  check('(a4) Windows: bajo el home con «~/» y barras normales', bajo === '~/.ssh/config-tessera-claves/id_web', bajo)
  check('(a5) Windows: fuera del home, absoluta, entre comillas y con el «%» doblado', fuera === '"D:/Mis Cosas/100%%/id_web"', fuera)
  const entornoW = { home: homeW, usuario: 'ana', plataforma: 'windows' as const }
  const vueltaW = rutaIdentidad(argumentosOpenSsh(fuera)[0], entornoW)
  check('(a6) Windows: la importación la lleva a la misma ruta', vueltaW === 'D:\\Mis Cosas\\100%\\id_web', String(vueltaW))
  const homeM = '/Users/ana'
  const m1 = identidadOpenSsh('/Users/ana/Documentos/config-claves/id_x', homeM, 'mac')
  const m2 = identidadOpenSsh('/Volumes/USB/id_x', homeM, 'mac')
  const m3 = identidadOpenSsh('/Users/anabel/id_x', homeM, 'mac')
  check('(a7) macOS: «~/» bajo el home, absoluta fuera (también un home que solo empieza igual)', m1 === '~/Documentos/config-claves/id_x' && m2 === '/Volumes/USB/id_x' && m3 === '/Users/anabel/id_x', j([m1, m2, m3]))
  const vueltaM = rutaIdentidad(argumentosOpenSsh(m1)[0], { home: homeM, usuario: 'ana', plataforma: 'mac' })
  check('(a8) macOS: la importación la lleva a la misma ruta', vueltaM === '/Users/ana/Documentos/config-claves/id_x', String(vueltaM))
}

hr('B - Qué se exporta y cómo queda el texto')
{
  const lista = [
    conexion('b1', 'bastion'),
    conexion('b2', 'salto 2', { saltoId: 'b1' }),
    conexion('c1', 'interna', { saltoId: 'b2', grupoId: 'g1', puerto: 2222 }),
    conexion('c2', 'suelta'),
    conexion('x1', 'ciclo-a', { saltoId: 'x2' }),
    conexion('x2', 'ciclo-b', { saltoId: 'x1' })
  ]
  const s = seleccionExportar(lista, ['c1'])
  check('(b1) una conexión con dos saltos se lleva los dos bastiones', j(s.elegidas.map((c) => c.id)) === j(['b1', 'b2', 'c1']) && s.bastiones === 2, j(s))
  const todas = seleccionExportar(lista)
  check('(b2) sin ids, todas y ningún bastión «añadido»', todas.elegidas.length === 6 && todas.bastiones === 0, j(todas))
  const ciclo = seleccionExportar(lista, ['x1'])
  check('(b3) un ciclo de saltos (a mano) no se cuelga', ciclo.elegidas.length === 2 && ciclo.bastiones === 1, j(ciclo))
  check('(b4) ids de otro perfil o que no existen se ignoran', seleccionExportar(lista, ['nada']).elegidas.length === 0, '')

  const conexiones = [
    conexion('k1', 'Web prod', { metodo: 'clave', clave: { nombre: 'id', tipo: 'RSA', cifrada: false }, grupoId: 'g1' }),
    conexion('k2', 'sin-copia', { metodo: 'clave', clave: { nombre: 'id', tipo: 'RSA', cifrada: false } }),
    conexion('p1', 'con-pass', { metodo: 'contrasena', tieneSecreto: true, saltoId: 'k1' }),
    conexion('t1', 'tuneles', {
      host: '2001:db8::1',
      tuneles: [
        { tipo: 'local', puerto: 8080, destinoHost: 'localhost', destinoPuerto: 80 },
        { tipo: 'remoto', puerto: 9000, destinoHost: '::1', destinoPuerto: 22 },
        { tipo: 'dinamico', puerto: 1080 }
      ]
    }),
    conexion('d1', 'web-prod', { grupoId: 'g-borrado' })
  ]
  const plan = planOpenSsh(conexiones, { grupos: [{ id: 'g1', profileId: 'pa', nombre: 'Producción' }], conClave: new Set(['k1']), identidad: (a) => `~/claves/${a}` })
  const t = plan.texto
  check('(b5) los grupos en su orden y «Sin grupo» al final (con el de un grupo desconocido)', t.indexOf('# Grupo: Producción') < t.indexOf('# Grupo: Sin grupo') && t.indexOf('Host web-prod-2') > t.indexOf('# Grupo: Sin grupo'), t)
  check('(b6) el alias con espacios va renombrado, con el original en un comentario; el repetido sin mayúsculas, con «-2»', t.includes('# Web prod\nHost Web-prod\n') && t.includes('# web-prod\nHost web-prod-2\n') && plan.renombradas === 2, t)
  check('(b7) la clave copiada: IdentityFile e IdentitiesOnly; sin copia, ninguno', t.includes('  IdentityFile ~/claves/id_Web-prod\n  IdentitiesOnly yes') && !/Host sin-copia\n[^#]*IdentityFile/.test(t) && j(plan.claves) === j([{ id: 'k1', archivo: 'id_Web-prod' }]), t)
  check('(b8) el bastión por su nombre de Host; el puerto 22 no se escribe', t.includes('Host con-pass\n  HostName p1.ejemplo.com\n  User ops\n  ProxyJump Web-prod\n'), t)
  check(
    '(b9) los túneles en 127.0.0.1 como en la pestaña, con la IPv6 entre corchetes',
    t.includes('  LocalForward 127.0.0.1:8080 localhost:80\n  RemoteForward 9000 [::1]:22\n  DynamicForward 127.0.0.1:1080'),
    t
  )
  const leido = analizarConfigOpenSsh(t)
  check(
    '(b10) el analizador de la importación lee cada Host con su HostName, User y clave',
    leido.patrones === 0 && j(leido.hosts.map((h) => [h.alias, h.host, h.usuario, h.identidad ?? null])) ===
      j([['Web-prod', 'k1.ejemplo.com', 'ops', '~/claves/id_Web-prod'], ['sin-copia', 'k2.ejemplo.com', 'ops', null], ['con-pass', 'p1.ejemplo.com', 'ops', null], ['tuneles', '2001:db8::1', 'ops', null], ['web-prod-2', 'd1.ejemplo.com', 'ops', null]]),
    j(leido)
  )
}

hr('C - De punta a punta: exportar y volver a importar')
{
  const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-ssh-exportar-'))
  try {
    const home = path.join(raiz, 'home')
    const dirSsh = path.join(home, '.ssh')
    mkdirSync(dirSsh, { recursive: true })
    const dirClaves = path.join(raiz, 'claves')
    const dirHuellas = path.join(raiz, 'huellas')
    mkdirSync(dirHuellas)
    const pem = String(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }))
    const original = path.join(raiz, 'id_original')
    writeFileSync(original, pem)
    const claves = new ClavesImportadas({
      dir: dirClaves,
      plataforma: 'mac',
      elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
      sshKeygen: () => null,
      permisos: { asegurarCarpeta: async (d) => void mkdirSync(d, { recursive: true }), escribirProtegida: async (r, t) => writeFileSync(r, t, { flag: 'wx' }) },
      ejecutar: async () => ({ codigo: 0, salida: '', errores: '', agotado: false }),
      log: () => {}
    })
    const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves, log: () => {} })
    let destino: string | null = path.join(dirSsh, 'config-tessera')
    let fallarEscritura = false
    const protegidas: string[] = []
    const ctrl = new ControladorSsh({
      conexiones,
      claves,
      home,
      elegirConfigOpenSsh: async () => destino,
      exportarOpenSsh: {
        elegirDestino: async () => destino,
        permisos: {
          asegurarCarpeta: async (d) => void protegidas.push(d),
          escribirProtegida: async (r, t) => {
            if (fallarEscritura) throw new Error(`sin permiso en ${r}`)
            writeFileSync(r, t, { flag: 'wx' })
            protegidas.push(r)
          }
        }
      },
      eventos: { emitir: () => {}, hayDestino: () => true },
      plataforma: path.sep === '\\' ? 'windows' : 'mac',
      log: () => {}
    })
    const g = ctrl.crearGrupo({ profileId: 'pa', nombre: 'Producción' })
    const ficha = await claves.soltada(original, 'pa')
    const bastion = ctrl.crear({ profileId: 'pa', alias: 'bastion', grupoId: null, host: '192.0.2.1', puerto: 22, usuario: 'salto', metodo: 'sistema', disponibleAgentes: true })
    const web = ctrl.crear({ profileId: 'pa', alias: 'web', grupoId: g.id, host: '192.0.2.30', puerto: 2222, usuario: 'deploy', metodo: 'clave', clave: { tipo: 'elegida', token: ficha.token }, disponibleAgentes: true })
    ctrl.crear({ profileId: 'pa', alias: 'Base de datos', grupoId: g.id, host: '192.0.2.31', puerto: 22, usuario: 'dba', metodo: 'contrasena', disponibleAgentes: true, saltoId: bastion.id })
    const base = ctrl.listar().conexiones.find((c) => c.alias === 'Base de datos') as SshConexion

    const r = await ctrl.exportarOpenSsh({ profileId: 'pa', ids: [web.id, base.id] })
    const carpeta = path.join(dirSsh, 'config-tessera-claves')
    check(
      '(c1) exporta las dos, añade el bastión, copia la clave junto al archivo y dice que se puede incluir',
      j(r) === j({ archivo: 'config-tessera', conexiones: 3, bastiones: 1, carpetaClaves: 'config-tessera-claves', claves: 1, sinClave: 0, conSecreto: 0, renombradas: 1, incluible: true }),
      j(r)
    )
    check('(c2) la copia de la clave es la de Tessera, protegida, y el config se escribió protegido', readFileSync(path.join(carpeta, 'id_web'), 'utf8') === readFileSync(conexiones.rutaClave(web.id), 'utf8') && protegidas.includes(carpeta) && protegidas.some((p) => p.startsWith(`${destino}.`)), j(protegidas))
    check('(c3) no queda ningún temporal junto al archivo', readdirSync(dirSsh).sort().join() === 'config-tessera,config-tessera-claves', j(readdirSync(dirSsh)))

    const vuelta = await ctrl.leerOpenSsh({ profileId: 'pb' })
    const por = (alias: string): unknown => {
      const c = vuelta?.candidatas.find((x) => x.alias === alias)
      return c && [c.host, c.puerto, c.usuario, c.clave?.tipo ?? null, c.claveNoUsable]
    }
    check(
      '(c4) «Importar desde OpenSSH…» lo lee igual: host, puerto, usuario y la clave (válida) de cada una',
      vuelta?.conPatrones === 0 && j([por('bastion'), por('web'), por('Base-de-datos')]) === j([['192.0.2.1', 22, 'salto', null, false], ['192.0.2.30', 2222, 'deploy', 'RSA', false], ['192.0.2.31', 22, 'dba', null, false]]),
      j(vuelta)
    )

    writeFileSync(path.join(dirSsh, 'config-tessera'), 'viejo')
    const otra = await ctrl.exportarOpenSsh({ profileId: 'pa' })
    check('(c5) otra vez al mismo archivo: lo sustituye y las claves van a otra carpeta, sin tocar la anterior', otra?.carpetaClaves === 'config-tessera-claves-2' && existsSync(path.join(carpeta, 'id_web')) && readFileSync(path.join(dirSsh, 'config-tessera'), 'utf8').includes('-claves-2/id_web'), j(otra))

    fallarEscritura = true
    let mensaje = ''
    try {
      await ctrl.exportarOpenSsh({ profileId: 'pa', ids: [web.id] })
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e)
    }
    check('(c6) si no se puede escribir: error sin rutas y sin dejar la carpeta de claves a medias', mensaje !== '' && !mensaje.includes(raiz) && !existsSync(path.join(dirSsh, 'config-tessera-claves-3')), mensaje)

    fallarEscritura = false
    destino = null
    check('(c7) cancelar el diálogo devuelve null', (await ctrl.exportarOpenSsh({ profileId: 'pa' })) === null, '')
    let vacio = ''
    try {
      await ctrl.exportarOpenSsh({ profileId: 'otro' })
    } catch (e) {
      vacio = e instanceof Error ? e.message : String(e)
    }
    check('(c8) un perfil sin conexiones: lo dice', vacio === 'No hay conexiones que exportar.', vacio)

    // El registro editado a mano: un host con un salto de línea abriría otra directiva en el config.
    const store = path.join(raiz, 'ssh-connections.json')
    const doc = JSON.parse(readFileSync(store, 'utf8')) as { conexiones: { alias: string; host: string }[] }
    for (const c of doc.conexiones) if (c.alias === 'bastion') c.host = 'x\nProxyCommand calc'
    writeFileSync(store, JSON.stringify(doc))
    const manual = new ControladorSsh({
      conexiones: new ConexionesSsh({ storePath: store, dirHuellas, dirClaves, log: () => {} }),
      claves,
      home,
      exportarOpenSsh: { elegirDestino: async () => path.join(raiz, 'inyectado'), permisos: { asegurarCarpeta: async () => {}, escribirProtegida: async (r, t) => writeFileSync(r, t, { flag: 'wx' }) } },
      eventos: { emitir: () => {}, hayDestino: () => true },
      log: () => {}
    })
    let rechazo = ''
    try {
      await manual.exportarOpenSsh({ profileId: 'pa' })
    } catch (e) {
      rechazo = e instanceof Error ? e.message : String(e)
    }
    check('(c9) un host editado a mano que no vale: no se exporta nada y se dice cuál', rechazo.includes('"bastion"') && !existsSync(path.join(raiz, 'inyectado')), rechazo)
    let lanzo = false
    try {
      valorOpenSsh('a\nb')
    } catch {
      lanzo = true
    }
    check('(c10) un valor con salto de línea nunca se escribe, ni entre comillas', lanzo, '')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

hr('D - REAL: el config exportado conecta con ssh, directo y saltando por un bastión')
{
  const destinoSsh = process.env.TESSERA_TEST_SSH
  const secretos = process.env.TESSERA_TEST_SSH_DIR
  const binarios = resolverBinariosSsh()
  if (!destinoSsh || !secretos) {
    console.log('  (sin TESSERA_TEST_SSH: corre con `bash scripts/pruebas/ssh.sh correr npm run -s test:ssh-openssh-exportar`)')
  } else if (!binarios.ssh || binarios.dePrueba) {
    check('(d0) hay cliente SSH del sistema', false, j(binarios))
  } else {
    const ssh = binarios.ssh
    const [hostPrueba, puertoPrueba] = destinoSsh.split(':')
    const plataforma = plataformaActual()
    const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-ssh-exportar-real-'))
    try {
      const dirClaves = path.join(raiz, 'claves')
      const dirHuellas = path.join(raiz, 'huellas')
      mkdirSync(dirHuellas)
      const dirExportado = path.join(raiz, 'exportado')
      mkdirSync(dirExportado)
      const exportado = path.join(dirExportado, 'config-tessera')
      const permisos = {
        asegurarCarpeta: (d: string) => asegurarCarpetaProtegida(d, plataforma),
        escribirProtegida: (r: string, t: string) => escribirClaveProtegida(r, t, plataforma)
      }
      const claves = new ClavesImportadas({
        dir: dirClaves,
        plataforma,
        elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
        sshKeygen: () => binarios.sshKeygen,
        permisos,
        ejecutar: async () => ({ codigo: 0, salida: '', errores: '', agotado: false }),
        log: () => {}
      })
      const ctrl = new ControladorSsh({
        conexiones: new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves, log: () => {} }),
        claves,
        home: path.join(raiz, 'home'),
        exportarOpenSsh: { elegirDestino: async () => exportado, permisos },
        eventos: { emitir: () => {}, hayDestino: () => true },
        plataforma,
        log: () => {}
      })
      // La clave del usuario `clave` de pruebas-ssh, importada como lo haría la app (una ficha por conexión).
      const clavePrueba = path.join(secretos, 'ssh', 'id_ed25519')
      const ficha = async (): Promise<string> => (await claves.soltada(clavePrueba, 'pa')).token
      const bastion = ctrl.crear({ profileId: 'pa', alias: 'bastion real', grupoId: null, host: hostPrueba, puerto: Number(puertoPrueba), usuario: 'clave', metodo: 'clave', clave: { tipo: 'elegida', token: await ficha() }, disponibleAgentes: true })
      // El destino del salto se resuelve DENTRO del bastión: su propio sshd en 127.0.0.1:22.
      ctrl.crear({ profileId: 'pa', alias: 'interna real', grupoId: null, host: '127.0.0.1', puerto: 22, usuario: 'clave', metodo: 'clave', clave: { tipo: 'elegida', token: await ficha() }, disponibleAgentes: true, saltoId: bastion.id })
      const r = await ctrl.exportarOpenSsh({ profileId: 'pa' })
      check('(d1) exporta las dos con sus dos claves', r?.conexiones === 2 && r.claves === 2, j(r))

      // Envoltorio de la prueba: incluye lo exportado tal cual y solo añade lo que una prueba necesita
      // (su known_hosts, sin preguntas). ssh se queda con el primer valor de cada opción, así que lo
      // exportado manda. El salto lanza otro ssh con el mismo -F, que también lo encuentra.
      const barras = (p: string): string => p.replace(/\\/g, '/')
      const envoltorio = path.join(dirExportado, 'envoltorio')
      writeFileSync(
        envoltorio,
        `Include "${barras(exportado)}"\nHost *\n  StrictHostKeyChecking no\n  UserKnownHostsFile "${barras(path.join(raiz, 'known_hosts'))}"\n  BatchMode yes\n  ConnectTimeout 15\n`
      )
      const correr = (host: string, eco: string): { codigo: number | null; salida: string } => {
        const s = spawnSync(ssh.exe, [...ssh.args, '-F', envoltorio, host, 'echo', eco], { encoding: 'utf8', timeout: 60_000 })
        return { codigo: s.status, salida: `${s.stdout ?? ''}${s.stderr ?? ''}`.trim() }
      }
      const directo = correr('bastion-real', 'exportado-directo')
      check('(d2) ssh -F con el Host exportado entra con la copia de la clave', directo.codigo === 0 && directo.salida.includes('exportado-directo'), j(directo))
      const salto = correr('interna-real', 'exportado-salto')
      check('(d3) y el de detrás del bastión entra por su ProxyJump', salto.codigo === 0 && salto.salida.includes('exportado-salto'), j(salto))
      if (plataforma !== 'windows') {
        const copias = readdirSync(path.join(dirExportado, 'config-tessera-claves')).map((n) => statSync(path.join(dirExportado, 'config-tessera-claves', n)).mode & 0o777)
        check('(d4) las copias exportadas son 0600, que es lo que ssh exige', copias.length === 2 && copias.every((m) => m === 0o600), j(copias.map((m) => m.toString(8))))
      }
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  }
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
