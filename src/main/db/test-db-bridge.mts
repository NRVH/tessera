// =============================================================================
// Prueba del puente local (`DbBridge`), sin Electron ni Docker: un cambio de ámbito se ve en la siguiente
// invocación, un token revocado deja de servir, ninguna concesión amplía el ámbito ni sirve el perfil entero,
// la respuesta lleva `consola: false` y la marca del espacio de datos, el punto de escucha real es el que
// promete `puntoEscucha.ts`, pausar y reanudar vuelve al mismo punto, y cada secreto va con su huella.
// (node src/main/db/test-db-bridge.mts)
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import { dirname } from 'node:path'
import { DbBridge, type ConexionDelPuente } from './dbBridge.ts'
import { huellaDestino } from './huellaDestino.ts'
import { LIMITE_SUN_PATH } from './puntoEscucha.ts'
import { plataformaActual } from '../../shared/plataforma.ts'

let fallos = 0

function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) {
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

/** El destino de las conexiones de mentira (entra en la huella de cada secreto, ver (7)). */
const DESTINO = { motor: 'postgres', host: 'db.lan', port: 5432, database: 'demo', user: 'u' }
const CONEXIONES: Record<string, ConexionDelPuente[]> = {
  p1: [
    { ...DESTINO, id: 'a', profileId: 'p1' },
    { ...DESTINO, id: 'b', profileId: 'p1', host: 'otra.lan' }
  ],
  p2: [{ ...DESTINO, id: 'z', profileId: 'p2' }]
}

let ahora = 1_000_000
/** Lo que el puente escribe en su registro (en producción, `dbLog('puente', …)`). */
const registro: string[] = []
const puente = new DbBridge({
  conexionesDelPerfil: (id) => CONEXIONES[id] ?? [],
  secretoDe: (id) => (id === 'b' ? null : `clave-${id}`),
  ahora: () => ahora,
  log: (m) => registro.push(m)
})

const PROYECTO = 'D:\\Repos\\demo'

// --- Resolución directa (sin sockets) ---------------------------------------

console.log('\nResolución y ámbito\n')

{
  const token = puente.mint('p1', PROYECTO)
  puente.setScope('p1', PROYECTO, ['a'])
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as {
    ok: boolean
    scope: string[]
    secretos: Record<string, string>
  }
  comprobar('devuelve solo lo montado', r.ok && r.scope.join() === 'a', JSON.stringify(r))
  comprobar('con su secreto', r.secretos.a === 'clave-a')
  comprobar('y ningún secreto de lo no montado', r.secretos.b === undefined)

  // ESTE es el corazón del montaje en caliente: la MISMA sesión, sin reiniciar
  // nada, ve el ámbito nuevo en la siguiente invocación.
  puente.setScope('p1', PROYECTO, ['a', 'b'])
  const r2 = puente.resolver({ v: 1, token, op: 'resolve' }) as { scope: string[] }
  comprobar('un cambio de ámbito se ve SIN reiniciar la sesión', r2.scope.join() === 'a,b', JSON.stringify(r2))

  // Desmontar también aplica al momento: si no, una base retirada seguiría siendo
  // consultable hasta el siguiente reinicio, que es justo lo que no queremos.
  puente.setScope('p1', PROYECTO, [])
  const r3 = puente.resolver({ v: 1, token, op: 'resolve' }) as { scope: string[] }
  comprobar('desmontar también aplica al momento', r3.scope.length === 0, JSON.stringify(r3))
}

{
  // Una conexión cuyo secreto safeStorage no puede descifrar entra en el ámbito
  // pero no en los secretos: `tdb` la lista y explica el fallo al conectar, que es
  // mejor que hacerla desaparecer sin decir nada.
  const token = puente.mint('p1', PROYECTO)
  puente.setScope('p1', PROYECTO, ['a', 'b'])
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as {
    scope: string[]
    secretos: Record<string, string>
    huellas: Record<string, string>
  }
  comprobar('la conexión sin secreto legible SIGUE en el ámbito', r.scope.includes('b'))
  comprobar('pero no aporta secreto', r.secretos.b === undefined)
  // (7) Cada secreto con la huella del destino para el que se sirve, y solo esos: la de `a`
  // es la de SU conexión (no la de `b`, que es de otro host), y `b`, sin secreto, no lleva.
  const [conA, conB] = CONEXIONES.p1
  comprobar(
    'cada secreto va con la huella del destino de SU conexión, con las mismas claves que los secretos',
    r.huellas?.a === huellaDestino(conA) &&
      r.huellas.a !== huellaDestino(conB) &&
      JSON.stringify(Object.keys(r.huellas)) === JSON.stringify(Object.keys(r.secretos)),
    JSON.stringify(r.huellas)
  )
  puente.revoke('x') // no-op, solo para comprobar que no revienta
}

console.log('\nAutorización\n')

{
  const r = puente.resolver({ v: 1, token: 'inventado', op: 'resolve' }) as { ok: boolean }
  comprobar('un token inventado no autoriza', r.ok === false)
}
{
  const r = puente.resolver({ v: 2, token: 'x', op: 'resolve' }) as { ok: boolean; error?: string }
  comprobar('una versión de protocolo distinta se rechaza', r.ok === false)
}
{
  const token = puente.mint('p1', PROYECTO)
  const r = puente.resolver({ v: 1, token, op: 'otra-cosa' }) as { ok: boolean }
  comprobar('una operación desconocida se rechaza', r.ok === false)
}
{
  // El ámbito no se pide: lo decide el main. Si un campo de la petición pudiera
  // ampliarlo, cualquier proceso de la terminal podría ascender su propio ámbito con
  // un campo JSON y ver conexiones de otros proyectos del perfil. El `consola: true`
  // es el campo que un día SÍ significó "todas" (en el token, no en la petición).
  const token = puente.mint('p1', PROYECTO)
  puente.setScope('p1', PROYECTO, ['a'])
  const r = puente.resolver({ v: 1, token, op: 'resolve', consola: true } as never) as {
    scope: string[]
  }
  comprobar('el cliente NO puede ascender su ámbito a "consola"', r.scope.join() === 'a', JSON.stringify(r))
}

console.log('\nEspacio de datos: ve solo lo montado\n')

// Se retiró la regla "la consola de datos ve todas": el agente del espacio de datos
// del perfil usa el selector de montaje como cualquier proyecto. Estas comprobaciones
// fijan que NINGUNA concesión sirve el perfil entero, y que la respuesta sigue
// diciendo `consola: false`, que es lo que `tdb.cjs` lee para tratar el ámbito como
// definido. La marca `espacioDatos` (solo redacción) tiene su sección más abajo.
const ESPACIO = 'C:\\Users\\yo\\AppData\\Roaming\\tessera\\conexiones\\p1'
{
  const token = puente.mint('p1', ESPACIO)
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as {
    ok: boolean
    scope: string[]
    secretos: Record<string, string>
    consola: boolean
  }
  comprobar('el espacio de datos SIN nada montado no ve ninguna', r.ok && r.scope.length === 0, JSON.stringify(r))
  comprobar('ni recibe ningún secreto', Object.keys(r.secretos).length === 0, JSON.stringify(r.secretos))
  comprobar('y la respuesta dice consola:false (tdb trata el ámbito como definido)', r.consola === false)
}
{
  const token = puente.mint('p1', ESPACIO)
  puente.setScope('p1', ESPACIO, ['a'])
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as { scope: string[]; secretos: Record<string, string> }
  comprobar('el espacio de datos ve EXACTAMENTE lo montado', r.scope.join() === 'a', JSON.stringify(r))
  comprobar('sin secretos de lo no montado', r.secretos.b === undefined)
  // En caliente, como un proyecto: montar la segunda aplica en la siguiente invocación.
  puente.setScope('p1', ESPACIO, ['a', 'b'])
  const r2 = puente.resolver({ v: 1, token, op: 'resolve' }) as { scope: string[] }
  comprobar('y montar otra aplica en caliente', r2.scope.join() === 'a,b', JSON.stringify(r2))
  puente.setScope('p1', ESPACIO, [])
}
{
  // Ningún camino sirve MÁS de lo montado: en cualquier ruta —un proyecto con algo
  // montado, el espacio de datos, una ruta vacía, una desconocida— lo que responde el
  // puente es exactamente el ámbito de esa ruta. Y el token de un solo uso acota a SU
  // conexión.
  const rutas = [PROYECTO, ESPACIO, '', 'C:\\otra\\ruta']
  const detalle: string[] = []
  const soloLoMontado = rutas.every((ruta) => {
    const r = puente.resolver({ v: 1, token: puente.mint('p1', ruta), op: 'resolve' }) as { scope: string[] }
    const montado = puente.getScope('p1', ruta).join()
    detalle.push(`${ruta || '(vacía)'}: ${r.scope.join()} / ${montado}`)
    return r.scope.join() === montado
  })
  comprobar('ninguna concesión de sesión sirve más de lo montado en su ruta', soloLoMontado, detalle.join(' | '))
  comprobar(
    'y las rutas sin montaje no ven ninguna',
    puente.getScope('p1', ESPACIO).length === 0 && puente.getScope('p1', 'C:\\otra\\ruta').length === 0
  )
  const unaVez = puente.resolver({ v: 1, token: puente.mintUnaVez('b', 'p1'), op: 'resolve' }) as {
    scope: string[]
    consola: boolean
  }
  comprobar(
    'el token de un solo uso tampoco (y también dice consola:false)',
    unaVez.scope.join() === 'b' && unaVez.consola === false,
    JSON.stringify(unaVez)
  )
}

console.log('\nEspacio de datos: la marca informativa\n')

{
  // Las dos mitades de `espacioDatos`: true SOLO en la concesión que se acuñó como
  // espacio; false en un proyecto, en un `mint` sin marca (el de siempre) y en el
  // token de un solo uso.
  type ConMarca = { ok: boolean; scope: string[]; secretos: Record<string, string>; espacioDatos: unknown }
  const resolver = (token: string): ConMarca => puente.resolver({ v: 1, token, op: 'resolve' }) as ConMarca
  puente.setScope('p1', ESPACIO, ['a'])
  puente.setScope('p1', PROYECTO, ['a'])
  const delEspacio = resolver(puente.mint('p1', ESPACIO, { espacioDatos: true }))
  const deProyecto = resolver(puente.mint('p1', PROYECTO, { espacioDatos: false }))
  const sinMarca = resolver(puente.mint('p1', PROYECTO))
  const unaVez = resolver(puente.mintUnaVez('a', 'p1'))
  comprobar('el espacio de datos responde espacioDatos:true', delEspacio.espacioDatos === true, JSON.stringify(delEspacio))
  comprobar('un proyecto responde espacioDatos:false', deProyecto.espacioDatos === false, JSON.stringify(deProyecto))
  comprobar('un mint SIN marca cuenta como proyecto (false, no ausente)', sinMarca.espacioDatos === false, JSON.stringify(sinMarca))
  comprobar('el token de un solo uso dice false', unaVez.espacioDatos === false, JSON.stringify(unaVez))

  // LA MARCA NO CAMBIA EL ÁMBITO. La MISMA ruta del espacio, acuñada con y sin marca,
  // responde exactamente lo mismo salvo la marca: mismas bases y mismos secretos.
  const conMarca = resolver(puente.mint('p1', ESPACIO, { espacioDatos: true }))
  const sinMarcaEspacio = resolver(puente.mint('p1', ESPACIO, { espacioDatos: false }))
  comprobar(
    'con o sin marca, la misma ruta ve el mismo ámbito y los mismos secretos',
    JSON.stringify({ ...conMarca, espacioDatos: null }) === JSON.stringify({ ...sinMarcaEspacio, espacioDatos: null }),
    `${JSON.stringify(conMarca)} / ${JSON.stringify(sinMarcaEspacio)}`
  )
  comprobar('y el ámbito sigue siendo lo montado, no el perfil', conMarca.scope.join() === 'a', JSON.stringify(conMarca))

  // Montar en caliente sigue aplicando igual con la marca puesta.
  const token = puente.mint('p1', ESPACIO, { espacioDatos: true })
  puente.setScope('p1', ESPACIO, ['a', 'b'])
  const tras = resolver(token)
  comprobar('montar otra aplica en caliente también con la marca', tras.scope.join() === 'a,b' && tras.espacioDatos === true, JSON.stringify(tras))
  puente.setScope('p1', ESPACIO, [])
  puente.setScope('p1', PROYECTO, [])

  // Un valor que no es `true` estricto no marca nada (un llamador descuidado).
  const raro = resolver(puente.mint('p1', ESPACIO, { espacioDatos: 'sí' as never }))
  comprobar('solo un true estricto marca el espacio', raro.espacioDatos === false, JSON.stringify(raro))

  // El CLIENTE no puede declararse espacio: lo que diga la petición no cuenta.
  const pedido = puente.resolver({ v: 1, token: puente.mint('p1', PROYECTO), op: 'resolve', espacioDatos: true } as never) as ConMarca
  comprobar('el cliente NO puede pedir la marca en la petición', pedido.espacioDatos === false, JSON.stringify(pedido))
}

console.log('\nCiclo de vida del token\n')

{
  const token = puente.mint('p1', PROYECTO)
  puente.bind(token, 'sesion-1')
  puente.revoke('sesion-1')
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as { ok: boolean }
  comprobar('revocar la sesión invalida su token', r.ok === false)
}
{
  // Un reload acuña token nuevo para la MISMA sesión. El anterior tiene que morir:
  // si no, cada recarga dejaría atrás un token vivo y sin dueño.
  const viejo = puente.mint('p1', PROYECTO)
  puente.bind(viejo, 'sesion-2')
  const nuevo = puente.mint('p1', PROYECTO)
  puente.bind(nuevo, 'sesion-2')
  const rViejo = puente.resolver({ v: 1, token: viejo, op: 'resolve' }) as { ok: boolean }
  const rNuevo = puente.resolver({ v: 1, token: nuevo, op: 'resolve' }) as { ok: boolean }
  comprobar('al reatar una sesión, el token anterior muere', rViejo.ok === false)
  comprobar('y el nuevo funciona', rNuevo.ok === true)
}
{
  // Token de un solo uso (botón "Probar" del panel).
  const token = puente.mintUnaVez('a', 'p1')
  const r1 = puente.resolver({ v: 1, token, op: 'resolve' }) as {
    ok: boolean
    secretos: Record<string, string>
  }
  comprobar('el token de un solo uso sirve una vez', r1.ok === true && r1.secretos.a === 'clave-a')
  const r2 = puente.resolver({ v: 1, token, op: 'resolve' }) as { ok: boolean }
  comprobar('y NO una segunda', r2.ok === false)
}
{
  const token = puente.mintUnaVez('a', 'p1')
  ahora += 61_000 // pasa el minuto de vida
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as { ok: boolean }
  comprobar('el token de un solo uso caduca', r.ok === false)
}
{
  // Autoriza UNA conexión, no el perfil entero.
  const token = puente.mintUnaVez('a', 'p1')
  const r = puente.resolver({ v: 1, token, op: 'resolve' }) as { scope: string[] }
  comprobar('el token de un solo uso acota a SU conexión', r.scope.join() === 'a', JSON.stringify(r))
}

// --- Por el pipe de verdad ---------------------------------------------------

console.log('\nPor el pipe real\n')

puente.start()
await new Promise((r) => setTimeout(r, 250))

{
  // EL PUNTO DE ESCUCHA, de extremo a extremo. La aritmética de `sun_path` la fija
  // `test-punto-escucha.mts` para las dos plataformas; aquí se comprueba que lo que
  // el puente REAL publica en `pipe` es lo que esa aritmética prometió, en la
  // plataforma que toque. Cada rama afirma algo: no hay plataforma que se salte.
  const esPipe = plataformaActual() === 'windows'
  const forma = esPipe ? /^\\\\\.\\pipe\\tessera-db-[0-9a-f]{16}$/ : /\/tessera-[0-9a-f]{16}\/db\.sock$/
  comprobar('el punto de escucha lleva un nombre de 16 hex (64 bits)', forma.test(puente.pipe), puente.pipe)
  const bytes = Buffer.byteLength(puente.pipe, 'utf8')
  comprobar(
    esPipe
      ? 'en Windows es un pipe del kernel, no una ruta del sistema de archivos'
      : `en POSIX la ruta del socket cabe en sun_path (<= ${LIMITE_SUN_PATH} bytes)`,
    esPipe ? puente.pipe.startsWith('\\\\.\\pipe\\') : bytes <= LIMITE_SUN_PATH,
    `${puente.pipe} (${bytes} bytes)`
  )
  // `listo` es lo que decide si el pty recibe el contrato nuevo o el antiguo (las
  // contraseñas en variables): si esto falla, el puente existe pero nadie lo usa.
  comprobar(
    'el puente está listo y lo dejó escrito en el registro',
    puente.listo && registro.some((m) => m.includes('escuchando')),
    JSON.stringify(registro)
  )
}

/** Cliente mínimo: la misma conversación que hace `tdb`. */
function pedir(
  token: string,
  sobrescribir?: string,
  pipe = puente.pipe
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = connect(pipe)
    let buffer = ''
    socket.setTimeout(3000)
    socket.on('timeout', () => {
      socket.destroy()
      resolve(null)
    })
    socket.on('error', () => resolve(null))
    socket.on('data', (t) => {
      buffer += t.toString('utf-8')
    })
    socket.on('end', () => {
      try {
        resolve(JSON.parse(buffer.trim()))
      } catch {
        resolve(null)
      }
    })
    socket.write(sobrescribir ?? JSON.stringify({ v: 1, token, op: 'resolve' }) + '\n')
  })
}

