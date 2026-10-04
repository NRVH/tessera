// =============================================================================
// Argv y entorno con que se lanza cada motor de descompilación (CFR, Vineflower). PURO, sin disco
// ni subprocesos, para fijarlo con un test: aquí un detalle mal puesto no falla ruidosamente, sino
// que produce texto raro o un agujero. El jar del usuario nunca entra en el classpath de la JVM y
// el entorno se limpia de las variables que inyectan agentes. El delimitador del classpath lo da
// `terminals/entornoPty.ts`, su único dueño.
// Decisiones: docs/decisiones/java/descompilacion-con-motores-externos.md
// =============================================================================

import type { MotorDescompilador } from '../../shared/java-ipc.ts'
import { delimitadorPath } from '../terminals/entornoPty.ts'

/** Variables que inyectan opciones o agentes en cualquier JVM que arranque. */
export const ENV_JVM_PELIGROSAS = [
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'CLASSPATH'
] as const

/** Máximo de jars hermanos que se pasan como contexto. Ver `contextoDe`. */
export const MAX_CLASSPATH_JARS = 64

export interface OpcionesArgv {
  /** Ruta del jar del motor (dentro de `vendor/java/`). */
  jarMotor: string
  /** Major de la JVM que va a arrancar (decide `--disable-@files`). */
  javaMajor: number
  /** Raíz del árbol temporal donde se extrajo la clase (y sus internas). */
  dirEntrada: string
  /** Ruta del .class dentro de esa raíz. */
  claseEntrada: string
  /** Directorio de salida (solo lo usa Vineflower). */
  dirSalida: string
  /** Jars que se pasan como contexto de tipos. */
  contexto: readonly string[]
  /** Memoria máxima de la JVM. */
  xmx?: string
}

/**
 * Prefijo de opciones de la JVM, ANTES de `-jar`.
 *
 * NO lleva `--disable-@files`. Se puso para que el lanzador no expandiera un
 * argumento que empezara por `@` como fichero de argumentos, con la guarda
 * "solo si la JVM es >= 9". Esa guarda era FALSA, y comprobarlo en las JVM de este
 * equipo lo dejó claro:
 *
 *     jdk1.8.0_202   Error: Could not create the Java Virtual Machine
 *     jdk-11.0.24    Unrecognized option: --disable-@files
 *     jdk-17.0.12    Unrecognized option: --disable-@files
 *     jdk-21.0.6     ok
 *     jdk-25.0.3     ok
 *
 * O sea: rompía en 11 y 17, que son justo las más habituales en un puesto legacy, y
 * el fallo solo se veía si la JVM elegida no era la más nueva. Se quita del todo en
 * vez de afinar el número: los argumentos que se pasan son rutas ABSOLUTAS de un
 * temporal (`C:\…\tessera-decomp-XXXX\in\…`), así que jamás empiezan por `@` y la
 * opción no protegía de nada real.
 */
export function prefijoJvm(javaMajor: number, xmx = '-Xmx1g'): string[] {
  const args: string[] = []
  void javaMajor
  args.push(xmx)
  // Los tres: `file.encoding` para la lectura, y los dos de stdout porque el nombre
  // de la propiedad cambió entre versiones (sun.stdout.encoding en 8, stdout.encoding
  // desde 18). Poner las tres es inocuo y cubre todo el espectro.
  args.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dsun.stdout.encoding=UTF-8')
  return args
}

/**
 * Argv completo (sin el ejecutable) para el motor indicado.
 *
 * SEGURIDAD: el jar del usuario NUNCA aparece en `-cp`/`-classpath`. Va como argumento posicional
 * o dentro de `--extraclasspath`/`-e=`, que para el motor son ENTRADA DE ANÁLISIS, no classpath
 * de ejecución. Moverlo a `-cp` es un cambio de una línea que convertiría esto en un vector de
 * ejecución de código.
 *
 * @param delimitador Separador del `--extraclasspath` de CFR. Por defecto el de la
 *                    plataforma actual; se puede fijar para probar la ajena desde
 *                    ésta, que es la convención del repo para la lógica pura.
 */
export function argvMotor(
  motor: MotorDescompilador,
  o: OpcionesArgv,
  delimitador: string = delimitadorPath()
): string[] {
  const args = [...prefijoJvm(o.javaMajor, o.xmx), '-jar', o.jarMotor]

  if (motor === 'cfr') {
    args.push(o.claseEntrada)
    // Sin --outputdir: CFR escribe la fuente por STDOUT.
    args.push('--hideutf', 'false')
    // Silencia el resumen que CFR imprime al final y que no es código.
    args.push('--silent', 'true')
    if (o.contexto.length > 0) {
      // EL DELIMITADOR ES EL DE LA PLATAFORMA, no un `;` fijo. CFR parte esta cadena
      // por el `File.pathSeparator` de la JVM que lo ejecuta —la del host—, que en
      // macOS es `:`. Con el `;` que había aquí, los 64 jars de contexto llegaban a
      // CFR como UNA sola entrada inexistente y el contexto de tipos se perdía
      // ENTERO: la descompilación seguía saliendo, pero sin resolver genéricos ni
      // clases internas y sin un solo error por ningún lado.
      args.push('--extraclasspath', o.contexto.slice(0, MAX_CLASSPATH_JARS).join(delimitador))
    }
    return args
  }

  // Vineflower: la RAÍZ del árbol como entrada (nunca el .class suelto) y un
  // DIRECTORIO como salida.
  args.push('--log-level=error')
  args.push('--thread-count=2')
  for (const jar of o.contexto.slice(0, MAX_CLASSPATH_JARS)) args.push(`-e=${jar}`)
  args.push(o.dirEntrada, o.dirSalida)
  return args
}

/**
 * Entorno del subproceso: copia del actual SIN las variables que inyectan agentes u opciones en
 * la JVM. Un `JAVA_TOOL_OPTIONS=-javaagent:evil.jar` heredado del entorno del usuario es ejecución
 * de código arbitrario DENTRO de nuestra JVM, y además ensucia stderr con su «Picked up …».
 */
export function envLimpio(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const clave of ENV_JVM_PELIGROSAS) delete env[clave]
  return env
}

/**
 * ¿Es una línea de "ruido" que el motor imprime y que no es código Java? Se usa
 * para decidir si una salida con código 0 trae fuente de verdad o solo su banner.
 */
export function pareceFuenteJava(texto: string): boolean {
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim()
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue
    // Lo primero de verdad que emite un fichero Java es su package, un import, una
    // anotación o la propia declaración de tipo.
    return /^(package|import|@|public|private|protected|final|abstract|class|interface|enum|record|sealed|non-sealed|static)\b/.test(
      t
    )
  }
  return false
}
