// =============================================================================
// Registro de las pestañas de datos con cambios sin enviar, gemelo de `registroConsolas.ts`:
// la carcasa pide cerrar una (el pane pregunta «Descartar N cambios» por PORTAL, porque la
// pestaña puede estar oculta), el diálogo de borrar la conexión suma lo pendiente de ella sin
// preguntar pestaña a pestaña, y la salida de la app lo lista en su diálogo nativo. Puro.
// Decisiones: docs/decisiones/bd/explorador-salida-de-la-app.md
// =============================================================================

import type { DbPestanaSinEnviar } from '../../../../../shared/db-explorador-ipc'
import { txRejilla } from './textosRejilla.ts'

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
export function registrarDatos(clavePane: string, api: ApiDatosRegistrada): () => void {
  registro.set(clavePane, api)
  return () => {
    // Solo da de baja si sigue siendo ESTA api: un remontaje rápido registra la nueva
    // antes de que la vieja se despida.
    if (registro.get(clavePane) === api) registro.delete(clavePane)
  }
}

/** Cierre de una pestaña de datos por su clavePane. Sin registrar, se puede cerrar. */
export async function solicitarCierreDatos(clavePane: string): Promise<boolean> {
  const api = registro.get(clavePane)
  return api ? api.solicitarCierre() : true
}

/** Cambios sin enviar de una pestaña (0 si no está registrada). */
export function cambiosPendientesDatos(clavePane: string): number {
  return registro.get(clavePane)?.cambiosPendientes() ?? 0
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
 * clavePane -> `alias · ESQUEMA.TABLA`, que pone la carcasa (`DbArea`). En una caja y no el
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
export function etiquetarDatos(clavePane: string, etiqueta: string): () => void {
  const caja = { texto: etiqueta }
  etiquetas.set(clavePane, caja)
  return () => {
    if (etiquetas.get(clavePane) === caja) etiquetas.delete(clavePane)
  }
}

/**
 * Las pestañas de datos con cambios sin enviar, para el diálogo de salida del main.
 * NUNCA lanza: una pestaña rota que no sabe contarse se salta, y la respuesta sale igual
 * con las demás (si no saliera, el main esperaría su plazo entero y cerraría sin saber
 * nada de NINGUNA).
 */
export function pestanasSinEnviar(): DbPestanaSinEnviar[] {
  const salida: DbPestanaSinEnviar[] = []
  for (const [clavePane, api] of registro) {
    let n = 0
    try {
      n = api.cambiosPendientes()
    } catch {
      continue
    }
    if (!(n > 0)) continue
    salida.push({ etiqueta: etiquetas.get(clavePane)?.texto ?? txRejilla().tabla, cambios: n })
  }
  return salida
}
