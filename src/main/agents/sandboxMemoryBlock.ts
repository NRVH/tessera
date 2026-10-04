// =============================================================================
// Bloque gestionado que le explica al agente DÓNDE corre y qué puede hacer ahí (sudo, lo que
// se pierde al recrear el contenedor, cómo capturar un PDF o un Office, Playwright). Es TEXTO
// que lee el agente: cambiarlo cambia lo que hace. Puro, sin disco: el efecto vive en
// `sandboxMemory.ts`. Nombra el sistema anfitrión, así que la plataforma entra por parámetro.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================
// Extensión explícita: lo importa de forma ESTÁTICA el test `.mts`, antes de su resolver-hook.
import { tieneDocumentos } from '../../shared/sandboxExtras.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { nombresSistema } from '../../shared/nombresSistema.ts'

export const INICIO_SANDBOX = '<!-- tessera:sandbox:start -->'
export const FIN_SANDBOX = '<!-- tessera:sandbox:end -->'

/** Lo que el bloque necesita saber del contenedor vivo. */
export interface ContextoSandbox {
  /** ¿La sonda dijo que hay `sudo` utilizable? Si no, el bloque dice lo contrario. */
  puedeInstalar: boolean
  /** Paquetes apt ya horneados en la imagen (los que el usuario configuró). */
  horneados: string[]
  /** ¿Se hornearon también las libs de sistema de Chromium? */
  depsNavegador: boolean
}

/** Bloque de contexto del sandbox: mismas entradas, mismo texto (idempotente). */
export function bloqueSandbox(
  ctx: ContextoSandbox,
  plataforma: Plataforma = plataformaActual()
): string {
  const lineas: string[] = [
    ...seccionEntorno(plataforma),
    ...seccionInstalar(ctx),
    ...seccionHorneadas(ctx),
    ...seccionDocumentos(ctx),
    ...seccionPlaywright(ctx, plataforma)
  ]
  return lineas.join('\n')
}

function seccionEntorno(plataforma: Plataforma): string[] {
  return [
    INICIO_SANDBOX,
    '# Entorno: contenedor de Tessera',
    '',
    'Corres dentro de un contenedor Docker (Debian) como el usuario `agente` (uid 1001).',
    'La carpeta del proyecto, en `/workspace/<proyecto>`, es una carpeta REAL del disco',
    `de ${nombresSistema(plataforma).sistema} montada aquí: lo que escribas ahí es permanente.`,
    ''
  ]
}

function seccionInstalar(ctx: ContextoSandbox): string[] {
  if (ctx.puedeInstalar) {
    return [
      '## Puedes instalar lo que necesites',
      '',
      'Tienes `sudo` sin contraseña. No pidas permiso para instalar una herramienta: instálala.',
      '',
      '- `sudo apt-get update && sudo apt-get install -y <paquete>`',
      '- `sudo npm install -g <paquete>`',
      '',
      '## Pero lo que instales EN CALIENTE se pierde',
      '',
      'El contenedor se DESTRUYE al hibernar el perfil, al cerrar Tessera y al pulsar',
      '"Actualizar agentes". Un `apt-get install` no sobrevive a ninguna de las tres.',
      'Tu trabajo sí sobrevive (está en `/workspace`); los paquetes no.',
      '',
      'Si una herramienta te va a hacer falta SIEMPRE, dile al usuario que la añada en',
      'Configuración → Proyectos → Sandbox de Docker: eso se hornea en la imagen y ya',
      'no hay que reinstalarlo nunca.',
      ''
    ]
  }
  return [
    '## NO puedes instalar paquetes',
    '',
    'Este contenedor no tiene `sudo` utilizable, así que `apt-get` y `npm install -g`',
    'van a fallar con "Permission denied". No insistas ni busques rodeos (descargar',
    '`.deb` y desempaquetarlos a mano no es una solución: se pierde igual al recrear',
    'el contenedor).',
    '',
    'Dile al usuario que la imagen del sandbox está desactualizada y que la rehornee',
    'con el botón "Actualizar agentes", o que añada lo que falte en Configuración →',
    'Proyectos → Sandbox de Docker.',
    ''
  ]
}

