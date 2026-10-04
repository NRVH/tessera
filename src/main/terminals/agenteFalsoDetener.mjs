#!/usr/bin/env node
// =============================================================================
// Agente falso para las pruebas de la parada de sesión: `test-detener-sesion.mts`,
// `test-cerrar-arbol.mts` y el paso nativo de `test-onexit-reload.mts`.
// Uso: node agenteFalsoDetener.mjs <modo> <registro>.
// Pone la tty en crudo; el modo A sale con el segundo `^C`, el modo B ignora los `^C` y el
// byte `Q` lo hace salir por su cuenta. El modo N es el B con dos nietos sordos, como los
// servidores MCP: uno en la consola del agente y otro suelto. Deja en `<registro>` una línea
// por evento (`INICIO`, `NIETO`, `RX`, `SALIDA`), cada una con su gemela `TIEMPO <ms>`.
// Es `.mjs` para correr con `node` sin type-stripping ni avisos que se cuelen en el pty.
// =============================================================================
/* global process */
import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const [modo, registro] = process.argv.slice(2)

function apuntar(linea) {
  // Las dos en UNA escritura: la gemela nunca queda separada de su evento.
  appendFileSync(registro, `${linea}\nTIEMPO ${Date.now()} ${linea}\n`, 'utf8')
}

function salir(motivo, codigo) {
  apuntar(`SALIDA ${motivo}`)
  try {
    process.stdin.setRawMode(false)
  } catch {
    /* sin tty que restaurar */
  }
  process.exit(codigo)
}

apuntar(`INICIO pid=${process.pid} modo=${modo}`)

if (!process.stdin.isTTY) {
  // Sin tty no hay modo crudo y el `^C` sería una señal: la prueba no probaría nada.
  salir('SIN-TTY', 3)
}

if (modo === 'N') {
  // El suelto no tiene consola (Windows) ni comparte grupo (POSIX): cerrar el pty no se lo
  // lleva, y es el que demuestra que se mató el ÁRBOL.
  for (const suelto of [false, true]) {
    const nieto = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
      detached: suelto
    })
    nieto.unref()
    apuntar(`NIETO pid=${nieto.pid} ${suelto ? 'suelto' : 'consola'}`)
  }
}

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')

const CTRL_C = String.fromCharCode(3)
let ctrlC = 0

process.stdin.on('data', (trozo) => {
  apuntar(`RX ${JSON.stringify(trozo)}`)
  for (const ch of trozo) {
    if (ch === 'Q') {
      salir('Q', 0)
      return
    }
    if (ch !== CTRL_C) continue
    ctrlC++
    if (modo === 'A' && ctrlC >= 2) {
      process.stdout.write('MARCA-DESPEDIDA\r\n')
      salir('CTRL-C', 0)
      return
    }
    // Lo que pinta el agente al recibir el `^C`: la prueba comprueba que NO llega a los
    // listeners, porque durante la parada el servicio se lo traga.
    process.stdout.write(`MARCA-CTRLC-${ctrlC}\r\n`)
  }
})

process.stdout.write('LISTO\r\n')
