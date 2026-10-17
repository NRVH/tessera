#!/usr/bin/env node
// =============================================================================
// Prueba de `resaltadoSalida`: qué se pinta en la salida de una terminal y qué no.
// (node src/renderer/src/features/terminales/test-resaltado-salida.mts)
// Protege que el texto no cambie (quitar los colores devuelve el original), que los niveles solo
// cuenten como etiqueta, que no se pinte lo que ya trae color ni la pantalla alternativa, que una
// línea partida nunca deje un color abierto, que el estado se siga entre trozos y que la salida real
// del pty de Windows se pinte igual.
// Decisiones: docs/decisiones/terminales/resaltado-de-la-salida.md
// =============================================================================

import { LARGO_MAXIMO, estadoInicial, nivelDeLinea, resaltarLinea, resaltarSalida } from './resaltadoSalida.ts'

const nuevo = estadoInicial

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

const E = '\u001b'
const ROJO = `${E}[31m`
const AMARILLO = `${E}[33m`
const AZUL = `${E}[34m`
const VERDE = `${E}[32m`
const CIAN = `${E}[36m`
const MAGENTA = `${E}[35m`
const AZUL_CLARO = `${E}[94m`
const MAGENTA_CLARO = `${E}[95m`
const CIAN_CLARO = `${E}[96m`
const TENUE = `${E}[2m`
const FIN = `${E}[39m`
/** Sin los colores que se añadieron: tiene que dar el original. */
const RE_ANADIDOS = new RegExp(`${E}\\[(?:3[1-6]|39|9[4-6]|2|22)m`, 'g')
const sinColor = (s: string): string => s.replace(RE_ANADIDOS, '')
const ver = (s: string): string => JSON.stringify(s).replace(/\\u001b/g, '⎋')

/** Pinta la línea entera de `color`. */
const entera = (linea: string, color: string): boolean => resaltarLinea(linea) === `${color}${linea}${FIN}`
/** Se pinta `trozo` (y solo él) de `color`. */
const pintado = (linea: string, trozo: string, color: string): boolean => resaltarLinea(linea).includes(`${color}${trozo}`)

