// =============================================================================
// Qué claves del registro hay que escribir (y cuáles borrar) para «Abrir con Tessera».
// Puro: aquí no se toca el registro, solo se decide; lo aplica `main/shell/RegistroWindows.ts`.
// Todo va en HKCU porque la instalación es por usuario: en HKLM los demás usuarios verían
// una entrada que lanza un ejecutable de otro perfil, y además pediría UAC.
// No puede fijar la app PREDETERMINADA (`UserChoice` lleva un hash del sistema): solo
// aparecer en «Abrir con» (`OpenWithProgids` y `Applications\Tessera.exe`).
// Lo importa un `test-*.mts` bajo `node`: imports con extensión `.ts`.
// Decisiones: docs/decisiones/sistema/menu-contextual-de-windows.md
// =============================================================================
import { nombreAmigableDe, progIdDe } from './extensionesShell.ts'

/** Nombre del verbo. Es también el nombre de la clave: corto, único y sin espacios. */
export const VERBO = 'Tessera'

/** Lo que se lee en el menú contextual. */
export const ETIQUETA_VERBO = 'Abrir con Tessera'

/** Raíz de TODO lo que escribe Tessera. Nada fuera de aquí. */
export const RAIZ = 'Software\\Classes'

/** Una escritura de un valor. `nombre: null` = el valor PREDETERMINADO de la clave. */
export interface EscrituraRegistro {
  clave: string
  nombre: string | null
  dato: string
}

/** Lo que hay que hacerle al registro para pasar de un estado a otro. */
export interface PlanRegistro {
  /** Claves a borrar ENTERAS (con sus subclaves). */
  borrarClaves: string[]
  /** Valores sueltos a borrar SIN tocar su clave (ver `OpenWithProgids`). */
  borrarValores: { clave: string; nombre: string }[]
  /** Valores a escribir. `reg add` crea la clave si no existe. */
  escrituras: EscrituraRegistro[]
}

/** Lo que el usuario ha pedido en Configuración. */
export interface EstadoIntegracion {
  /** Verbo en carpetas, fondo de carpeta y unidades. */
  carpetas: boolean
  /** Verbo en cualquier archivo. */
  archivos: boolean
  /** Extensiones asociadas, ya normalizadas (ver `extensionesShell`). */
  extensiones: readonly string[]
}

export const INTEGRACION_APAGADA: EstadoIntegracion = {
  carpetas: false,
  archivos: false,
  extensiones: []
}

/**
 * Las tres claves de «objeto contenedor» (sobre una carpeta, en su fondo y sobre una
 * unidad) llevan `%V`; la de archivo, `%1`. En el FONDO de una carpeta no hay archivo
 * sobre el que se hizo clic: `%1` ahí no falla, abre la carpeta equivocada.
 */
const CLAVES_CARPETA = ['Directory', 'Directory\\Background', 'Drive'] as const

const claveVerbo = (tipo: string): string => `${RAIZ}\\${tipo}\\shell\\${VERBO}`
const claveComando = (tipo: string): string => `${claveVerbo(tipo)}\\command`
const claveProgId = (ext: string): string => `${RAIZ}\\${progIdDe(ext)}`
const claveOpenWith = (ext: string): string => `${RAIZ}\\${ext}\\OpenWithProgids`

/** `Software\Classes\Applications\Tessera.exe`: la ficha de la app en "Abrir con". */
export function claveAplicacion(exePath: string): string {
  const exe = exePath.split('\\').pop() ?? 'Tessera.exe'
  return `${RAIZ}\\Applications\\${exe}`
}

/** El comando entrecomillado, tal cual lo espera el Explorador. */
function comando(exePath: string, marcador: '%1' | '%V'): string {
  return `"${exePath}" "${marcador}"`
}

/** Los valores de una clave de verbo: etiqueta, icono y (en archivos) multiselección. */
function valoresVerbo(clave: string, exePath: string, unicoAlSeleccionarVarios: boolean): EscrituraRegistro[] {
  const out: EscrituraRegistro[] = [
    // El valor PREDETERMINADO es la etiqueta. Se descartó `MUIVerb`: hace lo mismo,
    // gana sobre el predeterminado y complica explicar cuál manda cuando se depura
    // esto en `regedit` a las once de la noche.
    { clave, nombre: null, dato: ETIQUETA_VERBO },
    // Sin `,0`: Windows toma el primer icono del ejecutable, que es el que queremos.
    { clave, nombre: 'Icon', dato: exePath }
  ]
  // Imprescindible en `*\shell`: sin él, el sistema invoca el verbo una vez por archivo
  // seleccionado (hasta 15), y serían otros tantos procesos de ~250 MB muriendo contra
  // el cerrojo de instancia única sin abrir ninguna ventana.
  if (unicoAlSeleccionarVarios) {
    out.push({ clave, nombre: 'MultiSelectModel', dato: 'Single' })
  }
  return out
}

/**
 * Todo lo que hay que ESCRIBIR para dejar el registro en `estado`.
 *
 * No incluye borrados: eso lo decide `planDeCambio`, que es quien conoce el estado
 * anterior y por tanto lo que ha dejado de hacer falta.
 */
