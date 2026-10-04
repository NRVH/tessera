#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD contra un PostgreSQL de verdad: levanta un contenedor efímero con contraseña y conduce
// el `ExploradorController` entero con el trabajador real lanzado con el binario de Electron. El canal va en 'json'.
// Se salta (exit 0, con aviso) si no hay Docker, falta la imagen o falta el binario de Electron.
// (node src/main/db/explorador/test-db-postgres.mts  ·  npm run test:db-postgres)
// =============================================================================

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DbConnection, DbEsquemasVisibles, DbIntrospeccion } from '../../../shared/db-ipc.ts'
import {
  DBX_CHANNELS,
  type DbCelda,
  type DbEstadoSesion,
  type DbEventoCatalogo,
  type DbResultadoSentencia,
  type DbTipoObjeto
} from '../../../shared/db-explorador-ipc.ts'
import { crearEscritor } from '../../../shared/formatosFilas.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { ExploradorController } from './ExploradorController.ts'
import { probarFiltroGuiado } from './casosFiltroGuiado.mts'
import type { TrabajadorGestor } from './GestorSesiones.ts'
import { ProcesoTrabajador } from './ProcesoTrabajador.ts'
import type { OpTrabajador, PeticionSinIdDe, RespuestasPorOp } from './protocoloTrabajador.ts'

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
const PERFIL = 'perfil1'

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
CREATE SCHEMA ventas;
CREATE TABLE ventas.factura (id int PRIMARY KEY, importe numeric(10,2));
INSERT INTO cliente VALUES
  (1, 'Ana', 12345678901234567890123456789012345.67, '2024-03-31 02:30:00+02', true, '\\x0a0bff', '{"a":1}'),
  (2, 'Bea', -0.5, NULL, false, NULL, NULL),
  (3, 'Ñandú 😀', 0, '2024-01-01 00:00:00+00', true, NULL, '[]');
INSERT INTO pedido (cliente_id, total) VALUES (1, 10), (1, 20), (2, 30);
INSERT INTO linea VALUES (1, 1, 'tornillo'), (1, 2, 'tuerca');
COMMENT ON TABLE cliente IS 'Clientes de O''Brien';
COMMENT ON COLUMN cliente.nombre IS 'Nombre visible';
-- Segunda entrega: en su propio esquema, para no mover los conteos de public.
CREATE SCHEMA extra;
CREATE TYPE extra.estado AS ENUM ('activo', 'baja');
CREATE DOMAIN extra.positivo AS int CHECK (VALUE > 0);
CREATE TABLE extra.documento (id int, creado timestamp, cuerpo text, bin bytea, PRIMARY KEY (id, creado));
INSERT INTO extra.documento VALUES
  (1, '2024-03-31 02:30:00.123456', repeat('ñ😀', 40000) || 'FIN', decode(repeat('ab', 70000), 'hex'));
