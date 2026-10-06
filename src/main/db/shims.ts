// =============================================================================
// Generación de los atajos `tdb` (sh, PowerShell y cmd): lógica pura sobre cadenas, sin disco ni Electron,
// para generarlos en un tmpdir y ejecutarlos de verdad desde una prueba. Son tres porque cada shell
// resuelve el suyo: Git Bash, que usa el agente en Windows, no encuentra un `.ps1` ni cmd un `.PS1`.
// Decisiones: docs/decisiones/bd/puente-atajos-de-tdb.md
// =============================================================================
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { citarPowerShell, citarSh, rutaParaCmd } from '../../shared/citarShell.ts'

/**
 * Versión del contrato de los atajos: sube cuando cambia lo que el shim espera del entorno o cómo invoca
 * a `tdb`. Viven en `bin/s<N>/`, y esa subcarpeta es la que se antepone al PATH, así que dos instancias
 * de versiones distintas no se pisan el atajo.
 */
export const SHIM_VERSION = 2

/** Carpeta de atajos de esta versión, relativa a `<userData>/bin`. */
export const SHIM_DIR = `s${SHIM_VERSION}`

/** Lo que hace falta para generar los atajos de `tdb`. */
export interface ShimOpts {
  /** Ejecutable de Tessera (`process.execPath`), horneado como respaldo. */
  exe: string
  /** Ruta de `tdb.cjs`, horneada como respaldo. */
  script: string
  /** Cuándo se escribió. `tdb doctor` lo muestra para detectar atajos ajenos. */
  sello: string
  /** El entorno del main: las carpetas del usuario con que el `.cmd` escribe una ruta sin «ñ» (`rutaParaCmd`). */
  env?: Readonly<Record<string, string | undefined>>
}

/** Marca de orden de bytes UTF-8: sin ella, PowerShell 5.1 lee el `.ps1` en la página ANSI y una «ñ» de la ruta llega cambiada. */
const BOM = String.fromCharCode(0xfeff)

/** Un atajo generado: nombre de archivo, contenido y fin de línea. */
export interface ShimGenerado {
  nombre: string
  contenido: string
  /**
   * Fin de línea del archivo. El de `sh` DEBE ir en LF: MSYS decide que un archivo
   * sin extensión es ejecutable porque empieza por `#!`, y un CR colado en esa
   * primera línea convierte el intérprete en `/bin/sh` + CR, que no existe. El error
   * que da ("bad interpreter") no menciona el CR por ninguna parte.
   */
  eol: 'lf' | 'crlf'
}

// El citado (`citarSh` / `citarPowerShell`) vive en `shared/citarShell.ts`. Hace falta de verdad: un
// usuario de Windows puede llamarse `O'Brien` y su ruta llevar un apóstrofo, y sin escapar rompe los
// tres atajos a la vez.

/**
 * Genera los atajos que ESTE sistema necesita. Devuelve contenido y fin de línea;
 * escribirlos es cosa de quien llame (`DbController`), que además los deja en
 * `bin/<SHIM_DIR>/`.
 *
 * TRES EN WINDOWS, UNO EN macOS.
 *
 * Los tres de Windows existen por una razón medida que sigue en pie (ver el ADR):
 * con sólo el `.ps1`, `tdb` no existía ni en Git Bash —que es sobre lo que corre la
 * herramienta Bash de Claude Code— ni en cmd, porque `PATHEXT` no incluye `.PS1`.
 *
 * En macOS no hay ni PowerShell ni cmd ni `PATHEXT`: el `sh` es el único shell que va a
 * ver ese PATH. Escribir los otros dos dejaría en `userData` dos ficheros que nada
 * puede ejecutar, y —lo que de verdad molesta— haría mentir a `tdb doctor`, que deduce
 * el shell de QUÉ atajo se usó y anunciaría "Git Bash / MSYS" en un Mac.
 *
 * `plataforma` es explícita, con la del sistema por defecto, para que el test pueda
 * fijar las dos desde una sola.
 */
export function generarShims(
  opts: ShimOpts,
  plataforma: Plataforma = plataformaActual()
): ShimGenerado[] {
  const sh: ShimGenerado = { nombre: 'tdb', contenido: shimSh(opts), eol: 'lf' }
  if (plataforma !== 'windows') return [sh]
  return [
    sh,
    { nombre: 'tdb.ps1', contenido: shimPs1(opts), eol: 'crlf' },
    { nombre: 'tdb.cmd', contenido: shimCmd(opts), eol: 'crlf' }
  ]
}