function seccionHorneadas(ctx: ContextoSandbox): string[] {
  const lineas: string[] = ['## Herramientas horneadas en esta imagen', '']
  if (ctx.horneados.length) {
    lineas.push(...ctx.horneados.map((p) => `- \`${p}\``))
  } else {
    lineas.push('- (ninguna extra; solo lo que trae `node:lts`: node, npm, git)')
  }
  if (ctx.depsNavegador) {
    lineas.push('- las libs de sistema de Chromium (`playwright install-deps`)')
  }
  lineas.push('')
  return lineas
}

function seccionDocumentos(ctx: ContextoSandbox): string[] {
  const lineas: string[] = [
    '## Capturar un PDF o un documento de Office',
    '',
    '**Chromium headless no trae visor de PDF.** "Abrir el PDF en el navegador y hacer',
    'una captura" no produce nada: es un callejón sin salida, no un problema de permisos.',
    'Lo que sí funciona:',
    '',
    '- PDF → imagen: `pdftoppm -png -r 150 archivo.pdf salida` (paquete `poppler-utils`)',
    '- Word/Excel/PowerPoint → PDF: `soffice --headless --convert-to pdf archivo.docx`',
    '  (paquetes `libreoffice-writer`, `libreoffice-calc`, `libreoffice-impress`)',
    '- Un Office se captura encadenando las dos: primero a PDF, luego a PNG.',
    ''
  ]
  if (!tieneDocumentos(ctx.horneados)) {
    lineas.push(
      ctx.puedeInstalar
        ? '_No están horneadas en esta imagen: instálalas con `sudo apt-get install -y ...`_'
        : '_No están horneadas en esta imagen y no puedes instalarlas: pídeselo al usuario._',
      ''
    )
  }
  return lineas
}

function seccionPlaywright(ctx: ContextoSandbox, plataforma: Plataforma): string[] {
  const lineas: string[] = ['## Playwright, si lo usas aquí', '']
  if (ctx.depsNavegador) {
    lineas.push(
      '- **Hay Xvfb**, así que `"headless": false` SÍ funciona: lanza el proceso con',
      '  `xvfb-run -a <comando>` y Chromium arranca headed de verdad (no el headless',
      '  shell), con `slowMo` y `recordVideo` comportándose como en un escritorio. La',
      '  ventana existe, solo que en una pantalla virtual que no ve nadie.',
      '- No hace falta `--no-sandbox`: el sandbox de Chromium arranca bien aquí.'
    )
  } else {
    lineas.push(
      '- **No hay servidor gráfico** ni las libs de sistema de Chromium: hoy este',
      '  contenedor no puede lanzar un navegador. Se activan con el interruptor',
      '  "Navegador de pruebas" en Configuración → Proyectos → Sandbox de Docker, que',
      '  además instala Xvfb para poder correr en modo `headless: false`.'
    )
  }
  lineas.push(
    '- Instala los navegadores DENTRO del proyecto montado, nunca en `~/.cache`, o se',
    '  perderán (pesan ~200 MB) en la próxima recreación del contenedor:',
    '',
    '  ```sh',
    '  export PLAYWRIGHT_BROWSERS_PATH=/workspace/<proyecto>/.playwright-browsers-linux',
    '  npx playwright install chromium',
    '  ```',
    '',
    // Mismo problema, distinto síntoma: en Windows la ruta del anfitrión rompe el JSON
    // (barras invertidas); en macOS es JSON válido y falla tarde. Por eso se bifurca.
    ...(plataforma === 'windows'
      ? [
          '- Las rutas del `.mcp.json` tienen que ser POSIX (`/workspace/...`). Un `C:\\Users\\...`',
          '  no existe aquí dentro — y ojo, en JSON esas barras invertidas además hay que',
          '  duplicarlas, así que un `.mcp.json` con rutas de Windows suele ser JSON inválido',
          '  y el servidor MCP no llega ni a arrancar.'
        ]
      : [
          '- Las rutas del `.mcp.json` tienen que ser las de AQUÍ DENTRO (`/workspace/...`).',
          '  Una ruta del anfitrión (`/Users/...`) es JSON válido, así que no da error al',
          '  leerse: el servidor MCP arranca, no encuentra nada y falla mucho más tarde.'
        ]),
    FIN_SANDBOX
  )
  return lineas
}
