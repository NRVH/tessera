// =============================================================================
// Un PostgreSQL de usar y tirar (Docker, puerto elegido por Docker en 127.0.0.1, con
// contraseña) para las pruebas de interfaz del explorador de BD. `arrancarPostgres`
// devuelve el MOTIVO si no hay Docker o imagen y el spec lo convierte en `test.skip`.
// Se espera con `pg_isready -h 127.0.0.1` y no por el socket: durante el `initdb` la imagen
// levanta un servidor temporal solo en el socket y lo reinicia antes de abrir TCP.
// La siembra viaja por `docker exec -i psql`, sin montar carpetas del host.
// Decisiones: docs/decisiones/pruebas/que-va-en-e2e-y-que-en-test-mts.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

/** La imagen que ya usan `test:db-postgres` y `test:db-trabajador-pg`: una sola descarga. */
export const IMAGEN_POSTGRES = 'postgres:16-alpine'

/**
 * Lo que se siembra. Dos esquemas con los tipos de objeto que el árbol enseña por
 * carpeta, y datos elegidos para lo que la prueba mira:
 *   · `public.profile`: la tabla del autocompletado (`select * from pro`), con PK,
 *     números y NULLs (la rejilla pinta `<null>` y alinea a la derecha).
 *   · `public.numeros`: 1234 filas SIN clave primaria, para el paginado. La página es
 *     de 500, así que abrirla da «500+ filas», desplazarse al final trae la segunda
 *     (1000) y contar da un total que no coincide con ninguna página. Sin PK a
 *     propósito: es el caso en que la píldora avisa de «sin orden estable».
 *   · `ventas`: TRES tablas, para abrir dos y que queden pestañas distintas, con NULLs
 *     y números también, más vista, función, secuencia e índice (la vista y la
 *     función son las que abre la pestaña de fuente).
 * `public` es el esquema por defecto (el `search_path` de `postgres`), así que la
 * insignia arranca en «1 de 4»: public, ventas, information_schema y pg_catalog.
 */
export const SIEMBRA_POSTGRES = `
CREATE TABLE public.profile (
  id int PRIMARY KEY, nombre text NOT NULL, saldo numeric(12,2), nota text
);
CREATE TABLE public.module (
  id int PRIMARY KEY, profile_id int REFERENCES public.profile(id), nombre text
);
CREATE INDEX ix_module_profile ON public.module(profile_id);
CREATE VIEW public.v_perfiles AS SELECT id, nombre FROM public.profile;
CREATE FUNCTION public.doble(x int) RETURNS int LANGUAGE sql AS $$ SELECT x * 2 $$;
CREATE SEQUENCE public.seq_e2e START 100;
INSERT INTO public.profile VALUES
  (1, 'Gerente Nomina', 1234.50, NULL),
  (2, 'Analista', NULL, 'sin saldo'),
  (3, 'Auditor', -7.25, NULL);
INSERT INTO public.module VALUES (1, 1, 'nomina'), (2, 2, 'reportes');
CREATE TABLE public.numeros AS SELECT n FROM generate_series(1, 1234) AS n;

CREATE SCHEMA ventas;
CREATE TABLE ventas.cliente (id int PRIMARY KEY, nombre text NOT NULL, credito numeric(10,2));
CREATE TABLE ventas.factura (
  id int PRIMARY KEY, cliente_id int REFERENCES ventas.cliente(id), importe numeric(10,2), nota text
);
CREATE TABLE ventas.producto (id int PRIMARY KEY, nombre text, precio numeric(8,2));
CREATE INDEX ix_factura_cliente ON ventas.factura(cliente_id);
CREATE VIEW ventas.v_facturas AS SELECT f.id, c.nombre, f.importe FROM ventas.factura f JOIN ventas.cliente c ON c.id = f.cliente_id;
CREATE FUNCTION ventas.total_cliente(c int) RETURNS numeric LANGUAGE sql AS $$ SELECT sum(importe) FROM ventas.factura WHERE cliente_id = c $$;
CREATE SEQUENCE ventas.seq_facturas START 1000;
INSERT INTO ventas.cliente VALUES (1, 'Ana', 500.00), (2, 'Bea', NULL), (3, 'Ciro', 12.5);
INSERT INTO ventas.factura VALUES (10, 1, 99.90, NULL), (11, 1, 1500.00, 'urgente'), (12, 2, NULL, NULL);
INSERT INTO ventas.producto VALUES (1, 'tornillo', 0.10), (2, 'tuerca', NULL);
`

