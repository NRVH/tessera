// =============================================================================
// Arranque del ciclo: `sembrarDesdeMarcador` lee el marcador de la sesión anterior y siembra
// el estado con el desenlace (aplicada, fallida o preparada y pendiente de revalidar). Es lo
// que convierte el arranque en la pantalla donde se cuenta cómo acabó la actualización, y lo
// que evita re-descargar lo que ya está en disco. Trabaja sobre `ciclo` (`nucleo.ts`).
// Decisiones: docs/decisiones/actualizacion/marcador-y-prevuelos.md
// =============================================================================

import { capacidades, esMac } from '../../shared/plataforma'
import { logUpdate as log } from './logUpdate'
import {
  MAX_INTENTOS_UPDATE,
  decidirAlArrancar,
  marcadorTrasFallo,
  type MarcadorUpdate
} from './marcadorUpdatePuro'
import { borrarMarcador, guardarMarcador, instaladorPresente, leerMarcador } from './marcadorUpdate'
import { consumirMarcaRelevoMac } from './relevoMac'
import type { ResultadoRelevo } from './relevoMacPuro'
import { bundleAplicable } from './preparacionMac'
import { ciclo, seAplicaAlCerrarAhora, setState, sistema } from './nucleo'

/** Lee el marcador y siembra el estado con el desenlace de la actualización anterior. */
export function sembrarDesdeMarcador(): void {
  const enDisco = leerMarcador()
  const vinoDeUnUpdate = sistema().esArranqueTrasActualizar()
  // El desenlace que dejó el relevo de macOS se consume aquí, pase lo que pase con el
  // marcador: es de un solo uso, y es lo ÚNICO que puede explicar POR QUÉ no se aplicó
  // (quien lo intentó fue un proceso que ya no existe).
  const relevo: ResultadoRelevo | null = esMac() ? consumirMarcaRelevoMac() : null
  if (relevo !== null) log(`el relevo de macOS dejó dicho: ${relevo.clase === 'ok' ? 'ok' : relevo.motivo}`)
  const d = decidirAlArrancar({
    marcador: enDisco,
    versionActual: sistema().version(),
    vinoDeUnUpdate,
    instaladorPresente: instaladorPresente(enDisco),
    maxIntentos: MAX_INTENTOS_UPDATE
  })

  if (d.clase === 'exito') {
    // Se borra AQUÍ y no al descartar el aviso: un cierre inesperado entre este arranque
    // y el clic replicaría "¡Actualizada!" en todos los arranques siguientes.
    borrarMarcador()
    ciclo.marcador = null
    log(`actualización aplicada: ${d.desde} -> ${d.hasta}${vinoDeUnUpdate ? ' (nos relanzó el instalador)' : ''}.`)
    setState({ avisoAplicada: { desde: d.desde, hasta: d.hasta } })
    return
  }

  if (d.clase === 'fallo') {
    // `decidirAlArrancar` sólo devuelve 'fallo' con marcador. El marcador NO se borra: el
    // siguiente arranque tiene que seguir sabiendo de esta versión y sus intentos.
    ciclo.marcador = marcadorTrasFallo(enDisco as MarcadorUpdate, d.agotado)
    guardarMarcador(ciclo.marcador)
    log(
      `la actualización a ${d.versionEsperada} no llegó a aplicarse ` +
        `(intentos ${d.intentos}/${MAX_INTENTOS_UPDATE}${d.agotado ? ', agotados' : ''}).`
    )
    setState({
      // El instalador sigue en disco casi siempre, y con los intentos agotados lanzarlo
      // a mano es LA salida; sin esto el popover caía en "Ver registro".
      installerPath: instaladorPresente(ciclo.marcador) ? ciclo.marcador.rutaInstalador : null,
      avisoFallo: {
        versionEsperada: d.versionEsperada,
        intentos: d.intentos,
        agotado: d.agotado,
        // En Windows nadie sabe POR QUÉ (el que falló ya no existe) y la UI pone su frase
        // genérica. En Mac sí, cuando el relevo llegó a escribir su desenlace.
        mensaje: relevo !== null && relevo.clase === 'fallo' ? relevo.motivo : null,
        detalle: null
      }
    })
    return
  }

  if (d.clase === 'listo') {
    // Donde no se puede auto-instalar, un marcador «listo» no sirve: sembrarlo como
    // `ready` prometería algo que nadie va a aplicar y ninguna revalidación lo armaría.
    // Se descarta y el primer chequeo lo convierte en el `available` que sí es verdad.
    if (!capacidades().autoInstalarUpdate) {
      log(
        `se descarta el marcador de ${d.marcador.versionDestino}: esta plataforma no puede ` +
          'auto-instalar; el chequeo la anunciará como descarga manual.'
      )
      borrarMarcador()
      ciclo.marcador = null
      return
    }
    // Lo mismo si ESTA copia no puede: en Mac el marcador pudo escribirse con la app en
    // un sitio escribible y arrancar hoy desde otro (un .dmg montado, un volumen de sólo
    // lectura). Sería un `ready` que el cierre no puede cumplir.
    if (esMac() && !bundleAplicable()) {
      log(
        `se descarta el marcador de ${d.marcador.versionDestino}: no se puede sustituir el ` +
          '.app de esta copia; el chequeo la anunciará como descarga manual.'
      )
      borrarMarcador()
      ciclo.marcador = null
      return
    }
    ciclo.marcador = d.marcador
    // "Preparada" NO es "aplicable": electron-updater no sabe nada de este fichero hasta
    // que un chequeo lo revalide contra el feed (`necesitaRevalidar`).
    log(
      `actualización ${d.marcador.versionDestino} preparada de un arranque anterior; ` +
        'hay que revalidarla contra el feed antes de poder aplicarla.'
    )
    setState({
      status: 'ready',
      newVersion: d.marcador.versionDestino,
      percent: 100,
      installerPath: d.marcador.rutaInstalador,
      preparadaDesdeArranque: true,
      seAplicaAlCerrar: seAplicaAlCerrarAhora()
    })
    return
  }

  ciclo.marcador = null
  if (enDisco !== null) {
    log(`se descarta el marcador: ${d.motivo}.`)
    borrarMarcador()
  }
}
