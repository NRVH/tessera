#!/usr/bin/env node
// =============================================================================
// «ssh» falso para `test-sesion-ssh.mts`: corre en el pty como ssh, sin shell delante.
// Uso: node sshFalsoSesion.mjs <registro> [la línea de ssh, que solo apunta].
// Pone la tty en crudo y apunta en `<registro>` cada trozo que le llega (`RX <json>`): un `^C` o un
// `exit` tecleados por Tessera quedarían escritos. Apunta también argumentos, cwd y entorno, e
// imprime `LISTO`. `Z` sale con 3; `P` imprime el rechazo de ssh y sale con 255; `Q`, 255 a secas.
// Es `.mjs` para correr con `node` sin type-stripping ni avisos que se cuelen en el pty.
// =============================================================================
/* global process */
import { appendFileSync } from 'node:fs'

const [registro, ...lineaSsh] = process.argv.slice(2)

function apuntar(linea) {
  appendFileSync(registro, `${linea}\n`, 'utf8')
}

function salir(codigo) {
  try {
    process.stdin.setRawMode(false)
  } catch {
    /* sin tty que restaurar */
  }
  process.exit(codigo)
}

apuntar(`INICIO pid=${process.pid}`)
apuntar(`ARGS ${JSON.stringify(lineaSsh)}`)
apuntar(`CWD ${process.cwd()}`)
apuntar(`ENV TERM=${process.env.TERM ?? '-'} ASKPASS=${process.env.SSH_ASKPASS ?? '-'} REQUIRE=${process.env.SSH_ASKPASS_REQUIRE ?? '-'}`)

if (!process.stdin.isTTY) {
  // Sin tty no hay modo crudo y un `^C` sería una señal: la prueba no probaría nada.
  apuntar('SIN-TTY')
  salir(4)
}

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (trozo) => {
  apuntar(`RX ${JSON.stringify(trozo)}`)
  if (trozo.includes('Z')) salir(3)
  if (trozo.includes('Q')) salir(255)
  // En Windows la escritura a una tty es asíncrona: se sale cuando el texto ya está fuera.
  if (trozo.includes('P')) process.stdout.write('pruebas@192.0.2.10: Permission denied (password).\r\n', () => salir(255))
})

process.stdout.write('LISTO\r\n')