export interface PostgresEfimero {
  host: string
  port: number
  password: string
  contenedor: string
  /** Una consulta por `psql` DENTRO del contenedor: otra sesión, ajena a Tessera. */
  psql: (sql: string) => { ok: boolean; out: string; err: string }
  /** Borra el contenedor. Idempotente. */
  parar: () => void
}

/**
 * `fallo: true` distingue lo que es un error DE LA PRUEBA (la siembra no entra) de lo
 * que es falta de entorno (sin Docker, sin imagen): lo primero tiene que poner la
 * prueba en rojo, lo segundo saltarla.
 */
export type ArranquePostgres =
  | { ok: true; pg: PostgresEfimero }
  | { ok: false; motivo: string; fallo: boolean }

function docker(args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', input, windowsHide: true, timeout: 60_000 })
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || String(r.error ?? '')).trim() }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Arranca, espera y siembra. Si algo falla ANTES de tener el contenedor, devuelve el
 * motivo para saltar; si falla DESPUÉS, lo borra antes de devolverlo.
 */
export async function arrancarPostgres(siembra: string = SIEMBRA_POSTGRES): Promise<ArranquePostgres> {
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) {
    return { ok: false, fallo: false, motivo: 'Docker no responde (¿Docker Desktop apagado?)' }
  }
  if (!docker(['image', 'inspect', IMAGEN_POSTGRES]).ok) {
    return { ok: false, fallo: false, motivo: `falta la imagen ${IMAGEN_POSTGRES} (docker pull ${IMAGEN_POSTGRES})` }
  }
  const password = randomBytes(12).toString('hex')
  const run = docker(['run', '-d', '--rm', '-p', '127.0.0.1::5432', '-e', `POSTGRES_PASSWORD=${password}`, IMAGEN_POSTGRES])
  if (!run.ok) return { ok: false, fallo: false, motivo: `no se pudo arrancar el contenedor: ${run.err}` }
  const contenedor = run.out
  let borrado = false
  const parar = (): void => {
    if (borrado) return
    borrado = true
    // `-v`: la imagen de postgres declara un VOLUME, y un `rm -f` le gana al borrado de
    // `--rm` y lo deja huérfano (uno por corrida; medido, como en
    // test-db-postgres).
    docker(['rm', '-f', '-v', contenedor])
  }
  // Red de seguridad: `--rm` sólo borra al PARAR, y un worker de Playwright que muere
  // a medias no llega al `afterAll`. `spawnSync` sí corre dentro de 'exit'.
  process.once('exit', parar)

  const puertoTexto = docker(['port', contenedor, '5432/tcp']).out.split('\n')[0] || ''
  const port = Number(puertoTexto.slice(puertoTexto.lastIndexOf(':') + 1))
  if (!Number.isInteger(port) || port <= 0) {
    parar()
    return { ok: false, fallo: false, motivo: `Docker no publicó el puerto (${puertoTexto || 'vacío'})` }
  }
  let listo = false
  for (let i = 0; i < 120 && !listo; i++) {
    listo = docker(['exec', contenedor, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).ok
    if (!listo) await dormir(500)
  }
  if (!listo) {
    parar()
    return { ok: false, fallo: false, motivo: 'postgres no aceptó conexiones en 60 s' }
  }
  const psql = (sql: string): { ok: boolean; out: string; err: string } =>
    docker(['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-f', '-'], sql)
  const s = psql(siembra)
  if (!s.ok) {
    parar()
    // La siembra es NUESTRA: si falla es un error de la prueba, no un motivo para
    // saltar (`fallo: true`, y el spec lo pone en rojo).
    return { ok: false, fallo: true, motivo: `la siembra falló: ${s.err}` }
  }
  return { ok: true, pg: { host: '127.0.0.1', port, password, contenedor, psql, parar } }
}