/** Atajo para Git Bash (o cualquier sh). El que desbloquea al AGENTE. */
function shimSh({ exe, script, sello }: ShimOpts): string {
  return [
    '#!/bin/sh',
    `# Atajo generado por Tessera (contrato ${SHIM_DIR}, ${sello}).`,
    '# Se reescribe en cada arranque: no lo edites.',
    '',
    '# Desde WSL esto no puede funcionar: la ruta del ejecutable es de Windows (WSL',
    '# necesita /mnt/c/...) y el puente local de Tessera es inalcanzable. Medio soporte',
    '# sería peor que ninguno, así que se falla claro y pronto.',
    'if [ -n "$WSL_DISTRO_NAME" ]; then',
    '  echo "tdb no funciona desde WSL. Usa PowerShell o la terminal de Tessera." >&2',
    '  exit 2',
    'fi',
    '',
    '# El ENTORNO manda sobre la ruta horneada: una terminal abierta por ESTA instancia',
    '# de Tessera invoca ESTA instancia, aunque otra haya reescrito el atajo después.',
    `[ -n "$TESSERA_EXE" ] || TESSERA_EXE=${citarSh(exe)}`,
    `[ -n "$TESSERA_TDB" ] || TESSERA_TDB=${citarSh(script)}`,
    '',
    '# Sin estas dos, MSYS convierte a ruta de Windows cualquier argumento que empiece',
    '# por "/" —un hint de Oracle al principio del SQL, por ejemplo— y la consulta sale',
    '# mal SIN dar error. Mismo fallo silencioso que la expansión de %VAR% en cmd.',
    'MSYS_NO_PATHCONV=1',
    "MSYS2_ARG_CONV_EXCL='*'",
    'ELECTRON_RUN_AS_NODE=1',
    '# El atajo se identifica ante `tdb`: con esto, `tdb doctor` puede decir DESDE',
    '# QUE atajo se le llamo y si su carpeta esta en el PATH. Sin ello, el diagnostico',
    '# solo veia el .cjs y no podia distinguir un shell de otro ni detectar un atajo',
    '# dejado por otra instalacion de Tessera.',
    'TESSERA_SHIM="$0"',
    '# Se traduce a ruta de Windows para que sea COMPARABLE con el resto del entorno:',
    '# el PATH que ve `tdb` viene en formato Windows, y un "/tmp/..." nunca casaria',
    '# con una ruta de Windows. Si no hay cygpath, se manda tal cual y `doctor` avisa.',
    'if command -v cygpath >/dev/null 2>&1; then',
    '  TESSERA_SHIM=$(cygpath -w "$0" 2>/dev/null || printf %s "$0")',
    'fi',
    'export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL ELECTRON_RUN_AS_NODE TESSERA_SHIM',
    '',
    '# "$@" CON comillas: sin ellas el shell re-parte los argumentos por espacios y',
    '# destroza cualquier SQL. `exec` deja que el código de salida sea el del hijo.',
    'exec "$TESSERA_EXE" "$TESSERA_TDB" "$@"',
    ''
  ].join('\n')
}

