#!/usr/bin/env node
// =============================================================================
// Prueba de la parte PURA de `pathDeLogin.ts` (npm run test:path-de-login): orden de la fusión,
// deduplicación, segmentos vacíos, el delimitador por parámetro, marcadores con ruido alrededor o
// ausentes, PATH de login nulo, el comando sin variables interpoladas (ejecutado en cada shell
// Bourne de la máquina con `env -i`), `extrasDelHost`, idempotencia, `extraerEntreMarcas` y
// `leerPathDeLoginConMotivo` con un shell que no existe o que resuelve en cuanto llegan los
// marcadores sin esperar a que se cierren los stdio. Ese último caso necesita un `/bin/sh` real:
// en Windows se anuncia como NO APLICA (la función solo tiene llamador en POSIX).
// Decisiones: docs/decisiones/util/path-del-main-desde-el-shell-de-login.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  COMANDO_PATH_MARCADO,
  MARCA_FIN,
  MARCA_INICIO,
  extraerEntreMarcas,
  extraerPathMarcado,
  extrasDelHost,
  fusionarPath,
  leerPathDeLoginConMotivo
} from './pathDeLogin.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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
/**
 * Un check que en ESTE sistema no se puede correr. No cuenta como PASS (eso sería el
 * un verde de mentira): se lista aparte y se repite en el
 * veredicto, para que quien lo lea sepa que ahí no se comprobó nada.
 */
const omitidos: { name: string; motivo: string }[] = []
function omitir(name: string, motivo: string): void {
  omitidos.push({ name, motivo })
  console.log(`  [NO APLICA] ${name} -> ${motivo}`)
}

