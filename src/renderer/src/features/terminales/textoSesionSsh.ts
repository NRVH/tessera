// =============================================================================
// ¿Ha dicho algo una sesión SSH? El «Conectando a…» se retira con el primer TEXTO que llega, y no con
// el primer byte: al abrir el pty el sistema escribe secuencias de control (título de la ventana,
// borrado de pantalla, cursor) antes de que ssh diga nada, y con ellas el aviso desaparecería al
// instante. Puro, sin React ni DOM: se fija bajo `node` (`test-pestanas-ssh.mts`).
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md
// =============================================================================

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const DEL = 127

/** Secuencias CSI (`ESC [ … letra`), OSC (`ESC ] … BEL` o `ESC \`) y las de un solo carácter (`ESC (B`, `ESC M`…). */
const SECUENCIAS = [
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'),
  new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g'),
  new RegExp(`${ESC}[()][0-9A-Za-z]|${ESC}[@-Z\\\\-_]`, 'g')
]

/** El texto de un trozo de salida sin secuencias de control. */
function sinSecuencias(datos: string): string {
  return SECUENCIAS.reduce((texto, re) => texto.replace(re, ''), datos)
}

/**
 * ¿Trae el trozo algún carácter que se vea (ni blancos ni de control) una vez quitadas las
 * secuencias? Un trozo cortado en mitad de una secuencia puede dar un falso positivo: el aviso se
 * retira un instante antes, que es el error barato.
 */
export function hayTextoVisible(datos: string): boolean {
  for (const c of sinSecuencias(datos)) {
    const codigo = c.charCodeAt(0)
    if (codigo > 32 && codigo !== DEL) return true
  }
  return false
}
