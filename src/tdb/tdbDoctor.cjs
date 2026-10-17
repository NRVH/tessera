// =============================================================================
// `tdb doctor`: lo primero que hay que pedir cuando alguien dice «no lo reconoce» o «monté
// la base y no la ve». El subsistema falla en la ENTREGA (atajo, PATH, contexto), no en la
// lógica, y eso es invisible desde dentro de una consulta. Nunca imprime un secreto: solo
// cuántos hay. Depende de `motores.cjs`, `tdbConectar`, `tdbConexiones`, `tdbSalida`, `textosTdb`
// y, para la plataforma, de `sqliteComun` (el único que lee `process.platform` es `archivoSqlite`).
// =============================================================================
'use strict'

const path = require('node:path')
const { existsSync, statSync } = require('node:fs')
const motoresTdb = require('./motores.cjs')
const { secretoDe } = require('./tdbConectar.cjs')
const { nombreDe, entendida } = require('./tdbConexiones.cjs')
const { envolver } = require('./tdbSalida.cjs')
const { plataformaDelProceso } = require('./sqliteComun.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/**
 * ¿NO está el archivo de una base de archivo? Solo con ENOENT/ENOTDIR (o sin ruta de
 * texto): un EPERM es un permiso que falta (la privacidad de macOS sobre Documentos,
 * Escritorio o Descargas), no un archivo que no está.
 */
function archivoNoEsta(ruta) {
  if (typeof ruta !== 'string' || ruta === '') return true
  try {
    statSync(ruta)
    return false
  } catch (e) {
    return Boolean(e) && (e.code === 'ENOENT' || e.code === 'ENOTDIR')
  }
}

function fila(etiqueta, valor) {
  console.log('  ' + String(etiqueta).padEnd(16) + valor)
}

/**
 * ¿Son la misma carpeta? `path.win32.normalize` TAMBIÉN en macOS, y a propósito: solo se
 * construye una clave de COMPARACIÓN y las dos rutas pasan por la misma función, así que da
 * igual que el resultado no sea una ruta válida en este sistema. Lo que se gana es que `/` y
 * `\` cuenten como el mismo separador y que la caja no importe.
 */
function mismaCarpeta(a, b) {
  if (!a || !b) return false
  const limpiar = (s) => path.win32.normalize(s.trim()).toLowerCase().replace(/[/\\]+$/, '')
  return limpiar(a) === limpiar(b)
}

/**
 * Shell desde el que se llamó, deducido de qué atajo se ejecutó. El atajo sin extensión
 * significa cosas distintas según el sistema: en Windows dice que llamó un `sh` (Git Bash);
 * en macOS es el único que existe, y hablar de Git Bash mandaría a buscar un entorno que no
 * hay. Sin atajo cualquier heurística se equivoca: MSYSTEM y SHELL se HEREDAN.
 */
function detectarShell(atajo) {
  const a = String(atajo || '').toLowerCase()
  if (a.endsWith('.ps1')) return 'PowerShell'
  if (a.endsWith('.cmd')) return 'cmd.exe'
  if (a) return plataformaDelProceso() === 'windows' ? 'sh (Git Bash / MSYS)' : 'sh (POSIX)'
  return 'desconocido (invocación directa, sin atajo)'
}

/**
 * Lo que dice el entorno del proceso sobre el atajo con el que se llamó. El atajo se
 * identifica solo (`TESSERA_SHIM`): la carpeta que hay que buscar en el PATH es la del ATAJO,
 * no la del guion, que es el mismo `.cjs` para los tres. `path.delimiter` y no un `;`: con el
 * punto y coma clavado el PATH de un Mac quedaba en un solo segmento.
 */
function entornoDelAtajo() {
  const atajo = process.env.TESSERA_SHIM || ''
  const segmentos = (process.env.PATH || process.env.Path || '').split(path.delimiter)
  const dirAtajo = atajo ? path.dirname(atajo) : ''
  return {
    atajo,
    shell: detectarShell(atajo),
    exe: process.env.TESSERA_EXE || '',
    tdb: process.env.TESSERA_TDB || '',
    posicionEnPath: dirAtajo ? segmentos.findIndex((s) => mismaCarpeta(s, dirAtajo)) : -1
  }
}

/**
 * Los tres problemas que puede tener lo visible. Las que TIENEN contraseña pero para otro
 * destino (`secretoDe`): contarlas como servidas daba «Todo en orden» a una terminal cuyo
 * `tdb` se va a negar a usarlas. Solo las de un motor CON contraseña (una de archivo no la
 * usa nunca) y, para «sin contraseña», las que no la tienen por opcional. De las de archivo,
 * las que faltan.
 */
function problemasDeConexiones(ctx) {
  const conSecreto = ctx.conexiones.filter((c) => entendida(c) && motoresTdb.pideSecreto(c.motor))
  return {
    deOtroDestino: conSecreto.filter((c) => secretoDe(ctx, c).cambio !== undefined),
    conSecretoObligatorio: conSecreto.filter((c) => !motoresTdb.secretoOpcional(c.motor)),
    archivosQueFaltan: ctx.conexiones
      .filter((c) => entendida(c) && motoresTdb.deArchivo(c.motor) && archivoNoEsta(c.archivo))
      .map((c) => nombreDe(c))
  }
}

/**
 * El diagnóstico. Los campos NUEVOS (`espacioDatos`, `registroDesdeRespaldo`, `formatoAjeno`
 * con su `aviso`, `secretosDeOtroDestino`, `archivosQueFaltan`) no cambian los de antes:
 * `secretosDelPuente` y `secretosEnElEntorno` cuentan lo que llegó, y `secretosDeOtroDestino`
 * lo que no se puede usar.
 */
function construirInfo(ctx, entorno, problemas) {
  const secretosEnv = Object.keys(process.env).filter((k) => /^TESSERA_DB_SECRET_/.test(k))
  return {
    ok: true,
    version: 1,
    shell: entorno.shell,
    ejecutable: process.execPath,
    guion: process.argv[1] || '',
    atajo: entorno.atajo || '(invocación directa, sin atajo)',
    // Vacío = el atajo usó su ruta horneada; que aparezca es la señal de que la terminal la
    // abrió ESTA instancia de Tessera y no otra.
    tesseraExe: entorno.exe,
    tesseraTdb: entorno.tdb,
    perfil: ctx.perfil || '(sin TESSERA_PROFILE)',
    registro: ctx.registro || '(sin TESSERA_DB_REGISTRY)',
    registroExiste: Boolean(ctx.registro) && existsSync(ctx.registro),
    // Lo que se ve sale del `.bak`: separa «no hay registro» de «falta el principal y se usa la copia».
    registroDesdeRespaldo: ctx.origenRegistro === 'respaldo',
    driversDir: ctx.driversDir || '(sin TESSERA_DB_DRIVERS)',
    ambitoDefinido: ctx.scopeDefinido,
    espacioDatos: ctx.espacioDatos,
    conexionesEnElPerfil: ctx.delPerfil.length,
    conexionesVisibles: ctx.conexiones.length,
    formatoAjeno: Boolean(ctx.formatoAjeno),
    ...(ctx.formatoAjeno ? { aviso: ctx.avisoRegistro } : {}),
    puente: ctx.puente,
    secretosDelPuente: ctx.secretos ? Object.keys(ctx.secretos).length : 0,
    secretosEnElEntorno: secretosEnv.length,
    secretosDeOtroDestino: problemas.deOtroDestino.length,
    ...(problemas.archivosQueFaltan.length > 0 ? { archivosQueFaltan: problemas.archivosQueFaltan } : {}),
    atajoEnPath: entorno.posicionEnPath >= 0,
    posicionEnPath: entorno.posicionEnPath
  }
}

function textoRegistro(ctx, info, t) {
  if (!ctx.registro) return t.sinRegistro
  if (info.registroExiste) return info.registro
  return info.registro + (info.registroDesdeRespaldo ? t.noExisteConRespaldo : t.noExiste)
}

function textoAmbito(info, t) {
  if (!info.ambitoDefinido) return t.ambitoSinAcotar
  return info.espacioDatos ? t.ambitoEspacio : t.ambitoProyecto
}

/**
 * El volcado de texto. Los marcadores de «sin valor» se escriben aquí en el idioma de la
 * invocación; los del `--json` (`construirInfo`) se quedan fijos.
 */
function pintarVolcado(ctx, info, entorno) {
  const t = textosTdb()
  const e = t.etiquetas
  console.log('')
  console.log('  tdb doctor')
  console.log('  ' + '─'.repeat(60))
  fila(e.shell, entorno.atajo ? info.shell : t.shellDesconocido)
  fila(e.ejecutable, info.ejecutable)
  fila(e.guion, info.guion)
  fila(e.atajo, entorno.atajo || t.sinAtajo)
  fila('TESSERA_EXE', entorno.exe || t.rutaHorneada)
  fila('TESSERA_TDB', entorno.tdb || t.rutaHorneada)
  fila(e.atajoEnPath, info.atajoEnPath ? t.enPath(info.posicionEnPath) : t.noEnPath)
  console.log('')
  fila(e.perfil, ctx.perfil || t.sinPerfil)
  // El aviso de «no existe» solo tiene sentido si HAY una ruta que comprobar.
  fila(e.registro, textoRegistro(ctx, info, t))
  fila(e.drivers, ctx.driversDir || t.sinDrivers)
  fila(e.ambito, textoAmbito(info, t))
  fila(e.puente, t.estadoPuente(info.puente))
  fila(e.conexiones, t.conexionesVisibles(info.conexionesVisibles, info.conexionesEnElPerfil))
  fila(e.secretos, t.secretosContados(info.secretosDelPuente, info.secretosEnElEntorno))
  console.log('')
}

/**
 * Los veredictos de la ENTREGA: sin contexto, registro que no existe, formato ajeno o puente
 * caído. Devuelve las líneas, o `null` si ninguno aplica. Con el puente caído el ámbito puede
 * ser viejo y no hay secretos: `tdb ls` aún lista algo, y esa lista puede mentir.
 */
function veredictoDeEntrega(ctx, info) {
  const t = textosTdb()
  if (!ctx.registro) return t.doctorSinContexto
  if (!info.registroExiste && !info.registroDesdeRespaldo) return t.doctorRegistroNoExiste
  // Antes que el ámbito vacío: «móntalas» no se puede con un registro que la app tampoco lee.
  if (ctx.formatoAjeno) return [`  ✗ ${ctx.avisoRegistro}`]
  if (ctx.puente === 'no responde') return t.doctorPuenteCaido
  return null
}

/**
 * Los veredictos de lo visible. «Sin contraseña» cuenta solo las que este `tdb` sabe usar y
 * que no la tienen por opcional; «de otro destino» va antes: la contraseña está, lo que no
 * casa es el destino.
 */
function veredictoDeConexiones(ctx, info, problemas) {
  const t = textosTdb()
  if (ctx.scopeDefinido && ctx.conexiones.length === 0) {
    return [ctx.espacioDatos ? t.doctorSinBasesEspacio : t.doctorSinBasesProyecto, t.doctorMontalas]
  }
  if (problemas.deOtroDestino.length > 0) {
    return [
      '  ! ' + envolver(t.doctorOtroDestino(problemas.deOtroDestino.map((c) => nombreDe(c)).join(', '))),
      t.doctorRecargaOReinicia
    ]
  }
  if (problemas.conSecretoObligatorio.length > info.secretosDelPuente + info.secretosEnElEntorno) {
    return t.doctorSinContrasena
  }
  if (problemas.archivosQueFaltan.length > 0) {
    return ['  ! ' + envolver(t.doctorFaltaArchivo(problemas.archivosQueFaltan.join(', '))), t.doctorArchivoMovido]
  }
  return [t.doctorTodoBien]
}

/**
 * El principal FALTA pero se lee su `.bak`, como hace la app: no es un veredicto (con la
 * copia en uso, lo que diga el resto sigue valiendo) sino la verdad sobre de dónde salen las
 * conexiones. Que se recrea solo es cierto si la app puede escribirlo (no con un formato ajeno).
 */
function avisoDeRespaldo(ctx, info) {
  if (!(ctx.registro && !info.registroExiste && info.registroDesdeRespaldo)) return
  console.log('  ! ' + envolver(textosTdb().doctorRespaldo(ctx.formatoAjeno)))
}

function cmdDoctor(ctx) {
  const entorno = entornoDelAtajo()
  const problemas = problemasDeConexiones(ctx)
  const info = construirInfo(ctx, entorno, problemas)
  if (ctx.json) {
    console.log(JSON.stringify(info))
    return
  }
  pintarVolcado(ctx, info, entorno)
  avisoDeRespaldo(ctx, info)
  // Lo importante no es el volcado sino la frase final: cuál de los problemas conocidos es
  // este, y qué se hace.
  for (const linea of veredictoDeEntrega(ctx, info) || veredictoDeConexiones(ctx, info, problemas)) console.log(linea)
  console.log('')
}

module.exports = { cmdDoctor }