function main(): void {
  hr('(A) errores y avisos: la línea entera')
  const errores = [
    '2026-10-12 10:00:01 ERROR [main] Fallo al arrancar',
    '[ERROR] Failed to execute goal',
    '<Error> <Deployer> <BEA-149265> <Failure occurred>',
    'level=error msg="no se pudo"',
    '{"level":"error","msg":"boom"}',
    'ERROR:root:algo salió mal',
    'error[E0308]: mismatched types',
    'src/app.ts(12,5): error TS2345: Argument of type',
    'main.c:12:5: error: expected ";"',
    'npm ERR! code ENOENT',
    'npm error code E404',
    'E: Unable to locate package foo',
    'java.io.IOException: Identity certificate has expired',
    'TypeError: Cannot read properties of undefined',
    'Caused by: java.lang.NullPointerException',
    '    at com.acme.Servicio.run(Servicio.java:42)',
    '    at Object.<anonymous> (/app/index.js:10:15)',
    'Traceback (most recent call last):',
    '  File "app.py", line 3, in <module>',
    '[INFO] BUILD FAILURE',
    'ssh: connect to host 10.0.0.5 port 22: Connection refused',
    'curl: (6) Could not resolve host: ejemplo.invalid',
    'Permission denied (publickey).',
    'Request timed out.',
    'Tiempo de espera agotado para esta solicitud.',
    'FAIL src/app.test.ts'
  ]
  for (const l of errores) check(`rojo: ${l}`, entera(l, ROJO), ver(resaltarLinea(l)))
  const avisos = ['2026-10-12 10:00:02 WARN  [main] Deprecated option', '[WARNING] Using platform encoding', '<Warning> <Security> <BEA-090898>', 'warning: unused variable `x`', 'main.c:3:1: warning: implicit declaration', 'npm WARN deprecated foo@1.0.0', 'W: Some index files failed', 'level=warn msg="lento"']
  for (const l of avisos) check(`amarillo: ${l}`, entera(l, AMARILLO), ver(resaltarLinea(l)))

  hr('(B) NEGATIVO: una palabra suelta no es un nivel')
  const neutras = [
    'no error found',
    'Errors are handled gracefully',
    'the error handler was registered',
    'warning signs ahead',
    'ERRORLEVEL is set',
    'class ValidationError extends Error {',
    'function onError (e) {',
    '12 passed, 0 timed out',
    'MY_ERROR_CODE=3',
    'set -e; info about the build',
    'Error' // sola, sin dos puntos ni etiqueta
  ]
  for (const l of neutras) check(`sin nivel: ${l}`, nivelDeLinea(l) === null, String(nivelDeLinea(l)))

  hr('(C) datos sueltos: solo su trozo')
  check('<Info> en azul y el resto igual', pintado('####<Oct 12, 2026, 2:03:05,504 AM GMT> <Info> <WorkManager> <BEA-002959> <Self-tuning>', '<Info>', AZUL), ver(resaltarLinea('<Info> <WorkManager>')))
  check('INFO de un log con fecha en azul', pintado('2026-10-12 10:00:00 INFO  [main] Started', 'INFO', AZUL), '')
  check('[INFO] de Maven en azul', pintado('[INFO] Scanning for projects...', '[INFO]', AZUL), '')
  check('DEBUG atenuado', pintado('12:00 DEBUG cache miss', 'DEBUG', TENUE), '')
  check('BUILD SUCCESS en verde', pintado('[INFO] BUILD SUCCESS', 'BUILD SUCCESS', VERDE), ver(resaltarLinea('[INFO] BUILD SUCCESS')))
  check('Successfully installed en verde', pintado('Successfully installed requests-2.31.0', 'Successfully installed', VERDE), '')
  check('PASS en verde', pintado('PASS src/app.test.ts', 'PASS', VERDE), '')
  check('✓ en verde', pintado('  ✓ suma dos números (3 ms)', '✓', VERDE), '')
  check('«3 passed» en verde y «1 failed» en rojo', pintado('3 passed, 1 failed in 0.12s', '3 passed', VERDE) && pintado('3 passed, 1 failed in 0.12s', '1 failed', ROJO), ver(resaltarLinea('3 passed, 1 failed in 0.12s')))
  check('NEGATIVO: «0 failed» no se pinta', !resaltarLinea('5 passed, 0 failed').includes(`${ROJO}0 failed`), ver(resaltarLinea('5 passed, 0 failed')))
  check('Connected to en verde', pintado('Connected to db.ejemplo.local.', 'Connected to', VERDE), '')
  check('HTTP 200 en verde', pintado('HTTP/1.1 200 OK', '200', VERDE), ver(resaltarLinea('HTTP/1.1 200 OK')))
  check('HTTP 404 en amarillo', pintado('HTTP/2 404', '404', AMARILLO), '')
  const acceso = '10.0.0.7 - - [12/Oct/2026:10:00:00 +0000] "GET /api HTTP/1.1" 503 512 "-" "curl/8.0"'
  check('log de acceso: 503 en rojo', pintado(acceso, '503', ROJO), ver(resaltarLinea(acceso)))
  check('NEGATIVO: un 3xx no se pinta', resaltarLinea('HTTP/1.1 301 Moved') === 'HTTP/1.1 301 Moved', ver(resaltarLinea('HTTP/1.1 301 Moved')))
  check('fecha ISO en magenta', pintado('2026-10-12T10:00:00.123Z servicio listo', '2026-10-12T10:00:00.123Z', MAGENTA), '')
  check('IP en cian', pintado('Respuesta desde 127.0.0.1: bytes=32', '127.0.0.1', CIAN), '')
  check('NEGATIVO: 999.1.1.1 no es una IP', !resaltarLinea('versión 999.1.1.1').includes(CIAN), '')
  check('URL en cian', pintado('Abre https://ejemplo.com/ruta?x=1 para ver', 'https://ejemplo.com/ruta?x=1', CIAN), '')
  check('NEGATIVO: texto normal no cambia', resaltarLinea('total 7544') === 'total 7544', '')

  hr('(C2) registros del sistema y configuración')
  const syslog = 'Oct 14 16:51:50 pve-mini systemd[1]: ct104.service: Deactivated successfully.'
  check('syslog: la fecha en magenta', pintado(syslog, 'Oct 14 16:51:50', MAGENTA), ver(resaltarLinea(syslog)))
  check('syslog: el programa con su pid', pintado(syslog, 'systemd[1]', MAGENTA_CLARO), ver(resaltarLinea(syslog)))
  check('syslog: «successfully» en verde', pintado(syslog, 'successfully', VERDE), '')
  const postfix = 'Oct 14 16:48:02 pve-mini postfix/smtp[2839856]: connect to mx.ejemplo.invalid[2001:db8:4023:1000::1a]:25: Network unreachable'
  check('postfix/smtp[pid] entero', pintado(postfix, 'postfix/smtp[2839856]', MAGENTA_CLARO), ver(resaltarLinea(postfix)))
  check('IPv6 abreviada en cian', pintado(postfix, '2001:db8:4023:1000::1a', CIAN), ver(resaltarLinea(postfix)))
  check('«unreachable» en minúsculas, en rojo', pintado(postfix, 'unreachable', ROJO), '')
  check('«failed» suelto en rojo, solo la palabra', pintado('mount: /mnt/backups: mount failed', 'failed', ROJO) && !entera('mount: /mnt/backups: mount failed', ROJO), ver(resaltarLinea('mount: /mnt/backups: mount failed')))
  check('«Warning» en cualquier caja, en amarillo', pintado('disk usage Warning on sda', 'Warning', AMARILLO), '')
  check('NEGATIVO: «0 timed out» no se pinta', !resaltarLinea('12 passed, 0 timed out').includes(`${ROJO}timed out`), ver(resaltarLinea('12 passed, 0 timed out')))
  check('NEGATIVO: ni «0 failed» por la palabra', !resaltarLinea('5 passed, 0 failed').includes(`${ROJO}failed`), ver(resaltarLinea('5 passed, 0 failed')))
  check('NEGATIVO: «ConnectTimeout» no es «timeout»', !resaltarLinea('ConnectTimeout=10').includes(ROJO), ver(resaltarLinea('ConnectTimeout=10')))
  check('hora suelta en magenta', pintado('[05:00:05] Uploading', '05:00:05', MAGENTA), '')
  const acceso2 = '10.0.0.7 - - [12/Oct/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 5'
  check('fecha de un log de acceso', pintado(acceso2, '12/Oct/2026:10:00:00 +0000', MAGENTA), ver(resaltarLinea(acceso2)))
  check('ruta absoluta', pintado('Uploading: /mnt/backups/dump/vzdump-100.vma.zst', '/mnt/backups/dump/vzdump-100.vma.zst', AZUL_CLARO), '')
  check('ruta de Windows', pintado('Guardado en C:\\Temp\\informe.txt', 'C:\\Temp\\informe.txt', AZUL_CLARO), '')
  check('NEGATIVO: la URL no es una ruta', pintado('ver https://ejemplo.com/a/b', 'https://ejemplo.com/a/b', CIAN), ver(resaltarLinea('ver https://ejemplo.com/a/b')))
  check('NEGATIVO: «1/2» no es una ruta', !resaltarLinea('paso 1/2').includes(AZUL_CLARO), '')
  check('clave=valor: la clave', pintado('to=<a@ejemplo.invalid>, relay=none, delay=208598', 'relay', CIAN_CLARO), ver(resaltarLinea('to=<a@ejemplo.invalid>, relay=none')))
  check('YAML: la clave', pintado('  image: nginx:1.27', 'image', CIAN_CLARO), ver(resaltarLinea('  image: nginx:1.27')))
  check('YAML: la clave de un elemento de lista', pintado('  - name: web', 'name', CIAN_CLARO), '')
  check('JSON: la clave', pintado('  "puerto": 8080,', '"puerto"', CIAN_CLARO), '')
  check('comentario atenuado', pintado('# auto lo', '# auto lo', TENUE), ver(resaltarLinea('# auto lo')))
  check('NEGATIVO: «####<» no es un comentario', !resaltarLinea('####<Oct 12, 2026> <Info>').startsWith(TENUE), '')
  check('NEGATIVO: una hora de syslog no es una clave YAML', !resaltarLinea(syslog).includes(`${CIAN_CLARO}Oct`), '')

  hr('(D) el texto no cambia')
  const muestras = [...errores, ...avisos, ...neutras, acceso, '[INFO] BUILD SUCCESS', '3 passed, 1 failed in 0.12s']
  const distintos = muestras.filter((l) => sinColor(resaltarLinea(l)) !== l)
  check('quitar los colores devuelve el original, en todas las muestras', distintos.length === 0, distintos.join(' | '))
  const bloque = errores.join('\r\n') + '\r\n'
  check('y en un bloque con saltos', sinColor(resaltarSalida(bloque, nuevo())) === bloque, '')

  hr('(E) lo que no se toca')
  const coloreada = `${E}[31mERROR${E}[0m ya viene en color`
  check('una línea que ya trae color pasa tal cual', resaltarLinea(coloreada) === coloreada, ver(resaltarLinea(coloreada)))
  check('la pantalla alternativa pasa tal cual', resaltarSalida('ERROR algo\r\n', { ...nuevo(), alternativa: true }) === 'ERROR algo\r\n', '')
  const entra = `${E}[?1049hERROR en el editor\r\n`
  check('un trozo que entra en la pantalla alternativa pasa tal cual', resaltarSalida(entra, nuevo()) === entra, '')
  {
    // El paginador entra en un trozo y su contenido llega en los siguientes, antes de que xterm haya
    // procesado la entrada: el estado se sigue en el flujo, no en el búfer.
    const e = nuevo()
    resaltarSalida(`${E}[?1049h${E}[H`, e)
    const pagina = 'ERROR dentro del paginador\r\nINFO también\r\n'
    check('dentro de la pantalla alternativa, los trozos siguientes no se pintan', resaltarSalida(pagina, e) === pagina, ver(resaltarSalida(pagina, e)))
    resaltarSalida(`${E}[?1049l`, e)
    check('y al salir de ella se vuelve a pintar', resaltarSalida('ERROR fuera\r\n', e).startsWith(ROJO), '')
  }
  {
    // Un programa enciende un color en una línea y lo apaga varias líneas después.
    const e = nuevo()
    const bloqueAmarillo = `${E}[33mempieza el bloque\r\nCaused by: algo dentro del bloque\r\n[ERROR] también dentro\r\n${E}[0mya fuera\r\nERROR suelto\r\n`
    const rb = resaltarSalida(bloqueAmarillo, e)
    check(
      'con un color del programa abierto no se pinta nada dentro, y al cerrarlo se vuelve a pintar',
      rb.includes('\r\nCaused by: algo dentro del bloque\r\n[ERROR] también dentro\r\n') && rb.endsWith(`${ROJO}ERROR suelto${FIN}\r\n`),
      ver(rb)
    )
    const negrita = nuevo()
    const rn = resaltarSalida(`${E}[1mtítulo\r\n2026-10-12 10:00:00 DEBUG dentro\r\n`, negrita)
    check('tampoco dentro de una negrita abierta (el cierre del atenuado la apagaría)', !rn.includes(`${E}[22m`), ver(rn))
  }
  {
    // Una secuencia partida entre dos trozos: su cola llega al principio del siguiente.
    const e = nuevo()
    const a = resaltarSalida(`texto previo ${E}[3`, e)
    const b = resaltarSalida('1mERROR: x\r\nERROR después\r\n', e)
    check('el principio del trozo siguiente no se pinta', a === `texto previo ${E}[3` && b.startsWith('1mERROR: x\r\n'), ver(b))
    check('y la línea siguiente, sí', b.includes(`${ROJO}ERROR después${FIN}`), ver(b))
    const t = nuevo()
    const titulo = resaltarSalida(`${E}]0;ERROR en el título`, t)
    const resto = resaltarSalida(` sigue\u0007ERROR real\r\n`, t)
    check('un título de ventana partido tampoco se rompe', titulo === `${E}]0;ERROR en el título` && resto.startsWith(' sigue\u0007ERROR real'), ver(resto))
  }
  {
    // Secuencias de cadena (imágenes, datos): su contenido no es texto.
    const apc = `${E}_Gf=100;OK 10.0.0.1 ERROR${E}\\ fin\r\n`
    check('una secuencia de cadena completa no se pinta por dentro', !resaltarSalida(apc, nuevo()).includes(`${E}_Gf=100;${E}[`), ver(resaltarSalida(apc, nuevo())))
    const abierta = `${E}Pq#0;2;0;0;0 ERROR OK\r\n`
    check('ni una que queda sin cerrar', resaltarSalida(abierta, nuevo()) === abierta, ver(resaltarSalida(abierta, nuevo())))
  }
  {
    // Una palabra cortada al final del trozo no puede parecer un nivel.
    check('«ERR» de «ERRATA» al final del trozo no es un error', !resaltarSalida('lista de ERR', nuevo()).includes(ROJO), ver(resaltarSalida('lista de ERR', nuevo())))
    check('ni «OK» de «OKTA» un acierto', !resaltarSalida('cuenta de OK', nuevo()).includes(VERDE), '')
    check('pero una línea sin terminar con su nivel completo sí se pinta', resaltarSalida('ERROR al arrancar', nuevo()).startsWith(ROJO), '')
  }
  const larga = 'ERROR ' + 'x'.repeat(LARGO_MAXIMO)
  check('una línea larguísima no se analiza', resaltarLinea(larga) === larga, '')
  const partida = `ERROR algo ${E}[`
  check('una secuencia partida al final del trozo no se rompe', resaltarLinea(partida) === partida, ver(resaltarLinea(partida)))
  const surrogate = 'ERROR 😀'.slice(0, -1)
  check('un emoji partido al final no se rompe', resaltarLinea(surrogate) === surrogate, '')

  hr('(F) el pty de Windows: lo que llega de verdad')
  // Capturado de la terminal de Windows al volcar un archivo.
  const conpty = `${E}[m####<Oct 12, 2026> <Info> <BEA-002959> <Self-tuning>\r\n2026-10-12 10:00:01 ERROR [main] java.io.IOException: Connection refused\r\n2026-10-12 10:00:02 WARN  [main] Deprecated option\r\n[INFO] BUILD SUCCESS\r\nPS C:\\> `
  const r = resaltarSalida(conpty, nuevo())
  const lineas = r.split('\r\n')
  check('el reinicio de delante no impide pintar el <Info>', lineas[0].startsWith(`${E}[m`) && lineas[0].includes(`${AZUL}<Info>`), ver(lineas[0]))
  check('la línea de ERROR, roja entera', lineas[1] === `${ROJO}2026-10-12 10:00:01 ERROR [main] java.io.IOException: Connection refused${FIN}`, ver(lineas[1]))
  check('la de WARN, amarilla entera', lineas[2].startsWith(AMARILLO) && lineas[2].endsWith(FIN), ver(lineas[2]))
  check('el prompt no cambia', lineas[4] === 'PS C:\\> ', ver(lineas[4]))
  const reinicio = `ERROR uno ${E}[m dos`
  check('un reinicio a media línea vuelve a poner el rojo', resaltarLinea(reinicio) === `${ROJO}ERROR uno ${E}[m${ROJO} dos${FIN}`, ver(resaltarLinea(reinicio)))
  const posicion = `Respuesta desde 127.0.0.1: bytes=32${E}[12;1HRequest timed out.`
  const rp = resaltarSalida(posicion, nuevo())
  check('posicionar el cursor corta la línea: cada parte se pinta por su cuenta', rp.includes(`${CIAN}127.0.0.1`) && rp.endsWith(`${ROJO}Request timed out.${FIN}`) && !rp.startsWith(ROJO), ver(rp))
  const relativo = resaltarSalida(`barra 1 lista${E}[2AERROR en la barra 2${E}[1Bbarra 3 lista\r\n`, nuevo())
  check('subir o bajar el cursor también corta: el rojo no se extiende a otras filas', relativo.startsWith('barra 1 lista') && relativo.includes(`${ROJO}ERROR en la barra 2${FIN}${E}[1Bbarra 3 lista`), ver(relativo))
  const cortes = resaltarSalida('ERROR a\nERROR b\rWARN c', nuevo())
  check('cada línea cierra su color: nunca queda uno abierto', cortes.split(/\r|\n/).every((l) => !l.includes(E) || l.endsWith(FIN)), ver(cortes))

  hr('(G) rendimiento: diez mil líneas de log')
  const log = Array.from({ length: 10_000 }, (_, i) => `2026-10-12 10:00:${String(i % 60).padStart(2, '0')} ${['INFO', 'WARN', 'ERROR', 'DEBUG'][i % 4]} [hilo-${i}] mensaje ${i} desde 10.0.0.${i % 255}`).join('\r\n')
  const t0 = performance.now()
  resaltarSalida(log, nuevo())
  const ms = performance.now() - t0
  check('menos de 250 ms (unas 40 000 líneas por segundo como mínimo)', ms < 250, `${ms.toFixed(1)} ms`)

  hr('RESULTADO (PASS/FAIL)')
  for (const r2 of results) {
    console.log(`${r2.pass ? 'PASS' : 'FAIL'}  ${r2.name}`)
    console.log(`      -> ${r2.evidence}`)
  }
  const passed = results.filter((r2) => r2.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