{
  const token = puente.mint('p1', PROYECTO)
  puente.setScope('p1', PROYECTO, ['a'])
  const r = await pedir(token)
  comprobar('el pipe responde igual que la resolución directa', r?.ok === true, JSON.stringify(r))
}
{
  // La marca del espacio cruza el pipe tal cual: es lo que lee `tdb` de verdad.
  const espacio = await pedir(puente.mint('p1', ESPACIO, { espacioDatos: true }))
  const proyecto = await pedir(puente.mint('p1', PROYECTO))
  comprobar(
    'por el pipe, espacioDatos llega true en el espacio y false en un proyecto',
    espacio?.espacioDatos === true && proyecto?.espacioDatos === false,
    `${JSON.stringify(espacio)} / ${JSON.stringify(proyecto)}`
  )
}
{
  const r = await pedir('no-existe')
  comprobar('el pipe rechaza un token inventado', r?.ok === false, JSON.stringify(r))
}
{
  // Un cliente roto (o malicioso) no puede hacer crecer el buffer sin fin.
  const enorme = 'x'.repeat(9000) + '\n'
  const r = await pedir('', enorme)
  comprobar('una petición gigante se corta sin respuesta', r === null)
}
{
  // Concurrencia: el agente y varias terminales del mismo proyecto pueden invocar a
  // la vez sin que las respuestas se crucen.
  const token = puente.mint('p1', PROYECTO)
  puente.setScope('p1', PROYECTO, ['a', 'b'])
  const todas = await Promise.all(Array.from({ length: 30 }, () => pedir(token)))
  comprobar(
    '30 peticiones concurrentes se resuelven todas',
    todas.every((r) => r?.ok === true && (r.scope as string[]).join() === 'a,b')
  )
}