export function escriturasDe(estado: EstadoIntegracion, exePath: string): EscrituraRegistro[] {
  const out: EscrituraRegistro[] = []

  if (estado.carpetas) {
    for (const tipo of CLAVES_CARPETA) {
      out.push(...valoresVerbo(claveVerbo(tipo), exePath, false))
      out.push({ clave: claveComando(tipo), nombre: null, dato: comando(exePath, '%V') })
    }
  }

  if (estado.archivos) {
    out.push(...valoresVerbo(claveVerbo('*'), exePath, true))
    out.push({ clave: claveComando('*'), nombre: null, dato: comando(exePath, '%1') })
  }

  if (estado.extensiones.length > 0) {
    // La ficha de la app: es lo que hace que Tessera salga con su nombre y su icono en
    // el diálogo "Abrir con" en vez de como una ruta suelta.
    const app = claveAplicacion(exePath)
    out.push({ clave: app, nombre: 'FriendlyAppName', dato: 'Tessera' })
    out.push({ clave: `${app}\\shell\\open\\command`, nombre: null, dato: comando(exePath, '%1') })
    for (const ext of estado.extensiones) {
      out.push({ clave: `${app}\\SupportedTypes`, nombre: ext, dato: '' })
      // ProgID propio: nombre del tipo, icono y cómo abrirlo.
      out.push({ clave: claveProgId(ext), nombre: null, dato: nombreAmigableDe(ext) })
      out.push({ clave: `${claveProgId(ext)}\\DefaultIcon`, nombre: null, dato: exePath })
      out.push({
        clave: `${claveProgId(ext)}\\shell\\open\\command`,
        nombre: null,
        dato: comando(exePath, '%1')
      })
      // Y el alta en la lista de "Abrir con" de esa extensión. Es un VALOR dentro de
      // una clave que puede tener más candidatos: se añade, nunca se sustituye.
      out.push({ clave: claveOpenWith(ext), nombre: progIdDe(ext), dato: '' })
    }
  }

  return out
}

/**
 * El plan para pasar de `anterior` a `nuevo`.
 *
 * EL BORRADO ES LA MITAD DIFÍCIL, y tiene una trampa que hay que nombrar: para
 * desasociar una extensión NO se borra `Software\Classes\.java` —esa clave es del
 * SISTEMA y dentro vive la asociación que el usuario tenga con su editor o con
 * lo que sea—, se borra ÚNICAMENTE nuestro valor dentro de su
 * `OpenWithProgids`. Borrar la clave entera sería romperle al usuario una asociación
 * que Tessera nunca creó.
 */
export function planDeCambio(
  anterior: EstadoIntegracion,
  nuevo: EstadoIntegracion,
  exePath: string
): PlanRegistro {
  const borrarClaves: string[] = []
  const borrarValores: { clave: string; nombre: string }[] = []

  if (anterior.carpetas && !nuevo.carpetas) {
    for (const tipo of CLAVES_CARPETA) borrarClaves.push(claveVerbo(tipo))
  }
  if (anterior.archivos && !nuevo.archivos) {
    borrarClaves.push(claveVerbo('*'))
  }

  const siguen = new Set(nuevo.extensiones)
  for (const ext of anterior.extensiones) {
    if (siguen.has(ext)) continue
    borrarClaves.push(claveProgId(ext))
    borrarValores.push({ clave: claveOpenWith(ext), nombre: progIdDe(ext) })
    borrarValores.push({ clave: `${claveAplicacion(exePath)}\\SupportedTypes`, nombre: ext })
  }
  // Sin extensiones ya no hay nada que declarar: la ficha de la app se retira entera.
  if (anterior.extensiones.length > 0 && nuevo.extensiones.length === 0) {
    borrarClaves.push(claveAplicacion(exePath))
  }

  return { borrarClaves, borrarValores, escrituras: escriturasDe(nuevo, exePath) }
}

/** ¿Está todo apagado? Sirve para no llamar a `reg.exe` sin necesidad. */
export function integracionVacia(e: EstadoIntegracion): boolean {
  return !e.carpetas && !e.archivos && e.extensiones.length === 0
}

/**
 * La clave y el valor que hay que CONSULTAR para saber a qué ejecutable apunta el
 * registro ahora mismo. Es lo que permite reconciliar al arrancar cuando Tessera
 * cambia de carpeta (reinstalación en otro directorio, o paso a otra máquina con el
 * perfil sincronizado): sin esto, el menú seguiría lanzando un .exe que ya no existe.
 */
export function claveDeSondeo(estado: EstadoIntegracion): { clave: string } | null {
  if (estado.carpetas) return { clave: claveComando('Directory') }
  if (estado.archivos) return { clave: claveComando('*') }
  // Y si SOLO hay extensiones asociadas, se sondea el comando del primer ProgID. Sin
  // esta rama, quien no usa el menú contextual pero sí las asociaciones se quedaba sin
  // reconciliación: reinstalar Tessera en otra carpeta —el instalador lo permite— dejaba
  // el `shell\open\command` de su ProgID apuntando a un .exe que ya no existe, y nada
  // volvía a arreglarlo. Es exactamente el fallo para el que se escribió la
  // reconciliación.
  const primera = estado.extensiones[0]
  if (primera !== undefined) {
    return { clave: `${claveProgId(primera)}\\shell\\open\\command` }
  }
  return null
}

/** Saca la ruta del ejecutable de un `command` ya escrito (`"C:\…\x.exe" "%V"`). */
export function exeDeComando(dato: string): string | null {
  const m = /^"([^"]+)"/.exec(dato.trim())
  return m ? m[1] : null
}