CREATE TABLE extra.sin_pk (x int, y text);
INSERT INTO extra.sin_pk VALUES (1, 'a');
CREATE TABLE extra.ejecuciones (n serial PRIMARY KEY);
CREATE FUNCTION extra.registrar() RETURNS int LANGUAGE sql VOLATILE AS $$ INSERT INTO extra.ejecuciones DEFAULT VALUES RETURNING n $$;
CREATE FUNCTION extra.aviso_ro() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'desde ro'; RETURN 1; END $$;
CREATE SCHEMA temporal;
`

/** Registro de conexiones en memoria con la forma que el explorador espera. */
class ConexionesEnMemoria {
  readonly mapa = new Map<string, DbConnection>()
  readonly secretos = new Map<string, string>()
  introspecciones = 0
  verificadas: Array<[string, string | null]> = []
  get(id: string): DbConnection | undefined {
    return this.mapa.get(id)
  }
  secretOf(id: string): string | null {
    return this.secretos.get(id) ?? null
  }
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const c = this.mapa.get(id)
    if (!c) throw new Error('Conexión desconocida')
    const nueva = { ...c, esquemas: v }
    this.mapa.set(id, nueva)
    return nueva
  }
  setIntrospeccion(id: string, v: DbIntrospeccion): void {
    const c = this.mapa.get(id)
    if (!c) return
    this.introspecciones++
    this.mapa.set(id, { ...c, introspeccion: v })
  }
  marcarVerificada(id: string, driverId: string | null): boolean {
    const c = this.mapa.get(id)
    if (!c || (c.verificada && (c.driverId ?? null) === driverId)) return false
    this.verificadas.push([id, driverId])
    this.mapa.set(id, { ...c, verificada: true, driverId })
    return true
  }
}

function filasDe(r: DbResultadoSentencia | undefined): unknown[][] {
  return r && r.tipo === 'filas' ? (JSON.parse(r.pagina.filasJson) as unknown[][]) : []
}

/**
 * (16) Retener en el trabajador el SIGUIENTE `set_config` del esquema: abre a propósito
 * el hueco entre que el controlador fija su mapa y guarda el índice, para meter un
 * `listar` dentro. El trabajador de detrás es el real.
 */
const retencion: { puerta: Promise<void> | null; enVuelo: boolean } = { puerta: null, enVuelo: false }

/**
 * (22) Lo que ve el trabajador de la EDICIÓN de la rejilla:
 *   - `ejecutados`: cada `ejecutar`, para saber si salió el SELECT de una página;
 *   - `consultasEdicion`: la tabla de cada consulta de columnas editables
 *     (`sqlColumnasEdicion`, la del `attgenerated`), para contar cuántas veces se
 *     pregunta al catálogo de edición;
 *   - `edicion` + `pagina`: RETENER la consulta de edición de una tabla hasta ver salir
 *     el SELECT de su página (o un plazo), y anotar si ese SELECT salió ANTES de que la
 *     edición respondiera: con las dos en serie, nunca.
 */
const espia: {
  ejecutados: Array<{ sql: string; catalogo: boolean }>
  consultasEdicion: string[]
  edicion: { tabla: string; hasta: Promise<void>; respondida: boolean } | null
  pagina: { patron: RegExp; antesDeLaEdicion: boolean | null; avisar: () => void } | null
} = { ejecutados: [], consultasEdicion: [], edicion: null, pagina: null }

function conRetencion(p: ProcesoTrabajador): TrabajadorGestor {
  return {
    arrancar: () => p.arrancar(),
    async enviar<O extends OpTrabajador>(peticion: PeticionSinIdDe<O>, plazoMs?: number | null): Promise<RespuestasPorOp[O]> {
      const puerta = retencion.puerta
      const sql = peticion.op === 'ejecutar' ? (peticion as PeticionSinIdDe<'ejecutar'>).sql : ''
      if (puerta && /set_config\('search_path'/.test(sql)) {
        retencion.puerta = null
        retencion.enVuelo = true
        await puerta
        retencion.enVuelo = false
      }
      if (peticion.op === 'ejecutar') {
        const pe = peticion as PeticionSinIdDe<'ejecutar'>
        const catalogo = pe.opciones.proposito === 'catalogo'
        espia.ejecutados.push({ sql: pe.sql, catalogo })
        const tabla = catalogo && /attgenerated/.test(pe.sql) && Array.isArray(pe.binds) ? String(pe.binds[1]) : null
        if (tabla !== null) espia.consultasEdicion.push(tabla)
        const pag = espia.pagina
        if (pag && !catalogo && pag.patron.test(pe.sql)) {
          espia.pagina = null
          pag.antesDeLaEdicion = !(espia.edicion?.respondida ?? false)
          pag.avisar()
        }
        const ed = espia.edicion
        if (ed && tabla === ed.tabla) {
          await ed.hasta
          try {
            return await p.enviar(peticion, plazoMs)
          } finally {
            ed.respondida = true
          }
        }
      }
      return p.enviar(peticion, plazoMs)
    },
    onEvento: (cb) => p.onEvento(cb),
    onSalida: (cb) => p.onSalida(cb),
    salir: (plazoMs) => p.salir(plazoMs),
    matar: () => p.matar(),
    get vivo() {
      return p.vivo
    },
    get pendientes() {
      return p.pendientes
    }
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
  for (const k of Object.keys(process.env)) {
    if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  }

  const password = randomBytes(12).toString('hex')
  const run = docker(['run', '-d', '--rm', '-p', '127.0.0.1::5432', '-e', `POSTGRES_PASSWORD=${password}`, IMAGEN])
  if (!run.ok) saltar(`no se pudo arrancar el contenedor: ${run.err}`)
  const contenedor = run.out
  let borrado = false
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-dbx-'))
  // Red de seguridad: `--rm` solo borra al PARAR el contenedor, y una excepción que
  // escape al try saltaría el finally. `spawnSync` sí corre dentro de 'exit'.
  process.on('exit', () => {
    // `-v`: el volumen anónimo de la imagen (VOLUME /var/lib/postgresql/data) se iba
    // quedando huérfano en cada ejecución; `--rm` solo lo borra al PARAR, no con `rm -f`.
    if (!borrado) spawnSync('docker', ['rm', '-f', '-v', contenedor], { windowsHide: true })
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // nada
    }
  })
  const logs: string[] = []
  const eventos: Array<{ canal: string; payload: unknown }> = []
  const procesos: ProcesoTrabajador[] = []
  let explorador: ExploradorController | null = null

  try {
    hr('(0) Contenedor, siembra y controlador')
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
    check('siembra', siembra.ok, siembra.ok ? 'ok' : siembra.err)

    const base: DbConnection = {
      id: 'c1',
      profileId: PERFIL,
      alias: 'PG-PRUEBA',
      motor: 'postgres',
      host: '127.0.0.1',
      port,
      database: 'postgres',
      user: 'postgres',
      tieneSecreto: true,
      readonly: false
    }
    const conexiones = new ConexionesEnMemoria()
    conexiones.mapa.set('c1', base)
    conexiones.mapa.set('ro', { ...base, id: 'ro', alias: 'PG-RO', readonly: true })
    conexiones.secretos.set('c1', password)
    conexiones.secretos.set('ro', password)
    let cambios = 0
    const exportados = path.join(tmp, 'exportados')
    mkdirSync(exportados, { recursive: true })
    /** Lo que «elige» el usuario en el diálogo de guardar: null = cancelar; sin valor, lo propuesto. */
    let eleccion: string | null | undefined
    const dialogos: string[] = []
    /** Stop desde el primer progreso de esta exportación (ver (14)). */
    let pararEn: string | null = null
    /**
     * (14) En el primer progreso de esta exportación —la 1.ª página ya escrita y la 2.ª
     * sin pedir—, OTRA sesión escribe en la tabla (`escritura`) y se cuenta cuántas
     * conexiones de exportación hay en el servidor. Síncrono: la exportación espera.
     */
    let escribirEn: { peticionId: string; escritura: string; hecho: boolean; conexiones: string } | null = null
    let exRef: ExploradorController | null = null
    const ex = new ExploradorController({
      // La solo lectura IMPUESTA a la conexión con la casilla marcada ('ro'): este test fija
      // la maquinaria de solo lectura contra un PG de verdad. Ahora el
      // PRODUCTO no impone ninguna (la casilla es de los agentes); eso lo fijan
      // `test-gestor-sesiones` (34) y `test-db-sqlite` (14) con el trabajador real.
      soloLecturaImpuesta: (c) => c.readonly,
      conexiones,
      registro: {
        ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
        notificarCambio: () => {
          cambios++
        },
        espacioDeDatos: (p) => path.join(tmp, 'conexiones', p),
        tdbScriptDir: () => path.resolve(aqui, '..', '..', '..', 'tdb'),
        ensureWorkspace: (p) => mkdirSync(path.join(tmp, 'conexiones', p), { recursive: true })
      },
      perfilVivo: (id) => id === PERFIL,
      nombrePerfil: () => 'Pruebas',
      papelera: async (ruta) => rmSync(ruta, { force: true }),
      plataforma: plataformaActual(),
      getWindow: () => null,
      emitir: (canal, payload) => {
        eventos.push({ canal, payload })
        const p = payload as { peticionId?: string } | undefined
        if (canal === DBX_CHANNELS.EV_EXPORTACION && pararEn !== null && p?.peticionId === pararEn) {
          exRef?.cancelar({ rol: 'exportacion', peticionId: pararEn })
        }
        if (canal === DBX_CHANNELS.EV_EXPORTACION && escribirEn !== null && !escribirEn.hecho && p?.peticionId === escribirEn.peticionId) {
          escribirEn.hecho = true
          // Cada conexión de exportación: su estado y los bloqueos que tiene sobre la tabla.
          escribirEn.conexiones = docker([
            'exec', contenedor, 'psql', '-U', 'postgres', '-tAc',
            "SELECT a.state || ':' || coalesce((SELECT string_agg(l.mode, ',') FROM pg_locks l WHERE l.pid = a.pid AND l.relation = 'extra.instantanea'::regclass), '-') " +
              "FROM pg_stat_activity a WHERE a.application_name LIKE 'Tessera/explorador exportar%'"
          ]).out
          const w = docker(['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], escribirEn.escritura)
          if (!w.ok) escribirEn.conexiones += ` (la escritura falló: ${w.err})`
        }
      },
      // El diálogo de guardar, inyectado: nunca se importa electron. Como el de la app
      // (`util/adaptadores/dialogosNativos.ts`), se queda con el NOMBRE propuesto y pone su carpeta.
      guardarArchivo: async (_win, opciones) => {
        dialogos.push(String(opciones.defaultPath))
        const r = eleccion === undefined ? path.join(exportados, path.basename(String(opciones.defaultPath))) : eleccion
        return r === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: r }
      },
      // El historial en SU carpeta, junto a `conexiones/` y no dentro (como en la app).
      dirHistorial: path.join(tmp, 'db-historial'),
      log: (l) => logs.push(l),
      lanzar: () => {
        const p = new ProcesoTrabajador({
          rutaScript: path.resolve(aqui, '..', '..', '..', 'tdb', 'sesion.cjs'),
          execPath: electron,
          // Ver la cabecera: 'advanced' solo encaja con el mismo V8 en los dos lados.
          serializacion: process.versions.electron ? 'advanced' : 'json',
          log: (l) => logs.push(l)
        })
        procesos.push(p)
        return conRetencion(p)
      }
    })
    explorador = ex
    exRef = ex

    hr('(1) Catálogo')
    const esq = await ex.esquemas('c1')
    const lista = esq.ok ? esq.valor.esquemas.map((e) => e.nombre) : []
    check('esquemas: public por defecto, visible solo él (1 de M)', esq.ok && esq.valor.porDefecto === 'public' && esq.valor.nVisibles === 1 && lista.includes('ventas') && lista.includes('pg_catalog'), esq.ok ? `${esq.valor.nVisibles} de ${lista.length}: ${lista.join(',')}` : JSON.stringify(esq))
    check('los del sistema van al final', esq.ok && esq.valor.esquemas[esq.valor.esquemas.length - 1].sistema, esq.ok ? lista.slice(-2).join(',') : '')
    check('la introspección se guarda (N de M sin conectar)', conexiones.get('c1')?.introspeccion?.totalEsquemas === lista.length && conexiones.introspecciones === 1, JSON.stringify(conexiones.get('c1')?.introspeccion))
    check('abrir la sesión marca la conexión verificada', conexiones.verificadas.length === 1 && conexiones.get('c1')?.verificada === true, JSON.stringify(conexiones.verificadas))
    const conteos = await ex.resumen('c1', 'public')
    const cv = conteos.ok ? conteos.valor : {}
    check('conteos de public en un viaje', conteos.ok && cv.tabla === 3 && cv.vista === 1 && cv.rutina === 1 && (cv.secuencia ?? 0) >= 2, JSON.stringify(conteos))
    const tablas = await ex.objetos('c1', 'public', 'tabla')
    const nombres = tablas.ok ? tablas.valor.map((o) => o.nombre).join(',') : ''
    check('objetos: las tres tablas', nombres === 'cliente,linea,pedido', nombres || JSON.stringify(tablas))
    const det = await ex.detalle('c1', { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, ['columnas', 'indices', 'restricciones'])
    const id = det.ok ? det.valor.columnas?.find((c) => c.nombre === 'id') : undefined
    check('detalle: columnas con la PK, índices y restricciones', det.ok && id?.pk === 1 && (det.valor.columnas?.length ?? 0) === 7 && (det.valor.restricciones ?? []).some((r) => r.tipo === 'pk'), det.ok ? `id.pk=${id?.pk} cols=${det.valor.columnas?.length} restr=${det.valor.restricciones?.length}` : JSON.stringify(det))
    const fuente = await ex.fuente('c1', { esquema: 'public', nombre: 'v_clientes_activos', tipo: 'vista' })
    check('fuente de la vista', fuente.ok && /SELECT/i.test(fuente.valor.partes[0]?.texto ?? ''), fuente.ok ? fuente.valor.partes[0]?.texto.slice(0, 60) ?? '' : JSON.stringify(fuente))
    const idx = await ex.nombres('c1')
    const nomIdx = idx.ok ? idx.valor.objetos.map((o) => `${idx.valor.esquemas[o[1]]}.${o[0]}`) : []
    check('autocompletado: los nombres de public, no los de ventas', idx.ok && nomIdx.includes('public.cliente') && !nomIdx.includes('ventas.factura'), nomIdx.join(','))
    const antes = eventos.length
    const cambiosAntes = cambios
    const fij = await ex.fijarEsquemas('c1', { modo: 'todos' })
    const evCat = eventos.slice(antes).find((e) => e.canal === DBX_CHANNELS.EV_CATALOGO)?.payload as DbEventoCatalogo | undefined
    check('fijar «Todos»: persiste, emite db:changed y dbx:ev:catalogo', fij.ok && fij.valor.esquemas?.modo === 'todos' && cambios === cambiosAntes + 1 && evCat?.motivo === 'esquemas', JSON.stringify(evCat))
    const esq2 = await ex.esquemas('c1')
    check('con «Todos»: N = M', esq2.ok && esq2.valor.nVisibles === esq2.valor.esquemas.length, esq2.ok ? `${esq2.valor.nVisibles} de ${esq2.valor.esquemas.length}` : '')
    const idx2 = await ex.nombres('c1')
    const nomIdx2 = idx2.ok ? idx2.valor.objetos.map((o) => `${idx2.valor.esquemas[o[1]]}.${o[0]}`) : []
    check('índice en «Todos»: ventas sí, los del sistema no', nomIdx2.includes('ventas.factura') && !nomIdx2.some((n) => n.startsWith('pg_catalog.')), `${nomIdx2.length} nombres`)
    const refr = eventos.length
    ex.refrescar('c1', 'public')
    const evRef = eventos.slice(refr).find((e) => e.canal === DBX_CHANNELS.EV_CATALOGO)?.payload as DbEventoCatalogo | undefined
    check('Refrescar emite el evento de catálogo (síncrono)', evRef?.motivo === 'refrescar' && evRef.esquema === 'public', JSON.stringify(evRef))

    hr('(2) Consola: 3 SELECT, UPDATE')
    const consola = await ex.crearConsola(PERFIL, 'c1')
    check('crear consola (consola_1)', consola.ok && consola.valor.nombre === 'consola_1', JSON.stringify(consola))
    const k1 = consola.ok ? consola.valor.id : ''
    let n = 0
    const ejecutar = (sql: string, consolaId = k1, maxFilas = 500): Promise<Awaited<ReturnType<ExploradorController['ejecutar']>>> =>
      ex.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `x${++n}`, sql, maxFilas })
    const r1 = await ejecutar('select * from cliente')
    const r2 = await ejecutar('select * from pedido;')
    const r3 = await ejecutar('select * from linea')
    const tres = [r1, r2, r3].map((r) => (r.ok ? filasDe(r.valor).length : -1))
    check('3 SELECT = 3 resultados (3, 3 y 2 filas)', tres.join(',') === '3,3,2', tres.join(','))
    const celdas = r1.ok ? filasDe(r1.valor) : []
    check('celdas exactas: numeric de 37 dígitos y el emoji', celdas[0]?.[2] === '12345678901234567890123456789012345.67' && celdas[2]?.[1] === 'Ñandú 😀', JSON.stringify(celdas[0]?.[2]))
    const up = await ejecutar('update cliente set nombre = nombre where id = 1')
    check('UPDATE = 1 fila afectada', up.ok && up.valor.tipo === 'afectadas' && up.valor.filas === 1 && up.valor.comando === 'UPDATE', JSON.stringify(up.ok ? up.valor : up))

    hr('(3) Dos sentencias pegadas -> ✗ en su posición')
    const pegadas = 'select * from cliente\nselect * from pedido'
    const rp = await ejecutar(pegadas)
    const ep = rp.ok && rp.valor.tipo === 'error' ? rp.valor.error : null
    check('error del servidor con la posición de la segunda select', ep?.motivo === 'servidor' && ep.posicion === pegadas.indexOf('select', 1), JSON.stringify(ep))
    // Sin `position`: el RAISE de un DO solo trae `where` («… line 2 at RAISE»).
    const bloque = "DO $$ BEGIN\n  RAISE EXCEPTION 'x';\nEND $$"
    const rd = await ejecutar(bloque)
    const ed = rd.ok && rd.valor.tipo === 'error' ? rd.valor.error : null
    check('error dentro de un DO: la posición cae en la línea del RAISE', ed?.motivo === 'servidor' && ed.posicion === bloque.indexOf('RAISE'), JSON.stringify(ed))

    hr('(4) Transacción manual vista desde la sesión meta')
    const ref = { perfilId: PERFIL, consolaId: k1 }
    const deMeta = async (): Promise<string> => {
      const filas = await ex.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'SELECT saldo::text FROM cliente WHERE id = 2', binds: [] }))
      return String(filas[0]?.[0])
    }
    const man = await ex.modoTx(ref.perfilId, ref.consolaId, 'manual')
    check('pasar a Manual', man.ok && man.valor.txModo === 'manual', JSON.stringify(man.ok ? man.valor.txModo : man))
    await ejecutar('update cliente set saldo = 99 where id = 2')
    let est = ex.estadoConsola(PERFIL, k1)
    check('tras el UPDATE: tx pendiente, 1 sentencia', est?.tx === 'pendiente' && est.sentenciasEnTx === 1, JSON.stringify(est && { tx: est.tx, n: est.sentenciasEnTx }))
    check('meta NO ve el cambio sin confirmar', (await deMeta()) === '-0.50', 'sigue -0.50')
    const commit = await ex.tx(PERFIL, k1, 'commit')
    check('Commit: tx ninguna y meta ve 99.00', commit.ok && commit.valor.tx === 'ninguna' && (await deMeta()) === '99.00', JSON.stringify(commit.ok ? commit.valor.tx : commit))
    await ejecutar('update cliente set saldo = 7 where id = 2')
    const rb = await ex.tx(PERFIL, k1, 'rollback')
    check('Rollback: el valor sigue en 99.00', rb.ok && rb.valor.tx === 'ninguna' && (await deMeta()) === '99.00', JSON.stringify(rb.ok ? rb.valor.tx : rb))
    await ejecutar('update cliente set saldo = 8 where id = 2')
    await ejecutar('select columna_rota from cliente')
    est = ex.estadoConsola(PERFIL, k1)
    check('un error en la tx la deja fallida (estado real del servidor)', est?.tx === 'fallida', JSON.stringify(est?.tx))
    // PG convertiría el COMMIT en ROLLBACK y lo daría por bueno: se rechaza sin enviarlo.
    const cf = await ex.tx(PERFIL, k1, 'commit')
    est = ex.estadoConsola(PERFIL, k1)
    check(
      'Commit de una tx fallida: rechazado (solo se puede revertir) y sigue fallida',
      !cf.ok && cf.error.motivo === 'txPendiente' && /solo se puede revertir/.test(cf.error.mensaje) && est?.tx === 'fallida',
      JSON.stringify(cf.ok ? cf.valor.tx : cf.error)
    )
    const auto = await ex.modoTx(PERFIL, k1, 'auto')
    check('Manual -> Auto con tx fallida exige resolver', !auto.ok && auto.error.motivo === 'txPendiente', JSON.stringify(auto))
    const auto2 = await ex.modoTx(PERFIL, k1, 'auto', 'rollback')
    check('con resolver=rollback: Auto y sin tx', auto2.ok && auto2.valor.txModo === 'auto' && auto2.valor.tx === 'ninguna' && (await deMeta()) === '99.00', JSON.stringify(auto2.ok ? auto2.valor : auto2))

    hr('(5) Stop de pg_sleep(30)')
    const t0 = Date.now()
    const larga = ex.ejecutar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga', sql: 'select pg_sleep(30)', maxFilas: 500 })
    await dormir(600)
    ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId: 'otra' })
    ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga' })
    const rl = await larga
    const dt = Date.now() - t0
    check('cancelada en menos de 5 s', rl.ok && rl.valor.tipo === 'error' && rl.valor.error.motivo === 'cancelada' && dt < 5000, `${rl.ok ? rl.valor.tipo : 'ok:false'} en ${dt} ms`)
    const tras = await ejecutar('select 42')
    check('ningún cancel tardío cae en la siguiente', tras.ok && JSON.stringify(filasDe(tras.valor)) === '[["42"]]', JSON.stringify(tras.ok ? filasDe(tras.valor) : tras))

    hr('(6) Solo lectura: en el main y en el servidor')
    const consolaRo = await ex.crearConsola(PERFIL, 'ro')
    const kr = consolaRo.ok ? consolaRo.valor.id : ''
    const upRo = await ejecutar('update cliente set saldo = 0', kr)
    check('el main rechaza el UPDATE sin enviarlo', !upRo.ok && upRo.error.motivo === 'soloLectura', JSON.stringify(upRo))
    await ejecutar("select set_config('default_transaction_read_only', 'off', false)", kr)
    const nv = await ejecutar("select nextval('seq_facturas')", kr)
    const env = nv.ok && nv.valor.tipo === 'error' ? nv.valor.error : null
    // ok:true + error = llegó al servidor, y fue ÉL quien lo rechazó (25006,
    // read_only_sql_transaction, que el trabajador clasifica como solo lectura).
    check(
      'el servidor rechaza nextval() aunque se intente desactivar el candado',
      nv.ok && env?.motivo === 'soloLectura' && env.codigo === '25006',
      JSON.stringify(env)
    )
    const sp = await ejecutar('set search_path to ventas, public', kr)
    const estRo = ex.estadoConsola(PERFIL, kr)
    check('SET de la lista blanca: pasa y el esquema se relee', sp.ok && estRo?.esquema === 'ventas' && estRo.soloLectura, JSON.stringify(estRo && { esquema: estRo.esquema, ro: estRo.soloLectura }))

    hr('(7) Paginado de generate_series(1,1234) y Contar')
    const gs = await ejecutar('select * from generate_series(1,1234)')
    const p1 = gs.ok && gs.valor.tipo === 'filas' ? gs.valor : null
    const lector = p1?.lector ?? ''
    check('página 1: 500 filas, hay más, lector', p1 !== null && filasDe(p1).length === 500 && p1.pagina.hayMas && !!lector, JSON.stringify(p1 && { n: filasDe(p1).length, hayMas: p1.pagina.hayMas, lector }))
    const cnt = await ex.contar(lector, 'cuenta')
    check('Contar: 1234', cnt.ok && cnt.valor === 1234, JSON.stringify(cnt))
    const p2 = await ex.leerMas(lector, 500)
    const f2 = p2.ok ? (JSON.parse(p2.valor.filasJson) as unknown[][]) : []
    check('página 2: desde 500, 500 filas (501…1000), hay más', p2.ok && p2.valor.desde === 500 && f2.length === 500 && f2[0]?.[0] === '501' && p2.valor.hayMas, JSON.stringify(p2.ok ? { desde: p2.valor.desde, n: f2.length, primera: f2[0] } : p2))
    const p3 = await ex.leerMas(lector, 500)
    const f3 = p3.ok ? (JSON.parse(p3.valor.filasJson) as unknown[][]) : []
    check('página 3: 234 filas (…1234) y fin', p3.ok && f3.length === 234 && f3[233]?.[0] === '1234' && !p3.valor.hayMas, JSON.stringify(p3.ok ? { n: f3.length, ultima: f3[233] } : p3))

    hr('(8) Pestaña de tabla')
    const tb = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't1', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, where: 'id > 1', maxFilas: 500 })
    const tf = tb.ok && tb.valor.resultado.tipo === 'filas' ? tb.valor.resultado : null
    const ids = tf ? (JSON.parse(tf.pagina.filasJson) as unknown[][]).map((f) => f[0]) : []
    check('WHERE válido, PK conocida y orden por PK', tb.ok && JSON.stringify(ids) === '["2","3"]' && JSON.stringify(tb.valor.clavePrimaria) === '["id"]', JSON.stringify(tb.ok ? { ids, pk: tb.valor.clavePrimaria } : tb))
    const mal = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't2', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, where: 'id = ', maxFilas: 500 })
    const me = mal.ok && mal.valor.resultado.tipo === 'error' ? mal.valor.resultado.error : null
    check('WHERE inválido: error del servidor atribuido al campo where', me?.campo === 'where' && typeof me.posicion === 'number', JSON.stringify(me))
    const local = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't3', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, where: 'true); delete from cliente; select (1', maxFilas: 500 })
    const le = local.ok && local.valor.resultado.tipo === 'error' ? local.valor.resultado.error : null
    check('escape por paréntesis y «;»: rechazado en el main (campo where)', le?.campo === 'where' && (await deMeta()) === '99.00', JSON.stringify(le))

    hr('(9) pg_terminate_backend -> perdida y reapertura perezosa')
    const c3 = await ex.crearConsola(PERFIL, 'c1')
    const c4 = await ex.crearConsola(PERFIL, 'c1')
    const k3 = c3.ok ? c3.valor.id : ''
    const k4 = c4.ok ? c4.valor.id : ''
    const pidR = await ejecutar('select pg_backend_pid()', k3)
    const pid = pidR.ok ? String(filasDe(pidR.valor)[0]?.[0]) : ''
    await ejecutar(`select pg_terminate_backend(${pid})`, k4)
    let perdida: DbEstadoSesion | null = null
    for (let i = 0; i < 50 && !perdida; i++) {
      const e = ex.estadoConsola(PERFIL, k3)
      if (e?.fase === 'perdida') perdida = e
      else await dormir(100)
    }
    check('la sesión ociosa pasa a perdida (evento del trabajador)', perdida !== null && perdida.aviso?.tipo === 'perdida', JSON.stringify(perdida?.aviso))
    const emitida = eventos.some((e) => e.canal === DBX_CHANNELS.EV_SESION && (e.payload as DbEstadoSesion).fase === 'perdida')
    check('y se emitió por dbx:ev:sesion', emitida, String(emitida))
    const re = await ejecutar('select 7', k3)
    const pidNuevo = re.ok ? await ejecutar('select pg_backend_pid()', k3) : re
    check('la siguiente reabre sola y funciona (otro backend)', re.ok && JSON.stringify(filasDe(re.valor)) === '[["7"]]' && pidNuevo.ok && String(filasDe(pidNuevo.valor)[0]?.[0]) !== pid, JSON.stringify(re.ok ? filasDe(re.valor) : re))

    hr('(9b) Desconectar con «Confirmar»: una consola pendiente y otra fallida')
    // En BLOQUE, «Confirmar» confirma la pendiente y REVIERTE la fallida (PG convertiría
    // su COMMIT en ROLLBACK igualmente). Antes, desconectar se paraba al topar con la
    // fallida: error, y la conexión seguía conectada con la pendiente a medio resolver.
    const c5 = await ex.crearConsola(PERFIL, 'c1')
    const c6 = await ex.crearConsola(PERFIL, 'c1')
    const k5 = c5.ok ? c5.valor.id : ''
    const k6 = c6.ok ? c6.valor.id : ''
    await ex.modoTx(PERFIL, k5, 'manual')
    await ex.modoTx(PERFIL, k6, 'manual')
    // Filas distintas: ninguna de las dos transacciones espera un bloqueo de la otra.
    await ejecutar('update cliente set saldo = 55 where id = 3', k5)
    await ejecutar('update cliente set saldo = 66 where id = 1', k6)
    await ejecutar('select columna_rota from cliente', k6)
    const e5 = ex.estadoConsola(PERFIL, k5)
    const e6 = ex.estadoConsola(PERFIL, k6)
    check('preparación: una consola con tx pendiente y otra fallida', e5?.tx === 'pendiente' && e6?.tx === 'fallida', `${e5?.tx} / ${e6?.tx}`)
    const desc = await ex.desconectar('c1', 'commit')
    const rev0 = desc.ok ? desc.valor.revertidasFallidas?.[0] : undefined
    check(
      'desconectar con «Confirmar»: ok, y la fallida (solo ella) vuelve como revertida',
      desc.ok && desc.valor.revertidasFallidas?.length === 1 && rev0?.rol === 'consola' && rev0.consolaId === k6,
      JSON.stringify(desc)
    )
    const saldo = async (id: number): Promise<string> => {
      const filas = await ex.gestor.catalogo('c1', (ctx) =>
        ctx.consultar({ sql: 'SELECT saldo::text FROM cliente WHERE id = $1', binds: [id] })
      )
      return String(filas[0]?.[0])
    }
    const s3 = await saldo(3)
    check('en el servidor, la pendiente quedó CONFIRMADA (id 3 = 55.00)', s3 === '55.00', s3)
    const s1 = await saldo(1)
    check('y la fallida REVERTIDA (el UPDATE de id 1 no llegó)', s1 === '12345678901234567890123456789012345.67', s1)

    hr('(12) Ver DDL, y la definición de índices y restricciones en el detalle')
    const ddlDe = async (objeto: { esquema: string; nombre: string; tipo: DbTipoObjeto; firma?: string }): Promise<string> => {
      const r = await ex.ddl('c1', objeto)
      return r.ok && r.valor.partes[0]?.titulo === 'DDL' ? r.valor.partes[0].texto : `✗ ${JSON.stringify(r)}`
    }
    const ddlCli = await ddlDe({ esquema: 'public', nombre: 'cliente', tipo: 'tabla' })
    check(
      'tabla: CREATE TABLE con columnas, NOT NULL, la PK de pg_get_constraintdef y los comentarios',
      ddlCli.startsWith('CREATE TABLE public.cliente (') && ddlCli.includes('    nombre text NOT NULL,') &&
        ddlCli.includes('CONSTRAINT cliente_pkey PRIMARY KEY (id)') && ddlCli.includes("COMMENT ON TABLE public.cliente IS 'Clientes de O''Brien';") &&
        ddlCli.includes("COMMENT ON COLUMN public.cliente.nombre IS 'Nombre visible';") && !ddlCli.includes('CREATE UNIQUE INDEX cliente_pkey'),
      ddlCli
    )
    const ddlPed = await ddlDe({ esquema: 'public', nombre: 'pedido', tipo: 'tabla' })
    check(
      'tabla con serial, FK e índice propio (y sin el de la PK)',
      ddlPed.includes("id integer DEFAULT nextval('pedido_id_seq'::regclass) NOT NULL") && ddlPed.includes('FOREIGN KEY (cliente_id) REFERENCES cliente(id)') &&
        ddlPed.includes('CREATE INDEX ix_pedido_cliente ON public.pedido USING btree (cliente_id);') && !ddlPed.includes('pedido_pkey ON'),
      ddlPed
    )
    const ddlV = await ddlDe({ esquema: 'public', nombre: 'v_clientes_activos', tipo: 'vista' })
    check('vista: CREATE OR REPLACE VIEW con pg_get_viewdef y un solo ;', ddlV.startsWith('CREATE OR REPLACE VIEW public.v_clientes_activos AS\n') && /WHERE activo;$|WHERE cliente\.activo;$/.test(ddlV) && !ddlV.includes(';;'), ddlV)
    const ddlSq = await ddlDe({ esquema: 'public', nombre: 'seq_facturas', tipo: 'secuencia' })
    check('secuencia: AS bigint, START WITH 1000', ddlSq.startsWith('CREATE SEQUENCE public.seq_facturas\n    AS bigint\n    START WITH 1000'), ddlSq)
    const ddlSerial = await ddlDe({ esquema: 'public', nombre: 'pedido_id_seq', tipo: 'secuencia' })
    check('la secuencia de un serial dice de quién es (OWNED BY)', ddlSerial.includes('ALTER SEQUENCE public.pedido_id_seq OWNED BY public.pedido.id;'), ddlSerial)
    const ddlFn = await ddlDe({ esquema: 'public', nombre: 'doble', tipo: 'rutina', firma: 'x integer' })
    check('función: pg_get_functiondef por nombre Y firma, con su ;', ddlFn.startsWith('CREATE OR REPLACE FUNCTION public.doble(x integer)') && ddlFn.endsWith(';'), ddlFn)
    const ddlEnum = await ddlDe({ esquema: 'extra', nombre: 'estado', tipo: 'tipo' })
    const ddlDom = await ddlDe({ esquema: 'extra', nombre: 'positivo', tipo: 'tipo' })
    check(
      'tipos: enum y dominio con su CHECK',
      ddlEnum === "CREATE TYPE extra.estado AS ENUM (\n    'activo',\n    'baja'\n);" && ddlDom.startsWith('CREATE DOMAIN extra.positivo AS integer') && ddlDom.includes('CHECK ((VALUE > 0))'),
      `${ddlEnum} | ${ddlDom}`
    )
    const detDef = await ex.detalle('c1', { esquema: 'public', nombre: 'pedido', tipo: 'tabla' }, ['indices', 'restricciones'])
    const ixDef = detDef.ok ? detDef.valor.indices?.find((i) => i.nombre === 'ix_pedido_cliente')?.definicion : undefined
    const fkDef = detDef.ok ? detDef.valor.restricciones?.find((r) => r.tipo === 'fk')?.definicion : undefined
    check('detalle: los índices y restricciones de PG traen `definicion`', ixDef === 'CREATE INDEX ix_pedido_cliente ON public.pedido USING btree (cliente_id)' && fkDef === 'FOREIGN KEY (cliente_id) REFERENCES cliente(id)', `${ixDef} | ${fkDef}`)
    const ddlNo = await ex.ddl('c1', { esquema: 'public', nombre: 'no_existe', tipo: 'tabla' })
    check('un objeto que no existe: sin partes y con aviso (no un error)', ddlNo.ok && ddlNo.valor.partes.length === 0 && !!ddlNo.valor.aviso, JSON.stringify(ddlNo))
    // El «Refrescar» de la PESTAÑA DDL. Un ALTER hecho FUERA de Tessera (psql por
    // `docker exec`: no pasa por `alDdl`) no invalida la caché, que no tiene TTL. La
    // apertura normal sigue en la caché (es lo documentado), y `refrescar` va al servidor
    // y guarda lo nuevo. Antes el botón recibía el CREATE viejo.
    const fuera = (sql: string): string => {
      const r = docker(['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], sql)
      return r.ok ? 'ok' : r.err
    }
    const refRefresco = { esquema: 'extra', nombre: 'ddl_refresco', tipo: 'tabla' as const }
    const refVecina = { esquema: 'extra', nombre: 'ddl_vecina', tipo: 'tabla' as const }
    const creadasFuera = fuera('CREATE TABLE extra.ddl_refresco (id int PRIMARY KEY); CREATE TABLE extra.ddl_vecina (id int PRIMARY KEY);')
    const ddlAntes = await ddlDe(refRefresco)
    const vecinaAntes = await ddlDe(refVecina)
    const alterFuera = fuera('ALTER TABLE extra.ddl_refresco ADD COLUMN nota_nueva text; ALTER TABLE extra.ddl_vecina ADD COLUMN otra_nueva text;')
    const ddlCacheado = await ddlDe(refRefresco)
    check(
      'DDL tras un ALTER hecho FUERA: la apertura normal sigue saliendo de la caché (sin TTL)',
      creadasFuera === 'ok' && alterFuera === 'ok' && ddlAntes.startsWith('CREATE TABLE extra.ddl_refresco (') &&
        !ddlAntes.includes('nota_nueva') && ddlCacheado === ddlAntes,
      `${creadasFuera} / ${alterFuera} | ${ddlCacheado}`
    )
    const evAntesRefresco = eventos.filter((e) => e.canal === DBX_CHANNELS.EV_CATALOGO).length
    const rRefrescado = await ex.ddl('c1', refRefresco, true)
    const ddlRefrescado = rRefrescado.ok && rRefrescado.valor.partes[0]?.titulo === 'DDL' ? rRefrescado.valor.partes[0].texto : `✗ ${JSON.stringify(rRefrescado)}`
    check('DDL: el Refrescar de la pestaña (`refrescar`) va al servidor y trae la columna nueva', ddlRefrescado.includes('    nota_nueva text'), ddlRefrescado)
    const ddlLuego = await ddlDe(refRefresco)
    check('DDL: y lo GUARDA: la siguiente apertura normal ya ve la columna', ddlLuego === ddlRefrescado && ddlLuego.includes('nota_nueva'), ddlLuego)
    const vecinaLuego = await ddlDe(refVecina)
    const evTrasRefresco = eventos.filter((e) => e.canal === DBX_CHANNELS.EV_CATALOGO).length
    check(
      'DDL: NEGATIVO: refrescar UN objeto no invalida el esquema (la vecina sigue en caché) ni repinta el árbol (sin EV_CATALOGO)',
      vecinaLuego === vecinaAntes && !vecinaLuego.includes('otra_nueva') && evTrasRefresco === evAntesRefresco,
      `vecina ${vecinaLuego === vecinaAntes ? 'igual' : vecinaLuego} · EV_CATALOGO ${evAntesRefresco} -> ${evTrasRefresco}`
    )

    // Y la FUENTE («Ver definición» de una vista): el mismo `refrescar`, que le faltaba
    // desde la primera entrega. Un CREATE OR REPLACE hecho fuera no la invalida.
    const refVistaFuera = { esquema: 'extra', nombre: 'v_refresco', tipo: 'vista' as const }
    const textoFuente = (r: Awaited<ReturnType<typeof ex.fuente>>): string =>
      r.ok ? r.valor.partes.map((p) => p.texto).join('\n') : `✗ ${JSON.stringify(r)}`
    const vistaCreada = fuera('CREATE VIEW extra.v_refresco AS SELECT 1 AS primera;')
    const fuenteAntes = textoFuente(await ex.fuente('c1', refVistaFuera))
    const vistaCambiada = fuera('CREATE OR REPLACE VIEW extra.v_refresco AS SELECT 1 AS primera, 2 AS segunda_nueva;')
    const fuenteCacheada = textoFuente(await ex.fuente('c1', refVistaFuera))
    const fuenteRefrescada = textoFuente(await ex.fuente('c1', refVistaFuera, true))
    const fuenteLuego = textoFuente(await ex.fuente('c1', refVistaFuera))
    check(
      'FUENTE: tras un CREATE OR REPLACE hecho fuera, la apertura sigue en caché y `refrescar` trae la definición nueva y la guarda',
      vistaCreada === 'ok' && vistaCambiada === 'ok' && fuenteAntes.includes('primera') && !fuenteAntes.includes('segunda_nueva') &&
        fuenteCacheada === fuenteAntes && fuenteRefrescada.includes('segunda_nueva') && fuenteLuego === fuenteRefrescada,
      `${vistaCreada} / ${vistaCambiada} | cacheada=${fuenteCacheada === fuenteAntes} refrescada=${fuenteRefrescada.includes('segunda_nueva')} luego=${fuenteLuego === fuenteRefrescada}`
    )

    hr('(13) Valor completo por la PK (text de más de 64 KiB, bytea, PK int + timestamp)')
    const refDoc = { esquema: 'extra', nombre: 'documento', tipo: 'tabla' as const }
    const tdoc = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'tdoc', objeto: refDoc, maxFilas: 500 })
    const fdoc = tdoc.ok && tdoc.valor.resultado.tipo === 'filas' ? tdoc.valor.resultado : null
    const filaDoc = fdoc ? (JSON.parse(fdoc.pagina.filasJson) as Array<Array<string | null>>)[0] : []
    const recDoc = fdoc?.pagina.recortes ?? []
    check(
      'la rejilla lo recibe recortado (64 Ki de texto, 32 KiB de bytea) y con la PK compuesta',
      recDoc.some((r) => r[1] === 2 && r[2] === 120003) && recDoc.some((r) => r[1] === 3 && r[2] === 70000) && tdoc.ok && JSON.stringify(tdoc.valor.clavePrimaria) === '["id","creado"]',
      JSON.stringify({ recDoc, pk: tdoc.ok ? tdoc.valor.clavePrimaria : null, creado: filaDoc[1] })
    )
    const clave = [filaDoc[0] ?? null, filaDoc[1] ?? null]
    const vTexto = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave, columna: 'cuerpo' })
    const esperadoTexto = 'ñ😀'.repeat(40000) + 'FIN'
    check(
      'VALOR: el text ENTERO por su PK (int y timestamp como texto del bind), longitud UTF-16',
      vTexto.ok && vTexto.valor.valor === esperadoTexto && vTexto.valor.longitud === esperadoTexto.length && !vTexto.valor.recortado && vTexto.valor.tipoLogico === 'texto',
      JSON.stringify(vTexto.ok ? { longitud: vTexto.valor.longitud, recortado: vTexto.valor.recortado, fin: vTexto.valor.valor?.slice(-3) } : vTexto)
    )
    const vBin = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave, columna: 'bin' })
    check(
      'VALOR: el bytea entero como 0x… y su longitud en bytes',
      vBin.ok && vBin.valor.valor === '0x' + 'AB'.repeat(70000) && vBin.valor.longitud === 70000 && vBin.valor.tipoLogico === 'binario',
      JSON.stringify(vBin.ok ? { longitud: vBin.valor.longitud, n: vBin.valor.valor?.length } : vBin)
    )
    const vDesde = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: ['1', '2024-03-31 02:30:00.9'], columna: 'cuerpo' })
    check('la fila ya no existe (otra clave): error claro', !vDesde.ok && vDesde.error.motivo === 'noReleible' && /ya no existe/.test(vDesde.error.mensaje), JSON.stringify(vDesde))
    const vSinPk = await ex.valor({ conexionId: 'c1', objeto: { esquema: 'extra', nombre: 'sin_pk', tipo: 'tabla' }, clave: ['1'], columna: 'y' })
    check('sin PK: rechazado', !vSinPk.ok && /clave primaria/.test(vSinPk.error.mensaje), JSON.stringify(vSinPk))
    const vCol = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave, columna: 'no_existe' })
    const vClave = await ex.valor({ conexionId: 'c1', objeto: refDoc, clave: ['1'], columna: 'cuerpo' })
    check('columna inventada o clave de otro tamaño: rechazado sin tocar el servidor', !vCol.ok && !vClave.ok && /no cuadra/.test(vClave.error.mensaje), `${vCol.ok ? '' : vCol.error.mensaje} | ${vClave.ok ? '' : vClave.error.mensaje}`)

    hr('(13b) Valor de un resultado de CONSOLA: en su sesión, que ve la tx sin confirmar')
    // Antes se leía en `datos`, que solo ve lo confirmado: en Manual, una fila recién
    // insertada «ya no existía» y una actualizada daba el valor VIEJO sin avisar.
    const sembrarNota = docker(
      ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
      "CREATE TABLE extra.nota (id int PRIMARY KEY, cuerpo text);\nINSERT INTO extra.nota VALUES (1, 'viejo-confirmado');"
    )
    check('siembra de extra.nota', sembrarNota.ok, sembrarNota.ok ? 'ok' : sembrarNota.err)
    const nNota = await ex.crearConsola(PERFIL, 'c1')
    const kN = nNota.ok ? nNota.valor.id : ''
    await ex.modoTx(PERFIL, kN, 'manual')
    const insN = await ejecutar("insert into extra.nota values (2, repeat('x', 70000))", kN)
    const updN = await ejecutar("update extra.nota set cuerpo = repeat('n', 70000) where id = 1", kN)
    const selN = await ejecutar('select id, cuerpo from extra.nota order by id', kN)
    const recN = selN.ok && selN.valor.tipo === 'filas' ? (selN.valor.pagina.recortes ?? []) : []
    check(
      'Manual: INSERT y UPDATE sin confirmar, que la rejilla de la consola ve recortados',
      insN.ok && updN.ok && ex.estadoConsola(PERFIL, kN)?.tx === 'pendiente' && recN.length === 2 && recN.every((r) => r[2] === 70000),
      JSON.stringify({ recN, tx: ex.estadoConsola(PERFIL, kN)?.tx })
    )
    const refNota = { esquema: 'extra', nombre: 'nota', tipo: 'tabla' as const }
    const deKN = { perfilId: PERFIL, consolaId: kN }
    const vIns = await ex.valor({ conexionId: 'c1', objeto: refNota, clave: ['2'], columna: 'cuerpo', consola: deKN })
    check(
      'con su consola: la fila INSERTADA sin confirmar existe y trae sus 70 000 caracteres',
      vIns.ok && vIns.valor.valor === 'x'.repeat(70000) && vIns.valor.longitud === 70000 && !vIns.valor.recortado,
      JSON.stringify(vIns.ok ? { longitud: vIns.valor.longitud } : vIns)
    )
    const vUpd = await ex.valor({ conexionId: 'c1', objeto: refNota, clave: ['1'], columna: 'cuerpo', consola: deKN })
    check(
      'con su consola: la fila ACTUALIZADA da el valor NUEVO, no el confirmado',
      vUpd.ok && vUpd.valor.valor === 'n'.repeat(70000) && vUpd.valor.longitud === 70000,
      JSON.stringify(vUpd.ok ? { longitud: vUpd.valor.longitud, inicio: vUpd.valor.valor?.slice(0, 5) } : vUpd)
    )
    const vInsDatos = await ex.valor({ conexionId: 'c1', objeto: refNota, clave: ['2'], columna: 'cuerpo' })
    const vUpdDatos = await ex.valor({ conexionId: 'c1', objeto: refNota, clave: ['1'], columna: 'cuerpo' })
    check(
      'sin consola (la pestaña de tabla, en `datos`): lo confirmado, como antes',
      !vInsDatos.ok && vInsDatos.error.motivo === 'noReleible' && vUpdDatos.ok && vUpdDatos.valor.valor === 'viejo-confirmado',
      JSON.stringify({ ins: vInsDatos.ok ? 'ok' : vInsDatos.error.motivo, upd: vUpdDatos.ok ? vUpdDatos.valor.valor : vUpdDatos })
    )
    const cuentaNota = Number((await ex.gestor.catalogo('c1', (c) => c.consultar({ sql: 'SELECT count(*)::int FROM extra.nota', binds: [] })))[0]?.[0])
    check(
      'leer el valor no confirma ni revierte nada: la tx sigue pendiente y fuera no se ve',
      ex.estadoConsola(PERFIL, kN)?.tx === 'pendiente' && ex.estadoConsola(PERFIL, kN)?.fase === 'lista' && cuentaNota === 1,
      JSON.stringify({ tx: ex.estadoConsola(PERFIL, kN)?.tx, cuentaNota })
    )
    const nNotaRo = await ex.crearConsola(PERFIL, 'ro')
    const kNRo = nNotaRo.ok ? nNotaRo.valor.id : ''
    const vAjena = await ex.valor({ conexionId: 'c1', objeto: refNota, clave: ['1'], columna: 'cuerpo', consola: { perfilId: PERFIL, consolaId: kNRo } })
    check('una consola de OTRA conexión: rechazada', !vAjena.ok && /no es de esta conexión/.test(vAjena.error.mensaje), JSON.stringify(vAjena))
    const rbN = await ex.modoTx(PERFIL, kN, 'auto', 'rollback')
    check('y al revertir, todo como estaba', rbN.ok && rbN.valor.tx === 'ninguna', JSON.stringify(rbN.ok ? rbN.valor.tx : rbN))

    hr('(14) Exportar: los tres orígenes y los cinco formatos, en disco')
    const leerExportado = (archivo: string | undefined): string => {
      const ruta = path.join(exportados, archivo ?? '?')
      return existsSync(ruta) ? readFileSync(ruta, 'utf8') : '(no existe)'
    }
    const partes = (): string[] => readdirSync(exportados).filter((f) => f.endsWith('.part'))
    const tCli = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'tcli', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, maxFilas: 500 })
    const rCli = tCli.ok && tCli.valor.resultado.tipo === 'filas' ? tCli.valor.resultado : null
    const filasCli = rCli ? (JSON.parse(rCli.pagina.filasJson) as DbCelda[][]) : []
    let nExp = 0
    for (const formato of ['csv', 'tsv', 'json', 'insert', 'markdown'] as const) {
      const r = await ex.exportar({
        peticionId: `exp-t-${++nExp}`,
        origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' } },
        formato,
        nombreSugerido: 'public.cliente',
        tablaInsert: 'public.cliente',
        motor: 'postgres'
      })
      const e = crearEscritor(formato, rCli?.columnas ?? [], {
        motor: 'postgres',
        tablaInsert: 'public.cliente',
        cabecera: true,
        bom: formato === 'csv',
        saltoFinal: formato === 'csv' || formato === 'tsv'
      })
      const esperado = e.inicio() + e.filas(filasCli) + e.fin()
      const escrito = r.ok && r.valor ? leerExportado(r.valor.archivo) : ''
      check(
        `tabla -> ${formato}: el archivo es el de «Copiar como» de lo que enseña la rejilla`,
        r.ok && r.valor !== null && escrito === esperado && r.valor.filas === 3 && !r.valor.archivo.includes('/') && !r.valor.archivo.includes('\\'),
        r.ok ? `${r.valor?.archivo} ${r.valor?.filas} filas ${r.valor?.bytes} bytes` : JSON.stringify(r)
      )
    }
    check('sin temporales', partes().length === 0, readdirSync(exportados).join(','))
    const rDocExp = await ex.exportar({
      peticionId: `exp-t-${++nExp}`,
      origen: { tipo: 'tabla', conexionId: 'c1', objeto: refDoc, where: 'id = 1' },
      formato: 'json',
      nombreSugerido: 'extra.documento',
      motor: 'postgres'
    })
    const jsonDoc = rDocExp.ok && rDocExp.valor ? (JSON.parse(leerExportado(rDocExp.valor.archivo)) as Array<Record<string, string>>) : []
    check(
      'tabla con WHERE: los LOB ENTEROS, sin el recorte de 64 KiB de la rejilla',
      jsonDoc.length === 1 && jsonDoc[0].cuerpo === esperadoTexto && jsonDoc[0].bin === '0x' + 'AB'.repeat(70000) && rDocExp.ok && rDocExp.valor?.recortadas === undefined,
      JSON.stringify(rDocExp)
    )
    const rSinPk = await ex.exportar({
      peticionId: `exp-t-${++nExp}`,
      origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: 'extra', nombre: 'sin_pk', tipo: 'tabla' } },
      formato: 'csv',
      nombreSugerido: 'sin_pk',
      motor: 'postgres'
    })
    // Antes avisaba del orden no estable, que era cierto con LIMIT/OFFSET. Con UNA
    // lectura no hay páginas que repitan o se salten filas: el aviso mentiría.
    check('tabla sin PK ni ORDER BY: exporta, y SIN aviso de orden (es una sola lectura)', rSinPk.ok && rSinPk.valor?.filas === 1 && rSinPk.valor.aviso === undefined, JSON.stringify(rSinPk))
    const dialogosAntes = dialogos.length
    const rMalWhere = await ex.exportar({
      peticionId: `exp-t-${++nExp}`,
      origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, where: 'true); delete from cliente; select (1' },
      formato: 'csv',
      nombreSugerido: 'mal',
      motor: 'postgres'
    })
    check('un WHERE que escapa: rechazado ANTES de abrir el diálogo, con su campo', !rMalWhere.ok && rMalWhere.error.campo === 'where' && dialogos.length === dialogosAntes, JSON.stringify(rMalWhere))
    const rWhereSrv = await ex.exportar({
      peticionId: `exp-t-${++nExp}`,
      origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: 'public', nombre: 'cliente', tipo: 'tabla' }, where: 'no_existe = 1' },
      formato: 'csv',
      nombreSugerido: 'mal2',
      motor: 'postgres'
    })
    check(
      'un WHERE que el SERVIDOR rechaza: su error con el campo y la posición, sin archivo ni temporal',
      !rWhereSrv.ok && rWhereSrv.error.campo === 'where' && rWhereSrv.error.posicion === 0 && !existsSync(path.join(exportados, 'mal2.csv')) && partes().length === 0,
      JSON.stringify(rWhereSrv)
    )

    // --- Tabla de PG: UNA lectura con cursor vivo en una sesión efímera. Antes paginaba
    // con LIMIT/OFFSET en `datos`: coste cuadrático, una instantánea por página y, con
    // empates en el ORDER BY, filas repetidas y perdidas sin ninguna escritura. ---
    const sembrarInst = docker(
      ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
      'CREATE TABLE extra.instantanea (id int PRIMARY KEY, n int NOT NULL);\nINSERT INTO extra.instantanea SELECT g, g % 7 FROM generate_series(1, 12000) g;'
    )
    check('siembra de extra.instantanea (12 000 filas, 7 valores de n)', sembrarInst.ok, sembrarInst.ok ? 'ok' : sembrarInst.err)
    const refInst = { esquema: 'extra', nombre: 'instantanea', tipo: 'tabla' as const }
    const idsDe = (archivo: string | undefined): number[] =>
      leerExportado(archivo)
        .split('\r\n')
        .slice(1)
        .filter((l) => l !== '')
        .map((l) => Number(l.split(',')[0]))
    const conexionesExportar = async (): Promise<string> => {
      let r = ''
      for (let i = 0; i < 30; i++) {
        r = docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador exportar%'"]).out
        if (r === '0') break
        await dormir(100)
      }
      return r
    }
    // Entre la 1.ª página y la 2.ª, otra sesión BORRA 10 filas ya leídas y AÑADE una al
    // final. Con OFFSET, la 2.ª página empezaba 10 filas más allá (se perdían 5001…5010)
    // y traía la nueva; con el cursor, el archivo es la instantánea del principio.
    escribirEn = {
      peticionId: 'exp-inst',
      escritura: 'DELETE FROM extra.instantanea WHERE id <= 10;\nINSERT INTO extra.instantanea VALUES (20000, 0);',
      hecho: false,
      conexiones: ''
    }
    const evAntesInst = eventos.length
    const rInst = await ex.exportar({ peticionId: 'exp-inst', origen: { tipo: 'tabla', conexionId: 'c1', objeto: refInst }, formato: 'csv', nombreSugerido: 'instantanea', motor: 'postgres' })
    const evDatosInst = eventos
      .slice(evAntesInst)
      .filter((e) => e.canal === DBX_CHANNELS.EV_SESION && (e.payload as DbEstadoSesion).ref.rol === 'datos')
    const escrito = escribirEn
    escribirEn = null
    const idsInst = rInst.ok && rInst.valor ? idsDe(rInst.valor.archivo) : []
    check(
      'escrituras de OTRA sesión a media exportación: el archivo es la instantánea del principio (1…12 000, sin huecos ni repetidas ni la fila nueva)',
      escrito.hecho && rInst.ok && rInst.valor?.filas === 12000 && idsInst.length === 12000 && idsInst.every((v, i) => v === i + 1),
      JSON.stringify({ r: rInst.ok ? rInst.valor : rInst, n: idsInst.length, primeros: idsInst.slice(5000, 5003), ultimo: idsInst.at(-1) })
    )
    // Medido: con el portal suspendido el servidor no vuelve a ReadyForQuery, así que
    // pg_stat_activity la enseña `active` (no `idle in transaction`); y el DELETE de
    // arriba pasó sin esperar: AccessShareLock no frena un DML.
    check(
      'mientras exportaba: UNA conexión propia de la exportación, con el portal abierto (active) y AccessShareLock sobre la tabla',
      escrito.conexiones === 'active:AccessShareLock',
      escrito.conexiones
    )
    check('al acabar, esa conexión se cierra', (await conexionesExportar()) === '0', 'ninguna «Tessera/explorador exportar» en pg_stat_activity')
    const datosC1 = ex.gestor.sesiones().filter((x) => x.ref.rol === 'datos' && x.conexionId === 'c1')
    check(
      'ni la efímera se emite ni se lista, ni la sesión `datos` se ocupó (antes, un turno por página)',
      evDatosInst.length === 0 && datosC1.length <= 1,
      JSON.stringify({ eventos: evDatosInst.map((e) => (e.payload as DbEstadoSesion).fase), datos: datosC1.map((x) => x.fase) })
    )
    // Empates: 11 991 filas con 7 valores de n. Con OFFSET, el orden de los empates podía
    // cambiar entre páginas (heapsort acotado frente al sort completo) y repetir unas
    // filas y saltarse otras; una sola lectura las da todas, una vez cada una.
    const rEmp = await ex.exportar({ peticionId: 'exp-emp', origen: { tipo: 'tabla', conexionId: 'c1', objeto: refInst, orderBy: 'n' }, formato: 'csv', nombreSugerido: 'empates', motor: 'postgres' })
    const idsEmp = rEmp.ok && rEmp.valor ? idsDe(rEmp.valor.archivo) : []
    const distintos = new Set(idsEmp)
    check(
      'ORDER BY con empates (7 valores de n): todas las filas actuales, cada una UNA vez',
      rEmp.ok && rEmp.valor?.filas === 11991 && idsEmp.length === 11991 && distintos.size === 11991 && distintos.has(20000) && !distintos.has(10),
      JSON.stringify({ filas: rEmp.ok ? rEmp.valor?.filas : rEmp, distintos: distintos.size })
    )
    // Stop entre páginas: cancelada, sin archivo ni temporal, y la conexión efímera cerrada.
    pararEn = 'exp-inst-stop'
    const rInstStop = await ex.exportar({ peticionId: 'exp-inst-stop', origen: { tipo: 'tabla', conexionId: 'c1', objeto: refInst }, formato: 'csv', nombreSugerido: 'inst_parada', motor: 'postgres' })
    pararEn = null
    check(
      'Stop a media exportación de la tabla: cancelada, sin archivo ni temporal, y su conexión cerrada',
      !rInstStop.ok && rInstStop.error.motivo === 'cancelada' && !existsSync(path.join(exportados, 'inst_parada.csv')) && partes().length === 0 && (await conexionesExportar()) === '0',
      JSON.stringify(rInstStop)
    )
    const tTrasExp = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'tras-exp', objeto: refInst, maxFilas: 500 })
    check('y la pestaña de la tabla sigue funcionando en `datos`', tTrasExp.ok && tTrasExp.valor.resultado.tipo === 'filas', JSON.stringify(tTrasExp.ok ? tTrasExp.valor.resultado.tipo : tTrasExp))
    // Consulta de más de 5000 filas: UN cursor que sigue abierto, sin re-ejecutar.
    const nx = await ex.crearConsola(PERFIL, 'c1')
    const kx = nx.ok ? nx.valor.id : ''
    const antesEjec = Number((await ex.gestor.catalogo('c1', (c) => c.consultar({ sql: 'SELECT count(*)::int FROM extra.ejecuciones', binds: [] })))[0]?.[0])
    const sqlLarga = 'select g, md5(g::text) as h\nfrom generate_series(1, 12345) g, (select extra.registrar()) r\norder by g;'
    const rCons = await ex.exportar({
      peticionId: 'exp-c-1',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kx, sql: sqlLarga },
      formato: 'csv',
      nombreSugerido: 'Resultado 1',
      motor: 'postgres'
    })
    const despuesEjec = Number((await ex.gestor.catalogo('c1', (c) => c.consultar({ sql: 'SELECT count(*)::int FROM extra.ejecuciones', binds: [] })))[0]?.[0])
    const lineasCons = rCons.ok && rCons.valor ? leerExportado(rCons.valor.archivo).split('\r\n') : []
    check(
      'consulta de 12 345 filas (3 páginas de 5000): todas, en orden, y ejecutada UNA sola vez',
      rCons.ok && rCons.valor?.filas === 12345 && lineasCons[0] === String.fromCharCode(0xfeff) + 'g,h' && lineasCons[1].startsWith('1,') && lineasCons[12345].startsWith('12345,') && despuesEjec - antesEjec === 1,
      JSON.stringify({ r: rCons.ok ? rCons.valor : rCons, ejecuciones: despuesEjec - antesEjec, lineas: lineasCons.length })
    )
    const estCons = ex.estadoConsola(PERFIL, kx)
    check('la consola queda libre y sin transacción abierta (el cursor se cerró)', estCons?.fase === 'lista' && estCons.tx === 'ninguna', JSON.stringify(estCons && { fase: estCons.fase, tx: estCons.tx }))
    const dialogosAntesNoRel = dialogos.length
    const rNoRel = await ex.exportar({
      peticionId: 'exp-c-2',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kx, sql: "select nextval('seq_facturas')" },
      formato: 'csv',
      nombreSugerido: 'x',
      motor: 'postgres'
    })
    const rDml = await ex.exportar({
      peticionId: 'exp-c-3',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kx, sql: 'update cliente set saldo = 0' },
      formato: 'csv',
      nombreSugerido: 'x',
      motor: 'postgres'
    })
    check('una consulta con nextval o un UPDATE: noReleible, sin diálogo', !rNoRel.ok && rNoRel.error.motivo === 'noReleible' && !rDml.ok && rDml.error.motivo === 'noReleible' && dialogos.length === dialogosAntesNoRel, `${rNoRel.ok ? '' : rNoRel.error.motivo} / ${rDml.ok ? '' : rDml.error.motivo}`)
    const filasOrigen = [['1', 'a,b'], ['2', null]]
    const rFilas = await ex.exportar({
      peticionId: 'exp-f-1',
      origen: {
        tipo: 'filas',
        columnas: [
          { nombre: 'id', tipoLogico: 'numero', tipoMotor: 'int4' },
          { nombre: 't', tipoLogico: 'texto', tipoMotor: 'text' }
        ],
        filasJson: JSON.stringify(filasOrigen)
      },
      formato: 'insert',
      nombreSugerido: 'Resultado 2',
      tablaInsert: 'destino',
      motor: 'postgres'
    })
    check(
      'filas (lo ya cargado): INSERT tal cual',
      rFilas.ok && leerExportado(rFilas.valor?.archivo) === "INSERT INTO destino (id, t) VALUES (1, 'a,b');\nINSERT INTO destino (id, t) VALUES (2, NULL);\n",
      JSON.stringify(rFilas.ok ? leerExportado(rFilas.valor?.archivo) : rFilas)
    )
    eleccion = null
    const rCancelDlg = await ex.exportar({ peticionId: 'exp-f-2', origen: { tipo: 'filas', columnas: [], filasJson: '[]' }, formato: 'csv', nombreSugerido: 'x', motor: 'postgres' })
    check('cancelar el diálogo: ok con null', rCancelDlg.ok && rCancelDlg.valor === null, JSON.stringify(rCancelDlg))
    eleccion = undefined
    // Stop a media exportación: se pide desde el primer progreso (tras la 1.ª página).
    pararEn = 'exp-c-stop'
    const rStop = await ex.exportar({
      peticionId: 'exp-c-stop',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kx, sql: 'select g from generate_series(1, 30000) g' },
      formato: 'csv',
      nombreSugerido: 'parada',
      motor: 'postgres'
    })
    pararEn = null
    check(
      'Stop a media exportación: cancelada, sin archivo ni temporal, y la consola libre',
      !rStop.ok && rStop.error.motivo === 'cancelada' && !existsSync(path.join(exportados, 'parada.csv')) && partes().length === 0 && ex.estadoConsola(PERFIL, kx)?.fase === 'lista',
      JSON.stringify(rStop)
    )
    // Stop con la lectura EN VUELO (el servidor está ejecutando): CancelRequest.
    const t0Stop = Date.now()
    const enVuelo = ex.exportar({
      peticionId: 'exp-c-vuelo',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kx, sql: 'select pg_sleep(20), 1 as x' },
      formato: 'csv',
      nombreSugerido: 'vuelo',
      motor: 'postgres'
    })
    await dormir(700)
    ex.cancelar({ rol: 'exportacion', peticionId: 'exp-c-vuelo' })
    const rVuelo = await enVuelo
    const trasVuelo = await ejecutar('select 5', kx)
    check(
      'Stop con la consulta corriendo en el servidor: cancelada en < 5 s y la siguiente limpia',
      !rVuelo.ok && rVuelo.error.motivo === 'cancelada' && Date.now() - t0Stop < 5000 && trasVuelo.ok && JSON.stringify(filasDe(trasVuelo.valor)) === '[["5"]]' && partes().length === 0,
      `${JSON.stringify(rVuelo)} en ${Date.now() - t0Stop} ms`
    )
    const progresos = eventos.filter((e) => e.canal === DBX_CHANNELS.EV_EXPORTACION && (e.payload as { peticionId: string }).peticionId === 'exp-c-1')
    check('el progreso llegó por dbx:ev:exportacion (el primero sin esperar)', progresos.length >= 1 && (progresos[0].payload as { filas: number }).filas === 5000, JSON.stringify(progresos.map((p) => p.payload)))

    hr('(15) Salida del servidor: NOTICE y WARNING, también si falla')
    const rNotice = await ejecutar("DO $$ BEGIN RAISE NOTICE 'hola %', 1; RAISE WARNING 'cuidado'; END $$", kx)
    const salidaN = rNotice.ok && rNotice.valor.tipo === 'hecho' ? rNotice.valor.salida : undefined
    check(
      'un DO con RAISE NOTICE y WARNING: ✓ con su salida, el WARNING como aviso',
      JSON.stringify(salidaN) === '[{"texto":"hola 1"},{"texto":"cuidado","aviso":true}]',
      JSON.stringify(rNotice.ok ? rNotice.valor : rNotice)
    )
    const rNoticeErr = await ejecutar("DO $$ BEGIN RAISE NOTICE 'antes del fallo'; RAISE EXCEPTION 'fallo'; END $$", kx)
    check(
      'si falla, la salida viaja en el error',
      rNoticeErr.ok && rNoticeErr.valor.tipo === 'error' && JSON.stringify(rNoticeErr.valor.salida) === '[{"texto":"antes del fallo"}]',
      JSON.stringify(rNoticeErr.ok ? rNoticeErr.valor : rNoticeErr)
    )
    const rMuchas = await ejecutar('DO $$ BEGIN FOR i IN 1..1500 LOOP RAISE NOTICE \'linea %\', i; END LOOP; END $$', kx)
    const salidaM = rMuchas.ok && rMuchas.valor.tipo === 'hecho' ? (rMuchas.valor.salida ?? []) : []
    check(
      'tope: 1000 líneas y una última que dice cuántas se descartaron',
      salidaM.length === 1001 && salidaM[999].texto === 'linea 1000' && salidaM[1000].aviso === true && /se descartaron 500 líneas más/.test(salidaM[1000].texto),
      JSON.stringify(salidaM.slice(-2))
    )
    const rSel = await ejecutar('select 1', kx)
    check('un SELECT sin NOTICE no trae salida', rSel.ok && rSel.valor.tipo === 'filas' && rSel.valor.salida === undefined, 'sin salida')

    hr('(16) Esquema de la consola: fijar, sobrevivir a cerrar y reabrir, degradar')
    const esquemaActual = async (consolaId: string): Promise<string> => {
      const r = await ejecutar('select current_schema()', consolaId)
      return r.ok ? String(filasDe(r.valor)[0]?.[0]) : `✗ ${JSON.stringify(r)}`
    }
    const fijV = await ex.esquemaConsola(PERFIL, kx, 'ventas')
    check('fijar ventas con la sesión abierta: el estado lo trae YA', fijV.ok && fijV.valor.esquema === 'ventas', JSON.stringify(fijV.ok ? fijV.valor.esquema : fijV))
    const fac = await ejecutar('select id from factura', kx)
    const idUuid = await ejecutar("select extra.aviso_ro()", kx)
    check('lo sin calificar se resuelve en ventas; public sigue en el search_path', fac.ok && fac.valor.tipo === 'filas' && idUuid.ok && idUuid.valor.tipo === 'filas', `${JSON.stringify(fac.ok ? fac.valor.tipo : fac)} / ${JSON.stringify(idUuid.ok ? idUuid.valor.tipo : idUuid)}`)
    const evEsq = eventos.some((e) => e.canal === DBX_CHANNELS.EV_SESION && (e.payload as DbEstadoSesion).esquema === 'ventas' && (e.payload as DbEstadoSesion).ref.rol === 'consola')
    check('se emitió dbx:ev:sesion con el esquema nuevo', evEsq, String(evEsq))
    const lst = await ex.listarConsolas(PERFIL)
    check('listarConsolas trae el esquema de la consola (en el índice)', lst.ok && lst.valor.find((c) => c.id === kx)?.esquema === 'ventas', JSON.stringify(lst.ok ? lst.valor.find((c) => c.id === kx) : lst))
    await ex.cerrarSesionConsola(PERFIL, kx)
    check('cerrar y reabrir la sesión: vuelve a ventas', (await esquemaActual(kx)) === 'ventas', 'ventas')
    // Tras reiniciar la app, el índice manda: un controlador NUEVO lo lee del disco.
    const antesSesion = ex.estadoConsola(PERFIL, kx)
    check('la sesión reabierta dice ventas', antesSesion?.esquema === 'ventas', JSON.stringify(antesSesion?.esquema))
    const nula = await ex.esquemaConsola(PERFIL, kx, null)
    check('null: vuelve al de la conexión (public) y se quita del índice', nula.ok && nula.valor.esquema === 'public' && (await esquemaActual(kx)) === 'public' && (await ex.listarConsolas(PERFIL)).ok, JSON.stringify(nula.ok ? nula.valor.esquema : nula))
    const noExiste = await ex.esquemaConsola(PERFIL, kx, 'no_existe')
    const publico = await ex.esquemaConsola(PERFIL, kx, 'PUBLIC')
    check('un esquema que no existe (o PUBLIC): rechazado contra el catálogo', !noExiste.ok && !publico.ok && /no existe/.test(noExiste.error.mensaje), `${noExiste.ok ? '' : noExiste.error.mensaje}`)
    // Consola nueva y CERRADA: el esquema se ve ya y se aplica al abrir.
    const nueva = await ex.crearConsola(PERFIL, 'c1')
    const kn = nueva.ok ? nueva.valor.id : ''
    const fijCerrada = await ex.esquemaConsola(PERFIL, kn, 'ventas')
    check('consola sin sesión: el selector ve ventas y la primera sentencia ya corre allí', fijCerrada.ok && fijCerrada.valor.esquema === 'ventas' && fijCerrada.valor.fase === 'cerrada' && (await esquemaActual(kn)) === 'ventas', JSON.stringify(fijCerrada.ok ? fijCerrada.valor : fijCerrada))
    // PG: un ROLLBACK deshace el SET hecho dentro de la transacción; se vuelve a aplicar.
    await ex.modoTx(PERFIL, kn, 'manual')
    await ejecutar('select 1', kn)
    await ex.esquemaConsola(PERFIL, kn, 'temporal')
    const rb2 = await ex.tx(PERFIL, kn, 'rollback')
    check('Manual: fijar dentro de una tx y revertir -> el esquema elegido sigue (reaplicado)', rb2.ok && rb2.valor.esquema === 'temporal' && (await esquemaActual(kn)) === 'temporal', JSON.stringify(rb2.ok ? rb2.valor.esquema : rb2))
    await ex.tx(PERFIL, kn, 'rollback')
    await ex.modoTx(PERFIL, kn, 'auto', 'rollback')
    // Degradar: el esquema guardado desaparece mientras la sesión está cerrada.
    await ex.cerrarSesionConsola(PERFIL, kn)
    docker(['exec', contenedor, 'psql', '-U', 'postgres', '-qc', 'DROP SCHEMA temporal'])
    const trasBorrar = await ejecutar('select current_schema()', kn)
    const avisos = trasBorrar.ok && trasBorrar.valor.tipo === 'filas' ? (trasBorrar.valor.avisos ?? []) : []
    const lst2 = await ex.listarConsolas(PERFIL)
    check(
      'reabrir con el esquema borrado: vuelve al de la conexión, lo avisa en la Salida y lo olvida en el índice',
      String(filasDe(trasBorrar.ok ? trasBorrar.valor : undefined)[0]?.[0]) === 'public' && avisos.some((a) => /temporal/.test(a) && /ya no existe/.test(a)) &&
        lst2.ok && lst2.valor.find((c) => c.id === kn)?.esquema === undefined && ex.estadoConsola(PERFIL, kn)?.esquema === 'public',
      JSON.stringify({ avisos, esquema: ex.estadoConsola(PERFIL, kn)?.esquema })
    )
    // Ocupada: fijar mientras la consola ejecuta.
    const larga2 = ex.ejecutar({ perfilId: PERFIL, consolaId: kn, ejecucionId: 'larga-esq', sql: 'select pg_sleep(1.5)', maxFilas: 500 })
    await dormir(300)
    const ocup = await ex.esquemaConsola(PERFIL, kn, 'ventas')
    await larga2
    check('fijar mientras la consola ejecuta: ocupada', !ocup.ok && ocup.error.motivo === 'ocupada', JSON.stringify(ocup))

    // --- Un SET a mano manda (hallazgo: cualquier sentencia tx volvía al elegido) ---
    const sembrarEsquemas = docker(
      ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
      [
        'CREATE SCHEMA compras;',
        'CREATE TABLE ventas.pedidos (x int);',
        'CREATE TABLE compras.pedidos (x int);',
        // Dos `clientes` de la MISMA forma, con valores que no se confunden.
        'CREATE TABLE ventas.clientes AS SELECT g AS n FROM generate_series(1, 1200) g;',
        'CREATE TABLE compras.clientes AS SELECT g + 100000 AS n FROM generate_series(1, 1200) g;'
      ].join('\n')
    )
    check('siembra de compras y de los pedidos/clientes gemelos', sembrarEsquemas.ok, sembrarEsquemas.ok ? 'ok' : sembrarEsquemas.err)
    const esquemaDe = (k: string): string | null | undefined => ex.estadoConsola(PERFIL, k)?.esquema
    const cuenta = async (tabla: string): Promise<number> =>
      Number((await ex.gestor.catalogo('c1', (c) => c.consultar({ sql: `SELECT count(*)::int FROM ${tabla}`, binds: [] })))[0]?.[0])
    const nuevaConsola = async (): Promise<string> => {
      const r = await ex.crearConsola(PERFIL, 'c1')
      return r.ok ? r.valor.id : ''
    }
    const kA = await nuevaConsola()
    await ex.esquemaConsola(PERFIL, kA, 'ventas')
    await ejecutar('set search_path to compras, public', kA)
    const trasSet = esquemaDe(kA)
    await ejecutar('begin', kA)
    const trasBegin = esquemaDe(kA)
    const insA = await ejecutar('insert into pedidos values (1)', kA)
    const comA = await ejecutar('commit', kA)
    const enCompras = await cuenta('compras.pedidos')
    const enVentas = await cuenta('ventas.pedidos')
    check(
      'elegido ventas, SET a mano a compras, BEGIN, INSERT, COMMIT: la barra sigue en compras y el INSERT cae en compras.pedidos',
      trasSet === 'compras' && trasBegin === 'compras' && insA.ok && comA.ok && enCompras === 1 && enVentas === 0 && esquemaDe(kA) === 'compras',
      JSON.stringify({ trasSet, trasBegin, enCompras, enVentas, final: esquemaDe(kA) })
    )
    const rbSinTx = await ejecutar('rollback', kA)
    check('un ROLLBACK sin transacción no devuelve a ventas', rbSinTx.ok && esquemaDe(kA) === 'compras' && (await esquemaActual(kA)) === 'compras', `${esquemaDe(kA)}`)
    // La mitad que SÍ reaplica, escrita (la del botón ya está arriba).
    const kE = await nuevaConsola()
    await ex.modoTx(PERFIL, kE, 'manual')
    await ejecutar('select 1', kE)
    await ex.esquemaConsola(PERFIL, kE, 'ventas')
    const rbE = await ejecutar('rollback', kE)
    check('Manual: elegir ventas dentro de la tx y ESCRIBIR rollback -> se vuelve a aplicar', rbE.ok && esquemaDe(kE) === 'ventas' && (await esquemaActual(kE)) === 'ventas', `${esquemaDe(kE)}`)
    await ex.modoTx(PERFIL, kE, 'auto', 'rollback')
    // El botón Revertir tampoco pisa un SET a mano confirmado.
    const kG = await nuevaConsola()
    await ex.esquemaConsola(PERFIL, kG, 'ventas')
    await ejecutar('set search_path to compras, public', kG)
    await ex.modoTx(PERFIL, kG, 'manual')
    await ejecutar('select 1', kG)
    const rbG = await ex.tx(PERFIL, kG, 'rollback')
    check('botón Revertir tras un SET a mano a compras: sigue en compras', rbG.ok && rbG.valor.esquema === 'compras' && (await esquemaActual(kG)) === 'compras', JSON.stringify(rbG.ok ? rbG.valor.esquema : rbG))
    await ex.modoTx(PERFIL, kG, 'auto', 'rollback')

    // --- Un resultado está atado al esquema con el que se ejecutó ---
    const kL = await nuevaConsola()
    await ex.esquemaConsola(PERFIL, kL, 'ventas')
    const sqlCli = 'select n from clientes order by n'
    const rL = await ejecutar(sqlCli, kL)
    const lectorL = rL.ok && rL.valor.tipo === 'filas' ? (rL.valor.lector ?? '') : ''
    check('en ventas: 500 filas de ventas.clientes (1…) y hay más', filasDe(rL.ok ? rL.valor : undefined)[0]?.[0] === '1' && lectorL !== '', JSON.stringify(filasDe(rL.ok ? rL.valor : undefined)[0]))
    await ex.esquemaConsola(PERFIL, kL, 'compras')
    const cntL = await ex.contar(lectorL, 'cnt-l')
    const masL = await ex.leerMas(lectorL, 500)
    check(
      'cambiar el selector a compras: ni «más» ni Contar re-ejecutan (mezclarían compras.clientes)',
      !cntL.ok && cntL.error.motivo === 'noReleible' && !masL.ok && masL.error.motivo === 'noReleible' && /esquema/.test(masL.error.mensaje),
      JSON.stringify({ cnt: cntL, mas: masL.ok ? masL.valor.desde : masL })
    )
    const dlgAntes = dialogos.length
    const expL = await ex.exportar({
      peticionId: 'exp-esquema',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kL, sql: sqlCli, esquema: 'ventas' },
      formato: 'csv',
      nombreSugerido: 'clientes',
      motor: 'postgres'
    })
    check('exportar la consulta de ventas estando en compras: noReleible sin diálogo', !expL.ok && expL.error.motivo === 'noReleible' && dialogos.length === dlgAntes, JSON.stringify(expL))
    await ex.esquemaConsola(PERFIL, kL, 'ventas')
    const rL2 = await ejecutar(sqlCli, kL)
    const lectorL2 = rL2.ok && rL2.valor.tipo === 'filas' ? (rL2.valor.lector ?? '') : ''
    await ex.esquemaConsola(PERFIL, kL, 'compras')
    await ex.esquemaConsola(PERFIL, kL, 'ventas')
    const masL2 = await ex.leerMas(lectorL2, 500)
    const f2L = masL2.ok ? (JSON.parse(masL2.valor.filasJson) as unknown[][]) : []
    check('ir a compras y volver a ventas antes de leer: la página 2 es de ventas (501…)', masL2.ok && f2L[0]?.[0] === '501', JSON.stringify(masL2.ok ? f2L[0] : masL2))

    // --- El esquema pedido ya no existe (la caché lo tenía): vuelve al ANTERIOR ---
    const kQ = await nuevaConsola()
    await ex.esquemaConsola(PERFIL, kQ, 'ventas')
    await esquemaActual(kQ)
    docker(['exec', contenedor, 'psql', '-U', 'postgres', '-qc', 'CREATE SCHEMA efimero'])
    // Que entre en la caché de esquemas: se valida en otra consola SIN sesión y se devuelve.
    const kZ = await nuevaConsola()
    const enCache = await ex.esquemaConsola(PERFIL, kZ, 'efimero')
    await ex.esquemaConsola(PERFIL, kZ, null)
    docker(['exec', contenedor, 'psql', '-U', 'postgres', '-qc', 'DROP SCHEMA efimero'])
    const fEf = await ex.esquemaConsola(PERFIL, kQ, 'efimero')
    const lstQ = await ex.listarConsolas(PERFIL)
    check(
      'un esquema borrado tras cachearlo: rechazado y la sesión vuelve a ventas (el anterior), no a public',
      enCache.ok && !fEf.ok && esquemaDe(kQ) === 'ventas' && (await esquemaActual(kQ)) === 'ventas' && lstQ.ok && lstQ.valor.find((c) => c.id === kQ)?.esquema === 'ventas',
      JSON.stringify({ fEf, esquema: esquemaDe(kQ) })
    )

    // --- Un `listar` durante un cambio de esquema en vuelo no deja el mapa en el viejo ---
    const kR = await nuevaConsola()
    await ex.esquemaConsola(PERFIL, kR, 'ventas')
    await esquemaActual(kR)
    let soltar: () => void = () => {}
    retencion.puerta = new Promise<void>((r) => {
      soltar = r
    })
    const pFijar = ex.esquemaConsola(PERFIL, kR, 'compras')
    for (let i = 0; i < 400 && !retencion.enVuelo; i++) await dormir(5)
    const setEnVuelo = retencion.enVuelo
    const lstR = await ex.listarConsolas(PERFIL)
    const otra = await ex.esquemaConsola(PERFIL, kR, 'ventas')
    soltar()
    const fR = await pFijar
    await ex.cerrarSesionConsola(PERFIL, kR)
    const trasReabrir = await esquemaActual(kR)
    check(
      'un listar con el SET en vuelo (lee el índice viejo): reabrir sigue en compras',
      setEnVuelo && lstR.ok && lstR.valor.find((c) => c.id === kR)?.esquema === 'ventas' && fR.ok && trasReabrir === 'compras',
      JSON.stringify({ setEnVuelo, indiceEnMedio: lstR.ok ? lstR.valor.find((c) => c.id === kR)?.esquema : lstR, fR: fR.ok, trasReabrir })
    )
    check('y un segundo cambio a la vez en la misma consola: ocupada, sin tocar nada', !otra.ok && otra.error.motivo === 'ocupada', JSON.stringify(otra))

    hr('(17) Solo lectura, intacta con todo lo nuevo')
    const nRo = await ex.crearConsola(PERFIL, 'ro')
    const kro = nRo.ok ? nRo.valor.id : ''
    const fijRo = await ex.esquemaConsola(PERFIL, kro, 'ventas')
    check('fijar el esquema en una conexión de solo lectura funciona', fijRo.ok && (await esquemaActual(kro)) === 'ventas', JSON.stringify(fijRo.ok ? fijRo.valor.esquema : fijRo))
    const avisoRo = await ejecutar('select extra.aviso_ro()', kro)
    check('un SELECT que lanza NOTICE en solo lectura: filas y salida', avisoRo.ok && avisoRo.valor.tipo === 'filas' && JSON.stringify(avisoRo.valor.salida) === '[{"texto":"desde ro"}]', JSON.stringify(avisoRo.ok ? avisoRo.valor.salida : avisoRo))
    const expRo = await ex.exportar({
      peticionId: 'exp-ro',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kro, sql: 'select g from generate_series(1, 6000) g' },
      formato: 'tsv',
      nombreSugerido: 'ro',
      motor: 'postgres'
    })
    const estRo2 = ex.estadoConsola(PERFIL, kro)
    const nvRo = await ejecutar("select nextval('seq_facturas')", kro)
    const envRo = nvRo.ok && nvRo.valor.tipo === 'error' ? nvRo.valor.error : null
    check(
      'exportar en solo lectura (cursor vivo dentro de BEGIN READ ONLY) y el candado sigue: nextval -> 25006',
      expRo.ok && expRo.valor?.filas === 6000 && estRo2?.tx === 'ninguna' && envRo?.codigo === '25006',
      JSON.stringify({ exp: expRo.ok ? expRo.valor?.filas : expRo, tx: estRo2?.tx, nextval: envRo?.codigo })
    )
    // La TABLA, en su sesión efímera: el mismo envoltorio (el ROLLBACK espera al cursor).
    const expRoTabla = await ex.exportar({
      peticionId: 'exp-ro-tabla',
      origen: { tipo: 'tabla', conexionId: 'ro', objeto: refInst },
      formato: 'csv',
      nombreSugerido: 'ro_tabla',
      motor: 'postgres'
    })
    const nvRo2 = await ejecutar("select nextval('seq_facturas')", kro)
    const envRo2 = nvRo2.ok && nvRo2.valor.tipo === 'error' ? nvRo2.valor.error : null
    check(
      'exportar una TABLA en solo lectura (sesión efímera, cursor dentro de BEGIN READ ONLY): todas, su conexión cerrada y el candado sigue',
      expRoTabla.ok && expRoTabla.valor?.filas === 11991 && (await conexionesExportar()) === '0' && envRo2?.codigo === '25006',
      JSON.stringify({ exp: expRoTabla.ok ? expRoTabla.valor?.filas : expRoTabla, nextval: envRo2?.codigo })
    )
    const doRo = await ejecutar("DO $$ BEGIN RAISE NOTICE 'x'; END $$", kro)
    check('un DO sigue rechazado en el main', !doRo.ok && doRo.error.motivo === 'soloLectura', JSON.stringify(doRo))

    // --- Parámetros y ejecución --------------------------------------------------------------
    hr('(18) Parámetros: $1…$n, NULL, fechas, «más», Contar y exportar con los mismos')
    const nF2 = await ex.crearConsola(PERFIL, 'c1')
    const kp = nF2.ok ? nF2.valor.id : ''
    let nb = 0
    const conBinds = (sql: string, binds: Record<string, string | null> | undefined, consolaId = kp, maxFilas = 500): ReturnType<ExploradorController['ejecutar']> =>
      ex.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `b${++nb}`, sql, maxFilas, binds })
    const b1 = await conBinds('select nombre from cliente where id = $1', { '1': '2' })
    check('un $1 de texto casa con un int (el servidor convierte)', b1.ok && JSON.stringify(filasDe(b1.valor)) === '[["Bea"]]', JSON.stringify(b1.ok ? filasDe(b1.valor) : b1))
    const b2 = await conBinds("select $2::int + $1::int, coalesce($3, 'era null'), $4::date", { '1': '2', '2': '3', '3': null, '4': '2024-03-31', '9': 'sobra' })
    check('varios, NULL y una fecha con DateStyle ISO; el que sobra no viaja', b2.ok && JSON.stringify(filasDe(b2.valor)) === '[["5","era null","2024-03-31"]]', JSON.stringify(b2.ok ? filasDe(b2.valor) : b2))
    const b3 = await conBinds('select * from cliente where id = $1 and nombre = $2', { '1': '1' })
    check('falta $2: «parametros» con la clave y no se envía', !b3.ok && b3.error.motivo === 'parametros' && JSON.stringify(b3.error.parametros) === '["2"]', JSON.stringify(b3))
    const bg = await conBinds('select g from generate_series(1, $1::int) g', { '1': '1234' })
    const lectorB = bg.ok && bg.valor.tipo === 'filas' ? bg.valor.lector : null
    const pb2 = await ex.leerMas(lectorB ?? '', 500)
    const fb2 = pb2.ok ? (JSON.parse(pb2.valor.filasJson) as unknown[][]) : []
    check('«más» re-ejecuta con los MISMOS binds: 501…1000', pb2.ok && pb2.valor.reejecutada === true && fb2[0]?.[0] === '501' && fb2.length === 500, JSON.stringify(pb2.ok ? { desde: pb2.valor.desde, primera: fb2[0] } : pb2))
    const cb = await ex.contar(lectorB ?? '', 'cuenta-binds')
    check('Contar con los binds: 1234', cb.ok && cb.valor === 1234, JSON.stringify(cb))
    const expB = await ex.exportar({
      peticionId: 'exp-binds',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kp, sql: 'select g from generate_series(1, $1::int) g', binds: { '1': '700' } },
      formato: 'csv',
      nombreSugerido: 'con_binds',
      motor: 'postgres'
    })
    check('exportar la consulta con sus binds: 700 filas', expB.ok && expB.valor?.filas === 700, JSON.stringify(expB))
    const expSin = await ex.exportar({
      peticionId: 'exp-sin-binds',
      origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: kp, sql: 'select g from generate_series(1, $1::int) g' },
      formato: 'csv',
      nombreSugerido: 'sin_binds',
      motor: 'postgres'
    })
    check('… y sin ellos, «parametros» antes del diálogo', !expSin.ok && expSin.error.motivo === 'parametros', JSON.stringify(expSin))

    hr('(19) Explain: FORMAT JSON sin ANALYZE, nunca ejecuta; solo lectura; posición del error')
    const antesEj = Number(docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', 'SELECT count(*) FROM extra.ejecuciones']).out)
    let ne = 0
    const explicarPg = (sql: string, consolaId: string, binds?: Record<string, string | null>): ReturnType<ExploradorController['explicar']> =>
      ex.explicar({ perfilId: PERFIL, consolaId, ejecucionId: `p${++ne}`, sql, ...(binds ? { binds } : {}) })
    const e1 = await explicarPg('select * from cliente c join pedido p on p.cliente_id = c.id where c.id = $1', kp, { '1': '1' })
    check(
      'plan con join: nodos en árbol, objeto, coste y el texto de PG',
      e1.ok && e1.valor.nodos.length >= 2 && e1.valor.nodos[0].padre === null && e1.valor.nodos.some((x) => x.objeto === 'cliente' || x.objeto === 'pedido') && /cost=\d+\.\d\d\.\.\d+\.\d\d rows=\d+ width=\d+/.test(e1.valor.texto),
      e1.ok ? e1.valor.texto.split('\n').slice(0, 3).join(' | ') : JSON.stringify(e1)
    )
    const e2 = await explicarPg('insert into extra.ejecuciones default values', kp)
    const trasEj = Number(docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', 'SELECT count(*) FROM extra.ejecuciones']).out)
    check('un INSERT se explica (ModifyTable) y NO se ejecuta', e2.ok && e2.valor.nodos[0].operacion === 'ModifyTable' && trasEj === antesEj, JSON.stringify({ nodo: e2.ok ? e2.valor.nodos[0] : e2, antesEj, trasEj }))
    const e3 = await explicarPg('select nada from cliente', kp)
    check('error del servidor: ok:false «servidor» con la posición en la sentencia (7)', !e3.ok && e3.error.motivo === 'servidor' && e3.error.posicion === 7 && e3.error.codigo === '42703', JSON.stringify(e3))
    const e4 = await explicarPg('select * from cliente where id = $1', kp)
    check('PG exige los valores del plan: «parametros»', !e4.ok && e4.error.motivo === 'parametros', JSON.stringify(e4))
    // Manual con una tx pendiente: el Explain la ve y no la toca.
    await ex.modoTx(PERFIL, kp, 'manual')
    await conBinds("update cliente set nombre = 'Ana2' where id = $1", { '1': '1' })
    const pe5 = await explicarPg('select * from cliente where nombre = $1', kp, { '1': 'Ana2' })
    const est5 = ex.estadoConsola(PERFIL, kp)
    check('en Manual con cambios pendientes: el plan sale y la transacción sigue pendiente', pe5.ok && est5?.tx === 'pendiente', JSON.stringify({ ok: pe5.ok, tx: est5?.tx }))
    // Un Explain que FALLA dentro de esa transacción no la aborta (va entre SAVEPOINT y
    // RELEASE): sin eso, todo lo siguiente daba 25P02 y el COMMIT se volvía ROLLBACK.
    const pe5b = await explicarPg('select * from no_existe', kp)
    check(
      'Manual con cambios pendientes y un Explain con errata: 42P01 con su posición y la tx SIGUE pendiente',
      !pe5b.ok && pe5b.error.codigo === '42P01' && pe5b.error.posicion === 14 && ex.estadoConsola(PERFIL, kp)?.tx === 'pendiente',
      JSON.stringify({ r: pe5b, tx: ex.estadoConsola(PERFIL, kp)?.tx })
    )
    // Sin errata también: el planificador pliega las constantes y un 1/0 falla al planificar.
    const pe5c = await explicarPg('select 1/0 from cliente', kp)
    check(
      '… un 1/0 que el planificador pliega (22012) tampoco la aborta',
      !pe5c.ok && pe5c.error.codigo === '22012' && ex.estadoConsola(PERFIL, kp)?.tx === 'pendiente',
      JSON.stringify({ r: pe5c, tx: ex.estadoConsola(PERFIL, kp)?.tx })
    )
    // Stop mientras el EXPLAIN espera un bloqueo que otra consola tiene sobre `pedido`.
    const nBloqueo = await ex.crearConsola(PERFIL, 'c1')
    const kl = nBloqueo.ok ? nBloqueo.valor.id : ''
    await ex.modoTx(PERFIL, kl, 'manual')
    const lk = await ejecutar('lock table pedido in access exclusive mode', kl)
    const planEnEspera = ex.explicar({ perfilId: PERFIL, consolaId: kp, ejecucionId: 'plan-stop', sql: 'select * from pedido' })
    // El Stop, cuando el EXPLAIN ya espera el bloqueo (visto desde el servidor): antes, en
    // el SAVEPOINT, no cortaría nada y el EXPLAIN se quedaría esperando.
    const esperandoBloqueo = (): boolean =>
      docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'EXPLAIN%'"]).out === '1'
    for (let i = 0; i < 50 && !esperandoBloqueo(); i++) await dormir(100)
    const tStop = Date.now()
    ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: kp, ejecucionId: 'plan-stop' })
    // Red de seguridad: si el Stop no llegara, soltar el bloqueo hace que la prueba FALLE
    // (el plan saldría bien) en vez de quedarse colgada.
    const redDeSeguridad = setTimeout(() => void ex.tx(PERFIL, kl, 'rollback'), 5000)
    const pst = await planEnEspera
    clearTimeout(redDeSeguridad)
    await ex.tx(PERFIL, kl, 'rollback')
    check(
      '… ni un Stop mientras el Explain espera un bloqueo: cancelada y la tx SIGUE pendiente',
      lk.ok && !pst.ok && pst.error.motivo === 'cancelada' && Date.now() - tStop < 5000 && ex.estadoConsola(PERFIL, kp)?.tx === 'pendiente',
      JSON.stringify({ lk: lk.ok, r: pst, tx: ex.estadoConsola(PERFIL, kp)?.tx })
    )
    const dentro = await conBinds('select nombre from cliente where id = $1', { '1': '1' })
    check('la tx sigue viva y ve su propio UPDATE (Ana2)', dentro.ok && JSON.stringify(filasDe(dentro.valor)) === '[["Ana2"]]', JSON.stringify(dentro.ok ? filasDe(dentro.valor) : dentro))
    const nombreDeMeta = async (): Promise<string> => {
      const filas = await ex.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: 'SELECT nombre FROM cliente WHERE id = 1', binds: [] }))
      return String(filas[0]?.[0])
    }
    const cm5 = await ex.tx(PERFIL, kp, 'commit')
    check(
      'y el COMMIT confirma el UPDATE de antes de los tres Explain fallidos (otra sesión lee Ana2)',
      cm5.ok && cm5.valor.tx === 'ninguna' && (await nombreDeMeta()) === 'Ana2',
      JSON.stringify(cm5.ok ? cm5.valor.tx : cm5)
    )
    await conBinds("update cliente set nombre = 'Ana' where id = $1", { '1': '1' })
    await ex.tx(PERFIL, kp, 'commit')
    await ex.modoTx(PERFIL, kp, 'auto', 'rollback')
    // Auto con un BEGIN a mano: una transacción `abierta` también se protege.
    await ejecutar('begin', kp)
    const pe5d = await explicarPg('select * from no_existe', kp)
    const txAbierta = ex.estadoConsola(PERFIL, kp)?.tx
    await ejecutar('rollback', kp)
    check(
      'Auto + BEGIN a mano: el Explain que falla deja la tx ABIERTA (no fallida)',
      !pe5d.ok && pe5d.error.codigo === '42P01' && txAbierta === 'abierta' && (await nombreDeMeta()) === 'Ana',
      JSON.stringify({ tx: txAbierta })
    )
    // Solo lectura: un DELETE se explica dentro de BEGIN READ ONLY y nada cambia.
    const pe6 = await explicarPg('delete from cliente where id = $1', kro, { '1': '1' })
    const nCli = docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', 'SELECT count(*) FROM cliente']).out
    const nvRo3 = await ejecutar("select nextval('seq_facturas')", kro)
    check(
      'RO: un DELETE se explica (sin ejecutarse), la consola sin transacción y el candado sigue (nextval -> 25006)',
      pe6.ok && nCli === '3' && ex.estadoConsola(PERFIL, kro)?.tx === 'ninguna' && nvRo3.ok && nvRo3.valor.tipo === 'error' && nvRo3.valor.error.codigo === '25006',
      JSON.stringify({ pe6: pe6.ok ? pe6.valor.nodos[0]?.operacion : pe6, nCli })
    )

    hr('(20) Claves ajenas: salientes, entrantes, caché y el DDL de OTRO esquema')
    const fkPedido = await ex.fks('c1', { esquema: 'public', nombre: 'pedido', tipo: 'tabla' })
    const salP = fkPedido.ok ? fkPedido.valor.salientes : []
    const entP = fkPedido.ok ? fkPedido.valor.entrantes : []
    check(
      'pedido: sale a cliente(id) y entra desde linea(pedido_id)',
      salP.length === 1 && salP[0].hacia.tabla === 'cliente' && JSON.stringify(salP[0].desde.columnas) === '["cliente_id"]' && JSON.stringify(salP[0].hacia.columnas) === '["id"]' &&
        entP.length === 1 && entP[0].desde.tabla === 'linea' && JSON.stringify(entP[0].desde.columnas) === '["pedido_id"]',
      JSON.stringify(fkPedido)
    )
    const t0fk = Date.now()
    await ex.fks('c1', { esquema: 'public', nombre: 'pedido', tipo: 'tabla' })
    const msCache = Date.now() - t0fk
    check('la segunda vez sale de la caché', msCache < 20, `${msCache} ms`)
    const fkCli1 = await ex.fks('c1', { esquema: 'public', nombre: 'cliente', tipo: 'tabla' })
    const antesCli = fkCli1.ok ? fkCli1.valor.entrantes.length : -1
    const ddlOtro = await ejecutar('create table ventas.nota (id int primary key, cliente_id int references public.cliente(id))', kp)
    const fkCli2 = await ex.fks('c1', { esquema: 'public', nombre: 'cliente', tipo: 'tabla' })
    check(
      'un DDL en ventas que apunta a public.cliente: la FK nueva entra SIN «Refrescar»',
      ddlOtro.ok && ddlOtro.valor.tipo === 'hecho' && fkCli2.ok && fkCli2.valor.entrantes.length === antesCli + 1 && fkCli2.valor.entrantes.some((f) => f.desde.esquema === 'ventas' && f.desde.tabla === 'nota'),
      JSON.stringify(fkCli2.ok ? fkCli2.valor.entrantes.map((f) => `${f.desde.esquema}.${f.desde.tabla}`) : fkCli2)
    )
    await ejecutar('drop table ventas.nota', kp)

    hr('(21) Historial: privado, con lo que llegó al servidor y las contraseñas tapadas')
    await ejecutar("select id from cliente where nombre = 'Ñandú 😀'", kp)
    await ejecutar("create role tessera_hist_tmp password 'Secreto-Del-Rol-99'", kp)
    await ejecutar('drop role tessera_hist_tmp', kp)
    // Se anota sin esperar: lo encolado termina antes de mirar el disco.
    await ex.historial?.esperar()
    const dirHist = path.join(tmp, 'db-historial')
    const archivos = existsSync(dirHist) ? readdirSync(dirHist) : []
    const crudo = archivos.length ? readFileSync(path.join(dirHist, archivos[0]), 'utf8') : ''
    const enDatos = existsSync(path.join(tmp, 'conexiones')) ? JSON.stringify(readdirSync(path.join(tmp, 'conexiones'), { recursive: true })) : '[]'
    check(
      'un archivo en db-historial y NADA de historial en el espacio de datos',
      archivos.join() === `${PERFIL}.jsonl` && !/historial|jsonl/.test(enDatos),
      `${archivos.join()} · datos: ${enDatos.slice(0, 160)}`
    )
    check('la contraseña del rol NO está en el disco', crudo.length > 0 && !crudo.includes('Secreto-Del-Rol-99') && /PASSWORD '\*\*\*'/i.test(crudo), `${crudo.length} caracteres`)
    const hTodo = await ex.historialListar({ perfilId: PERFIL })
    const hLista = hTodo.ok ? hTodo.valor : []
    check(
      'la más reciente primero; hay ok, error y la del Stop (cancelada)',
      hLista[0]?.sql === 'drop role tessera_hist_tmp' && hLista.some((x) => x.resultado === 'error') && hLista.some((x) => x.resultado === 'cancelada' && /pg_sleep/.test(x.sql)),
      JSON.stringify(hLista.slice(0, 2).map((x) => [x.sql.slice(0, 30), x.resultado]))
    )
    const conParam = hLista.find((x) => /generate_series\(1, \$1::int\)/.test(x.sql))
    check('una con parámetros guarda el texto con $1 (no los valores) y sus filas', conParam !== undefined && conParam.filas === 500, JSON.stringify(conParam))
    check('los rechazos (solo lectura, parámetros que faltan) no están', !hLista.some((x) => /update cliente set saldo = 0/.test(x.sql) || /nombre = \$2/.test(x.sql)), `${hLista.length} entradas`)
    check('el Explain no se anota', !hLista.some((x) => /^select \* from cliente c join pedido/.test(x.sql)), 'no está')
    const hRo = await ex.historialListar({ perfilId: PERFIL, conexionId: 'ro' })
    check('por conexión', hRo.ok && hRo.valor.length > 0 && hRo.valor.every((x) => x.conexionId === 'ro'), `${hRo.ok ? hRo.valor.length : -1}`)
    const hTexto = await ex.historialListar({ perfilId: PERFIL, texto: 'nandu' })
    const hTexto2 = await ex.historialListar({ perfilId: PERFIL, texto: 'GENERATE_series', limite: 2 })
    check(
      'por texto sin caja ni tildes («nandu» encuentra «Ñandú»), y con límite',
      hTexto.ok && hTexto.valor.length === 1 && hTexto2.ok && hTexto2.valor.length === 2,
      `${hTexto.ok ? hTexto.valor.length : -1} / ${hTexto2.ok ? hTexto2.valor.length : -1}`
    )
    const idBorrar = hLista[0]?.id ?? ''
    await ex.historialBorrar(PERFIL, [idBorrar])
    const tras1 = await ex.historialListar({ perfilId: PERFIL })
    check('borrar una: ya no está', tras1.ok && !tras1.valor.some((x) => x.id === idBorrar) && tras1.valor.length === hLista.length - 1, `${tras1.ok ? tras1.valor.length : -1}`)
    const malo = await ex.historialBorrar(PERFIL, undefined)
    check('ids ausente (no null) NO borra todo', !malo.ok && (await ex.historialListar({ perfilId: PERFIL })).ok, JSON.stringify(malo))
    await ex.historialBorrar(PERFIL, null)
    const trasTodo = await ex.historialListar({ perfilId: PERFIL })
    check('borrar todo: vacío y sin archivo', trasTodo.ok && trasTodo.valor.length === 0 && readdirSync(dirHist).length === 0, JSON.stringify(readdirSync(dirHist)))

    hr('(22) editar la rejilla (identidad, todo o nada, Stop) y producción')
    {
      const sembrado = docker(
        ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
        `
