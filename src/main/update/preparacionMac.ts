// =============================================================================
// La descarga y la preparación de macOS, que aquí son NUESTRAS: `atenderUpdateMac` hace a mano
// lo que en Windows hace `update-downloaded` (bajar o revalidar el zip con `descargaMac.ts`,
// armar el motor, escribir el marcador, pasar a `ready`), y `bundleAplicable` dice si esta
// copia puede sustituir su propio `.app`. Trabaja sobre `ciclo` (`nucleo.ts`).
// Decisiones: docs/decisiones/actualizacion/relevo-de-macos.md
// =============================================================================

import { join } from 'node:path'
import { logUpdate as log } from './logUpdate'
import { elegirZipDeActualizacion, nombreDeArchivoDeUrl } from './descargaManual'
import { bundleDeLaApp, sePuedeEscribirEnElBundle } from './relevoMac'
import { descargarZipMac, dirPendienteMac, podarPendientesMac, zipYaVerificado } from './descargaMac'
import { nuevoMarcador } from './marcadorUpdatePuro'
import { guardarMarcador } from './marcadorUpdate'
import { replanificar } from './chequeo'
import {
  anunciarDescargaManual,
  ciclo,
  fail,
  necesitaRevalidar,
  seAplicaAlCerrarAhora,
  setState,
  sistema
} from './nucleo'

/**
 * ¿Puede ESTA copia sustituir su propio `.app`? Separa el camino completo del respaldo
 * `available`. Se contesta en el momento, sin caché: es barato (`stat` + `access`) y el
 * `.app` se puede mover, así que una respuesta rancia sería una promesa que el cierre no
 * puede cumplir.
 */
export function bundleAplicable(): boolean {
  const bundle = bundleDeLaApp()
  return bundle !== null && sePuedeEscribirEnElBundle(bundle)
}

/**
 * El `update-downloaded` de macOS, hecho a mano. Baja el zip (o revalida el que ya está
 * en disco), lo verifica contra el sha512 del feed y deja el ciclo en `ready` con
 * marcador, como el handler de Windows. TODA DECISIÓN DE ESTADO SE TOMA ANTES DEL PRIMER
 * `await`: el `finally` de `check()` devuelve a `idle` lo que encuentre en `checking`.
 */
export async function atenderUpdateMac(info: {
  version: string
  files: ReadonlyArray<{ url: string; sha512?: string; size?: number }>
}): Promise<void> {
  const version = String(info.version)

  // PRIMERO DE TODO: dos `update-available` seguidos (un chequeo manual encima del
  // automático) no pueden arrancar dos descargas sobre el mismo archivo parcial. Va antes
  // que los otros guardas porque los otros TOCAN el estado que la descarga está pintando.
  if (ciclo.descargaMacEnCurso) {
    log(`ya hay una descarga de macOS en marcha; se ignora el aviso repetido de v${version}.`)
    return
  }
  if (!bundleAplicable()) {
    anunciarDescargaManual(version, info.files, 'no se puede escribir donde vive el .app')
    return
  }
  const zip = ciclo.feedBase === null ? null : elegirZipDeActualizacion(ciclo.feedBase, info.files)
  if (zip === null) {
    anunciarDescargaManual(version, info.files, 'el feed no publica un .zip con sha512')
    return
  }

  // ¿Es la que arrastrábamos del arranque anterior? Se calcula ANTES de armar nada,
  // porque `necesitaRevalidar()` deja de ser cierto en cuanto se arma, y
  // `preparadaDesdeArranque` tiene que seguir siendo verdad para la UI.
  const revalidando =
    necesitaRevalidar() && ciclo.marcador !== null && ciclo.marcador.versionDestino === version

  ciclo.descargaMacEnCurso = true
  ciclo.descargaEnVuelo = true
  const destino = join(dirPendienteMac(), nombreDeArchivoDeUrl(zip.url))

  // Revalidando no se pinta una descarga: se recalcula el sha512 de un archivo que ya
  // está en disco, y «Descargando 0 %» sería inventarse una descarga que no existe.
  if (!revalidando) {
    log(`disponible v${version}; descargando en segundo plano…`)
    setState({
      status: 'downloading',
      newVersion: version,
      percent: 0,
      errorMessage: null,
      errorDetail: null
    })
  } else {
    log(`el feed confirma la v${version}; revalidando el zip que ya estaba en disco…`)
  }

  try {
    if (await zipYaVerificado(destino, zip.sha512)) {
      log(`la copia de ${destino} cuadra con el sha512 del feed: no hay que bajar nada.`)
    } else {
      await descargarZipMac({
        url: zip.url,
        sha512: zip.sha512,
        size: zip.size,
        destino,
        onProgreso: (pct) => setState({ status: 'downloading', percent: pct }),
        log: (m) => log(m),
        peticionGet: (url) => sistema().peticionGet(url)
      })
    }
  } catch (err) {
    // `fail` respeta un `ready` previo (no lo degrada a error) y sabe que aquí no hay
    // nada preparado si veníamos de `downloading`. El archivo malo ya está borrado.
    fail(err, 'descarga de macOS')
    ciclo.descargaMacEnCurso = false
    ciclo.descargaEnVuelo = false
    return
  }

  // A partir de aquí el «motor» está armado, y significa lo mismo que en Windows: hay un
  // archivo en disco que ESTA sesión ha verificado contra el feed (`decisionInstalar.ts`).
  ciclo.motorArmado = true
  ciclo.descargaMacEnCurso = false
  ciclo.descargaEnVuelo = false
  ciclo.avisadoFeedSinVersion = false
  log(`v${version} descargada y verificada -> ${destino}`)
  // La versión anterior, si el usuario encadena dos actualizaciones sin reiniciar.
  podarPendientesMac([destino], (m) => log(m))

  const base = nuevoMarcador({
    versionDestino: version,
    versionOrigen: sistema().version(),
    rutaInstalador: destino,
    ahora: new Date(),
    // Aquí no aplica NSIS sino el guion de `relevoMac.ts`: el marcador es el registro de
    // lo que se preparó, y escribir `'nsis'` en un Mac sería una mentira persistida.
    motor: 'relevo-mac'
  })
  // Se conserva la contabilidad de intentos si ya había marcador para ESTA misma versión
  // destino; si no, la guarda anti-bucle no saltaría jamás. Idéntico a Windows.
  ciclo.marcador =
    ciclo.marcador !== null && ciclo.marcador.versionDestino === base.versionDestino
      ? { ...base, intentos: ciclo.marcador.intentos, bloqueado: ciclo.marcador.bloqueado }
      : base
  guardarMarcador(ciclo.marcador)

  setState({
    status: 'ready',
    newVersion: version,
    percent: 100,
    installerPath: destino,
    preparadaDesdeArranque: revalidando,
    seAplicaAlCerrar: seAplicaAlCerrarAhora(),
    errorMessage: null,
    errorDetail: null
  })
  replanificar('actualización preparada (macOS)')
}
