// =============================================================================
// Prueba de la construcción del entorno de las terminales de modo nativo (`hostEnv.ts`): un solo ámbito,
// lo montado (el espacio de datos como un proyecto más, sin «ver todas»), la marca informativa del espacio
// solo en él y sin cambiar el ámbito, la causa de cada id montado descartado y la huella del destino con
// cada contraseña. (node src/main/db/test-host-env.mts)
// Decisiones: docs/decisiones/bd/puente-entorno-de-las-terminales.md
// =============================================================================
import {
  avisosDeDescartados,
  construirEntornoHost,
  registroParaDescartes,
  variablesDeSecreto,
  type ConexionParaEntorno,
  type EntornoHostDeps,
  type RegistroParaDescartes
} from './hostEnv.ts'
import {
  ENV_DRIVERS,
  ENV_ESPACIO,
  ENV_PERFIL,
  ENV_REGISTRO,
  ENV_SCOPE,
  ENV_SESION,
  envVarDestino,
  envVarSecreto
} from '../../shared/db-ipc.ts'
import { huellaDestino } from './huellaDestino.ts'

let fallos = 0

function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) {
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

const BIN = 'C:\\Users\\yo\\AppData\\Roaming\\tessera\\bin\\s2'
const REGISTRO = 'C:\\Users\\yo\\AppData\\Roaming\\tessera\\db-connections.json'
const DRIVERS = 'C:\\Users\\yo\\AppData\\Roaming\\tessera\\drivers'
const ESPACIO = 'C:\\Users\\yo\\AppData\\Roaming\\tessera\\conexiones\\p1'
const PROYECTO = 'D:\\Repos\\mi-proyecto'

/**
 * Conexiones de mentira: dos del perfil p1 y una de otro, para probar el filtro. Cada una con
 * su destino, que entra en la huella que acompaña a su contraseña (ver la cabecera).
 */
const DESTINO = { motor: 'postgres', host: 'db.lan', port: 5432, database: 'demo', user: 'u' }
const CONEXIONES: Record<string, ConexionParaEntorno[]> = {
  p1: [
    { ...DESTINO, id: 'a', profileId: 'p1' },
    { ...DESTINO, id: 'b', profileId: 'p1', motor: 'oracle', port: 1521, database: undefined, sid: 'XE' }
  ],
  p2: [{ ...DESTINO, id: 'z', profileId: 'p2' }]
}

/** `ilegible` simula una conexión cuyo secreto safeStorage no puede descifrar. */
function deps(ilegible: string[] = []): EntornoHostDeps {
  return {
    binDir: BIN,
    registryPath: REGISTRO,
    driversDir: DRIVERS,
    conexionesDelPerfil: (id) => CONEXIONES[id] ?? [],
    secretoDe: (id) => (ilegible.includes(id) ? null : `secreto-de-${id}`),
    espacioDeDatos: () => ESPACIO
  }
}

console.log('\nEntorno de las terminales de modo Windows\n')

// --- El invariante nuevo -----------------------------------------------------
{
  // ANTES: sin bases montadas se devolvía `{}`, el PATH no se tocaba y el comando
  // `tdb` no existía. Para quien lo teclea eso es indistinguible de "esta función no
  // existe en Tessera": ni comando, ni mensaje, ni pista. Ahora `tdb` está siempre y
  // puede explicar que a este proyecto no se le ha montado nada.
  const { env } = construirEntornoHost(deps(), 'p1', PROYECTO, [])
  comprobar('sin nada montado, el PATH con el atajo va IGUALMENTE', env.PATH === BIN, JSON.stringify(env))
  comprobar('sin nada montado, el ámbito se define VACÍO', env[ENV_SCOPE] === '', JSON.stringify(env))
  comprobar('sin nada montado, no se filtra ningún secreto', Object.keys(env).every((k) => !k.startsWith('TESSERA_DB_SECRET_')))
  comprobar('el perfil y el registro van siempre', env[ENV_PERFIL] === 'p1' && env[ENV_REGISTRO] === REGISTRO)
  comprobar('la carpeta de drivers va siempre', env[ENV_DRIVERS] === DRIVERS)
}

// --- Ámbito de un proyecto ---------------------------------------------------
{
  const { env, diag } = construirEntornoHost(deps(), 'p1', PROYECTO, ['a'])
  comprobar('solo entra el secreto de lo MONTADO', env[envVarSecreto('a')] === 'secreto-de-a')
  comprobar('lo NO montado no deja secreto en el entorno', env[envVarSecreto('b')] === undefined)
  comprobar('el ámbito lista exactamente lo montado', env[ENV_SCOPE] === 'a', env[ENV_SCOPE])
  comprobar('el diagnóstico cuenta bien', diag.idsPedidos === 1 && diag.idsValidos === 1 && diag.secretosResueltos === 1)
}

// --- La huella del destino de cada contraseña ---------------
{
  const [a, b] = CONEXIONES.p1
  const { env, diag } = construirEntornoHost(deps(), 'p1', PROYECTO, ['a', 'b'])
  comprobar(
    'cada contraseña va con la huella del destino de SU conexión',
    env[envVarDestino('a')] === huellaDestino(a) && env[envVarDestino('b')] === huellaDestino(b),
    JSON.stringify([env[envVarDestino('a')], env[envVarDestino('b')]])
  )
  comprobar(
    'NEGATIVO: dos conexiones con otro destino no comparten huella (la de una no vale para la otra)',
    env[envVarDestino('a')] !== env[envVarDestino('b')]
  )
  comprobar(
    'la huella NO se cuenta como secreto (no empieza por TESSERA_DB_SECRET_) y el diagnóstico solo lleva su nombre',
    !envVarDestino('a').startsWith('TESSERA_DB_SECRET_') && diag.claves.includes(envVarDestino('a')) && !diag.claves.includes(huellaDestino(a)),
    JSON.stringify(diag.claves)
  )
  // `variablesDeSecreto` es la que usa también el «Probar» del main sin puente
  // (`entornoDe` en `controlador/invocacionTdb.ts`, que no se puede probar sin Electron): las dos juntas.
  comprobar(
    'variablesDeSecreto: el secreto y la huella de su destino, las dos juntas y nada más',
    JSON.stringify(variablesDeSecreto(a, 's')) === JSON.stringify({ [envVarSecreto('a')]: 's', [envVarDestino('a')]: huellaDestino(a) }),
    JSON.stringify(Object.keys(variablesDeSecreto(a, 's')))
  )
  const sinSecreto = construirEntornoHost(deps(['b']), 'p1', PROYECTO, ['a', 'b']).env
  comprobar(
    'una conexión sin secreto legible no deja huella suelta (no hay contraseña que atar)',
    sinSecreto[envVarDestino('b')] === undefined && sinSecreto[envVarDestino('a')] === huellaDestino(a),
    JSON.stringify(Object.keys(sinSecreto))
  )
  // Lo que NO entra en la huella: renombrarla, su entorno, sus notas, su driver o su solo
  // lectura no la mandan a otro sitio. Y cada campo que SÍ entra la cambia.
  const base = { motor: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u' }
  const h = huellaDestino(base)
  const iguales = [{ ...base, alias: 'otro' }, { ...base, readonly: false }, { ...base, entorno: 'produccion' }, { ...base, notas: 'x', driverId: 'pg' }]
  const distintos: Array<[string, object]> = [
    ['motor', { ...base, motor: 'oracle' }],
    ['host', { ...base, host: 'h2' }],
    ['port', { ...base, port: 5433 }],
    ['database', { ...base, database: 'd2' }],
    ['sid', { ...base, sid: 'XE' }],
    ['user', { ...base, user: 'u2' }]
  ]
  comprobar(
    'NEGATIVO: lo que no es el destino (alias, solo lectura, entorno, notas, driver) no cambia la huella',
    iguales.every((c) => huellaDestino(c) === h)
  )
  const noCambian = distintos.filter(([, c]) => huellaDestino(c as typeof base) === h).map(([k]) => k)
  comprobar('y cada campo del destino (motor, host, puerto, base, SID, usuario) sí la cambia', noCambian.length === 0, noCambian.join(',') || 'todos')
  comprobar(
    'una clave ausente y una a `null` son la misma (el disco no guarda las ausentes)',
    huellaDestino({ ...base, sid: undefined }) === huellaDestino({ ...base, sid: null }) && huellaDestino({ ...base, sid: null }) === h
  )
}

// --- Espacio de datos: ve solo lo montado ------------------------------------
{
  // Se retiró la regla "la consola de datos ve todas": el agente del espacio de datos
  // usa el selector de montaje como cualquier proyecto. Antes esta ruta NO definía el
  // ámbito (ausente = todas) y recibía los secretos de todo el perfil; ahora, con
  // nada montado, no ve ninguna.
  const { env, diag } = construirEntornoHost(deps(), 'p1', ESPACIO, [])
  comprobar('el espacio de datos se sigue reconociendo por la ruta (solo diagnóstico)', diag.espacioDatos)
  comprobar('el espacio de datos DEFINE el ámbito, vacío si no hay nada montado', env[ENV_SCOPE] === '', JSON.stringify(env))
  comprobar(
    'sin nada montado, el espacio de datos no recibe ningún secreto',
    Object.keys(env).every((k) => !k.startsWith('TESSERA_DB_SECRET_')),
    JSON.stringify(Object.keys(env))
  )
  comprobar('y el diagnóstico no cuenta el perfil entero como pedido', diag.idsPedidos === 0 && diag.idsValidos === 0)
}
{
  const { env, diag } = construirEntornoHost(deps(), 'p1', ESPACIO, ['b'])
  comprobar('el espacio de datos ve EXACTAMENTE lo montado', env[ENV_SCOPE] === 'b', env[ENV_SCOPE])
  comprobar('con el secreto de lo montado', env[envVarSecreto('b')] === 'secreto-de-b')
  comprobar('y sin el de lo no montado', env[envVarSecreto('a')] === undefined)
  comprobar('el diagnóstico cuenta lo montado', diag.idsPedidos === 1 && diag.idsValidos === 1, JSON.stringify(diag))
}
{
  // La misma carpeta puede llegar con barras al revés o con otra caja según venga del
  // main, de un estado persistido o de un diálogo. Ya no cambia qué bases se ven,
  // pero el registro tiene que etiquetar bien la terminal: un diagnóstico que se
  // equivoca manda a buscar el fallo a otro sitio.
  const raro = ESPACIO.replace(/\\/g, '/').toUpperCase() + '/'
  const { diag } = construirEntornoHost(deps(), 'p1', raro, [])
  comprobar('la ruta del espacio se compara sin distinguir barra ni caja', diag.espacioDatos, raro)
  const otro = construirEntornoHost(deps(), 'p1', PROYECTO, []).diag
  comprobar('un proyecto normal no se etiqueta como espacio de datos', !otro.espacioDatos)
  // Un id de perfil que no pasa la validación no tiene espacio: `DbController` sirve
  // una ruta vacía, que no puede coincidir con ninguna (ni siquiera con otra vacía).
  const vacio: EntornoHostDeps = { ...deps(), espacioDeDatos: () => '' }
  comprobar('un espacio vacío no coincide con nada', !construirEntornoHost(vacio, 'p1', '', []).diag.espacioDatos)
}

// --- La marca informativa del espacio (redacción de `tdb`) -------------------
{
  // Las dos mitades. En el espacio, la marca vale '1'; en un proyecto se escribe VACÍA
  // (no se omite): el entorno se fusiona encima del heredado, y un '1' heredado de un
  // Tessera lanzado desde el espacio no debe colarse en las terminales de un proyecto.
  const espacio = construirEntornoHost(deps(), 'p1', ESPACIO, ['a']).env
  const proyecto = construirEntornoHost(deps(), 'p1', PROYECTO, ['a']).env
  comprobar('el espacio de datos lleva la marca TESSERA_DB_ESPACIO=1', espacio[ENV_ESPACIO] === '1', JSON.stringify(espacio))
  comprobar(
    'un proyecto la lleva VACÍA (pisa un 1 heredado)',
    proyecto[ENV_ESPACIO] === '',
    JSON.stringify(proyecto[ENV_ESPACIO])
  )
  // La marca NO toca el ámbito ni los secretos: con la marca a '', el entorno del
  // espacio es EXACTAMENTE el de un proyecto con los mismos montajes.
  const espacioSinMarca = { ...espacio, [ENV_ESPACIO]: '' }
  comprobar(
    'sin la marca, el entorno del espacio es idéntico al de un proyecto con lo mismo montado',
    JSON.stringify(espacioSinMarca) === JSON.stringify(proyecto),
    `${JSON.stringify(espacioSinMarca)} / ${JSON.stringify(proyecto)}`
  )
  // Misma comparación de rutas que el diagnóstico: con barras y caja cambiadas, sigue
  // siendo el espacio; con un espacio vacío (id no válido), no lo es nadie.
  const raro = ESPACIO.replace(/\\/g, '/').toUpperCase() + '/'
  comprobar('la marca sigue a la ruta aunque cambien barra y caja', construirEntornoHost(deps(), 'p1', raro, []).env[ENV_ESPACIO] === '1')
  const vacio: EntornoHostDeps = { ...deps(), espacioDeDatos: () => '' }
  comprobar('sin espacio conocido la marca va vacía', construirEntornoHost(vacio, 'p1', '', []).env[ENV_ESPACIO] === '')
  // Y va en el registro de claves, como el resto (solo el NOMBRE).
  comprobar(
    'el diagnóstico la cuenta entre las claves',
    construirEntornoHost(deps(), 'p1', ESPACIO, []).diag.claves.includes(ENV_ESPACIO)
  )
}

// --- Modo puente: el token no puede pedir "todas" ----------------------------
{
  // El puente sirve el ámbito en caliente. Lo que se comprueba aquí es lo que la
  // construcción le PASA: el ámbito inicial (lo montado, también en el espacio de
  // datos) y un `mint` que ya no recibe ningún "ver todas" — solo la marca
  // INFORMATIVA del espacio, que el puente devuelve a `tdb` para sus mensajes.
  const llamadas: { mint: unknown[][]; ambito: unknown[][] } = { mint: [], ambito: [] }
  const conPuente: EntornoHostDeps = {
    ...deps(),
    puente: {
      pipe: '\\\\.\\pipe\\tessera-db-0123456789abcdef',
      mint: (...args) => {
        llamadas.mint.push(args)
        return 'token-de-prueba'
      },
      fijarAmbito: (...args) => {
        llamadas.ambito.push([args[0], args[1], [...args[2]]])
      }
    }
  }
  const { env, diag } = construirEntornoHost(conPuente, 'p1', ESPACIO, ['a', 'fantasma'])
  comprobar('en modo puente no viaja ninguna contraseña', Object.keys(env).every((k) => !k.startsWith('TESSERA_DB_SECRET_')))
  comprobar(
    'ni ninguna huella (las manda el puente con cada secreto, en caliente)',
    Object.keys(env).every((k) => !k.startsWith('TESSERA_DB_DESTINO_')),
    JSON.stringify(Object.keys(env))
  )
  comprobar('el token acuñado va en el entorno', env[ENV_SESION] === 'token-de-prueba', JSON.stringify(env))
  comprobar(
    'mint recibe perfil, proyecto y SOLO la marca informativa del espacio (ningún "consola")',
    JSON.stringify(llamadas.mint) === JSON.stringify([['p1', ESPACIO, { espacioDatos: true }]]),
    JSON.stringify(llamadas.mint)
  )
  comprobar(
    'el ámbito inicial del espacio de datos es lo montado y válido, no el perfil entero',
    JSON.stringify(llamadas.ambito) === JSON.stringify([['p1', ESPACIO, ['a']]]),
    JSON.stringify(llamadas.ambito)
  )
  comprobar('el ámbito de respaldo del entorno coincide', env[ENV_SCOPE] === 'a', env[ENV_SCOPE])
  comprobar('en modo puente el espacio lleva también la marca de respaldo', env[ENV_ESPACIO] === '1', JSON.stringify(env))
  comprobar('el diagnóstico delata el id descartado', diag.idsPedidos === 2 && diag.idsValidos === 1, JSON.stringify(diag))

  // La otra mitad: un PROYECTO acuña con la marca en false y sin variable de respaldo.
  llamadas.mint.length = 0
  const deProyecto = construirEntornoHost(conPuente, 'p1', PROYECTO, ['a']).env
  comprobar(
    'un proyecto acuña con espacioDatos:false',
    JSON.stringify(llamadas.mint) === JSON.stringify([['p1', PROYECTO, { espacioDatos: false }]]),
    JSON.stringify(llamadas.mint)
  )
  comprobar('y en modo puente la marca también va vacía', deProyecto[ENV_ESPACIO] === '', JSON.stringify(deProyecto[ENV_ESPACIO]))
}

// --- Defensa ante ids basura -------------------------------------------------
{
  const { env, diag } = construirEntornoHost(deps(), 'p1', PROYECTO, ['a', 'z', 'fantasma'])
  comprobar('descarta un id de OTRO perfil', env[envVarSecreto('z')] === undefined)
  comprobar('descarta un id que ya no existe', env[envVarSecreto('fantasma')] === undefined)
  comprobar('el ámbito solo lleva los válidos', env[ENV_SCOPE] === 'a', env[ENV_SCOPE])
  comprobar(
    'el diagnóstico DELATA los descartados',
    diag.idsPedidos === 3 && diag.idsValidos === 1,
    JSON.stringify(diag)
  )
  comprobar(
    'y dice CUÁLES, en el orden pedido (para que el log los nombre)',
    JSON.stringify(diag.idsDescartados) === '["z","fantasma"]',
    JSON.stringify(diag.idsDescartados)
  )
}

// --- La CAUSA de cada descarte ----------------------------
// El log decía «AVISO: N id(s) montado(s) no existen en el perfil» de TODO descarte, y
// su comentario lo daba por «SIEMPRE un fallo real». Con el registro bloqueado (formato
// ajeno, o un archivo que no se pudo leer) o con conexiones AJENAS montadas, esos ids SÍ
// existen en el archivo: el log mandaba a buscar un fallo de montaje que no había. La
// cadena con el store real está en `test-registro-conexiones`; aquí, la regla sola.
{
  const legible: RegistroParaDescartes = { avisoRegistro: null, idsAjenas: new Set(['lite']) }
  const lineas = avisosDeDescartados(['lite', 'fantasma', 'otro'], legible, 'p1')
  comprobar(
    'una ajena montada es una NOTA (existe; esta versión no sabe usarla), no «no existen»',
    lineas.length === 2 && lineas[0].startsWith('NOTA: 1 id(s)') && lineas[0].includes('lite') && !lineas[0].includes('no existen'),
    JSON.stringify(lineas)
  )
  comprobar(
    'NEGATIVO: lo que de verdad no existe sigue siendo un AVISO, con sus ids y el perfil',
    lineas[1] === 'AVISO: 2 id(s) montado(s) no existen en el perfil "p1" (de otro perfil, o conexión borrada) y se descartaron: fantasma,otro',
    JSON.stringify(lineas[1])
  )
  const bloqueado = avisosDeDescartados(['a', 'b'], { avisoRegistro: 'No se puede leer el registro…', idsAjenas: new Set() }, 'p1')
  comprobar(
    'con el registro bloqueado: UNA nota que culpa al registro (con su aviso), ningún «no existen»',
    bloqueado.length === 1 &&
      bloqueado[0].startsWith('NOTA: 2 id(s)') &&
      bloqueado[0].includes('bloqueado') &&
      bloqueado[0].includes('No se puede leer el registro…') &&
      !bloqueado[0].includes('no existen'),
    JSON.stringify(bloqueado)
  )
  comprobar('sin descartes, ninguna línea', avisosDeDescartados([], legible, 'p1').length === 0)
  comprobar(
    'registroParaDescartes: la marca con su aviso y las ajenas, de la respuesta de listaCompleta',
    JSON.stringify([
      ...registroParaDescartes({ conexiones: [], ajenas: [{ id: 'x', profileId: 'p1', alias: 'X', motor: 'sqlite' }], formatoAjeno: false }).idsAjenas
    ]) === '["x"]' &&
      registroParaDescartes({ conexiones: [], ajenas: [], formatoAjeno: false }).avisoRegistro === null &&
      registroParaDescartes({ conexiones: [], ajenas: [], formatoAjeno: true, aviso: 'Z' }).avisoRegistro === 'Z'
  )
}

// --- Secreto ilegible --------------------------------------------------------
{
  // safeStorage puede no poder descifrar (perfil de Windows restaurado, p.ej.). La
  // conexión se lista igual pero no conecta, y desde fuera eso se parece demasiado a
  // "tdb no funciona". El contador es lo que permite distinguirlo en el log.
  const { env, diag } = construirEntornoHost(deps(['b']), 'p1', PROYECTO, ['a', 'b'])
  comprobar('una conexión sin secreto legible NO rompe el resto', env[envVarSecreto('a')] === 'secreto-de-a')
  comprobar('la ilegible se omite del entorno', env[envVarSecreto('b')] === undefined)
  comprobar('pero SIGUE en el ámbito (tdb la lista y explica el fallo)', env[ENV_SCOPE] === 'a,b', env[ENV_SCOPE])
  comprobar(
    'el diagnóstico distingue "no hay ids" de "no hay secretos"',
    diag.idsValidos === 2 && diag.secretosResueltos === 1,
    JSON.stringify(diag)
  )
}

// --- Higiene del registro ----------------------------------------------------
{
  const { diag } = construirEntornoHost(deps(), 'p1', PROYECTO, ['a', 'b'])
  comprobar(
    'el diagnóstico solo lleva NOMBRES de variable, nunca valores',
    diag.claves.every((k) => typeof k === 'string' && !k.includes('secreto')),
    JSON.stringify(diag.claves)
  )
}

console.log(`\n${fallos === 0 ? '✓ TODO VERDE' : `✗ ${fallos} FALLO(S)`}\n`)
process.exit(fallos === 0 ? 0 : 1)