CREATE SCHEMA edicion;
CREATE TABLE edicion.cliente (
  id int PRIMARY KEY, nombre text NOT NULL, nota text,
  doble int GENERATED ALWAYS AS (id * 2) STORED, n int GENERATED ALWAYS AS IDENTITY, foto bytea
);
INSERT INTO edicion.cliente (id, nombre, nota) VALUES (1, 'Ana', 'a'), (2, 'Bea', 'b'), (3, 'Cai', NULL);
CREATE TABLE edicion.hija (id int PRIMARY KEY, cliente_id int NOT NULL REFERENCES edicion.cliente(id));
CREATE TABLE edicion.solo_unica (codigo text NOT NULL, parte int NOT NULL, valor text, CONSTRAINT uq_solo UNIQUE (codigo, parte));
INSERT INTO edicion.solo_unica VALUES ('A', 1, 'uno'), ('A', 2, 'dos');
CREATE TABLE edicion.unica_nula (codigo text UNIQUE, valor text);
CREATE TABLE edicion.sin_nada (x int, y text);
INSERT INTO edicion.sin_nada VALUES (1, 'a');
CREATE TABLE edicion.bin (guid bytea PRIMARY KEY, v text);
INSERT INTO edicion.bin VALUES ('\\x0a0b', 'antes');
CREATE VIEW edicion.v_cliente AS SELECT id, nombre FROM edicion.cliente;
CREATE TABLE edicion.dif (id int PRIMARY KEY, ref int REFERENCES edicion.cliente(id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE edicion.paralela (id int PRIMARY KEY, v text);
INSERT INTO edicion.paralela VALUES (1, 'uno');
CREATE TABLE edicion.alterada (id int PRIMARY KEY, v text);
INSERT INTO edicion.alterada VALUES (1, 'uno');
`
      )
      check('siembra del esquema edicion', sembrado.ok, sembrado.ok ? 'ok' : sembrado.err)
      conexiones.mapa.set('prod', { ...base, id: 'prod', alias: 'PG-PROD', entorno: 'produccion' })
      conexiones.secretos.set('prod', password)
      const psql = (sql: string): string => docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', sql]).out
      let nPet = 0
      const objeto = (nombre: string, tipo: 'tabla' | 'vista' = 'tabla'): { esquema: string; nombre: string; tipo: 'tabla' | 'vista' } => ({ esquema: 'edicion', nombre, tipo })
      const abrirEd = (nombre: string, con = 'c1', tipo: 'tabla' | 'vista' = 'tabla'): ReturnType<ExploradorController['abrirTabla']> =>
        ex.abrirTabla({ conexionId: con, peticionId: `ed${++nPet}`, objeto: objeto(nombre, tipo), maxFilas: 100 })
      const enviar = (nombre: string, identidad: unknown, cambios: unknown[], extra: Record<string, unknown> = {}): ReturnType<ExploradorController['enviarCambios']> =>
        ex.enviarCambios({ conexionId: 'c1', peticionId: `env${++nPet}`, objeto: objeto(nombre), identidad, cambios, ...extra })
      const PK_ID = { tipo: 'pk', columnas: ['id'] }

      // --- Identidad al abrir ---
      const tCli = await abrirEd('cliente')
      const noEd = tCli.ok ? (tCli.valor.noEditables ?? []).map((x) => x.columna).sort() : []
      check('con PK: identidad pk [id]', tCli.ok && JSON.stringify(tCli.valor.identidad) === JSON.stringify(PK_ID), JSON.stringify(tCli.ok ? tCli.valor.identidad : tCli))
      check('no editables: la generada, la identidad ALWAYS y la binaria (y solo esas)', JSON.stringify(noEd) === JSON.stringify(['doble', 'foto', 'n']), JSON.stringify(tCli.ok ? tCli.valor.noEditables : null))
      const tUni = await abrirEd('solo_unica')
      check('sin PK con una UNIQUE NOT NULL: pk [codigo, parte]', tUni.ok && JSON.stringify(tUni.valor.identidad) === JSON.stringify({ tipo: 'pk', columnas: ['codigo', 'parte'] }), JSON.stringify(tUni.ok ? tUni.valor.identidad : tUni))
      const tNula = await abrirEd('unica_nula')
      const tNada = await abrirEd('sin_nada')
      check(
        'NEGATIVO: una UNIQUE que admite NULL no identifica, y sin nada tampoco: ninguna con su motivo',
        tNula.ok && tNula.valor.identidad?.tipo === 'ninguna' && tNada.ok && tNada.valor.identidad?.tipo === 'ninguna' && tNada.valor.noEditables === undefined,
        JSON.stringify([tNula.ok && tNula.valor.identidad, tNada.ok && tNada.valor.identidad])
      )
      const tVista = await abrirEd('v_cliente', 'c1', 'vista')
      check('NEGATIVO: una vista, ninguna', tVista.ok && tVista.valor.identidad?.tipo === 'ninguna' && /vista/.test(tVista.valor.identidad.motivo), JSON.stringify(tVista.ok && tVista.valor.identidad))
      const tRo = await abrirEd('cliente', 'ro')
      check('NEGATIVO: en SOLO LECTURA, ninguna (aunque tenga PK)', tRo.ok && tRo.valor.identidad?.tipo === 'ninguna' && tRo.valor.noEditables === undefined, JSON.stringify(tRo.ok && tRo.valor.identidad))

      // --- Enviar: editar, insertar y borrar, todo junto ---
      const r1 = await enviar('cliente', PK_ID, [
        { tipo: 'actualizar', clave: ['1'], valores: { nombre: 'Ana María', nota: null } },
        { tipo: 'insertar', valores: { id: '4', nombre: 'Dan' } },
        { tipo: 'borrar', clave: ['3'] }
      ])
      check('editar + insertar + borrar: hecho, 3 cambios', r1.ok && r1.valor.tipo === 'hecho' && r1.valor.cambios === 3, JSON.stringify(r1))
      check('en el servidor: el UPDATE (con su NULL), el INSERT y el DELETE', psql("SELECT string_agg(id || ':' || nombre || ':' || coalesce(nota, 'NULL'), ',' ORDER BY id) FROM edicion.cliente") === '1:Ana María:NULL,2:Bea:b,4:Dan:NULL', psql("SELECT string_agg(id || ':' || nombre, ',' ORDER BY id) FROM edicion.cliente"))
      const tras = await abrirEd('cliente')
      const filasTras = tras.ok && tras.valor.resultado.tipo === 'filas' ? (JSON.parse(tras.valor.resultado.pagina.filasJson) as unknown[][]) : []
      check('tras el COMMIT, volver a pedir la página ve lo nuevo', filasTras.map((f) => f[1]).join(',') === 'Ana María,Bea,Dan', JSON.stringify(filasTras.map((f) => f[1])))

      // --- Todo o nada: el 2.º falla (FK) y el 1.º NO queda ---
      const r2 = await enviar('hija', PK_ID, [
        { tipo: 'insertar', valores: { id: '10', cliente_id: '1' } },
        { tipo: 'insertar', valores: { id: '11', cliente_id: '999' } }
      ])
      check('el 2.º viola la FK: error en el índice 1 con su código', r2.ok && r2.valor.tipo === 'error' && r2.valor.indice === 1 && r2.valor.error.codigo === '23503', JSON.stringify(r2))
      check('… y el 1.º NO se aplicó (todo o nada)', psql('SELECT count(*) FROM edicion.hija') === '0', psql('SELECT count(*) FROM edicion.hija'))

      // --- Una fila cambiada entretanto: 0 filas y se revierte ---
      psql("UPDATE edicion.cliente SET id = 20 WHERE id = 2")
      const r3 = await enviar('cliente', PK_ID, [
        { tipo: 'actualizar', clave: ['1'], valores: { nota: 'no debe quedar' } },
        { tipo: 'actualizar', clave: ['2'], valores: { nota: 'la fila ya no es la 2' } }
      ])
      check('la fila cambió de clave entretanto: 0 filas en el índice 1', r3.ok && r3.valor.tipo === 'error' && r3.valor.indice === 1 && r3.valor.filas === 0 && r3.valor.error.codigo === 'TESSERA-FILAS', JSON.stringify(r3))
      check('… y el 1.º tampoco quedó', psql('SELECT coalesce(nota, \'NULL\') FROM edicion.cliente WHERE id = 1') === 'NULL', psql('SELECT nota FROM edicion.cliente WHERE id = 1'))

      // --- Identidad por la UNIQUE NOT NULL, y por una clave binaria ---
      const r4 = await enviar('solo_unica', { tipo: 'pk', columnas: ['codigo', 'parte'] }, [{ tipo: 'actualizar', clave: ['A', '2'], valores: { valor: 'DOS' } }])
      check('por la UNIQUE NOT NULL: hecho y solo esa fila', r4.ok && r4.valor.tipo === 'hecho' && psql("SELECT string_agg(valor, ',' ORDER BY parte) FROM edicion.solo_unica") === 'uno,DOS', JSON.stringify(r4))
      const tBin = await abrirEd('bin')
      const guid = tBin.ok && tBin.valor.resultado.tipo === 'filas' ? String((JSON.parse(tBin.valor.resultado.pagina.filasJson) as unknown[][])[0]?.[0]) : ''
      const r5 = await enviar('bin', { tipo: 'pk', columnas: ['guid'] }, [{ tipo: 'actualizar', clave: [guid], valores: { v: 'después' } }])
      check('clave BINARIA (bytea) tal como la pinta la rejilla (0x…): encuentra su fila', guid === '0x0A0B' && r5.ok && r5.valor.tipo === 'hecho' && psql('SELECT v FROM edicion.bin') === 'después', JSON.stringify({ guid, r5 }))

      // --- Restricción DIFERIDA: falla el COMMIT, índice -1, nada aplicado ---
      const r6 = await enviar('dif', PK_ID, [{ tipo: 'insertar', valores: { id: '1', ref: '999' } }])
      check('FK diferida: pasa el INSERT y falla el COMMIT (índice -1)', r6.ok && r6.valor.tipo === 'error' && r6.valor.indice === -1 && r6.valor.error.codigo === '23503', JSON.stringify(r6))
      check('… y no quedó nada', psql('SELECT count(*) FROM edicion.dif') === '0', psql('SELECT count(*) FROM edicion.dif'))

      // --- Lo que el main rechaza SIN enviar ---
      const antesRo = psql('SELECT nombre FROM edicion.cliente WHERE id = 1')
      const rRo = await ex.enviarCambios({ conexionId: 'ro', peticionId: 'ro1', objeto: objeto('cliente'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nombre: 'RO' } }] })
      check("solo lectura: 'soloLectura' y nada cambia", !rRo.ok && rRo.error.motivo === 'soloLectura' && psql('SELECT nombre FROM edicion.cliente WHERE id = 1') === antesRo, JSON.stringify(rRo))
      const rFalsa = await enviar('cliente', { tipo: 'pk', columnas: ['nombre'] }, [{ tipo: 'borrar', clave: ['Ana María'] }])
      check('una identidad que no es la de la tabla: rechazada', !rFalsa.ok && /cambió desde que se abrió/.test(rFalsa.error.mensaje) && psql('SELECT count(*) FROM edicion.cliente') === '3', JSON.stringify(rFalsa))
      const rGen = await enviar('cliente', PK_ID, [{ tipo: 'actualizar', clave: ['1'], valores: { doble: '7' } }])
      const rFant = await enviar('cliente', PK_ID, [{ tipo: 'actualizar', clave: ['1'], valores: { fantasma: '7' } }])
      check('una columna generada o inexistente: rechazada sin enviar', !rGen.ok && /no se puede editar/.test(rGen.error.mensaje) && !rFant.ok && /no existe/.test(rFant.error.mensaje), JSON.stringify([rGen, rFant]))
      const rNinguna = await enviar('sin_nada', { tipo: 'ninguna', motivo: 'x' }, [{ tipo: 'borrar', clave: ['1'] }])
      check("una tabla sin identidad: rechazada con su motivo", !rNinguna.ok && /clave primaria/.test(rNinguna.error.mensaje) && psql('SELECT count(*) FROM edicion.sin_nada') === '1', JSON.stringify(rNinguna))

      // --- Producción ---
      const rProd = await ex.enviarCambios({ conexionId: 'prod', peticionId: 'pr1', objeto: objeto('cliente'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nota: 'prod' } }] })
      check("producción sin confirmar: 'produccion' con el alias y nada cambia", !rProd.ok && rProd.error.motivo === 'produccion' && rProd.error.mensaje.includes('PG-PROD') && psql('SELECT coalesce(nota, \'NULL\') FROM edicion.cliente WHERE id = 1') === 'NULL', JSON.stringify(rProd))
      const rProdOk = await ex.enviarCambios({ conexionId: 'prod', peticionId: 'pr2', objeto: objeto('cliente'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nota: 'prod' } }], confirmado: true })
      check('producción CON confirmado: hecho', rProdOk.ok && rProdOk.valor.tipo === 'hecho' && psql('SELECT nota FROM edicion.cliente WHERE id = 1') === 'prod', JSON.stringify(rProdOk))
      const kp = await ex.crearConsola(PERFIL, 'prod')
      const KP = kp.ok ? kp.valor.id : ''
      // sin sesión, null. La barra pinta el Manual con el que nacerá sobre la
      // conexión VIVA (`modoTxInicial`); una sesión inventada aquí la leía el renderer una
      // vez y se quedaba vieja si la conexión cambiaba (Manual en una de desarrollo).
      const estNueva = ex.estadoConsola(PERFIL, KP)
      check('la consola nueva de producción, sin sesión: null (nada inventado que se quede viejo)', estNueva === null, JSON.stringify(estNueva))
      const cUp = await ex.ejecutar({ perfilId: PERFIL, consolaId: KP, ejecucionId: 'p1', sql: "update edicion.cliente set nota = 'consola' where id = 1", maxFilas: 10 })
      check("consola de producción: UPDATE sin confirmar, 'produccion' y nada enviado", !cUp.ok && cUp.error.motivo === 'produccion' && psql('SELECT nota FROM edicion.cliente WHERE id = 1') === 'prod', JSON.stringify(cUp))
      const cUpOk = await ex.ejecutar({ perfilId: PERFIL, consolaId: KP, ejecucionId: 'p2', sql: "update edicion.cliente set nota = 'consola' where id = 1", maxFilas: 10, confirmado: true })
      const estP = ex.estadoConsola(PERFIL, KP)
      check('con confirmado: se ejecuta, en Manual y PENDIENTE (no se confirmó solo)', cUpOk.ok && estP?.txModo === 'manual' && estP.tx === 'pendiente' && psql('SELECT nota FROM edicion.cliente WHERE id = 1') === 'prod', JSON.stringify(estP))
      const cCommit = await ex.tx(PERFIL, KP, 'commit')
      check("el botón Commit sin confirmar: 'produccion' y sigue pendiente", !cCommit.ok && cCommit.error.motivo === 'produccion' && ex.estadoConsola(PERFIL, KP)?.tx === 'pendiente', JSON.stringify(cCommit))
      const cCommitOk = await ex.tx(PERFIL, KP, 'commit', true)
      check('con confirmado: confirma', cCommitOk.ok && cCommitOk.valor.tx === 'ninguna' && psql('SELECT nota FROM edicion.cliente WHERE id = 1') === 'consola', JSON.stringify(cCommitOk.ok ? cCommitOk.valor.tx : cCommitOk))

      // --- Stop de un envío bloqueado por otra sesión ---
      const bloqueo = spawn('docker', ['exec', contenedor, 'psql', '-U', 'postgres', '-c', "BEGIN; UPDATE edicion.cliente SET nota = 'bloqueo' WHERE id = 4; SELECT pg_sleep(20); ROLLBACK;"], { windowsHide: true })
      let bloqueado = false
      for (let i = 0; i < 50 && !bloqueado; i++) {
        await dormir(200)
        bloqueado = psql("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(20)%' AND state = 'active' AND pid <> pg_backend_pid()") !== '0'
      }
      const t0Stop = Date.now()
      const enVuelo = ex.enviarCambios({ conexionId: 'c1', peticionId: 'stop-pg', objeto: objeto('cliente'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nota: 'no' } }, { tipo: 'actualizar', clave: ['4'], valores: { nota: 'espera' } }] })
      let esperando = false
      for (let i = 0; i < 50 && !esperando; i++) {
        await dormir(100)
        esperando = psql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador enviar%' AND wait_event_type = 'Lock'") !== '0'
      }
      ex.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop-pg' })
      const rStop = await enVuelo
      const msStop = Date.now() - t0Stop
      try {
        bloqueo.kill()
      } catch {
        // ya terminó
      }
      check(
        'Stop con el UPDATE esperando un bloqueo: cancelado en el índice 1, en segundos',
        bloqueado && esperando && rStop.ok && rStop.valor.tipo === 'error' && rStop.valor.indice === 1 && rStop.valor.error.motivo === 'cancelada' && msStop < 10_000,
        JSON.stringify({ bloqueado, esperando, msStop, rStop })
      )
      check('… y el 1.º no quedó', psql('SELECT nota FROM edicion.cliente WHERE id = 1') === 'consola', psql('SELECT nota FROM edicion.cliente WHERE id = 1'))

      // --- un Stop que llega MIENTRAS el main valida ---
      // En ese tramo (el catálogo de la tabla, un viaje o dos por la VPN si la caché se
      // invalidó) la sesión del envío aún no existe en el gestor: el Stop no encontraba
      // nada, se perdía EN SILENCIO y el envío llegaba al COMMIT. Se pide en el mismo
      // turno en que se lanza: el controlador está en su primer `await`.
      const notaUno = (): string => psql("SELECT coalesce(nota, 'NULL') FROM edicion.cliente WHERE id = 1")
      const antesVal = notaUno()
      const validando = ex.enviarCambios({ conexionId: 'c1', peticionId: 'stop-validando', objeto: objeto('cliente'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nota: 'no debe quedar' } }] })
      ex.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop-validando' })
      const rVal = await validando
      check(
        'Stop mientras el main VALIDA: ok:false cancelada (no se envió nada) y la fila sigue igual',
        !rVal.ok && rVal.error.motivo === 'cancelada' && notaUno() === antesVal,
        JSON.stringify({ rVal, nota: notaUno() })
      )
      const validando2 = ex.enviarCambios({ conexionId: 'c1', peticionId: 'sigue-validando', objeto: objeto('cliente'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { nota: 'sí queda' } }] })
      ex.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'otro-envio' })
      const rVal2 = await validando2
      check(
        'NEGATIVO: el Stop de OTRO peticionId no detiene este envío: hecho',
        rVal2.ok && rVal2.valor.tipo === 'hecho' && notaUno() === 'sí queda',
        JSON.stringify({ rVal2, nota: notaUno() })
      )

      // --- un Stop mientras ABRIR una tabla lee el catálogo ---
      // Lo mismo que el de «Enviar», en la pestaña de tabla: la PK y la identidad se leen
      // ANTES de encolar la página, y el Stop no encontraba cola; el SELECT salía igual.
      const paginasDe = (tabla: string, desde: number): number =>
        espia.ejecutados.slice(desde).filter((x) => !x.catalogo && x.sql.includes(`FROM "edicion"."${tabla}"`)).length
      let nEj = espia.ejecutados.length
      const abriendo = ex.abrirTabla({ conexionId: 'c1', peticionId: 'stop-abriendo', objeto: objeto('cliente'), maxFilas: 100 })
      ex.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'stop-abriendo' })
      const rAbr = await abriendo
      check(
        'Stop mientras se ABRE la tabla (catálogo antes de la página): ok:false cancelada y el SELECT no sale',
        !rAbr.ok && rAbr.error.motivo === 'cancelada' && paginasDe('cliente', nEj) === 0,
        JSON.stringify({ r: rAbr.ok ? rAbr.valor.resultado.tipo : rAbr.error, paginas: paginasDe('cliente', nEj) })
      )
      nEj = espia.ejecutados.length
      const abriendo2 = ex.abrirTabla({ conexionId: 'c1', peticionId: 'sigue-abriendo', objeto: objeto('cliente'), maxFilas: 100 })
      ex.cancelar({ rol: 'datos', conexionId: 'c1', peticionId: 'otra-pestana' })
      const rAbr2 = await abriendo2
      check(
        'NEGATIVO: el Stop de OTRA pestaña no la detiene: filas, y su SELECT sale',
        rAbr2.ok && rAbr2.valor.resultado.tipo === 'filas' && paginasDe('cliente', nEj) === 1,
        JSON.stringify({ r: rAbr2.ok ? rAbr2.valor.resultado.tipo : rAbr2.error, paginas: paginasDe('cliente', nEj) })
      )

      // --- la identidad va EN PARALELO con la primera página ---
      // Se RETIENE en el trabajador la consulta de edición de una tabla sin caché hasta ver
      // salir el SELECT de su página (plazo: 5 s). En serie, el SELECT no salía hasta que
      // la edición respondía, así que llegaba tarde (y la prueba esperaba el plazo).
      let avisarPagina = (): void => {}
      const paginaVista = new Promise<void>((res) => {
        avisarPagina = res
      })
      const marcaPagina = { patron: /FROM "edicion"\."paralela"/, antesDeLaEdicion: null as boolean | null, avisar: () => avisarPagina() }
      espia.pagina = marcaPagina
      espia.edicion = { tabla: 'paralela', hasta: Promise.race([paginaVista, dormir(5000)]), respondida: false }
      const nEdPar = espia.consultasEdicion.length
      const tPar = await abrirEd('paralela')
      espia.edicion = null
      espia.pagina = null
      check(
        'la primera página sale ANTES de que responda la consulta de edición (en paralelo), y la identidad llega igual',
        marcaPagina.antesDeLaEdicion === true && espia.consultasEdicion.length === nEdPar + 1 && tPar.ok && JSON.stringify(tPar.valor.identidad) === JSON.stringify(PK_ID),
        JSON.stringify({ antes: marcaPagina.antesDeLaEdicion, consultas: espia.consultasEdicion.length - nEdPar, identidad: tPar.ok ? tPar.valor.identidad : tPar.error })
      )

      // --- un ALTER hecho FUERA de Tessera no deja la edición atascada ---
      // La caché de edición no caduca por tiempo; un DDL de Tessera la invalida, uno de
      // fuera no. Antes, «Enviar» rechazaba la columna nueva con «vuelve a abrirla», y
      // reabrir leía la MISMA lista vieja: no había salida sin refrescar el árbol.
      const nombresDe = (t: Awaited<ReturnType<ExploradorController['abrirTabla']>>): string[] =>
        t.ok && t.valor.resultado.tipo === 'filas' ? t.valor.resultado.columnas.map((c) => c.nombre) : []
      await abrirEd('alterada')
      const nEdAlt = espia.consultasEdicion.length
      const tAlt = await abrirEd('alterada')
      check(
        'NEGATIVO: reabrir una tabla que no cambió no vuelve a preguntar al catálogo de edición',
        tAlt.ok && espia.consultasEdicion.length === nEdAlt,
        `consultas de más: ${espia.consultasEdicion.length - nEdAlt}`
      )
      psql('ALTER TABLE edicion.alterada ADD COLUMN nueva text')
      const evAntes = eventos.filter((x) => x.canal === DBX_CHANNELS.EV_CATALOGO).length
      const tAlt2 = await abrirEd('alterada')
      check(
        'tras un ALTER de FUERA, reabrir trae la columna y relee la edición UNA vez, sin avisar al árbol',
        nombresDe(tAlt2).includes('nueva') &&
          espia.consultasEdicion.length === nEdAlt + 1 &&
          tAlt2.ok &&
          !(tAlt2.valor.noEditables ?? []).some((x) => x.columna === 'nueva') &&
          eventos.filter((x) => x.canal === DBX_CHANNELS.EV_CATALOGO).length === evAntes,
        JSON.stringify({ columnas: nombresDe(tAlt2), relecturas: espia.consultasEdicion.length - nEdAlt, noEditables: tAlt2.ok ? tAlt2.valor.noEditables : null })
      )
      const rAlt = await enviar('alterada', PK_ID, [{ tipo: 'actualizar', clave: ['1'], valores: { nueva: 'desde fuera' } }])
      check(
        '«Enviar» escribe la columna nueva (antes: «no existe… vuelve a abrirla», y reabrir no lo arreglaba)',
        rAlt.ok && rAlt.valor.tipo === 'hecho' && psql('SELECT nueva FROM edicion.alterada WHERE id = 1') === 'desde fuera',
        JSON.stringify(rAlt)
      )
      let efimeras = '-1'
      for (let i = 0; i < 30; i++) {
        efimeras = psql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador enviar%'")
        if (efimeras === '0') break
        await dormir(100)
      }
      check('ninguna conexión de «Enviar» queda abierta en el servidor', efimeras === '0', `quedan=${efimeras}`)
      check('ni en el gestor: ninguna sesión de datos sin pestaña', !ex.sesiones().some((s) => s.ref.rol === 'datos' && s.fase === 'ocupada'), JSON.stringify(ex.sesiones().filter((s) => s.ref.rol === 'datos').map((s) => s.fase)))

      // --- «Enviar» espera un BLOQUEO con tope (SET LOCAL lock_timeout) ---
      // Lo típico: una consola del propio usuario con un UPDATE sin confirmar de la misma
      // fila. Antes, «Enviar» esperaba sin plazo (en PG el Stop sí lo cortaba; en Oracle
      // 12c+ ni eso). Ahora, a los ~10 s, el error de la fila bloqueada en SU índice.
      const kb = await ex.crearConsola(PERFIL, 'c1')
      const KB = kb.ok ? kb.valor.id : ''
      await ex.modoTx(PERFIL, KB, 'manual')
      const nota = (id: number): string => psql(`SELECT coalesce(nota, 'NULL') FROM edicion.cliente WHERE id = ${id}`)
      const notaUnoAntes = nota(1)
      const upKb = await ex.ejecutar({ perfilId: PERFIL, consolaId: KB, ejecucionId: 'kb1', sql: "update edicion.cliente set nota = 'de la consola' where id = 4", maxFilas: 10 })
      check('una consola con un UPDATE sin confirmar de la fila 4', upKb.ok && ex.estadoConsola(PERFIL, KB)?.tx === 'pendiente', JSON.stringify(ex.estadoConsola(PERFIL, KB)?.tx))
      const tBloq = Date.now()
      const rBloq = await enviar('cliente', PK_ID, [
        { tipo: 'actualizar', clave: ['1'], valores: { nota: 'no debe quedar' } },
        { tipo: 'actualizar', clave: ['4'], valores: { nota: 'bloqueada' } }
      ])
      const msBloq = Date.now() - tBloq
      console.log(`  [MEDIDO] «Enviar» contra una fila bloqueada por una consola, en PG: ${msBloq} ms hasta el error`)
      check(
        'la fila bloqueada por la consola: a los ~10 s (lock_timeout), error 55P03 en el índice 1 con el mensaje de la fila bloqueada',
        rBloq.ok && rBloq.valor.tipo === 'error' && rBloq.valor.indice === 1 && rBloq.valor.error.codigo === '55P03' &&
          /bloqueada por otra transacción/.test(rBloq.valor.error.mensaje) && /No se aplicó nada/.test(rBloq.valor.error.mensaje) &&
          msBloq >= 9000 && msBloq < 15_000,
        JSON.stringify({ msBloq, rBloq })
      )
      check('… y el 1.º NO quedó (todo o nada), y la consola sigue con lo suyo pendiente', nota(1) === notaUnoAntes && ex.estadoConsola(PERFIL, KB)?.tx === 'pendiente', `${nota(1)} / ${ex.estadoConsola(PERFIL, KB)?.tx}`)
      await ex.tx(PERFIL, KB, 'rollback')
      const rSuelta = await enviar('cliente', PK_ID, [
        { tipo: 'actualizar', clave: ['1'], valores: { nota: 'ahora sí' } },
        { tipo: 'actualizar', clave: ['4'], valores: { nota: 'ya suelta' } }
      ])
      check('revertida la consola, el mismo envío se aplica entero', rSuelta.ok && rSuelta.valor.tipo === 'hecho' && nota(1) === 'ahora sí' && nota(4) === 'ya suelta', JSON.stringify(rSuelta))
      check(
        'el lock_timeout era LOCAL: no queda en ninguna sesión (la efímera se cerró y la consola sigue en 0)',
        psql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador enviar%'") === '0',
        psql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador enviar%'")
      )
      const ltConsola = await ex.ejecutar({ perfilId: PERFIL, consolaId: KB, ejecucionId: 'kb2', sql: 'show lock_timeout', maxFilas: 10 })
      check('NEGATIVO: la consola no hereda nada (lock_timeout 0)', filasDe(ltConsola.ok ? ltConsola.valor : undefined)[0]?.[0] === '0', JSON.stringify(ltConsola.ok ? filasDe(ltConsola.valor) : ltConsola))
    }

    hr('(23) standard_conforming_strings fijado (el léxico y el servidor leen igual)')
    {
      // Una base o un rol viejos con standard_conforming_strings = off: el servidor lee
      // '\' como escape y el léxico del main no. Tessera lo fija al abrir.
      const rol = docker(
        ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
        `CREATE ROLE scs_off LOGIN PASSWORD '${password}';\nALTER ROLE scs_off SET standard_conforming_strings = off;\nGRANT USAGE ON SCHEMA public TO scs_off;`
      )
      const deFabrica = docker(['exec', contenedor, 'psql', '-U', 'scs_off', '-d', 'postgres', '-tAc', 'SHOW standard_conforming_strings']).out
      check('un rol con standard_conforming_strings = off (lo que vería cualquier otra herramienta)', rol.ok && deFabrica === 'off', `${rol.ok ? 'ok' : rol.err} / ${deFabrica}`)
      conexiones.mapa.set('scs', { ...base, id: 'scs', alias: 'PG-SCS-OFF', user: 'scs_off' })
      conexiones.secretos.set('scs', password)
      const ks = await ex.crearConsola(PERFIL, 'scs')
      const KS = ks.ok ? ks.valor.id : ''
      let ns = 0
      const enScs = (sql: string): ReturnType<ExploradorController['ejecutar']> => ex.ejecutar({ perfilId: PERFIL, consolaId: KS, ejecucionId: `scs${++ns}`, sql, maxFilas: 10 })
      const celda = async (sql: string): Promise<unknown> => {
        const r = await enScs(sql)
        return r.ok ? filasDe(r.valor)[0]?.[0] : `(${JSON.stringify(r.error)})`
      }
      const alAbrir = await celda('SHOW standard_conforming_strings')
      check('Tessera la abre con standard_conforming_strings = on', alAbrir === 'on', String(alAbrir))
      const barra = await celda("SELECT 'a\\b' AS x")
      check("'a\\b' es a, barra, b (3 caracteres): lo que el léxico cree, no un retroceso", barra === 'a\\b' && String(barra).length === 3, `${JSON.stringify(barra)} (${String(barra).length} caracteres)`)
      const setOff = await enScs('SET standard_conforming_strings = off')
      check(
        "SET standard_conforming_strings = off: rechazado como los formatos fijados («Tessera fija este formato»), con SU remedio (E'…') y no el de las fechas (TO_CHAR)",
        !setOff.ok && /Tessera fija este formato/.test(setOff.error.mensaje) && setOff.error.mensaje.includes("E'") && !setOff.error.mensaje.includes('TO_CHAR'),
        JSON.stringify(setOff)
      )
      // Por donde el main no mira (un SELECT que llama a set_config): el servidor lo informa
      // (ParameterStatus) y el trabajador lo vuelve a fijar tras la sentencia.
      await enScs("SELECT set_config('standard_conforming_strings', 'off', false)")
      const trasAtras = await celda('SHOW standard_conforming_strings')
      check('un set_config por la puerta de atrás: tras la sentencia vuelve a estar on', trasAtras === 'on', String(trasAtras))
      await enScs("SELECT set_config('DateStyle', 'German', false)")
      const estilo = await celda('SHOW DateStyle')
      check('… y lo mismo con DateStyle (también se informa)', estilo === 'ISO, YMD', String(estilo))
      const barra2 = await celda("SELECT 'a\\b' AS x")
      check("… y 'a\\b' sigue siendo de 3 caracteres", barra2 === 'a\\b', `${JSON.stringify(barra2)} (${String(barra2).length} caracteres)`)
      await ex.borrarConsola(PERFIL, KS)
    }

    hr('(24) El FILTRO GUIADO contra el servidor (casos comunes de `casosFiltroGuiado.mts`)')
    {
      const siembra = docker(
        ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'],
        [
          'CREATE TABLE public.fg (id int PRIMARY KEY, nombre text, sueldo numeric(10,2), grande numeric(38,0), alta timestamp, activo boolean);',
          'INSERT INTO public.fg VALUES',
          "(1, 'Ana', 12.5, 123456789012345678901234567890, '2026-09-28 00:00:00', true),",
          "(2, 'ANA_B', 10, 123456789012345678901234567891, '2026-09-28 23:59:59', false),",
          "(3, '50% off', -3.25, 5, '2026-09-29 00:00:00', true),",
          '(4, NULL, NULL, NULL, NULL, NULL),',
          "(5, '', 7, 7, '2026-09-27 12:00:00', false),",
          "(6, 'anaXb', 12.5, 9, '2026-09-01 10:00:00', true);"
        ].join('\n')
      )
      check('siembra de public.fg', siembra.ok, siembra.ok ? 'ok' : siembra.err)
      const ref = { esquema: 'public', nombre: 'fg', tipo: 'tabla' as const }
      await probarFiltroGuiado({
        motor: 'PG',
        col: { id: 'id', nombre: 'nombre', sueldo: 'sueldo', grande: 'grande', alta: 'alta', activo: 'activo' },
        grandes: ['123456789012345678901234567890', '123456789012345678901234567891'],
        booleano: true,
        columnaInexistente: 'condicion',
        abrir: (p) => ex.abrirTabla({ conexionId: 'c1', objeto: ref, maxFilas: 100, ...p }),
        leerMas: (l, m) => ex.leerMas(l, m),
        contar: (l, id) => ex.contar(l, id),
        check
      })
      // Exportar la tabla con el filtro y el orden: el archivo trae SOLO las filas filtradas,
      // en su orden (`[…filtro, null, 0]` en el LIMIT/OFFSET «sin límite» del gestor).
      eleccion = undefined
      const exp = await ex.exportar({
        origen: {
          tipo: 'tabla',
          conexionId: 'c1',
          objeto: ref,
          filtro: { union: 'todas', condiciones: [{ columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: 'ana' }] },
          orden: [{ columna: 'id', dir: 'desc' }]
        },
        formato: 'csv',
        peticionId: 'fg-exp',
        nombreSugerido: 'public.fg',
        motor: 'postgres'
      })
      const csv = exp.ok && exp.valor ? leerExportado(exp.valor.archivo) : ''
      const idsCsv = csv.split(/\r?\n/).slice(1).filter((l) => l !== '').map((l) => l.split(',')[0])
      check('PG · exportar con filtro guiado y orden: solo 6, 2, 1 en ese orden', JSON.stringify(idsCsv) === '["6","2","1"]', JSON.stringify({ idsCsv, exp }))
      const expMal = await ex.exportar({
        origen: { tipo: 'tabla', conexionId: 'c1', objeto: ref, filtro: { union: 'todas', condiciones: [{ columna: 'sueldo', categoria: 'numero', operador: 'igual', valor: 'doce' }] } },
        formato: 'csv',
        peticionId: 'fg-exp-mal',
        nombreSugerido: 'public.fg',
        motor: 'postgres'
      })
      check(
        'PG · exportar con un filtro inválido: rechazado ANTES del diálogo, con campo y condición',
        !expMal.ok && expMal.error.campo === 'filtro' && expMal.error.condicion === 0,
        JSON.stringify(expMal)
      )
    }

    hr('(10) El secreto no aparece en el log')
    const todo = logs.join('\n')
    check('ninguna línea contiene la contraseña', !todo.includes(password), `${logs.length} líneas`)
    check('ni SQL de usuario', !/generate_series|pg_terminate_backend|columna_rota/.test(todo), 'limpio')

    hr('(11) cerrarTodo')
    const vivosAntes = procesos.filter((p) => p.vivo).length
    await ex.cerrarTodo(2500)
    check('ningún proceso de sesión vivo', ex.gestor.procesosVivos() === 0 && procesos.every((p) => !p.vivo) && vivosAntes > 0, `antes=${vivosAntes} después=${procesos.filter((p) => p.vivo).length}`)
    let vivas = -1
    for (let i = 0; i < 30; i++) {
      const r = docker(['exec', contenedor, 'psql', '-U', 'postgres', '-tAc', "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'Tessera/explorador%'"])
      vivas = Number(r.out)
      if (vivas === 0) break
      await dormir(100)
    }
    check('ninguna sesión de Tessera queda en el servidor', vivas === 0, `vivas=${vivas}`)
  } catch (err) {
    check('sin excepciones inesperadas', false, String(err instanceof Error ? err.stack : err))
  } finally {
    if (explorador) await explorador.cerrarTodo(1000)
    docker(['rm', '-f', '-v', contenedor])
    borrado = true
    if (results.some((r) => !r.pass)) {
      console.log('\n--- log ---')
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