async function main(): Promise<void> {
  const EXTRAS = ['/usr/local/bin', '/opt/homebrew/bin']
  // El delimitador se FIJA en los casos con forma de PATH POSIX. Sin él, `fusionarPath`
  // toma el de la plataforma que corre la prueba (`delimitadorPath()`), y en Windows
  // —`;`— siete de estos casos salían en rojo sin que el módulo tuviera nada roto: se
  // comprobaban sólo en la máquina del SO que tocara, que es justo lo que la convención
  // de «la plataforma es un parámetro» existe para evitar. El `;` tiene su bloque (4).
  const POSIX = ':'

  // -------------------------------------------------------------------------
  hr('(1) orden: login, luego el proceso, luego los extras')
  // -------------------------------------------------------------------------
  {
    const r = fusionarPath('/usr/bin:/bin', '/Users/yo/.nvm/bin:/opt/homebrew/bin', EXTRAS, POSIX)
    check(
      '(1a) el PATH de login va delante, el del proceso detrás, los extras al final',
      r === '/Users/yo/.nvm/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin',
      r
    )
  }
  {
    const r = fusionarPath('/usr/bin', '/a:/b', [], POSIX)
    check('(1b) sin extras: login + proceso, tal cual', r === '/a:/b:/usr/bin', r)
  }

  // -------------------------------------------------------------------------
  hr('(2) deduplicación conservando la primera aparición')
  // -------------------------------------------------------------------------
  {
    // Un PATH de login REAL de esta máquina trae `/usr/local/bin` tres veces.
    const login = '/opt/homebrew/bin:/usr/local/bin:/usr/local/bin:/usr/local/bin:/usr/bin:/bin'
    const r = fusionarPath('/usr/bin:/bin:/usr/sbin:/sbin', login, EXTRAS, POSIX)
    check(
      '(2a) repetidos del login: una sola vez, en su primera posición',
      r === '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      r
    )
    check(
      '(2b) los del proceso que ya estaban en login no se repiten',
      r.split(':').filter((s) => s === '/usr/bin').length === 1,
      r
    )
    check(
      '(2c) los extras que ya estaban no se repiten',
      r.split(':').filter((s) => s === '/usr/local/bin').length === 1 &&
        r.split(':').filter((s) => s === '/opt/homebrew/bin').length === 1,
      r
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) segmentos vacíos fuera')
  // -------------------------------------------------------------------------
  {
    const r = fusionarPath('/usr/bin::/bin:', '::/a:', [], POSIX)
    check('(3a) `::` y `:` final desaparecen', r === '/a:/usr/bin:/bin', r)
  }
  {
    const r = fusionarPath('', '', ['/x'], POSIX)
    check('(3b) todo vacío salvo un extra: sólo el extra', r === '/x', r)
  }
  {
    const r = fusionarPath('', null, [], POSIX)
    check('(3c) nada de nada: cadena vacía, sin delimitadores sueltos', r === '', JSON.stringify(r))
  }

  // -------------------------------------------------------------------------
  hr('(4) delimitador `;` (el de Windows)')
  // -------------------------------------------------------------------------
  {
    const r = fusionarPath('C:\\Windows;C:\\Tools', null, ['C:\\Docker\\bin', 'C:\\Tools'], ';')
    check(
      '(4a) se parte y se une con `;`, y las rutas con `:` de unidad no se rompen',
      r === 'C:\\Windows;C:\\Tools;C:\\Docker\\bin',
      r
    )
  }
  {
    const r = fusionarPath('C:\\Windows', 'D:\\nvm;C:\\Windows', [], ';')
    check('(4b) login delante también con `;`', r === 'D:\\nvm;C:\\Windows', r)
  }

  // -------------------------------------------------------------------------
  hr('(5) marcadores con ruido alrededor')
  // -------------------------------------------------------------------------
  {
    const salida =
      'Bienvenido, yo. Hay 3 actualizaciones pendientes.\n' +
      'zsh: no job control in this shell\n' +
      `${MARCA_INICIO}/opt/homebrew/bin:/usr/bin${MARCA_FIN}` +
      '\nadiós\n'
    const r = extraerPathMarcado(salida)
    check('(5a) banner antes y texto después: sólo lo de dentro', r === '/opt/homebrew/bin:/usr/bin', String(r))
  }
  {
    const r = extraerPathMarcado(`${MARCA_INICIO}/a:/b${MARCA_FIN}`)
    check('(5b) sin ruido: igual', r === '/a:/b', String(r))
  }
  {
    // Una ruta que contiene "__TESSERA_" no confunde al extractor: los marcadores
    // son cadenas completas y se busca el FIN a partir del INICIO.
    const r = extraerPathMarcado(`${MARCA_INICIO}/Users/x/__TESSERA_cosas/bin:/usr/bin${MARCA_FIN}`)
    check('(5c) un segmento con prefijo parecido al marcador no rompe nada', r === '/Users/x/__TESSERA_cosas/bin:/usr/bin', String(r))
  }

  // -------------------------------------------------------------------------
  hr('(6) sin marcadores → null')
  // -------------------------------------------------------------------------
  check('(6a) salida sin marcadores', extraerPathMarcado('/usr/bin:/bin') === null, 'null')
  check('(6b) salida vacía', extraerPathMarcado('') === null, 'null')
  check('(6c) sólo el marcador de inicio', extraerPathMarcado(`${MARCA_INICIO}/usr/bin`) === null, 'null')
  check('(6d) sólo el marcador de fin', extraerPathMarcado(`/usr/bin${MARCA_FIN}`) === null, 'null')
  check(
    '(6e) fin ANTES del inicio (no cuenta)',
    extraerPathMarcado(`${MARCA_FIN}/usr/bin${MARCA_INICIO}`) === null,
    'null'
  )
  check('(6f) nada entre los marcadores', extraerPathMarcado(`${MARCA_INICIO}${MARCA_FIN}`) === null, 'null')

  // -------------------------------------------------------------------------
  hr('(7) PATH de login null → los extras se añaden igualmente')
  // -------------------------------------------------------------------------
  {
    const r = fusionarPath('/usr/bin:/bin:/usr/sbin:/sbin', null, EXTRAS, POSIX)
    check(
      '(7a) el PATH de launchd + los respaldos',
      r === '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin',
      r
    )
    check('(7b) /usr/local/bin (donde vive docker) queda dentro', r.split(':').includes('/usr/local/bin'), r)
  }

  // -------------------------------------------------------------------------
  hr('(8) el comando que se manda al shell')
  // -------------------------------------------------------------------------
  check(
    '(8a) lleva los dos marcadores',
    COMANDO_PATH_MARCADO.includes(MARCA_INICIO) && COMANDO_PATH_MARCADO.includes(MARCA_FIN),
    COMANDO_PATH_MARCADO
  )
  // La propiedad que lo hace válido en FISH además de en la familia Bourne: no expande
  // ninguna variable. `${PATH}` es un error de sintaxis en fish, y un `$PATH` a secas
  // es allí una LISTA que al entrecomillarse se une con espacios en vez de con `:`.
  // Quien tenía fish como $SHELL no recibía marcadores y perdía todo su PATH de
  // usuario. Aquí no se cuenta con fish instalado, así que lo que
  // se fija es la propiedad, no el shell.
  check(
    '(8b) no interpola NINGUNA variable: ni `${…}` ni `$…` (si no, fish no lo entiende)',
    !COMANDO_PATH_MARCADO.includes('$'),
    COMANDO_PATH_MARCADO
  )
  check(
    '(8c) el PATH lo imprime `printenv`, que lee el entorno exportado sea cual sea el shell',
    COMANDO_PATH_MARCADO.includes('/usr/bin/printenv PATH') && COMANDO_PATH_MARCADO.includes('|| printenv PATH'),
    COMANDO_PATH_MARCADO
  )
  check(
    '(8d) los marcadores no contienen el delimitador ni comillas (van dentro de un \'…\')',
    !/[:;"'$]/.test(MARCA_INICIO) && !/[:;"'$]/.test(MARCA_FIN),
    `${MARCA_INICIO} ${MARCA_FIN}`
  )
  // Y se EJECUTA de verdad en cada shell de la familia Bourne que haya en la máquina,
  // con un entorno controlado (`env -i`) para que el resultado no dependa de los
  // ficheros de configuración de quien corra la prueba. `-c` a secas y no `-ilc`: aquí
  // se prueba el comando, no la carga de perfiles.
  const preguntar = (shell: string, pathDado: string): string | null => {
    const r = spawnSync('/usr/bin/env', ['-i', `PATH=${pathDado}`, shell, '-c', COMANDO_PATH_MARCADO], {
      encoding: 'utf8'
    })
    return extraerPathMarcado(r.stdout)
  }
  for (const shell of ['/bin/sh', '/bin/zsh', '/bin/bash']) {
    if (!fs.existsSync(shell)) {
      check(`(8e·${shell}) no está en esta máquina: no se prueba`, true, 'ausente')
      continue
    }
    // NO se compara con igualdad: `zsh` lee `/etc/zshenv` hasta con `-c`, así que
    // puede añadir segmentos suyos, y eso es lo correcto (es el PATH del usuario, que
    // es lo que se viene a buscar). Lo que se fija es que el PATH DADO llega entero,
    // separado por `:`, y sin el salto de línea de `printenv` pegado al último
    // segmento — que es lo que rompía antes en fish y lo que rompería un `trim` mal
    // puesto aquí.
    const normal = preguntar(shell, '/usr/bin:/bin:/un/sitio/del/usuario')
    check(
      `(8e·${shell}) devuelve el PATH separado por ":" y sin el salto de printenv`,
      normal !== null &&
        normal.includes('/usr/bin:/bin:/un/sitio/del/usuario') &&
        normal.split(':').includes('/un/sitio/del/usuario') &&
        normal === normal.trim(),
      JSON.stringify(normal)
    )
    // Y lo mismo con un PATH que NO contiene /usr/bin: por eso `printenv` se invoca
    // primero por ruta absoluta. Buscándolo sólo por nombre, aquí no se encontraría y
    // la salida serían dos marcadores vacíos — el fallo mudo de siempre.
    const raro = preguntar(shell, '/solo/lo/mio/bin')
    check(
      `(8f·${shell}) …incluso si /usr/bin no está en el PATH del usuario`,
      raro !== null && raro.split(':').includes('/solo/lo/mio/bin'),
      JSON.stringify(raro)
    )
  }

  // -------------------------------------------------------------------------
  hr('(9) extrasDelHost')
  // -------------------------------------------------------------------------
  {
    const e = extrasDelHost('/Users/prueba')
    check(
      '(9a) los cuatro sitios, con ~/.docker/bin colgando del home dado',
      e.length === 4 &&
        e.includes('/usr/local/bin') &&
        e.includes('/opt/homebrew/bin') &&
        e.includes('/Users/prueba/.docker/bin') &&
        e.includes('/Applications/Docker.app/Contents/Resources/bin'),
      e.join(':')
    )
  }

  // -------------------------------------------------------------------------
  hr('(10) idempotencia')
  // -------------------------------------------------------------------------
  {
    const una = fusionarPath('/usr/bin:/bin', '/a:/usr/bin', EXTRAS, POSIX)
    const dos = fusionarPath(una, '/a:/usr/bin', EXTRAS, POSIX)
    check('(10a) fusionar el resultado otra vez no cambia nada', una === dos, `${una} == ${dos}`)
  }

  // -------------------------------------------------------------------------
  hr('(11) leerPathDeLoginConMotivo con shells que no pueden responder: nunca lanza')
  // -------------------------------------------------------------------------
  {
    const r = await leerPathDeLoginConMotivo('/ruta/que/no/existe/zsh', 2000)
    check(
      '(11a) shell inexistente: path null y el motivo dice que no existe',
      r.path === null && r.motivo !== null && r.motivo.includes('no existe'),
      JSON.stringify(r)
    )
  }
  {
    // `node` como "shell": no entiende `-ilc`, sale con error y sin marcadores.
    const r = await leerPathDeLoginConMotivo(process.execPath, 5000)
    check(
      '(11b) un ejecutable que no entiende `-ilc`: path null y motivo con causa',
      r.path === null && r.motivo !== null && r.motivo.length > 0,
      JSON.stringify(r)
    )
  }
  {
    // Antes esto probaba la envoltura `leerPathDeLogin`, que se borró por no tener
    // ningún llamador de producción (existía sólo para este check). Lo que importaba
    // se conserva sobre la función de verdad.
    const r = await leerPathDeLoginConMotivo('/ruta/que/no/existe/zsh', 2000)
    check(
      '(11c) sin marcadores nunca hay PATH: `path` es null, no una cadena vacía',
      r.path === null,
      JSON.stringify(r)
    )
  }
  {
    // (11d) EL CASO QUE MOTIVA EL LISTENER DE `stdout`: un shell que imprime el PATH y
    // deja un proceso en segundo plano heredando stdout. El pipe no llega nunca a EOF,
    // así que el callback de `execFile` (que espera a 'close') no se dispararía hasta
    // el timeout. Tiene que resolver enseguida, con el PATH bueno.
    hr('(11d) marcadores impresos + algo en segundo plano: resuelve YA, no al timeout')
    if (!fs.existsSync('/bin/sh')) {
      omitir(
        '(11d) resuelve en cuanto llegan los marcadores',
        'no hay /bin/sh en este sistema (Windows): el shell de mentira es un script POSIX, y ' +
          '`leerPathDeLoginConMotivo` sólo tiene llamador en POSIX'
      )
    } else {
      const PATH_FALSO = '/de/mentira/bin:/usr/bin'
      const guion = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-shell-')),
        'shell-de-mentira.sh'
      )
      // Ignora sus argumentos a propósito: imita al shell cuyo `.zshrc` deja algo
      // corriendo. El `sleep` va ANTES del `printf` para que herede stdout ya abierto.
      fs.writeFileSync(
        guion,
        `#!/bin/sh\nsleep 20 &\nprintf '%s' "${MARCA_INICIO}${PATH_FALSO}${MARCA_FIN}"\nexit 0\n`,
        { mode: 0o755 }
      )
      const t0 = Date.now()
      const r = await leerPathDeLoginConMotivo(guion, 5000)
      const ms = Date.now() - t0
      check(
        '(11d1) devuelve el PATH que el shell imprimió, sin motivo',
        r.path === PATH_FALSO && r.motivo === null,
        JSON.stringify(r)
      )
      check(
        '(11d2) resuelve muy por debajo del timeout de 5000 ms (antes: 5005 ms)',
        ms < 2000,
        `${ms} ms`
      )
      fs.rmSync(path.dirname(guion), { recursive: true, force: true })
    }
  }

  // -------------------------------------------------------------------------
  hr('(12) extraerEntreMarcas: la extracción genérica (la comparte ejecutorShell)')
  // -------------------------------------------------------------------------
  {
    const INI = '__PRUEBA_INI__'
    const FIN = '__PRUEBA_FIN__'
    {
      // Lo que devuelve un `zsh -ilc` con un `.zshrc` hablador: banner antes, aviso
      // después, y la respuesta de `--version` con su salto de línea entre medias.
      const salida =
        'Último inicio de sesión: hoy\nzsh: no job control in this shell\n' +
        `${INI}\ncodex-cli 0.156.0\n${FIN}\n` +
        'Tienes correo.\n'
      const r = extraerEntreMarcas(salida, INI, FIN)
      check(
        '(12a) banners antes y después: sólo lo de dentro, SIN recortar',
        r === '\ncodex-cli 0.156.0\n',
        JSON.stringify(r)
      )
    }
    check('(12b) falta el de inicio → null', extraerEntreMarcas(`hola${FIN}`, INI, FIN) === null, 'null')
    check('(12c) falta el de fin → null', extraerEntreMarcas(`${INI}hola`, INI, FIN) === null, 'null')
    check('(12d) salida vacía → null', extraerEntreMarcas('', INI, FIN) === null, 'null')
    check(
      '(12e) un fin ANTES del inicio no cuenta',
      extraerEntreMarcas(`${FIN}x${INI}y`, INI, FIN) === null,
      'null'
    )
    {
      const r = extraerEntreMarcas(`${INI}${FIN}`, INI, FIN)
      check('(12f) marcadores pegados → cadena vacía (no null: decide el llamador)', r === '', JSON.stringify(r))
    }
    {
      // Dos parejas: manda la PRIMERA, lo de detrás se ignora. Es la misma regla que
      // `extraerPathMarcado` tenía antes de la extracción.
      const r = extraerEntreMarcas(`ruido${INI}uno${FIN}medio${INI}dos${FIN}cola`, INI, FIN)
      check('(12g) marcadores repetidos: la primera pareja', r === 'uno', JSON.stringify(r))
    }
    {
      // Inicio repetido antes del primer fin: se corta desde el PRIMER inicio, así que el
      // segundo queda dentro. Se fija para que un cambio de regla no pase inadvertido.
      const r = extraerEntreMarcas(`${INI}a${INI}b${FIN}`, INI, FIN)
      check('(12h) inicio repetido: desde el primero hasta el primer fin', r === `a${INI}b`, JSON.stringify(r))
    }
    {
      // `extraerPathMarcado` es ahora `extraerEntreMarcas` + recorte + vacío→null: la
      // conducta de antes se conserva (los bloques 5 y 6 la fijan entera).
      const salida = `x${MARCA_INICIO}  /a:/b\n${MARCA_FIN}y`
      check(
        '(12i) extraerPathMarcado = extraerEntreMarcas recortado',
        extraerPathMarcado(salida) === (extraerEntreMarcas(salida, MARCA_INICIO, MARCA_FIN) ?? '').trim(),
        JSON.stringify(extraerPathMarcado(salida))
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  for (const o of omitidos) {
    console.log(`NO APLICA  ${o.name}`)
    console.log(`      -> ${o.motivo}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  const cola = omitidos.length > 0 ? ` (${omitidos.length} NO APLICA en este sistema)` : ''
  hr(`VEREDICTO: ${passed}/${total} PASS${cola} — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