console.log('\nPausa y reanudación (cierre de la app abortado)\n')

// `iniciarCierre` (`app/cierre.ts`) PAUSA el puente y, si la actualización no arranca (su «plan C»),
// aborta el cierre y lo REANUDA. Lo que se fija aquí es lo que decidió `DbBridge`:
// vuelve al MISMO punto con los MISMOS tokens (una terminal viva sigue funcionando
// sin recargar), y si ese punto está ocupado, escucha en uno NUEVO en vez de quedarse
// apagado. Antes, el cierre hacía `stop()` y el puente no volvía hasta reiniciar.
{
  const esPipe = plataformaActual() === 'windows'
  // Una sesión viva: el nombre del pipe y su token viajaron en su entorno al spawn.
  const token = puente.mint('p1', PROYECTO)
  puente.bind(token, 'sesion-viva')
  puente.setScope('p1', PROYECTO, ['a'])
  const nombreAntes = puente.pipe
  const antes = await pedir(token, undefined, nombreAntes)
  comprobar('antes de la pausa, la sesión viva resuelve', antes?.ok === true, JSON.stringify(antes))

  await puente.pausar()
  comprobar(
    'en pausa no está listo ni publica nombre (una terminal nueva no lo anunciaría)',
    !puente.listo && puente.pipe === '',
    `listo=${puente.listo} pipe=${puente.pipe}`
  )
  const enPausa = await pedir(token, undefined, nombreAntes)
  comprobar('en pausa, el cliente falla en vez de colgarse', enPausa === null, JSON.stringify(enPausa))
  comprobar(
    esPipe ? 'en Windows la pausa no deja nada que barrer' : 'la pausa ya barre la carpeta del socket (si la app sale ahí, no queda basura)',
    esPipe || !existsSync(dirname(nombreAntes)),
    esPipe ? nombreAntes : dirname(nombreAntes)
  )
  // Un montaje hecho durante la pausa no se pierde: al reanudar se sirve el vigente.
  puente.setScope('p1', PROYECTO, ['a', 'b'])

  await puente.reanudar()
  comprobar('reanudar vuelve al MISMO punto de escucha', puente.listo && puente.pipe === nombreAntes, `${nombreAntes} -> ${puente.pipe}`)
  const despues = await pedir(token, undefined, nombreAntes)
  comprobar(
    'y el token PREVIO de la sesión viva sigue resolviendo, con el ámbito vigente',
    despues?.ok === true && (despues.scope as string[]).join() === 'a,b',
    JSON.stringify(despues)
  )
  comprobar(
    'el registro lo dice',
    registro.some((m) => m.includes('reanudado en el mismo punto')),
    JSON.stringify(registro.slice(-3))
  )
  await puente.reanudar()
  comprobar('reanudar con el puente ya levantado no cambia nada', puente.listo && puente.pipe === nombreAntes, puente.pipe)
  // La pausa no puede resucitar lo revocado ni dejar de revocar: el ciclo de vida del
  // token sigue igual después.
  puente.revoke('sesion-viva')
  const revocado = await pedir(token, undefined, nombreAntes)
  comprobar('revocar tras reanudar sigue invalidando el token', revocado?.ok === false, JSON.stringify(revocado))
}
{
  // RESPALDO: el punto viejo ya no se puede usar. En Windows, otro ocupa el nombre del
  // pipe (libuv crea la primera instancia en exclusiva: el `listen` falla); en POSIX,
  // la carpeta del socket reaparece creada por otro (y escuchar dentro le daría el
  // socket). En los dos casos el puente escucha en un punto NUEVO en vez de quedarse
  // apagado: las terminales recargadas funcionan y las viejas reciben de `tdb` el
  // «Recarga la terminal» de siempre.
  const esPipe = plataformaActual() === 'windows'
  const token = puente.mint('p1', PROYECTO)
  puente.setScope('p1', PROYECTO, ['a'])
  const viejo = puente.pipe
  await puente.pausar()
  let okupa: Server | null = null
  if (esPipe) {
    const s = createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => s.listen(viejo, () => resolve()))
    okupa = s
  } else {
    mkdirSync(dirname(viejo), { mode: 0o700 })
  }
  await puente.reanudar()
  comprobar(
    esPipe ? 'con el pipe viejo ocupado, reanuda en un pipe NUEVO' : 'con la carpeta vieja ya creada por otro, reanuda en un socket NUEVO',
    puente.listo && puente.pipe !== '' && puente.pipe !== viejo,
    `${viejo} -> ${puente.pipe}`
  )
  const r = await pedir(token)
  comprobar('y el punto nuevo responde', r?.ok === true, JSON.stringify(r))
  const ocupante = okupa
  if (ocupante) await new Promise<void>((resolve) => ocupante.close(() => resolve()))
  if (!esPipe) rmSync(dirname(viejo), { recursive: true, force: true })
}

