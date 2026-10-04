// =============================================================================
// Escribir y borrar en el registro de Windows con `reg.exe` por `execFile`, una operación por
// valor: sin shell nada interpreta las comillas del `command` ni el `*` de `Classes\*\shell`
// (con `exec` se expandiría contra el directorio actual), y un fallo dice qué clave falló. Todo
// es `HKCU`: la colmena se compone aquí y el plan (`shared/integracionShell.ts`) no puede elegir
// otra, así que nada pide elevación. La existencia se pregunta por el código de salida de
// `reg query`, nunca por el mensaje traducido. Lo usa `IntegracionShellService`.
// Decisiones: docs/decisiones/sistema/menu-contextual-de-windows.md
// =============================================================================

import { execFile } from 'node:child_process'
import type { EscrituraRegistro, PlanRegistro } from '../../shared/integracionShell'

/** La única colmena que Tessera toca. Ver la cabecera. */
const COLMENA = 'HKCU'

/** Tope por invocación. `reg.exe` es local e inmediato: si tarda esto, algo va mal. */
const TIMEOUT_MS = 10_000

/** Resultado de una operación: qué se pidió y, si falló, por qué. */
export interface FalloRegistro {
  operacion: string
  detalle: string
}

/** `reg.exe <args>`. Resuelve con la salida, o con el error ya legible. */
function reg(args: string[]): Promise<{ ok: boolean; salida: string }> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      args,
      { timeout: TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ ok: true, salida: stdout })
          return
        }
        // `reg.exe` escribe el motivo en stderr y a veces solo devuelve el código.
        const detalle = (stderr || stdout || err.message).trim()
        resolve({ ok: false, salida: detalle })
      }
    )
  })
}

/** `HKCU\<clave>`, que es lo que `reg.exe` espera como primer argumento. */
function ruta(clave: string): string {
  return `${COLMENA}\\${clave}`
}

/** Escribe un valor (creando la clave si hiciera falta). */
async function escribir(e: EscrituraRegistro): Promise<FalloRegistro | null> {
  const args = [
    'add',
    ruta(e.clave),
    ...(e.nombre === null ? ['/ve'] : ['/v', e.nombre]),
    '/t',
    'REG_SZ',
    '/d',
    e.dato,
    '/f'
  ]
  const r = await reg(args)
  return r.ok ? null : { operacion: `escribir ${e.clave}`, detalle: r.salida }
}

/**
 * ¿Existe? Se pregunta por el CÓDIGO DE SALIDA de `reg query` (0 = sí, 1 = no) y no
 * mirando el mensaje de error.
 *
 * SE PROBÓ lo segundo y falló en la primera ejecución real: la comprobación era
 * `/no puede encontrar|cannot find/`, y el mensaje que devuelve un Windows en español
 * es "El sistema no ha podido encontrar la clave o el valor del Registro". No casaba,
 * así que retirar una integración ya retirada se contaba como fallo y pintaba un aviso
 * rojo por hacer bien las cosas. Los mensajes de `reg.exe` están traducidos y no son
 * un contrato; el código de salida sí.
 */
async function existe(args: string[]): Promise<boolean> {
  const r = await reg(['query', ...args])
  return r.ok
}

/**
 * Borra una clave entera. Que NO EXISTA no es un fallo: quitar la integración cuando
 * ya estaba quitada tiene que ser una operación silenciosa, no un aviso rojo.
 */
async function borrarClave(clave: string): Promise<FalloRegistro | null> {
  if (!(await existe([ruta(clave)]))) return null
  const r = await reg(['delete', ruta(clave), '/f'])
  return r.ok ? null : { operacion: `borrar ${clave}`, detalle: r.salida }
}

