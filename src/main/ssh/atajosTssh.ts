// =============================================================================
// Los atajos `tssh` (sh, PowerShell y cmd), hermanos de los de `tdb` y en su misma carpeta `bin/s<N>`: solo
// el texto, puro y con la plataforma como parámetro, para generarlos en un temporal y ejecutarlos de verdad
// desde una prueba. Los escribe `util/escrituraAtajos.ts` (el mismo escritor que los de `tdb`) desde
// `componer.ts`; las rutas del `.cmd` van con `rutaParaCmd` de `shared/citarShell.ts`, como las de `tdb`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md, docs/decisiones/bd/puente-atajos-de-tdb.md
// =============================================================================
import { citarPowerShell, citarSh, rutaParaCmd } from '../../shared/citarShell.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { SHIM_DIR, type ShimGenerado } from '../db/shims.ts'

/** Lo que hace falta para generar los atajos. */
export interface OpcionesAtajosTssh {
  /** El ejecutable de Tessera (`process.execPath`), horneado como respaldo. */
  exe: string
  /** La ruta de `src/tssh/tssh.cjs`, horneada como respaldo. */
  script: string
  /** Cuándo se escribió; `tssh doctor` enseña el atajo con que se le llamó. */
  sello: string
  /** El entorno del main: las carpetas del usuario con que el `.cmd` escribe una ruta sin «ñ» (ver `rutaParaCmd`). */
  env?: Readonly<Record<string, string | undefined>>
}

/** Una marca de orden de bytes UTF-8: sin ella, PowerShell 5.1 lee el `.ps1` en la página de códigos ANSI. */
const BOM = String.fromCharCode(0xfeff)

/**
 * Genera los atajos que ESTE sistema necesita: los tres en Windows (Git Bash, que usa el agente, no
 * resuelve un `.ps1`, y cmd no trae `.PS1` en `PATHEXT`) y solo el `sh` en macOS.
 */
export function generarAtajosTssh(opts: OpcionesAtajosTssh, plataforma: Plataforma = plataformaActual()): ShimGenerado[] {
  const sh: ShimGenerado = { nombre: 'tssh', contenido: atajoSh(opts), eol: 'lf' }
  if (plataforma !== 'windows') return [sh]
  return [sh, { nombre: 'tssh.ps1', contenido: atajoPs1(opts), eol: 'crlf' }, { nombre: 'tssh.cmd', contenido: atajoCmd(opts), eol: 'crlf' }]
}

/** Atajo para sh: el del shell de Git en Windows (el del agente) y el único en macOS. */
function atajoSh({ exe, script, sello }: OpcionesAtajosTssh): string {
  return [
    '#!/bin/sh',
    `# Atajo generado por Tessera (contrato ${SHIM_DIR}, ${sello}).`,
    '# Se reescribe en cada arranque: no lo edites.',
    '',
    '# Desde WSL la ruta del ejecutable no sirve y el puente local de Tessera no se alcanza.',
    'if [ -n "$WSL_DISTRO_NAME" ]; then',
    '  echo "tssh no funciona desde WSL. Usa PowerShell o la terminal de Tessera." >&2',
    '  exit 2',
    'fi',
    '',
    '# El entorno manda sobre la ruta horneada (como en el atajo de tdb).',
    `[ -n "$TESSERA_EXE" ] || TESSERA_EXE=${citarSh(exe)}`,
    `[ -n "$TESSERA_TSSH" ] || TESSERA_TSSH=${citarSh(script)}`,
    '',
    '# Sin estas dos, MSYS convierte a ruta de Windows todo argumento que empiece por "/": la orden remota',
    '# (ls /etc) y el lado remoto de una copia (web:/tmp) llegarían cambiados sin dar error. Las rutas',
    '# locales de `tssh cp` las convierte tssh.',
    'MSYS_NO_PATHCONV=1',
    "MSYS2_ARG_CONV_EXCL='*'",
    'ELECTRON_RUN_AS_NODE=1',
    'TESSERA_SHIM="$0"',
    'if command -v cygpath >/dev/null 2>&1; then',
    '  TESSERA_SHIM=$(cygpath -w "$0" 2>/dev/null || printf %s "$0")',
    'fi',
    'export MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL ELECTRON_RUN_AS_NODE TESSERA_SHIM',
    '',
    'exec "$TESSERA_EXE" "$TESSERA_TSSH" "$@"',
    ''
  ].join('\n')
}

/**
 * Atajo para PowerShell. Sin bloque `param`: así `$input` recibe lo que llegue por la canalización
 * (`tssh run --stdin`). Canalizar la salida (`| Write-Output`) hace que PowerShell espere al ejecutable, que
 * es de subsistema GUI, y la deja en la canalización (una variable, `ConvertFrom-Json`). Va con BOM.
 */
function atajoPs1({ exe, script, sello }: OpcionesAtajosTssh): string {
  return (
    BOM +
    [
      `# Atajo generado por Tessera (contrato ${SHIM_DIR}, ${sello}).`,
      '# Se reescribe en cada arranque: no lo edites.',
      `$exe = if ($env:TESSERA_EXE) { $env:TESSERA_EXE } else { ${citarPowerShell(exe)} }`,
      `$guion = if ($env:TESSERA_TSSH) { $env:TESSERA_TSSH } else { ${citarPowerShell(script)} }`,
      '$argumentos = @($args)',
      '# Consola y canalización en UTF-8 solo durante la invocación; sin consola, el cambio no se puede hacer.',
      '$previaSalida = [Console]::OutputEncoding',
      '$previaEntrada = $OutputEncoding',
      '$previoNode = $env:ELECTRON_RUN_AS_NODE',
      '$previoShim = $env:TESSERA_SHIM',
      '$codigo = $null',
      'try {',
      '  try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }',
      '  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      "  $env:ELECTRON_RUN_AS_NODE = '1'",
      '  $env:TESSERA_SHIM = $PSCommandPath',
      '  if ($MyInvocation.ExpectingInput) { $input | & $exe $guion @argumentos | Write-Output }',
      '  else { & $exe $guion @argumentos | Write-Output }',
      '  $codigo = $LASTEXITCODE',
      '} finally {',
      '  try { [Console]::OutputEncoding = $previaSalida } catch { }',
      '  $OutputEncoding = $previaEntrada',
      '  $env:ELECTRON_RUN_AS_NODE = $previoNode',
      '  $env:TESSERA_SHIM = $previoShim',
      '}',
      'if ($null -eq $codigo) { $codigo = 1 }',
      'exit $codigo',
      ''
    ].join('\r\n')
  )
}

/** Atajo para cmd.exe: para una consola abierta a mano. cmd expande `%VAR%` en la línea tecleada antes de llamarlo. */
function atajoCmd({ exe, script, sello, env }: OpcionesAtajosTssh): string {
  return [
    '@echo off',
    `rem Atajo generado por Tessera (contrato ${SHIM_DIR}, ${sello}).`,
    'rem Se reescribe en cada arranque: no lo edites.',
    'setlocal',
    `if not defined TESSERA_EXE set "TESSERA_EXE=${rutaParaCmd(exe, env)}"`,
    `if not defined TESSERA_TSSH set "TESSERA_TSSH=${rutaParaCmd(script, env)}"`,
    'set "ELECTRON_RUN_AS_NODE=1"',
    'set "TESSERA_SHIM=%~f0"',
    '"%TESSERA_EXE%" "%TESSERA_TSSH%" %*',
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n')
}
