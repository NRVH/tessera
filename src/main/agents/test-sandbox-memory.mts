#!/usr/bin/env node
// =============================================================================
// Prueba del bloque de contexto del sandbox (npm run test:sandbox-memory): dice la verdad
// sobre `sudo`, avisa de que lo instalado en caliente se pierde, nombra `pdftoppm`/`soffice`,
// convive con el bloque de bases de datos, es idempotente y nombra bien el anfitrión (y su
// fallo del `.mcp.json`) en las dos plataformas.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================

import { bloqueSandbox, INICIO_SANDBOX, FIN_SANDBOX } from './sandboxMemoryBlock.ts'
import { bloqueEspacioDatos, reemplazarBloque, INICIO, FIN } from '../db/agentMemoryBlock.ts'
import { PRESET_DOCUMENTOS } from '../../shared/sandboxExtras.ts'

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

/** Primeras palabras de la línea que contiene `aguja`, como evidencia legible. */
function linea(texto: string, aguja: string): string {
  const l = texto.split('\n').find((x) => x.includes(aguja))
  return l ? l.trim().slice(0, 76) : `(no aparece "${aguja}")`
}

function main(): void {
  const conPermiso = bloqueSandbox({ puedeInstalar: true, horneados: [], depsNavegador: false })
  const sinPermiso = bloqueSandbox({ puedeInstalar: false, horneados: [], depsNavegador: false })

  // -------------------------------------------------------------------------
  hr('1) DICE LA VERDAD sobre los permisos')
  {
    check('con sudo: enseña el comando de instalación', conPermiso.includes('sudo apt-get install -y'), linea(conPermiso, 'apt-get install'))
    check(
      'SIN sudo: NO promete que se puede instalar',
      !sinPermiso.includes('Tienes `sudo` sin contraseña') && sinPermiso.includes('NO puedes instalar'),
      linea(sinPermiso, 'NO puedes instalar')
    )
    check(
      'SIN sudo: manda al usuario, que es quien sí puede arreglarlo',
      sinPermiso.includes('Actualizar agentes') || sinPermiso.includes('Configuración'),
      linea(sinPermiso, 'Actualizar agentes')
    )
    check(
      'SIN sudo: desaconseja el apaño de desempaquetar .deb a mano',
      sinPermiso.includes('.deb'),
      linea(sinPermiso, '.deb')
    )
  }

  // -------------------------------------------------------------------------
  hr('2) AVISA de que lo instalado en caliente se pierde')
  {
    check('nombra hibernar y cerrar Tessera', conPermiso.includes('hibernar') && conPermiso.includes('cerrar Tessera'), linea(conPermiso, 'hibernar'))
    check(
      'y aclara que el TRABAJO sí sobrevive (está en /workspace)',
      conPermiso.includes('/workspace'),
      linea(conPermiso, 'Tu trabajo')
    )
    check(
      'dice dónde se hace permanente',
      conPermiso.includes('Sandbox de Docker'),
      linea(conPermiso, 'Sandbox de Docker')
    )
  }

  // -------------------------------------------------------------------------
  hr('3) DESMIENTE lo del navegador y da la vía que sí funciona')
  {
    check('avisa de que Chromium headless no tiene visor de PDF', conPermiso.includes('no trae visor de PDF'), linea(conPermiso, 'visor de PDF'))
    check('nombra pdftoppm', conPermiso.includes('pdftoppm'), linea(conPermiso, 'pdftoppm'))
    check('nombra soffice --headless', conPermiso.includes('soffice --headless'), linea(conPermiso, 'soffice'))
    check(
      'sin las herramientas horneadas, lo advierte',
      conPermiso.includes('No están horneadas'),
      linea(conPermiso, 'No están horneadas')
    )
    const conDocs = bloqueSandbox({ puedeInstalar: true, horneados: [...PRESET_DOCUMENTOS], depsNavegador: false })
    check(
      'CON las herramientas horneadas, ya no lo advierte',
      !conDocs.includes('No están horneadas') && conDocs.includes('`poppler-utils`'),
      linea(conDocs, 'poppler-utils')
    )
    check(
      'SIN el preset del navegador: avisa de que no hay servidor gráfico',
      conPermiso.includes('No hay servidor gráfico'),
      linea(conPermiso, 'servidor gráfico')
    )
    // El mensaje se DA LA VUELTA con el preset puesto, y esto es lo que importa
    // fijar: si siguiera diciendo "solo headless" con Xvfb instalado, el agente
    // reescribiría una config que funciona para evitar un problema que ya no existe.
    const conNav = bloqueSandbox({ puedeInstalar: true, horneados: [], depsNavegador: true })
    check(
      'CON el preset: dice que `headless: false` SÍ funciona, vía xvfb-run',
      conNav.includes('xvfb-run -a') &&
        conNav.includes('headless') &&
        !conNav.includes('No hay servidor gráfico'),
      linea(conNav, 'xvfb-run')
    )
    check(
      'CON el preset: aclara que no hace falta --no-sandbox (verificado contra Docker)',
      conNav.includes('--no-sandbox'),
      linea(conNav, '--no-sandbox')
    )
    check(
      // La plataforma va EXPLÍCITA desde que el aviso se bifurca: este caso es el de
      // Windows, y con el valor por defecto la comprobación pasaba o fallaba según la
      // máquina donde se corriera el test. El caso de Mac está en el bloque (6).
      'avisa de que un .mcp.json con rutas de Windows suele ser JSON inválido',
      bloqueSandbox({ puedeInstalar: true, horneados: [], depsNavegador: true }, 'windows').includes(
        'JSON inválido'
      ),
      linea(bloqueSandbox({ puedeInstalar: true, horneados: [], depsNavegador: true }, 'windows'), 'JSON inválido')
    )
    check(
      'manda los navegadores de Playwright al proyecto montado, no a ~/.cache',
      conPermiso.includes('PLAYWRIGHT_BROWSERS_PATH=/workspace/'),
      linea(conPermiso, 'PLAYWRIGHT_BROWSERS_PATH')
    )
  }

  // -------------------------------------------------------------------------
  hr('4) CONVIVE con el bloque de bases de datos en el MISMO archivo')
  {
    const db = bloqueEspacioDatos('Alfa', [])
    // Se escriben los dos, en los dos órdenes posibles.
    let doc = reemplazarBloque('# Notas mías\n', db)
    doc = reemplazarBloque(doc, conPermiso, INICIO_SANDBOX, FIN_SANDBOX)
    check(
      'escribir el del sandbox NO se lleva el de bases de datos',
      doc.includes(INICIO) && doc.includes(FIN) && doc.includes(INICIO_SANDBOX) && doc.includes(FIN_SANDBOX),
      `db=${doc.includes(INICIO)} sandbox=${doc.includes(INICIO_SANDBOX)}`
    )
    check('y conserva las notas del usuario', doc.includes('# Notas mías'), linea(doc, 'Notas mías'))

    // Reescribir uno no toca al otro.
    const otro = bloqueSandbox({ puedeInstalar: false, horneados: [], depsNavegador: false })
    const doc2 = reemplazarBloque(doc, otro, INICIO_SANDBOX, FIN_SANDBOX)
    check(
      'reescribir el del sandbox deja intacto el de bases de datos',
      doc2.includes('Espacio de datos — Alfa') && doc2.includes('NO puedes instalar'),
      `db=${doc2.includes('Espacio de datos — Alfa')} sandbox-nuevo=${doc2.includes('NO puedes instalar')}`
    )
    check(
      'y no deja rastro del bloque de sandbox anterior',
      !doc2.includes('Tienes `sudo` sin contraseña'),
      String(!doc2.includes('Tienes `sudo` sin contraseña'))
    )
    check(
      'RETIRAR el del sandbox no toca el de bases de datos',
      reemplazarBloque(doc2, '', INICIO_SANDBOX, FIN_SANDBOX).includes('Espacio de datos — Alfa'),
      'db sigue'
    )
    // El caso simétrico: que el de BD siga usando sus marcadores por defecto.
    check(
      'reescribir el de BD (sin pasar marcadores) no toca el del sandbox',
      reemplazarBloque(doc2, bloqueEspacioDatos('OTRO', [])).includes(INICIO_SANDBOX),
      'sandbox sigue'
    )
  }

  // -------------------------------------------------------------------------
  hr('5) IDEMPOTENCIA')
  {
    check(
      'mismas entradas -> mismo texto',
      bloqueSandbox({ puedeInstalar: true, horneados: ['jq'], depsNavegador: true }) ===
        bloqueSandbox({ puedeInstalar: true, horneados: ['jq'], depsNavegador: true }),
      'idéntico'
    )
    const doc = reemplazarBloque('', conPermiso, INICIO_SANDBOX, FIN_SANDBOX)
    check(
      'reescribir el mismo bloque no cambia el documento',
      reemplazarBloque(doc, conPermiso, INICIO_SANDBOX, FIN_SANDBOX) === doc,
      'sin cambios'
    )
    const conDeps = bloqueSandbox({ puedeInstalar: true, horneados: [], depsNavegador: true })
    check(
      'el flag del navegador SÍ se refleja en el texto',
      conDeps.includes('playwright install-deps') && !conPermiso.includes('las libs de sistema de Chromium (`playwright install-deps`)'),
      linea(conDeps, 'install-deps')
    )
  }

  // -------------------------------------------------------------------------
  hr('6) EL ANFITRIÓN SE NOMBRA SEGÚN LA PLATAFORMA')
  {
    // La plataforma va explícita en los dos casos: con el valor por defecto sólo se
    // comprobaría la mitad que le toque a la máquina donde corra el test, y la otra
    // dejaría de comprobarse EN SILENCIO — que es lo mismo que borrarla.
    const ctx = { puedeInstalar: true, horneados: [], depsNavegador: false }
    const enWin = bloqueSandbox(ctx, 'windows')
    const enMac = bloqueSandbox(ctx, 'mac')
    check(
      'en Windows el montaje viene «del disco de Windows»',
      enWin.includes('de Windows montada aquí') && !enWin.includes('de macOS montada aquí'),
      linea(enWin, 'montada aquí')
    )
    check(
      'en Mac viene «del disco de macOS», no de Windows',
      enMac.includes('de macOS montada aquí') && !enMac.includes('de Windows montada aquí'),
      linea(enMac, 'montada aquí')
    )
    // El aviso del `.mcp.json` se bifurca porque el SÍNTOMA es otro: en Windows la
    // ruta mala no parsea (barras invertidas sin duplicar); en Mac es JSON válido y
    // el servidor arranca para fallar más tarde.
    check(
      'Windows: avisa de las barras invertidas de `C:\\...`',
      enWin.includes('C:\\Users\\...') && enWin.includes('duplicarlas'),
      linea(enWin, '.mcp.json')
    )
    check(
      'Mac: NO habla de barras invertidas, sí de que es JSON válido y falla tarde',
      !enMac.includes('duplicarlas') &&
        !enMac.includes('C:\\') &&
        enMac.includes('es JSON válido'),
      linea(enMac, '.mcp.json')
    )
    check(
      'los dos textos son distintos (o la bifurcación no existiría)',
      enWin !== enMac,
      `win ${enWin.length} chars · mac ${enMac.length} chars`
    )
  }

  // -------------------------------------------------------------------------
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
