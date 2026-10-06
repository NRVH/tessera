// =============================================================================
// La ayuda de `tssh`: el vocabulario, el lado remoto de una copia, los códigos de salida y lo que cambia
// según el shell. Es la que remiten el aviso de arranque del agente y el `CLAUDE.md` del agente de la
// terminal. Lo usa `tssh.cjs`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { CODIGOS } = require('./tsshSalida.cjs')

/** El texto de la ayuda. */
function textoAyuda() {
  return `
  tssh — las conexiones SSH del perfil de Tessera, para ti y para los agentes

  tssh ls [--json]
      Las conexiones que el usuario dejó disponibles para los agentes, con su destino, su
      método y si están listas (la huella confirmada y, si la piden, la contraseña guardada).
      Las demás no se nombran: solo cuántas son.

  tssh run <alias> [--timeout S] [--stdin] -- <orden>
      Ejecuta la orden en el equipo, sin terminal, con su salida en vivo, y sale con su código.
      Sin --stdin la orden no recibe entrada; con --stdin recibe la de tssh:
        tssh run web -- uptime
        tssh run "nas casa" -- df -h /
        tssh run web --stdin -- 'cat > /tmp/nota.txt' < nota.txt
      --timeout S corta la conexión a los S segundos (sale con ${CODIGOS.tope}). Sin él, no hay tope.

  tssh cp [-r] <origen> <destino>
      Copia con scp entre este equipo y una conexión. El lado remoto es <alias>:<ruta> (una ruta
      relativa, o vacía, es desde la carpeta del usuario remoto); -r copia carpetas:
        tssh cp informe.txt web:/tmp/
        tssh cp -r "nas casa:/var/log/nginx" ./logs
      En Windows, una letra de unidad (C:\\…) es siempre local.

  tssh doctor [alias]
      Diagnostica: el atajo, el puente con Tessera, el cliente SSH y, con un alias, la conexión y
      una prueba real.

  tssh help
      Esta ayuda.

  Si el alias lleva espacios, ponlo entre comillas; sus comillas pueden escribirse rectas.
  tssh nunca pide ni enseña contraseñas: las pone Tessera. Solo conecta con equipos cuya huella
  ya aceptó una persona desde la terminal de Tessera (o con «Probar»).

  Códigos de salida. Si la orden o la copia llegan a correr, el código es el suyo, y 255 si ssh
  no pudo conectar o entrar (tssh dice por qué). Los de tssh salen antes de conectar:
    ${CODIGOS.uso}    uso incorrecto (argumentos, subcomando) o desde WSL
    ${CODIGOS.puente}    Tessera no contesta o no reconoce esta terminal
    ${CODIGOS.alias}    no hay ninguna conexión disponible con ese alias
    ${CODIGOS.huella}    la huella del servidor no está confirmada, o cambió
    ${CODIGOS.noUsable}    la conexión no se puede usar ahora (falta su contraseña, la copia de su
         clave o el cliente SSH)
    ${CODIGOS.tope}  se agotó --timeout

  En PowerShell, un -- sin comillas no llega a tssh: lo entiende igual (tras el alias, la orden
  empieza en la primera palabra que no es una opción de tssh); escribe '--' si la orden empieza
  por --stdin o --timeout. La salida es texto: para binarios, tssh cp. En cmd.exe, las
  %variables% de tu línea se expanden antes de llegar a tssh.
`
}

/** Escribe la ayuda. */
function ayuda() {
  process.stdout.write(textoAyuda())
}

module.exports = { ayuda, textoAyuda }