/** Atajo para PowerShell: el de la terminal de Tessera, y el que tecleas tú. */
function shimPs1({ exe, script, sello }: ShimOpts): string {
  return (
    BOM +
    [
      `# Atajo generado por Tessera (contrato ${SHIM_DIR}, ${sello}).`,
      '# Se reescribe en cada arranque: no lo edites.',
      'param([Parameter(ValueFromRemainingArguments = $true)] $TdbArgs)',
      'if ($null -eq $TdbArgs) { $TdbArgs = @() }',
      '',
      '# El entorno manda sobre la ruta horneada (ver el atajo `tdb` de sh).',
      `$exe = if ($env:TESSERA_EXE) { $env:TESSERA_EXE } else { ${citarPowerShell(exe)} }`,
      `$guion = if ($env:TESSERA_TDB) { $env:TESSERA_TDB } else { ${citarPowerShell(script)} }`,
      '',
      '# La consola pasa a UTF-8 SOLO durante la invocación: `tdb` escribe UTF-8 (acentos,',
      '# los bordes de la tabla) pero una consola española arranca en CP850 y esos bytes',
      '# se ven como "ÔöÇ". Restaurar es obligatorio: en esta misma terminal se corren',
      '# herramientas legacy que SÍ emiten CP850, y dejarlas mal cambia un problema por otro.',
      '$previaSalida = [Console]::OutputEncoding',
      '# Se restaura TAMBIÉN ELECTRON_RUN_AS_NODE. Antes se quedaba pegado a la sesión, así',
      '# que cualquier app de Electron lanzada luego desde esta misma terminal arrancaba',
      '# como node —sin ventana— sin que nada explicara por qué.',
      '$previoNode = $env:ELECTRON_RUN_AS_NODE',
      '$previoShim = $env:TESSERA_SHIM',
      '$codigo = $null',
      'try {',
      '  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '  $env:ELECTRON_RUN_AS_NODE = "1"',
      '  # El atajo se identifica ante `tdb` (ver el equivalente en el atajo de sh).',
      '  $env:TESSERA_SHIM = $PSCommandPath',
      '  # `| Out-Host` NO es decorativo: el ejecutable es de subsistema GUI y PowerShell no',
      '  # espera a esos —devuelve el prompt al instante y la salida cae después, encima de',
      '  # lo que estés escribiendo—. Al canalizar, PowerShell lee hasta el fin del flujo, o',
      '  # sea hasta que el proceso muere. `$LASTEXITCODE` sigue siendo el del proceso nativo.',
      '  & $exe $guion @TdbArgs | Out-Host',
      '  $codigo = $LASTEXITCODE',
      '} finally {',
      '  [Console]::OutputEncoding = $previaSalida',
      '  $env:ELECTRON_RUN_AS_NODE = $previoNode',
      '  $env:TESSERA_SHIM = $previoShim',
      '}',
      '# Si el proceso ni llegó a arrancar, $LASTEXITCODE se queda nulo y `exit $null`',
      '# sería un error de PowerShell encima del error de verdad.',
      'if ($null -eq $codigo) { $codigo = 1 }',
      'exit $codigo',
      ''
    ].join('\r\n')
  )
}

/**
 * Atajo para cmd.exe. Existe para "abro una consola a mano" y para los .bat legacy de
 * los proyectos, no para el camino normal.
 *
 * SE NIEGA a ejecutar `query` sin `--stdin`/`--file`, y no es puritanismo: cmd expande
 * `%VAR%` en la línea que TECLEA el usuario, antes de que este archivo exista para el
 * sistema. Un `... LIKE '%path%'` llega al motor con el PATH entero incrustado — una
 * consulta silenciosamente distinta de la que se escribió, que es el peor resultado
 * posible. Ningún contenido del batch puede deshacerlo, así que lo correcto es fallar
 * ruidosamente y señalar la salida.
 */
function shimCmd({ exe, script, sello, env }: ShimOpts): string {
  return [
    '@echo off',
    `rem Atajo generado por Tessera (contrato ${SHIM_DIR}, ${sello}).`,
    'rem Se reescribe en cada arranque: no lo edites.',
    'setlocal',
    `if not defined TESSERA_EXE set "TESSERA_EXE=${rutaParaCmd(exe, env)}"`,
    `if not defined TESSERA_TDB set "TESSERA_TDB=${rutaParaCmd(script, env)}"`,
    'set "ELECTRON_RUN_AS_NODE=1"',
    'rem El atajo se identifica ante tdb (ver el equivalente en el atajo de sh).',
    'set "TESSERA_SHIM=%~f0"',
    '',
    'rem cmd expande %VAR% ANTES de llegar aqui: un SQL con % ya viene corrompido.',
    'if /I not "%~1"=="query" goto :ejecutar',
    'set "TDB_SEGURO="',
    'for %%A in (%*) do (',
    '  if /I "%%~A"=="--stdin" set "TDB_SEGURO=1"',
    '  if /I "%%~A"=="--file" set "TDB_SEGURO=1"',
    ')',
    'if defined TDB_SEGURO goto :ejecutar',
    '>&2 echo(',
    '>&2 echo   cmd.exe expande las %variables% de tu linea ANTES de llamar a tdb, asi que',
    '>&2 echo   un SQL con el simbolo de porcentaje llegaria corrompido sin avisar.',
    '>&2 echo   Usa una de estas dos:',
    '>&2 echo(',
    '>&2 echo     tdb query ^<base^> --stdin            (el SQL por la entrada estandar)',
    '>&2 echo     tdb query ^<base^> --file consulta.sql',
    '>&2 echo(',
    '>&2 echo   O ejecutalo desde PowerShell, que no hace esa expansion.',
    '>&2 echo(',
    'exit /b 3',
    '',
    ':ejecutar',
    '"%TESSERA_EXE%" "%TESSERA_TDB%" %*',
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n')
}
