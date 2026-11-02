// =============================================================================
// ¿Qué terminales de shell ejecutan algo? En macOS y Linux, el grupo de procesos en primer plano
// del tty: si no es el del shell, hay un comando delante. En Windows no hay tty: un hijo directo
// que no sea la consola. Puro: recibe la tabla de procesos (`ps`, o la de Windows por PowerShell)
// y los pid de los shells; lo usa `TerminalController` para avisar antes de cortar lo que corre.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Un proceso de la tabla del sistema: su pid, el de su padre y lo que se sepa de él. */
export interface FilaProceso {
  pid: number
  ppid: number | null
  nombre?: string
  /** Su grupo de procesos (solo `ps`). */
  pgid?: number
  /** El grupo en primer plano de su tty (solo `ps`); `<= 0` si no tiene tty. */
  tpgid?: number
}

/**
 * Procesos que la consola de Windows pone bajo un shell sin que el usuario ejecute nada: no
 * cuentan como «algo en marcha».
 */
const AUXILIARES = new Set(['conhost.exe', 'openconsole.exe'])

function tieneHijo(tabla: readonly FilaProceso[], pid: number): boolean {
  return tabla.some(
    (p) => p.ppid === pid && p.pid !== pid && !AUXILIARES.has((p.nombre ?? '').toLowerCase())
  )
}

/**
 * Cuántos de `shells` ejecutan algo, o `null` si no se puede saber: algún shell no aparece en la
 * tabla (consulta vacía o rota), y callar sería cortar sin avisar. Un pid repetido cuenta una vez.
 *
 * En POSIX un shell en reposo es el grupo en primer plano de su tty; los ayudantes permanentes del
 * prompt y los trabajos de fondo viven en otros grupos y no cuentan. Sin `tpgid` (sin tty) se
 * recurre al hijo directo, que puede preguntar de más pero nunca de menos.
 */
export function contarConProceso(
  tabla: readonly FilaProceso[],
  shells: readonly number[],
  plataforma: Plataforma = plataformaActual()
): number | null {
  let enMarcha = 0
  for (const pid of new Set(shells)) {
    const fila = tabla.find((p) => p.pid === pid)
    if (!fila) return null
    const primerPlano =
      plataforma !== 'windows' && fila.pgid !== undefined && fila.tpgid !== undefined && fila.tpgid > 0
    if (primerPlano ? fila.tpgid !== fila.pgid : tieneHijo(tabla, pid)) enMarcha++
  }
  return enMarcha
}
