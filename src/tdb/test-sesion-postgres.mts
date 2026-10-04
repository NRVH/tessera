#!/usr/bin/env node
// =============================================================================
// Integración del proceso de sesión del explorador contra un PostgreSQL efímero de Docker: lanza
// el trabajador REAL (`sesion.cjs`) con `fork` y el binario de Electron, por `ProcesoTrabajador`,
// sin dobles. Se salta (exit 0, con aviso) sin Docker, sin la imagen o sin el binario de Electron.
// Cubre apertura, filas, celdas exactas, errores, transacción, solo lectura, Stop, pérdida y salida.
// (node src/tdb/test-sesion-postgres.mts)
// Decisiones: docs/decisiones/bd/trabajador-postgres-sesion.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcesoTrabajador } from '../main/db/explorador/ProcesoTrabajador.ts'
import {
  FalloTrabajador,
  type ErrorTrabajador,
  type EventoTrabajador,
  type OpcionesEjecucion,
  type ResultadoTrabajador
} from '../main/db/explorador/protocoloTrabajador.ts'

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

function saltar(motivo: string): never {
  console.log(`\nSALTADO: ${motivo}\nVEREDICTO: 0/0 PASS — SALTADO`)
  process.exit(0)
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const IMAGEN = 'postgres:16-alpine'

function docker(args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', input, windowsHide: true })
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

const SIEMBRA = `
CREATE TABLE cliente (
  id int PRIMARY KEY, nombre text NOT NULL, saldo numeric(38,2), alta timestamptz,
  activo boolean, foto bytea, datos jsonb
);
CREATE TABLE pedido (
  id serial PRIMARY KEY, cliente_id int REFERENCES cliente(id), total numeric(12,2),
  creado date DEFAULT current_date
);
CREATE TABLE linea (pedido_id int REFERENCES pedido(id), n int, producto text, PRIMARY KEY (pedido_id, n));
CREATE INDEX ix_pedido_cliente ON pedido(cliente_id);
CREATE VIEW v_clientes_activos AS SELECT id, nombre FROM cliente WHERE activo;
CREATE FUNCTION doble(x int) RETURNS int LANGUAGE sql AS $$ SELECT x * 2 $$;
CREATE SEQUENCE seq_facturas START 1000;
INSERT INTO cliente VALUES
  (1, 'Ana', 12345678901234567890123456789012345.67, '2024-03-31 02:30:00+02', true, '\\x0a0bff', '{"a":1}'),
  (2, 'Bea', -0.5, NULL, false, NULL, NULL),
  (3, 'Ñandú 😀', 0, '2024-01-01 00:00:00+00', true, NULL, '[]');
INSERT INTO pedido (cliente_id, total) VALUES (1, 10), (1, 20), (2, 30);
INSERT INTO linea VALUES (1, 1, 'tornillo'), (1, 2, 'tuerca');
-- Una base «vieja», con standard_conforming_strings = off para toda sesión
-- nueva. Las del trabajador tienen que abrir con on (ver (1c)); esta ya está abierta.
ALTER DATABASE postgres SET standard_conforming_strings = off;
`

async function intentar<T>(p: Promise<T>): Promise<{ ok: true; r: T } | { ok: false; error: ErrorTrabajador }> {
  try {
    return { ok: true, r: await p }
  } catch (e) {
    if (e instanceof FalloTrabajador) return { ok: false, error: e.error }
    return { ok: false, error: { clase: 'protocolo', mensaje: String(e) } }
  }
}

async function main(): Promise<void> {
  // --- Requisitos -------------------------------------------------------------
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) saltar('Docker no responde.')
  if (!docker(['image', 'inspect', IMAGEN]).ok) saltar(`falta la imagen ${IMAGEN} (docker pull ${IMAGEN}).`)
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    saltar('el paquete electron no está instalado.')
  }
  if (!electron || !existsSync(electron)) saltar('falta el binario de Electron (lo baja `npm run predev`).')
  // Por si el test corre desde una terminal de Tessera: sus variables TESSERA_* no deben colarse.
  for (const k of Object.keys(process.env)) {
    if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  }

  const password = randomBytes(12).toString('hex')
  const run = docker(['run', '-d', '--rm', '-p', '127.0.0.1::5432', '-e', `POSTGRES_PASSWORD=${password}`, IMAGEN])
  if (!run.ok) saltar(`no se pudo arrancar el contenedor: ${run.err}`)
  const contenedor = run.out
  // Red de seguridad: una excepción que escape al try (p. ej. un fallo del canal
  // IPC al deserializar) mata el proceso sin pasar por el finally, y `--rm` solo
  // borra al PARAR el contenedor. `spawnSync` sí corre dentro de 'exit'. Con `-v`,
  // como en test-db-postgres: el `rm -f` le gana al borrado de `--rm` y,
  // sin él, cada ejecución dejaba huérfano el volumen anónimo de datos de postgres
  // (medido: uno por corrida, PG_VERSION 16 dentro).
  let borrado = false
  process.on('exit', () => {
    if (!borrado) spawnSync('docker', ['rm', '-f', '-v', contenedor], { windowsHide: true })
  })
  let proc: ProcesoTrabajador | null = null
  const logs: string[] = []

  try {
    hr('(0) Contenedor y siembra')
    const puertoTexto = docker(['port', contenedor, '5432/tcp']).out.split('\n')[0] || ''
    const port = Number(puertoTexto.slice(puertoTexto.lastIndexOf(':') + 1))
    check('puerto publicado', Number.isInteger(port) && port > 0, puertoTexto)
    let listo = false
    for (let i = 0; i < 120 && !listo; i++) {
      // Por TCP: el servidor temporal del initdb solo escucha en el socket unix.
      listo = docker(['exec', contenedor, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).ok
      if (!listo) await dormir(500)
    }
    check('pg_isready', listo, listo ? 'aceptando conexiones' : 'no arrancó en 60 s')
    if (!listo) throw new Error('postgres no arrancó')
    const siembra = docker(['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], SIEMBRA)
    check('siembra (3 tablas, vista, función, secuencia, índice, FK)', siembra.ok, siembra.ok ? 'ok' : siembra.err)

    const conexion = {
      id: 'c1',
      alias: 'PG-PRUEBA',
      motor: 'postgres' as const,
      host: '127.0.0.1',
      port,
      database: 'postgres',
      user: 'postgres',
      readonly: false
    }
    const ctx = { packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }
    const p = new ProcesoTrabajador({
      rutaScript: path.join(aqui, 'sesion.cjs'),
      execPath: electron,
      // 'advanced' (el formato de V8) solo encaja con el mismo V8 en los dos lados: la app lo usa
      // porque es el mismo Electron; con el `node` del sistema falla al deserializar, y va 'json'.
      serializacion: process.versions.electron ? 'advanced' : 'json',
      log: (l) => logs.push(l)
    })
    proc = p
    const eventos: EventoTrabajador[] = []
    p.onEvento((e) => eventos.push(e))
    let salida: { codigo: number | null; senal: string | null } | null = null
    p.onSalida((s) => {
      salida = s
    })

    const abrir = (sesion: string, rol: 'meta' | 'datos' | 'consola', timeoutMs = 0, readonly = false) =>
      p.enviar<'abrir'>({
        op: 'abrir',
        sesion,
        rol,
        conexion: { ...conexion, readonly },
        secreto: password,
        ctx,
        opciones: { timeoutMs }
      })
    const ejecutar = (sesion: string, sql: string, opciones: Partial<OpcionesEjecucion> = {}, binds?: Array<string | number | null>) =>
      p.enviar<'ejecutar'>({
        op: 'ejecutar',
        sesion,
        sql,
        binds,
        opciones: { proposito: 'usuario', maxFilas: 500, ...opciones }
      })
    const filas = (r: ResultadoTrabajador): unknown[][] => (r.tipo === 'filas' ? JSON.parse(r.filasJson) : [])

    hr('(1) Arranque y apertura')
    const ini = await p.arrancar()
    check('arranca con el binario de Electron', ini.v === 1 && Boolean(ini.versiones.electron), JSON.stringify(ini.versiones))

    // (1b) La configuración EXACTA de la app: un Electron de main, fork con
    // 'advanced', saludo y salida. Con `-e` para no depender de ningún archivo.
    const guion = [
      "const { fork } = require('child_process')",
      `const c = fork(${JSON.stringify(path.join(aqui, 'sesion.cjs'))}, [], { execPath: process.execPath, execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced', windowsHide: true })`,
      "c.on('message', (m) => { console.log(JSON.stringify(m)); if (m.id === 1) c.send({ id: 2, op: 'salir' }) })",
      "c.on('exit', (code) => process.exit(code === 0 ? 0 : 3))",
      "c.send({ id: 1, op: 'iniciar', v: 1 })",
      'setTimeout(() => process.exit(4), 10000)'
    ].join('\n')
    const avanzado = spawnSync(electron, ['-e', guion], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      timeout: 20_000
    })
    const salidaAvanzado = avanzado.stdout || ''
    check(
      "serialización 'advanced' entre dos Electron (la de la app)",
      avanzado.status === 0 && salidaAvanzado.includes('"ok":true') && salidaAvanzado.includes('"v":1') && salidaAvanzado.includes('"saliendo":true'),
      `exit=${avanzado.status} ${salidaAvanzado.trim().split('\n').join(' | ').slice(0, 160)}`
    )
    const ab = await abrir('consola|k1', 'consola')
    check(
      'abre con contraseña',
      ab.modo === 'nativo' && ab.esquema === 'public' && ab.usuario === 'postgres' && ab.version.startsWith('16'),
      JSON.stringify(ab)
    )
    await abrir('meta|c1', 'meta', 60_000)

    hr('(1c) standard_conforming_strings fijado al abrir, y la segunda barrera')
    {
      const deFabrica = docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', 'SHOW standard_conforming_strings']).out
      const valor = async (sql: string): Promise<unknown> => filas(await ejecutar('consola|k1', sql))[0]?.[0]
      const alAbrir = await valor('SHOW standard_conforming_strings')
      check(
        'la base lo tiene off para cualquier otra sesión, y la del trabajador abre con on',
        deFabrica === 'off' && alAbrir === 'on',
        `psql=${deFabrica} trabajador=${String(alAbrir)}`
      )
      const barra = await valor("SELECT 'a\\b'")
      check("'a\\b' son 3 caracteres (a, barra, b), lo que cree el léxico del main", barra === 'a\\b', `${JSON.stringify(barra)} (${String(barra).length} caracteres)`)
      await ejecutar('consola|k1', "SELECT set_config('standard_conforming_strings', 'off', false)")
      const trasAtras = await valor('SHOW standard_conforming_strings')
      check(
        'un set_config de standard_conforming_strings: el servidor lo informa (ParameterStatus) y se refija tras la sentencia',
        trasAtras === 'on',
        String(trasAtras)
      )
      await ejecutar('consola|k1', "SELECT set_config('IntervalStyle', 'iso_8601', false)")
      const intervalo = await valor('SHOW IntervalStyle')
      check('… también IntervalStyle (se informa igual)', intervalo === 'postgres', String(intervalo))
      // Dentro de una transacción que se revierte, el set_config se deshace solo: al salir
      // no queda nada que refijar ni nada fuera de su sitio.
      const enTx = await ejecutar('consola|k1', "SELECT set_config('DateStyle', 'German', false)", { txManual: true })
      const dentro = await valor('SHOW DateStyle')
      await p.enviar<'tx'>({ op: 'tx', sesion: 'consola|k1', accion: 'rollback' })
      check(
        'dentro de una transacción también se refija en el acto (y el ROLLBACK no deja nada raro)',
        enTx.tx !== 'ninguna' && dentro === 'ISO, YMD' && (await valor('SHOW DateStyle')) === 'ISO, YMD',
        `dentro=${String(dentro)}`
      )
      // Revisión: un camino que vuelve SIN refijar tras la sentencia. El cursor vivo de una
      // exportación (`mantenerCursor`) no puede lanzar nada detrás del portal abierto, y el
      // ParameterStatus llega al cerrarlo; la sentencia SIGUIENTE tiene que correr ya con
      // lo de Tessera, no solo la de después.
      const vivo = await ejecutar(
        'consola|k1',
        "SELECT set_config('standard_conforming_strings', 'off', false) FROM generate_series(1, 30)",
        { mantenerCursor: true, maxFilas: 10, lector: 'exp-scs' }
      )
      let lector = vivo.tipo === 'filas' ? vivo.lector : null
      for (let i = 0; i < 10 && lector !== null; i++) {
        lector = (await p.enviar<'leer'>({ op: 'leer', sesion: 'consola|k1', lector, maxFilas: 100 })).lector
      }
      const barraTrasCursor = await valor("SELECT 'a\\b'")
      check(
        "tras exportar con cursor vivo un set_config de standard_conforming_strings, la sentencia SIGUIENTE ya lee 'a\\b' con 3 caracteres",
        vivo.tipo === 'filas' && lector === null && barraTrasCursor === 'a\\b',
        `${JSON.stringify(barraTrasCursor)} (${String(barraTrasCursor).length} caracteres)`
      )
    }

    hr('(2) SELECT: filasJson, hayMas y re-ejecución')
    const sqlSerie = 'SELECT g AS n, g * 2 AS n FROM generate_series(1, 1234) g'
    const s1 = await ejecutar('consola|k1', sqlSerie)
    const f1 = filas(s1)
    check(
      'primera página: 500 filas y hayMas',
      s1.tipo === 'filas' && s1.nFilas === 500 && s1.hayMas && s1.lector === null && f1.length === 500,
      s1.tipo === 'filas' ? `n=${s1.nFilas} hayMas=${s1.hayMas} lector=${s1.lector}` : s1.tipo
    )
    check(
      'columnas duplicadas (n, n) conservadas',
      s1.tipo === 'filas' && s1.columnas.length === 2 && s1.columnas.every((c) => c.nombre === 'n') && JSON.stringify(f1[0]) === '["1","2"]',
      JSON.stringify(f1[0])
    )
    check('int4 como texto exacto y tipo numero', s1.tipo === 'filas' && s1.columnas[0].tipoLogico === 'numero', JSON.stringify(s1.tipo === 'filas' && s1.columnas[0]))
    const s3 = await ejecutar('consola|k1', sqlSerie, { saltarFilas: 1000 })
    const f3 = filas(s3)
    check(
      'tercera página por re-ejecución: 234 filas, sin más',
      s3.tipo === 'filas' && s3.nFilas === 234 && !s3.hayMas && s3.saltadas === 1000 && JSON.stringify(f3[0]) === '["1001","2002"]',
      s3.tipo === 'filas' ? `n=${s3.nFilas} hayMas=${s3.hayMas} saltadas=${s3.saltadas} primera=${JSON.stringify(f3[0])}` : s3.tipo
    )
    check('sin transacción tras leer en Auto', s3.tx === 'ninguna', s3.tx)

    hr('(3) Celdas exactas')
    const c = await ejecutar('consola|k1', 'SELECT id, nombre, saldo, alta, activo, foto, datos FROM cliente ORDER BY id')
    const fc = filas(c) as unknown[][]
    check('numeric(38,2) exacto', fc[0]?.[2] === '12345678901234567890123456789012345.67', String(fc[0]?.[2]))
    check('numeric negativo con su escala', fc[1]?.[2] === '-0.50', String(fc[1]?.[2]))
    check('timestamptz en texto ISO de la sesión (UTC)', fc[0]?.[3] === '2024-03-31 00:30:00+00', String(fc[0]?.[3]))
    check('bool como boolean', fc[0]?.[4] === true && fc[1]?.[4] === false, `${fc[0]?.[4]}, ${fc[1]?.[4]}`)
    check('bytea en hex', fc[0]?.[5] === '0x0A0BFF', String(fc[0]?.[5]))
    check('jsonb como texto', fc[0]?.[6] === '{"a": 1}', String(fc[0]?.[6]))
    check('NULL como null', fc[1]?.[3] === null && fc[1]?.[5] === null, `${fc[1]?.[3]}, ${fc[1]?.[5]}`)
    check('texto con Ñ y emoji intacto', fc[2]?.[1] === 'Ñandú 😀', String(fc[2]?.[1]))
    const tipos = c.tipo === 'filas' ? c.columnas.map((col) => col.tipoLogico).join(',') : ''
    check('tipos lógicos', tipos === 'numero,texto,numero,fechaHora,booleano,binario,json', tipos)
    check('tipoMotor con typmod', c.tipo === 'filas' && c.columnas[2].tipoMotor === 'numeric(38,2)', c.tipo === 'filas' ? c.columnas[2].tipoMotor : '')

    hr('(4) UPDATE -> afectadas')
    const u = await ejecutar('consola|k1', 'UPDATE pedido SET total = total + 1 WHERE cliente_id = 1')
    check('2 filas afectadas, comando UPDATE, tx ninguna', u.tipo === 'afectadas' && u.filas === 2 && u.comando === 'UPDATE' && u.tx === 'ninguna', JSON.stringify(u))

    hr('(5) Error de sintaxis con offsetCp')
    const sqlMal = "SELECT '😀' AS x\nSELECT 2"
    const e5 = await intentar(ejecutar('consola|k1', sqlMal))
    const esperado = Array.from("SELECT '😀' AS x\n").length
    check(
      'clase servidor, 42601 y offset en puntos de código',
      !e5.ok && e5.error.clase === 'servidor' && e5.error.codigo === '42601' && e5.error.offsetCp === esperado,
      e5.ok ? 'no falló' : `${e5.error.codigo} offsetCp=${e5.error.offsetCp} esperado=${esperado} (UTF-16 sería ${esperado + 1})`
    )
    const tras5 = await intentar(ejecutar('consola|k1', 'SELECT 1'))
    check('la sesión sigue sana tras el error', tras5.ok, tras5.ok ? 'SELECT 1 ok' : tras5.error.mensaje)

    hr('(6) Transacción manual')
    const ac = await p.enviar<'autoCommit'>({ op: 'autoCommit', sesion: 'consola|k1', valor: false })
    check('pasa a Manual sin tx', ac.autoCommit === false && ac.tx === 'ninguna', JSON.stringify(ac))
    const lectura = await ejecutar('consola|k1', 'SELECT 1')
    check('BEGIN perezoso: una lectura deja la tx `abierta`', lectura.tx === 'abierta', lectura.tx)
    await p.enviar<'tx'>({ op: 'tx', sesion: 'consola|k1', accion: 'rollback' })
    const upd = await ejecutar('consola|k1', "UPDATE cliente SET nombre = 'Anita' WHERE id = 1", { txManual: true })
    check('UPDATE en Manual -> pendiente', upd.tipo === 'afectadas' && upd.filas === 1 && upd.tx === 'pendiente', JSON.stringify(upd))
    const desdeMeta = await ejecutar('meta|c1', 'SELECT nombre FROM cliente WHERE id = $1', { proposito: 'catalogo', maxFilas: 10 }, [1])
    check('otra sesión NO ve el cambio sin confirmar', JSON.stringify(filas(desdeMeta)) === '[["Ana"]]', JSON.stringify(filas(desdeMeta)))
    const rb = await p.enviar<'tx'>({ op: 'tx', sesion: 'consola|k1', accion: 'rollback' })
    check('rollback -> ninguna', rb.tx === 'ninguna', JSON.stringify(rb))
    const trasRb = await ejecutar('consola|k1', 'SELECT nombre FROM cliente WHERE id = 1', { sinBegin: true })
    check('el cambio se revirtió', JSON.stringify(filas(trasRb)) === '[["Ana"]]' && trasRb.tx === 'ninguna', `${JSON.stringify(filas(trasRb))} tx=${trasRb.tx}`)
    const div = await intentar(ejecutar('consola|k1', 'SELECT 1/0'))
    const est = await p.enviar<'tx'>({ op: 'tx', sesion: 'consola|k1', accion: 'estado' })
    check('un error en Manual deja la tx `fallida`', !div.ok && div.error.codigo === '22012' && est.tx === 'fallida', `${div.ok ? '' : div.error.codigo} tx=${est.tx}`)
    const cm = await p.enviar<'tx'>({ op: 'tx', sesion: 'consola|k1', accion: 'commit' })
    check('COMMIT sobre `fallida` avisa del ROLLBACK', cm.tx === 'ninguna' && (cm.avisos ?? []).some((a) => a.includes('ROLLBACK')), JSON.stringify(cm))
    await p.enviar<'autoCommit'>({ op: 'autoCommit', sesion: 'consola|k1', valor: true })

    hr('(7) Candado de solo lectura')
    await abrir('consola|ro', 'consola', 0, true)
    const w1 = await intentar(ejecutar('consola|ro', 'UPDATE pedido SET total = 0', { candadoRO: true }))
    check('el servidor rechaza la escritura (25006)', !w1.ok && w1.error.clase === 'soloLectura' && w1.error.codigo === '25006', w1.ok ? 'escribió' : `${w1.error.clase} ${w1.error.codigo}`)
    await ejecutar('consola|ro', "SELECT set_config('default_transaction_read_only', 'off', false)", { candadoRO: true })
    const w2 = await intentar(ejecutar('consola|ro', 'UPDATE pedido SET total = 0', { candadoRO: true }))
    check('el truco de set_config no abre la puerta', !w2.ok && w2.error.codigo === '25006', w2.ok ? 'escribió' : `${w2.error.codigo}`)
    const setOk = await ejecutar('consola|ro', 'SET search_path TO public', { candadoRO: true, fueraDeEnvoltorio: true })
    check('la lista blanca va fuera del envoltorio', setOk.tipo === 'hecho' && setOk.comando === 'SET' && setOk.tx === 'ninguna', JSON.stringify(setOk))
    const leidoRo = await ejecutar('consola|ro', 'SELECT count(*) FROM pedido', { candadoRO: true })
    check('en solo lectura se lee y la tx queda `ninguna`', JSON.stringify(filas(leidoRo)) === '[["3"]]' && leidoRo.tx === 'ninguna', `${JSON.stringify(filas(leidoRo))} tx=${leidoRo.tx}`)

    hr('(8) Stop y statement_timeout')
    const t0 = Date.now()
    const larga = intentar(ejecutar('consola|k1', 'SELECT pg_sleep(30)'))
    await dormir(400)
    const can = await p.enviar<'cancelar'>({ op: 'cancelar', sesion: 'consola|k1' })
    const rl = await larga
    const dt = Date.now() - t0
    check(
      'pg_sleep(30) cancelado en < 3 s',
      can.cancelada && !rl.ok && rl.error.clase === 'cancelada' && rl.error.codigo === '57014' && dt < 3000,
      `${rl.ok ? 'terminó' : `${rl.error.clase} ${rl.error.codigo}`} en ${dt} ms`
    )
    const tras8 = await intentar(ejecutar('consola|k1', 'SELECT 42'))
    check('ningún cancel tardío cae en la siguiente', tras8.ok && JSON.stringify(filas(tras8.r)) === '[["42"]]', tras8.ok ? 'ok' : tras8.error.mensaje)
    const sinNada = await p.enviar<'cancelar'>({ op: 'cancelar', sesion: 'consola|k1' })
    check('cancelar sin nada en curso no hace nada', sinNada.cancelada === false, JSON.stringify(sinNada))
    await abrir('meta|corta', 'meta', 500)
    const to = await intentar(ejecutar('meta|corta', 'SELECT pg_sleep(3)'))
    check('statement_timeout -> clase timeout', !to.ok && to.error.clase === 'timeout' && to.error.codigo === '57014', to.ok ? 'terminó' : `${to.error.clase} ${to.error.codigo}`)

    hr('(9) Una operación por sesión')
    const primera = intentar(ejecutar('consola|k1', 'SELECT pg_sleep(0.5)'))
    const segunda = await intentar(ejecutar('consola|k1', 'SELECT 1'))
    const r9 = await primera
    check('la segunda es `ocupada` y la primera termina', !segunda.ok && segunda.error.clase === 'ocupada' && r9.ok, segunda.ok ? 'no fue ocupada' : segunda.error.clase)
    const leer = await intentar(p.enviar<'leer'>({ op: 'leer', sesion: 'consola|k1', lector: 'x', maxFilas: 10 }))
    check('PG no tiene lectores vivos (leer -> protocolo)', !leer.ok && leer.error.clase === 'protocolo' && leer.error.codigo === 'TESSERA-LECTOR', leer.ok ? 'leyó' : `${leer.error.clase} ${leer.error.codigo}`)

    hr('(10) pg_terminate_backend -> perdida')
    await ejecutar('meta|c1', 'SELECT pg_terminate_backend($1)', { proposito: 'catalogo', maxFilas: 1 }, [ab.pidServidor ?? 0])
    let evento: EventoTrabajador | undefined
    for (let i = 0; i < 50 && !evento; i++) {
      evento = eventos.find((e) => e.ev === 'perdida' && e.sesion === 'consola|k1')
      if (!evento) await dormir(100)
    }
    check(
      'evento perdida de la sesión ociosa',
      Boolean(evento) && evento?.ev === 'perdida' && evento.error.clase === 'perdida',
      evento && evento.ev === 'perdida' ? `${evento.error.codigo} ${evento.error.mensaje}` : 'sin evento'
    )
    const lapida = await intentar(ejecutar('consola|k1', 'SELECT 1'))
    check('la sesión perdida responde `perdida`', !lapida.ok && lapida.error.clase === 'perdida', lapida.ok ? 'respondió' : lapida.error.clase)
    const re = await intentar(abrir('consola|k1', 'consola'))
    const tras10 = re.ok ? await intentar(ejecutar('consola|k1', 'SELECT 7')) : re
    check('reabrir sobre la lápida funciona', re.ok && tras10.ok, tras10.ok ? 'SELECT 7 ok' : tras10.error.mensaje)
    check('el proceso sigue vivo', p.vivo, String(p.vivo))

    hr('(11) El secreto no aparece en el log')
    const todo = logs.join('\n')
    check('ninguna línea contiene la contraseña', !todo.includes(password), `${logs.length} líneas`)

    hr('(12) Salida limpia')
    await p.salir(3000)
    const s = salida as { codigo: number | null; senal: string | null } | null
    check('exit observado con código 0', !p.vivo && s !== null && s.codigo === 0, JSON.stringify(s))
    let vivas = -1
    for (let i = 0; i < 30; i++) {
      const r = docker([
        'exec',
        contenedor,
        'psql',
        '-U',
        'postgres',
        '-tAc',
        "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador%'"
      ])
      vivas = Number(r.out)
      if (vivas === 0) break
      await dormir(100)
    }
    check('ninguna sesión de Tessera queda en el servidor', vivas === 0, `vivas=${vivas}`)
    const tardia = await intentar(ejecutar('consola|k1', 'SELECT 1'))
    check('enviar tras salir rechaza sin colgarse', !tardia.ok && tardia.error.clase === 'perdida', tardia.ok ? 'respondió' : tardia.error.codigo ?? '')
  } catch (err) {
    check('sin excepciones inesperadas', false, String(err instanceof Error ? err.stack : err))
  } finally {
    if (proc && proc.vivo) await proc.salir(1000)
    docker(['rm', '-f', '-v', contenedor])
    borrado = true
    if (results.some((r) => !r.pass)) {
      console.log('\n--- log del trabajador ---')
      for (const l of logs) console.log('  ' + l)
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
