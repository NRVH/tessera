#!/usr/bin/env node
// =============================================================================
// Prueba de `shellNativo`: qué shell lanza el modo nativo de la terminal en cada sistema. (node
// src/main/terminals/test-shell-nativo.mts)
// Puro (sin node-pty, sin Electron, sin disco): PowerShell en Windows; en macOS el `$SHELL` con
// `-i` y `-l` siempre, también para el agente; y un respaldo sin `$SHELL`.
// La plataforma es el último parámetro y vale la actual por defecto; las dos se comprueban desde
// cualquiera.
// =============================================================================

import { shellNativoPara } from './shellNativo.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

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

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Windows: PowerShell')
  // -------------------------------------------------------------------------
  {
    const s = shellNativoPara(undefined, undefined, 'windows')
    check(
      '(1a) terminal interactiva: powershell.exe -NoLogo',
      s.archivo === 'powershell.exe' && s.args.join(' ') === '-NoLogo',
      `${s.archivo} ${s.args.join(' ')}`
    )
  }
  {
    const s = shellNativoPara('claude --version', undefined, 'windows')
    check(
      '(1b) agente: -NoProfile -Command <launch>, y el launch va ENTERO en un argumento',
      s.archivo === 'powershell.exe' &&
        s.args.includes('-NoProfile') &&
        s.args[s.args.length - 1] === 'claude --version',
      `${s.archivo} ${JSON.stringify(s.args)}`
    )
  }
  // `$SHELL` es un concepto POSIX: en Windows no debe influir en nada.
  {
    const s = shellNativoPara(undefined, '/bin/bash', 'windows')
    check('(1c) $SHELL no altera la rama de Windows', s.archivo === 'powershell.exe', s.archivo)
  }
  // Modo aislado (solo pruebas): sin perfil ni historial; el valor por defecto no cambia nada.
  {
    const s = shellNativoPara(undefined, undefined, 'windows', true)
    check(
      '(1d) aislada + interactiva: -NoProfile, -NoExit y SaveNothing del historial',
      s.archivo === 'powershell.exe' &&
        s.args.includes('-NoProfile') &&
        s.args.includes('-NoExit') &&
        s.args[s.args.length - 1].includes('-HistorySaveStyle SaveNothing'),
      JSON.stringify(s.args)
    )
    const sin = shellNativoPara(undefined, undefined, 'windows', false)
    check('(1e) NEGATIVO: sin aislar, la interactiva sigue siendo `-NoLogo` a secas', sin.args.join(' ') === '-NoLogo', sin.args.join(' '))
    const ag = shellNativoPara('claude --version', undefined, 'windows', true)
    const agSin = shellNativoPara('claude --version', undefined, 'windows')
    check('(1f) aislada con agente: igual que sin aislar', JSON.stringify(ag) === JSON.stringify(agSin), JSON.stringify(ag.args))
    const mac = shellNativoPara(undefined, '/bin/zsh', 'mac', true)
    const macSin = shellNativoPara(undefined, '/bin/zsh', 'mac')
    check('(1g) aislada en macOS: no cambia nada', JSON.stringify(mac) === JSON.stringify(macSin), JSON.stringify(mac))
  }

  // -------------------------------------------------------------------------
  hr('(2) macOS: el shell del usuario')
  // -------------------------------------------------------------------------
  {
    const s = shellNativoPara(undefined, '/bin/zsh', 'mac')
    check(
      '(2a) terminal interactiva: $SHELL -il',
      s.archivo === '/bin/zsh' && s.args.join(' ') === '-il',
      `${s.archivo} ${s.args.join(' ')}`
    )
  }
  {
    const s = shellNativoPara(undefined, '/opt/homebrew/bin/fish', 'mac')
    check(
      '(2b) se respeta el $SHELL que el usuario eligió, no se impone zsh',
      s.archivo === '/opt/homebrew/bin/fish',
      s.archivo
    )
  }
  {
    const s = shellNativoPara('claude', '', 'mac')
    check(
      '(2c) $SHELL vacío -> respaldo /bin/zsh (abrir siempre gana a abrir "bien")',
      s.archivo === '/bin/zsh',
      s.archivo
    )
  }
  {
    const s = shellNativoPara('claude', '   ', 'mac')
    check('(2d) $SHELL con solo espacios cuenta como ausente', s.archivo === '/bin/zsh', s.archivo)
  }

  // -------------------------------------------------------------------------
  hr('(3) EL INVARIANTE: en macOS SIEMPRE shell de LOGIN e INTERACTIVO')
  // -------------------------------------------------------------------------
  // Sin `-l`, `launchd` deja el PATH mínimo del sistema. Sin `-i`, zsh no lee `~/.zshrc`
  // y el PATH de nvm / `~/.local/bin` / Homebrew se queda fuera: la terminal de abajo
  // (que ya era `-il`) encontraba `claude` y el agente (que era `-lc`) no. El fallo se
  // ve como "Tessera no encuentra claude" y la causa es de macOS: no hay ningún
  // mensaje que las relacione, por eso está fijado aquí.
  const agente = shellNativoPara('exec claude', '/bin/zsh', 'mac')
  const interactiva = shellNativoPara(undefined, '/bin/zsh', 'mac')
  check(
    '(3a) con agente: -ilc (login + interactivo + comando), NO -lc ni -c a secas',
    agente.args[0] === '-ilc',
    JSON.stringify(agente.args)
  )
  check(
    '(3b) el comando del agente viaja ENTERO en un solo argumento',
    agente.args.length === 2 && agente.args[1] === 'exec claude',
    JSON.stringify(agente.args)
  )
  check(
    '(3c) sin agente: -il (login + interactivo)',
    interactiva.args[0] === '-il',
    JSON.stringify(interactiva.args)
  )
  // Sobre los args REALES de las dos llamadas (con y sin `launch`): el primer argumento
  // es un grupo de banderas que lleva la `i` y la `l`. Antes esto comparaba dos
  // literales consigo mismos y no miraba ninguna llamada.
  {
    const primeros = [agente.args[0], interactiva.args[0]]
    check(
      '(3d) LAS DOS formas de macOS llevan la `i` y la `l` en su primer argumento',
      primeros.every((a) => /^-[a-z]+$/.test(a) && a.includes('i') && a.includes('l')),
      JSON.stringify(primeros)
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) `otra` (Linux) va por la rama POSIX, no por la de Windows')
  // -------------------------------------------------------------------------
  // Hoy Linux no es un objetivo, pero si alguien arranca ahí en desarrollo lo correcto
  // es un shell POSIX y no un `powershell.exe` que no existe.
  {
    const s = shellNativoPara(undefined, '/bin/bash', 'otra')
    check(
      '(4a) Linux -> $SHELL -il, nunca PowerShell',
      s.archivo === '/bin/bash' && s.args.join(' ') === '-il',
      `${s.archivo} ${s.args.join(' ')}`
    )
  }
  {
    const s = shellNativoPara('exec codex', '/bin/bash', 'otra')
    check(
      '(4b) Linux con agente -> -ilc, igual que macOS',
      s.archivo === '/bin/bash' && s.args[0] === '-ilc',
      `${s.archivo} ${JSON.stringify(s.args)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(5) la plataforma por defecto es la ACTUAL')
  // -------------------------------------------------------------------------
  // El llamador de producción (`TerminalService.spawnHostPty`) no pasa plataforma.
  // Lo que obtiene tiene que ser idéntico a pasar la actual explícitamente, y distinto
  // de lo que daría la otra (si no, el default podría estar ignorándose sin que nadie
  // lo note).
  {
    const actual: Plataforma = plataformaActual()
    const otra: Plataforma = actual === 'windows' ? 'mac' : 'windows'
    const porDefecto = shellNativoPara('exec claude', '/bin/zsh')
    const explicita = shellNativoPara('exec claude', '/bin/zsh', actual)
    const ajena = shellNativoPara('exec claude', '/bin/zsh', otra)
    check(
      `(5a) sin plataforma == plataforma actual (${actual})`,
      JSON.stringify(porDefecto) === JSON.stringify(explicita),
      `${JSON.stringify(porDefecto)} == ${JSON.stringify(explicita)}`
    )
    check(
      `(5b) y NO es lo que daría la otra (${otra})`,
      JSON.stringify(porDefecto) !== JSON.stringify(ajena),
      `${JSON.stringify(porDefecto)} != ${JSON.stringify(ajena)}`
    )
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

main()