/** Borra UN valor sin tocar su clave (ver la trampa de `OpenWithProgids`). */
async function borrarValor(clave: string, nombre: string): Promise<FalloRegistro | null> {
  if (!(await existe([ruta(clave), '/v', nombre]))) return null
  const r = await reg(['delete', ruta(clave), '/v', nombre, '/f'])
  return r.ok ? null : { operacion: `borrar ${clave}\\${nombre}`, detalle: r.salida }
}

/**
 * Aplica un plan completo. Devuelve los fallos (vacío = todo bien).
 *
 * BORRAR VA PRIMERO: si una extensión se desmarca y otra se marca en el mismo
 * guardado, hacerlo al revés podría borrar lo que se acaba de escribir.
 *
 * NO SE PARA AL PRIMER FALLO. Un plan a medias es peor que uno completo con una clave
 * rota: si `reg.exe` falla en el ProgID de `.sql`, el verbo de carpetas —que no tiene
 * nada que ver— debe quedar escrito igualmente. Se acumulan los fallos y se cuentan
 * todos juntos.
 */
export async function aplicarPlan(plan: PlanRegistro): Promise<FalloRegistro[]> {
  const fallos: FalloRegistro[] = []
  for (const clave of plan.borrarClaves) {
    const f = await borrarClave(clave)
    if (f) fallos.push(f)
  }
  for (const v of plan.borrarValores) {
    const f = await borrarValor(v.clave, v.nombre)
    if (f) fallos.push(f)
  }
  for (const e of plan.escrituras) {
    const f = await escribir(e)
    if (f) fallos.push(f)
  }
  return fallos
}

/**
 * Lee el valor PREDETERMINADO de una clave, o `null` si no existe.
 *
 * ESTA ES LA ÚNICA OPERACIÓN QUE NO USA `reg.exe`, Y HAY UN MOTIVO MEDIDO. `reg.exe`
 * ESCRIBE bien (se comprobó: acentos, comillas y el `*` de la clave de archivo llegan
 * intactos al registro), pero IMPRIME su salida en la página de códigos OEM de la
 * consola. Lanzado desde Node en asíncrono eso es cp850, no UTF-8: leer
 * `C:\Users\José\Tessera.exe` devolvía `C:\Users\Jos?\Tessera.exe`, y el único
 * consumidor de esta función compara esa ruta con `process.execPath` para decidir si
 * hay que reescribir el registro. O sea: en cualquier equipo cuyo usuario lleve una
 * tilde, la reconciliación habría reescrito el registro entero en CADA arranque
 * creyendo que estaba desactualizado. Los bytes se vieron en hexadecimal para
 * confirmarlo (`82` = é en cp850) antes de escribir esto.
 *
 * PowerShell no tiene ese problema porque se le puede FIJAR la codificación de salida.
 * Cuesta unos cientos de milisegundos arrancarlo, y se paga UNA vez por arranque —solo
 * si el usuario tiene la integración encendida—, así que el cambio no se nota. Es el
 * mismo recurso que ya usa `update/installDirLock.ts` para enumerar procesos.
 *
 * La clave se interpola en un literal de PowerShell entre comillas dobles, donde la
 * barra invertida NO escapa nada (el carácter de escape de PowerShell es la comilla
 * invertida). Todas las claves las compone `shared/integracionShell.ts` a partir de
 * constantes y de extensiones ya validadas, así que no hay comillas que puedan cerrar
 * el literal; aun así se rechaza cualquier clave con una, que es más barato que
 * confiar.
 */
export async function leerPredeterminado(clave: string): Promise<string | null> {
  if (clave.includes('"') || clave.includes('`') || clave.includes('$')) return null
  const guion =
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
    `$v = (Get-ItemProperty -LiteralPath "HKCU:\\${clave}" -ErrorAction SilentlyContinue)."(default)"; ` +
    'if ($null -ne $v) { [Console]::Out.Write($v) }'
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', guion],
      { timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err !== null) {
          resolve(null)
          return
        }
        resolve(stdout.length > 0 ? stdout : null)
      }
    )
  })
}
