// =============================================================================
// Prueba de la escalada de thin a thick de Oracle (`oracle.cjs` y `clienteOracle.cjs`): qué errores
// del modo thin (NJS-138, NJS-533, NJS-116) cargan el Instant Client, cómo se carga con un `oracledb` de
// mentira, el `sqlnet.ora` del explorador, las versiones y los textos de «falta el cliente». No toca la red.
// Decisiones: docs/decisiones/bd/adaptador-oracle-escalada-y-stop.md
// =============================================================================

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const oracle = require_(path.join(path.dirname(fileURLToPath(import.meta.url)), 'oracle.cjs'))

let fallos = 0
function prueba(nombre: string, fn: () => void): void {
  try {
    fn()
    console.log(`  ok  ${nombre}`)
  } catch (err) {
    fallos++
    console.log(`  FALLA  ${nombre}`)
    console.log(`        ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log('\nEscalada thin -> thick\n')

prueba('cifrado nativo de red (NJS-533) escala', () => {
  const err = Object.assign(
    new Error(
      'NJS-533: Advanced Networking Option service negotiation failed. Native Network ' +
        'Encryption and DataIntegrity only supported in node-oracledb thick mode.\n' +
        'Cause: ORA-12660'
    ),
    { code: 'NJS-533' }
  )
  const limite = oracle.limiteDeThin(err)
  assert.ok(limite, 'NJS-533 debería escalar a thick')
  assert.match(limite.motivo, /cifrado nativo/)
})

prueba('servidor anterior a 12.1 (NJS-138) escala', () => {
  const err = Object.assign(
    new Error('NJS-138: Thin mode connection is not supported to this database version 11.2.0.4.0'),
    { code: 'NJS-138' }
  )
  assert.ok(oracle.limiteDeThin(err))
})

prueba('verificador de contraseña antiguo (NJS-116) escala', () => {
  assert.ok(oracle.limiteDeThin(new Error('NJS-116: password verifier type 0x939 is not supported')))
})

prueba('el código basta aunque el mensaje venga envuelto', () => {
  assert.ok(oracle.limiteDeThin({ code: 'NJS-533', message: 'fallo al conectar' }))
})

prueba('un fallo de red o credenciales NO escala', () => {
  // Escalar aquí sería peor que no hacerlo: cargaría el driver, reintentaría y
  // devolvería el mismo error después de tardar el doble.
  assert.equal(oracle.limiteDeThin(Object.assign(new Error('ORA-12170: TNS:Connect timeout occurred'), { code: 'ORA-12170' })), null)
  assert.equal(oracle.limiteDeThin(new Error('ORA-01017: invalid username/password')), null)
  assert.equal(oracle.limiteDeThin(new Error('NJS-090: initOracleClient ya se llamó')), null)
  assert.equal(oracle.limiteDeThin(undefined), null)
})

console.log('\nVersión del servidor a partir del mensaje\n')

prueba('se extrae de un banner y de un NJS-138', () => {
  assert.equal(
    oracle.versionDeTexto('Oracle Database 11g Enterprise Edition Release 11.2.0.4.0 - 64bit'),
    11.2
  )
  assert.equal(oracle.versionDeTexto('NJS-138: ... database version 11.2.0.4.0'), 11.2)
})

prueba('el mensaje de NJS-533 no inventa una versión', () => {
  // Se comprueba porque el pack se elige por versión: una versión inventada elegiría
  // el cliente equivocado. Con null se cae al 19, que es el que cubre 11.2 y superior.
  const texto =
    'NJS-533: Advanced Networking Option service negotiation failed. Cause: ORA-12660 ' +
    'Help: https://docs.oracle.com/error-help/db/ora-12660'
  assert.equal(oracle.versionDeTexto(texto), null)
  const pack = oracle.packParaServidor(
    [
      { id: 'oracle-ic-19', motor: 'oracle', servidorDesde: 11.2, servidorHasta: 99 },
      { id: 'oracle-ic-12.1', motor: 'oracle', servidorDesde: 10.2, servidorHasta: 11.1 }
    ],
    null
  )
  assert.equal(pack?.id, 'oracle-ic-19')
})

// El sqlnet.ora del explorador (ver la cabecera de oracle.cjs): medido contra una 11.2
// en thick, sin DISABLE_OOB el Stop no cortaba y al Forzar la sesión seguía viva en el
// servidor. Lo que se fija aquí es lo que no se ve en esa prueba de red: que se
// incluye el sqlnet.ora del usuario, cuál, y que el nuestro va después.
console.log('\nsqlnet.ora del explorador (DISABLE_OOB)\n')

const existeEn =
  (...rutas: string[]) =>
  (r: string): boolean =>
    rutas.includes(r)

prueba('TNS_ADMIN manda sobre el network/admin del cliente', () => {
  const tns = path.join('C:', 'oracle', 'tns')
  const ic = path.join('C:', 'drivers', 'ic19')
  const deTns = path.join(tns, 'sqlnet.ora')
  const deIc = path.join(ic, 'network', 'admin', 'sqlnet.ora')
  assert.equal(oracle.sqlnetDelUsuario({ TNS_ADMIN: tns }, ic, existeEn(deTns, deIc)), deTns)
  // Sin sqlnet.ora en TNS_ADMIN se cae al del cliente, como haría él.
  assert.equal(oracle.sqlnetDelUsuario({ TNS_ADMIN: tns }, ic, existeEn(deIc)), deIc)
  assert.equal(oracle.sqlnetDelUsuario({}, ic, existeEn(deIc)), deIc)
})

prueba('sin sqlnet.ora del usuario no hay IFILE', () => {
  assert.equal(oracle.sqlnetDelUsuario({ TNS_ADMIN: '  ' }, path.join('x', 'ic'), () => false), null)
  const c: string = oracle.contenidoSqlnetExplorador(null)
  assert.doesNotMatch(c, /IFILE/)
  assert.match(c, /^DISABLE_OOB=ON$/m)
})

prueba('con sqlnet.ora del usuario: IFILE entre comillas ANTES de DISABLE_OOB', () => {
  // La ruta con espacios es el caso normal en Windows (C:\Users\Nombre Apellido\…).
  const ruta = path.join('C:', 'Users', 'Nombre Apellido', 'tns', 'sqlnet.ora')
  const c: string = oracle.contenidoSqlnetExplorador(ruta)
  const ifile = c.indexOf(`IFILE="${ruta}"`)
  const oob = c.indexOf('DISABLE_OOB=ON')
  assert.ok(ifile >= 0, c)
  assert.ok(oob > ifile, 'DISABLE_OOB tiene que ir después del IFILE')
  // Todo lo demás son comentarios: una línea más sería un parámetro que no se pidió.
  const activas = c.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'))
  assert.deepEqual(activas, [`IFILE="${ruta}"`, 'DISABLE_OOB=ON'])
})

// El error de un Instant Client que
// no carga nombra la biblioteca con su RUTA, y `tdb test` (lo que corre «Probar») lo sacaba
// tal cual en su línea JSON, que llega al renderer. Se limpia en el origen, al cargarlo.
console.log('\nUn cliente que no carga: el error, sin rutas del equipo\n')

const DPI_WIN =
  'DPI-1047: Cannot locate a 64-bit Oracle Client library: "C:\\Users\\Nombre Apellido\\AppData\\Roaming\\Tessera\\drivers\\oracle\\oracle-ic-19\\oci.dll is not the correct architecture". See https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html for help'
const DPI_MAC =
  "DPI-1047: Cannot locate a 64-bit Oracle Client library: \"dlopen(libclntsh.dylib, 0x0001): tried: '/Users/nombre/Library/Application Support/Tessera/drivers/oracle/oracle-ic-19/libclntsh.dylib' (mach-o file, but is an incompatible architecture)\". See https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html for help"
/** Una carpeta de drivers con el centinela del pack, y un `oracledb` de mentira que falla (o no) al cargarlo. */
function cargarCon(fallo: string | null): { r: unknown; err: (Error & { code?: string; errorNum?: number }) | null } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-ic-'))
  try {
    const ic = path.join(dir, 'oracle', 'oracle-ic-19')
    mkdirSync(ic, { recursive: true })
    writeFileSync(path.join(ic, 'oci.dll'), '')
    const ctx = { packs: [{ id: 'oracle-ic-19', motor: 'oracle', centinela: 'oci.dll' }], externos: {}, driversDir: dir }
    const oracledb = {
      initOracleClient: (): void => {
        if (fallo !== null) throw Object.assign(new Error(fallo), { code: 'DPI-1047', errorNum: 1047 })
      }
    }
    try {
      return { r: oracle.cargarInstantClient(oracledb, ctx, 'oracle-ic-19', false), err: null }
    } catch (e) {
      return { r: null, err: e as Error & { code?: string; errorNum?: number } }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

prueba('DPI-1047 de Windows: la ruta del Instant Client -> <cliente>, con su código y la URL de ayuda intacta', () => {
  const { err } = cargarCon(DPI_WIN)
  assert.ok(err, 'tenía que lanzar')
  assert.equal(err.code, 'DPI-1047')
  assert.equal(err.errorNum, 1047)
  assert.doesNotMatch(err.message, /Nombre Apellido|AppData|[A-Za-z]:\\/)
  assert.match(err.message, /<cliente> is not the correct architecture/)
  assert.match(err.message, /https:\/\/node-oracledb\.readthedocs\.io\/en\/latest\/user_guide\/installation\.html/)
})

prueba('DPI-1047 de Mac: la ruta con espacios -> <cliente>', () => {
  const { err } = cargarCon(DPI_MAC)
  assert.ok(err, 'tenía que lanzar')
  assert.doesNotMatch(err.message, /\/Users\/|Application Support/)
  assert.match(err.message, /tried: '<cliente>' \(mach-o file/)
})

prueba('NEGATIVO: un cliente que carga devuelve su carpeta y su pack, como siempre', () => {
  const { r, err } = cargarCon(null)
  assert.equal(err, null)
  assert.equal((r as { packId: string }).packId, 'oracle-ic-19')
})

prueba('la limpieza es la MISMA en el trabajador del explorador (una sola copia)', () => {
  const sesion = require_(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sesionOracle.cjs'))
  assert.equal(sesion.limpiarRutasHost, oracle.limpiarRutasHost)
})

console.log(fallos === 0 ? '\nTodo verde.\n' : `\n${fallos} prueba(s) en rojo.\n`)
process.exit(fallos === 0 ? 0 : 1)
