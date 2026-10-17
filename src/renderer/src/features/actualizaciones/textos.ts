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
      falloTitulo: (v: string) => `La versión ${v} no llegó a instalarse. Pulsa para ver por qué.`,
      descargandoEtiqueta: (v: string, pct: number) => `Descargando ${v} · ${pct} %`,
      descargandoTitulo: (v: string, pct: number) => `Descargando Tessera ${v} en segundo plano (${pct} %).`,
      quienConVersion: (v: string) => `Tessera ${v}`,
      quienSinVersion: 'Una versión nueva de Tessera',
      descargar: (v: string) => `Descargar ${v}`,
      disponibleTitulo: (quien: string) =>
        `${quien} está disponible. Esta copia no puede instalarse sola: pulsa para ver cómo.`,
      sinConfirmar: (v: string | null) =>
        `Tessera ${v} está preparada, pero falta confirmarla con el servidor. Pulsa para hacerlo e instalarla.`,
      alCerrar: (v: string | null) =>
        `Tessera ${v} está preparada. Se aplicará sola al cerrar; pulsa para hacerlo ya.`,
      preparada: (v: string | null) => `Tessera ${v} está preparada. Pulsa para reiniciar e instalarla.`,
      actualizarAhora: 'Actualizar ahora',
      instalando: 'Instalando…',
      aplicando: 'Aplicando la actualización.',
      errorEtiqueta: 'No se pudo comprobar',
      errorTitulo: 'La comprobación de actualizaciones falló. Pulsa para ver por qué.',
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
      sigues: (v: string) => `Sigues en la ${v}. Tus datos y tu configuración están intactos.`,
      agotado: ' Se dejó de intentar; publicar una versión superior lo desatasca.',
      reintento: ' Se volverá a intentar la próxima vez que cierres Tessera.',
      abrirInstalador: 'Abrir instalador',
      verRegistro: 'Ver registro',
      descartar: 'Descartar',
      aplicadaTitulo: 'Tessera se actualizó',
      entendido: 'Entendido',
      bajando: 'Se está bajando en segundo plano; puedes seguir trabajando.',
      faltaConfirmar: 'Está descargada, pero falta confirmarla con el servidor antes de poder aplicarla.',
      seAplicaAlCerrar: 'Se aplicará sola cuando cierres Tessera. No se volverá a abrir sola.',
      seAplicaAlPulsar: 'Se aplicará cuando pulses “Actualizar ahora”.',
      venia: ' Venía preparada del arranque anterior.',
      preparadaTitulo: 'Actualización preparada',
      descargandoTitulo: 'Descargando actualización',
      actualizarAhora: 'Actualizar ahora',
      disponibleTitulo: 'Versión nueva disponible',
      noSePuedeSola: 'Esta copia no puede instalarse sola: descárgala y sustituye la app.',
      descargar: (v: string) => `Descargar ${v}`,
      errorTitulo: 'No se pudo comprobar',
      reintentar: 'Reintentar',
      copiado: 'Copiado',
      copiarDetalles: 'Copiar detalles',
      yaPreparada: 'Ya hay una versión preparada: no hay nada más que buscar.',
      confirmarConServidor: 'Confirma con el servidor la versión que ya está descargada.',
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
      descargandoEtiqueta: (v: string, pct: number) => `Downloading ${v} · ${pct} %`,
      descargandoTitulo: (v: string, pct: number) => `Downloading Tessera ${v} in the background (${pct} %).`,
      quienConVersion: (v: string) => `Tessera ${v}`,
      quienSinVersion: 'A new version of Tessera',
      descargar: (v: string) => `Download ${v}`,
      disponibleTitulo: (quien: string) =>
        `${quien} is available. This copy can’t install itself: click to see how.`,
      sinConfirmar: (v: string | null) =>
        `Tessera ${v} is ready, but it still needs to be confirmed with the server. Click to do that and install it.`,
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
      agotado: ' Tessera stopped trying; releasing a higher version will unblock it.',
      reintento: ' It will be tried again the next time you quit Tessera.',
      abrirInstalador: 'Open installer',
      verRegistro: 'View log',
      descartar: 'Dismiss',
      aplicadaTitulo: 'Tessera was updated',
      entendido: 'Got it',
      bajando: 'It is downloading in the background; you can keep working.',
      faltaConfirmar: 'It is downloaded, but it needs to be confirmed with the server before it can be applied.',
      seAplicaAlCerrar: 'It will be applied automatically when you quit Tessera. It will not reopen on its own.',
      seAplicaAlPulsar: 'It will be applied when you click “Update now”.',
      venia: ' It was already prepared at the previous launch.',
      preparadaTitulo: 'Update ready',
      descargandoTitulo: 'Downloading update',
      actualizarAhora: 'Update now',
      disponibleTitulo: 'New version available',
      noSePuedeSola: 'This copy can’t install itself: download it and replace the app.',
      descargar: (v: string) => `Download ${v}`,
      errorTitulo: 'Check failed',
      reintentar: 'Retry',
      copiado: 'Copied',
      copiarDetalles: 'Copy details',
      yaPreparada: 'A version is already prepared: there is nothing else to look for.',
      confirmarConServidor: 'Confirm with the server the version that is already downloaded.',
      buscarAhora: 'Check now'
    }
  }
)