// El nombre se guarda ANTES de parar: es el caso real que hay que cubrir —el cliente
// tiene un nombre de pipe válido en su entorno y al otro lado ya no hay nadie (Tessera
// cerrada a mitad de una sesión de terminal)—, no el de un nombre vacío.
const nombreMuerto = puente.pipe
puente.stop()
{
  // Un socket unix es un ARCHIVO y sobrevive al proceso: `stop()` tiene que barrer
  // su carpeta, o cada arranque dejaría un directorio huérfano en el temporal. En
  // Windows no hay nada que barrer: el pipe muere con el proceso.
  const esPipe = plataformaActual() === 'windows'
  comprobar(
    esPipe ? 'en Windows no hay carpeta que barrer al parar' : 'al parar, la carpeta del socket desaparece',
    esPipe ? nombreMuerto.startsWith('\\\\.\\pipe\\') : !existsSync(dirname(nombreMuerto)),
    esPipe ? nombreMuerto : dirname(nombreMuerto)
  )
}
{
  const token = puente.mint('p1', PROYECTO)
  const t0 = Date.now()
  const r = await pedir(token, undefined, nombreMuerto)
  const ms = Date.now() - t0
  comprobar('con el puente parado, el cliente falla en vez de colgarse', r === null)
  comprobar('y falla RÁPIDO (sin esperar al timeout)', ms < 2000, `${ms} ms`)
}

console.log(`\n${fallos === 0 ? '✓ TODO VERDE' : `✗ ${fallos} FALLO(S)`}\n`)
process.exit(fallos === 0 ? 0 : 1)
