// =============================================================================
// Textos del botón de actualización de la barra de título, su popover y la línea de última
// comprobación, en español e inglés. Sin JSX: lo importan módulos puros que prueba `node` a secas.
// Se leen al usarse. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txActualizaciones = crearTextos(
  {
    ultimoChequeo: {
      nunca: 'Aún no se ha comprobado',
      momento: 'Comprobado hace un momento',
      min: (n: number) => `Comprobado hace ${n} min`,
      horas: (n: number) => `Comprobado hace ${n} h`,
      dias: (n: number) => `Comprobado hace ${n} d`
    },
    vista: {
      falloEtiqueta: 'La actualización falló',
      falloTitulo: (v: string) => `La versión ${v} no llegó a instalarse. Haga clic para ver el motivo.`,
      descargandoEtiqueta: (v: string, pct: number) => `Descargando ${v} · ${pct} %`,
      descargandoTitulo: (v: string, pct: number) => `Descargando Tessera ${v} en segundo plano (${pct} %).`,
      quienConVersion: (v: string) => `Tessera ${v}`,
      quienSinVersion: 'Una versión nueva de Tessera',
      descargar: (v: string) => `Descargar ${v}`,
      disponibleTitulo: (quien: string) =>
        `${quien} está disponible. Esta copia no puede instalarse automáticamente: haga clic para ver cómo hacerlo.`,
      sinConfirmar: (v: string | null) =>
        `Tessera ${v} está preparada, pero falta confirmarla con el servidor. Haga clic para confirmarla e instalarla.`,
      alCerrar: (v: string | null) =>
        `Tessera ${v} está preparada. Se aplicará automáticamente al cerrar; haga clic para aplicarla ahora.`,
      preparada: (v: string | null) => `Tessera ${v} está preparada. Haga clic para reiniciar e instalarla.`,
      actualizarAhora: 'Actualizar ahora',
      instalando: 'Instalando…',
      aplicando: 'Aplicando la actualización.',
      errorEtiqueta: 'No se pudo comprobar',
      errorTitulo: 'No se pudo completar la comprobación de actualizaciones. Haga clic para ver el motivo.',
      aplicadaEtiqueta: (hasta: string) => `Actualizada a ${hasta}`,
      aplicadaTitulo: (desde: string, hasta: string) => `Tessera se actualizó de ${desde} a ${hasta}.`,
      buscando: 'Buscando…',
      comprobando: 'Comprobando si hay una versión nueva.',
      buscar: 'Buscar actualizaciones',
      comprobar: 'Comprobar si hay una versión nueva de Tessera.'
    },
    anuncios: {
      actualizada: (hasta: string) => `Tessera se actualizó a ${hasta}.`,
      preparada: (v: string | null) => `La versión ${v} está preparada.`,
      disponible: (v: string) => `La versión ${v} está disponible para descargar.`,
      nueva: 'nueva'
    },
    popover: {
      etiqueta: 'Actualizaciones de Tessera',
      falloTitulo: (v: string) => `No se pudo aplicar la versión ${v}`,
      sigues: (v: string) => `Se mantiene la versión ${v}. Sus datos y su configuración están intactos.`,
      agotado: ' Tessera dejó de reintentar; la publicación de una versión superior resolverá el problema.',
      reintento: ' Se volverá a intentar la próxima vez que se cierre Tessera.',
      abrirInstalador: 'Abrir instalador',
      verRegistro: 'Ver registro',
      descartar: 'Descartar',
      aplicadaTitulo: 'Tessera se actualizó',
      entendido: 'Entendido',
      bajando: 'Se está descargando en segundo plano; puede seguir trabajando.',
      faltaConfirmar: 'Está descargada, pero falta confirmarla con el servidor antes de poder aplicarla.',
      seAplicaAlCerrar: 'Se aplicará automáticamente al cerrar Tessera. Después de instalarla, Tessera no se volverá a abrir.',
      seAplicaAlPulsar: 'Se aplicará al hacer clic en "Actualizar ahora".',
      venia: ' Quedó preparada en el inicio anterior.',
      preparadaTitulo: 'Actualización preparada',
      descargandoTitulo: 'Descargando actualización',
      actualizarAhora: 'Actualizar ahora',
      disponibleTitulo: 'Versión nueva disponible',
      noSePuedeSola: 'Esta copia no puede instalarse automáticamente: descargue la versión nueva y sustituya la aplicación.',
      descargar: (v: string) => `Descargar ${v}`,
      errorTitulo: 'No se pudo comprobar',
      reintentar: 'Reintentar',
      copiado: 'Copiado',
      copiarDetalles: 'Copiar detalles',
      yaPreparada: 'Ya hay una versión preparada: no hay nada más que buscar.',
      confirmarConServidor: 'Confirma con el servidor la versión que ya se descargó.',
      buscarAhora: 'Buscar ahora'
    }
  },
  {
    ultimoChequeo: {
      nunca: 'Not checked yet',
      momento: 'Checked just now',
      min: (n: number) => `Checked ${n} min ago`,
      horas: (n: number) => `Checked ${n} h ago`,
      dias: (n: number) => `Checked ${n} d ago`
    },
    vista: {
      falloEtiqueta: 'Update failed',
      falloTitulo: (v: string) => `Version ${v} was not installed. Click to see why.`,
      descargandoEtiqueta: (v: string, pct: number) => `Downloading ${v} · ${pct}%`,
      descargandoTitulo: (v: string, pct: number) => `Downloading Tessera ${v} in the background (${pct}%).`,
      quienConVersion: (v: string) => `Tessera ${v}`,
      quienSinVersion: 'A new version of Tessera',
      descargar: (v: string) => `Download ${v}`,
      disponibleTitulo: (quien: string) =>
        `${quien} is available. This copy cannot install itself: click to see how.`,
      sinConfirmar: (v: string | null) =>
        `Tessera ${v} is ready, but the server still needs to confirm it. Click to confirm and install it.`,
      alCerrar: (v: string | null) =>
        `Tessera ${v} is ready. It will be applied automatically when you quit; click to apply it now.`,
      preparada: (v: string | null) => `Tessera ${v} is ready. Click to restart and install it.`,
      actualizarAhora: 'Update now',
      instalando: 'Installing…',
      aplicando: 'Applying the update.',
      errorEtiqueta: 'Check failed',
      errorTitulo: 'The update check failed. Click to see why.',
      aplicadaEtiqueta: (hasta: string) => `Updated to ${hasta}`,
      aplicadaTitulo: (desde: string, hasta: string) => `Tessera was updated from ${desde} to ${hasta}.`,
      buscando: 'Checking…',
      comprobando: 'Checking for a new version.',
      buscar: 'Check for updates',
      comprobar: 'Check whether there is a new version of Tessera.'
    },
    anuncios: {
      actualizada: (hasta: string) => `Tessera was updated to ${hasta}.`,
      preparada: (v: string | null) => `Version ${v} is ready.`,
      disponible: (v: string) => `Version ${v} is available to download.`,
      nueva: 'new'
    },
    popover: {
      etiqueta: 'Tessera updates',
      falloTitulo: (v: string) => `Version ${v} could not be applied`,
      sigues: (v: string) => `You are still on ${v}. Your data and settings are intact.`,
      agotado: ' Tessera stopped retrying; a newer release will unblock it.',
      reintento: ' Tessera tries again the next time you quit.',
      abrirInstalador: 'Open installer',
      verRegistro: 'View log',
      descartar: 'Dismiss',
      aplicadaTitulo: 'Tessera was updated',
      entendido: 'Got it',
      bajando: 'Downloading in the background; you can keep working.',
      faltaConfirmar: 'It is downloaded, but the server must confirm it before it can be applied.',
      seAplicaAlCerrar: 'It is applied automatically when you quit Tessera. Tessera does not reopen automatically.',
      seAplicaAlPulsar: 'It is applied when you click "Update now".',
      venia: ' It was already prepared the last time Tessera started.',
      preparadaTitulo: 'Update ready',
      descargandoTitulo: 'Downloading update',
      actualizarAhora: 'Update now',
      disponibleTitulo: 'New version available',
      noSePuedeSola: 'This copy cannot install itself: download it and replace the app.',
      descargar: (v: string) => `Download ${v}`,
      errorTitulo: 'Check failed',
      reintentar: 'Retry',
      copiado: 'Copied',
      copiarDetalles: 'Copy details',
      yaPreparada: 'A version is already prepared: there is nothing else to check.',
      confirmarConServidor: 'Confirm the downloaded version with the server.',
      buscarAhora: 'Check now'
    }
  }
)
