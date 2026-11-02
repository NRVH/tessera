// =============================================================================
// Modo relevo: el mismo binario de Tessera arrancado desde una COPIA en `%LOCALAPPDATA%` con el
// encargo en el argv, para aplicar la actualización cuando la Tessera de verdad ya no existe
// (un solo empaquetado que mantener, y la ventana con la paleta de la app). Raíz de composición
// propia: abre el registro, consume el encargo, abre la ventana (`adaptadores/ventana.ts`), ejecuta
// el supervisor (`supervisor.ts`) y atiende las salidas (`salidas.ts`). No arranca nada de la app:
// este proceso es su enterrador.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// Decisiones: docs/decisiones/app/arranque-relevo-e-instancia-unica.md
// =============================================================================

import { app, clipboard } from 'electron'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { encargoValido, rutaEncargoDesdeArgv, type EncargoRelevo } from '../../shared/relevo'
import {
  MARCA_ABRIR,
  MARCA_ANTERIOR,
  MARCA_COPIAR,
  MARCA_INSTALADOR,
  MARCA_REINTENTAR,
  paginaRelevo
} from './relevoUi'
import { crearLog, ejecutarRelevo } from './supervisor'
import { crearSalidas } from './salidas'
import { txRelevoUi } from './textos.ts'
import { VentanaRelevo } from './adaptadores/ventana'
import { fijarIdiomaHeredado } from '../app/idioma'

/** ¿Nos han arrancado como relevo? Devuelve la ruta del encargo, o null. */
export function rutaEncargoRelevo(): string | null {
  return rutaEncargoDesdeArgv(process.argv)
}

/** Lee y valida el encargo; null si no se puede usar, y lo dice en el registro. */
function leerEncargo(rutaEncargo: string, log: (m: string) => void): EncargoRelevo | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(rutaEncargo, 'utf8'))
    if (encargoValido(raw)) return raw
    log(`el encargo ${rutaEncargo} no tiene la forma esperada; el relevo no puede seguir`)
  } catch (err) {
    log(`no se pudo leer el encargo ${rutaEncargo}: ${String(err)}`)
  }
  return null
}

/**
 * Arranca la ventana del relevo y ejecuta el encargo. Solo devuelve el control
 * cuando el usuario cierra: a partir de aquí este proceso no hace nada más.
 */
export async function arrancarRelevo(rutaEncargo: string): Promise<void> {
  // EL REGISTRO SE ABRE ANTES DE LEER EL ENCARGO, y no después. Su ruta va DENTRO
  // del encargo, así que un encargo ilegible dejaba al relevo sin log — y ese es
  // justo el caso que hay que poder explicar: para cuando esto corre, la Tessera
  // que lo lanzó ya selló un intento contra el tope anti-bucle y se murió. La ruta
  // se deriva de la del encargo, que sí conocemos siempre.
  const log = crearLog(path.join(path.dirname(path.dirname(rutaEncargo)), 'relevo.log'))

  const encargo = leerEncargo(rutaEncargo, log)
  if (encargo === null) {
    // Sin encargo no hay nada que supervisar. Se sale sin ventana (no sabríamos ni
    // qué versiones anunciar), pero ya NO en silencio: la línea de arriba queda
    // escrita. Tessera sigue instalada; su camino de respaldo se encarga.
    app.exit(0)
    return
  }

  log(`relevo arranca; ${encargo.versionActual} -> ${encargo.versionNueva}; padre=${encargo.pidPadre}`)
  // EL ENCARGO SE CONSUME. Mientras exista en disco, cualquier arranque que llegue a
  // este código lo tomaría por trabajo pendiente y volvería a instalar. Se borra en
  // cuanto está leído y validado: a partir de aquí vive en memoria.
  try {
    rmSync(rutaEncargo, { force: true })
  } catch {
    /* si no se puede borrar, el próximo `lanzarRelevo` lo pisa al escribir el suyo */
  }

  await app.whenReady()
  // El relevo no pasa por el arranque normal: el idioma se fija aquí para su ventana.
  fijarIdiomaHeredado()
  const ventana = await VentanaRelevo.abrir(
    paginaRelevo(encargo.versionActual, encargo.versionNueva),
    txRelevoUi().ventana,
    { titulo: txRelevoUi().cerrandoTitulo, detalle: txRelevoUi().cerrandoDetalle }
  )
  const salidas = crearSalidas(encargo, ventana, log, () => app.exit(0))
  ventana.alPulsar((marca) => {
    if (marca === MARCA_ABRIR) salidas.abrirTessera()
    else if (marca === MARCA_COPIAR) clipboard.writeText(ventana.lineas.join('\n'))
    else if (marca === MARCA_REINTENTAR) salidas.enExclusiva(salidas.reintentar)
    else if (marca === MARCA_ANTERIOR) salidas.enExclusiva(salidas.volverALaAnterior)
    else if (marca === MARCA_INSTALADOR) salidas.enExclusiva(salidas.abrirInstalador)
  })
  salidas.enExclusiva(async () =>
    salidas.pintarVeredicto(
      await ejecutarRelevo(
        encargo,
        (t, d) => ventana.paso(t, d),
        (m) => ventana.registrar(log, m)
      )
    )
  )
  // A partir de aquí manda el usuario: el proceso vive hasta que elija una salida o
  // cierre la ventana. Es lo que convierte un fallo mudo en un fallo que se lee.
}
