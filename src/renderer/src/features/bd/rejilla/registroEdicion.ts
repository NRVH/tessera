// =============================================================================
// Registro de las pestañas de datos con cambios sin enviar, gemelo de `registroConsolas.ts`:
// la carcasa pide cerrar una (el pane pregunta «Descartar N cambios» por PORTAL, porque la
// pestaña puede estar oculta), el diálogo de borrar la conexión suma lo pendiente de ella sin
// preguntar pestaña a pestaña, y la salida de la app lo lista en su diálogo nativo. Puro.
// Decisiones: docs/decisiones/bd/explorador-salida-de-la-app.md
// =============================================================================

import type { DbPestanaSinEnviar } from '../../../../../shared/db-explorador-ipc'

export interface ApiDatosRegistrada {
  /** Conexión de la pestaña: la usa el aviso de «Eliminar conexión». */
  conexionId: string
  /**
   * Pide cerrar la pestaña: si hay cambios sin enviar pregunta «Descartar N cambios» y
   * resuelve `true` si se puede cerrar; `false` = el usuario canceló.
   */
  solicitarCierre: () => Promise<boolean>
  /** Cuántos cambios sin enviar tiene ahora (0 = ninguno). */
  cambiosPendientes: () => number
}

const registro = new Map<string, ApiDatosRegistrada>()

/** Registra la API de una pestaña de datos; devuelve la función de baja. */
export function registrarDatos(paneKey: string, api: ApiDatosRegistrada): () => void {
  registro.set(paneKey, api)
  return () => {
    // Solo da de baja si sigue siendo ESTA api: un remontaje rápido registra la nueva
    // antes de que la vieja se despida.
    if (registro.get(paneKey) === api) registro.delete(paneKey)
  }
}

/** Cierre de una pestaña de datos por su paneKey. Sin registrar, se puede cerrar. */
export async function solicitarCierreDatos(paneKey: string): Promise<boolean> {
  const api = registro.get(paneKey)
  return api ? api.solicitarCierre() : true
}

/** Cambios sin enviar de una pestaña (0 si no está registrada). */
export function cambiosPendientesDatos(paneKey: string): number {
  return registro.get(paneKey)?.cambiosPendientes() ?? 0
}

/** Cambios sin enviar entre todas las pestañas de datos de una conexión. */
export function cambiosPendientesDeConexion(conexionId: string): number {
  let n = 0
  for (const api of registro.values()) if (api.conexionId === conexionId) n += api.cambiosPendientes()
  return n
}

/** Solo para tests. */
export function datosRegistrados(): number {
  return registro.size
}

// --- Cierre de la app ---------------------------------------------------------------------

/**
 * paneKey -> `alias · ESQUEMA.TABLA`, que pone la carcasa (`DbArea`). En una caja y no el
 * texto a pelo: la baja compara por IDENTIDAD, y dos altas con el mismo texto son dos.
 */
const etiquetas = new Map<string, { texto: string }>()

/** Lo que lee el diálogo de salida para una pestaña de tabla. */
export function etiquetaSalidaDatos(alias: string | undefined, esquema: string, objeto: string): string {
  const tabla = esquema ? `${esquema}.${objeto}` : objeto
  return alias ? `${alias} · ${tabla}` : tabla
}

/**
 * Fija la etiqueta de una pestaña de datos; devuelve la baja. Como `registrarDatos`,
 * la baja solo quita la etiqueta si sigue siendo ESTA (un re-render que la recalcula
 * pone la nueva antes de que la vieja se despida).
 */
export function etiquetarDatos(paneKey: string, etiqueta: string): () => void {
  const caja = { texto: etiqueta }
  etiquetas.set(paneKey, caja)
  return () => {
    if (etiquetas.get(paneKey) === caja) etiquetas.delete(paneKey)
  }
}

/**
 * Las pestañas de datos con cambios sin enviar, para el diálogo de salida del main.
 * NUNCA lanza: una pestaña rota que no sabe contarse se salta, y la respuesta sale igual
 * con las demás (si no saliera, el main esperaría su plazo entero y cerraría sin saber
 * nada de NINGUNA).
 */
export function pestanasSinEnviar(): DbPestanaSinEnviar[] {
  const out: DbPestanaSinEnviar[] = []
  for (const [paneKey, api] of registro) {
    let n = 0
    try {
      n = api.cambiosPendientes()
    } catch {
      continue
    }
    if (!(n > 0)) continue
    out.push({ etiqueta: etiquetas.get(paneKey)?.texto ?? 'Pestaña de tabla', cambios: n })
  }
  return out
}
