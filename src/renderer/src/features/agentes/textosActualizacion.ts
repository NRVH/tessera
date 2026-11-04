// =============================================================================
// Textos de la actualización de los agentes: el modal de Docker, el botón y el popover de los
// agentes nativos, los motivos por los que una sesión no se reinicia y los banners con los que
// vuelve. Puro y sin JSX: el marcado (negritas, código) lo compone cada componente con los trozos.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

const sesionesEs = (n: number): string => (n === 1 ? '1 sesión' : `${n} sesiones`)
const sesionesEn = (n: number): string => (n === 1 ? '1 session' : `${n} sessions`)

export const txActualizacion = crearTextos(
  {
    modal: {
      titulo: 'Actualizar agentes',
      cerrar: 'Cerrar',
      introA: 'Descarga e instala la última versión de ',
      introY: ' y ',
      introB:
        ' reconstruyendo la imagen base (unos minutos) y reiniciando los contenedores. Los agentes abiertos se reiniciarán automáticamente sobre la versión nueva.',
      okAntes: '✓ Agentes actualizados. Ahora: ',
      okSep: ' · ',
      okDespues: '.',
      fallo: '✕ No se pudo actualizar: ',
      cancelar: 'Cancelar',
      actualizar: 'Actualizar',
      trabajando: 'Actualizando… No cierre la aplicación.'
    },
    boton: {
      etiqueta: (tuEquipo: string) => `Actualizar los agentes de ${tuEquipo}`,
      actualizando: 'Actualizando…',
      fases: {
        comprobando: 'comprobando versiones',
        instalando: 'instalando la versión nueva',
        deteniendo: 'deteniendo las sesiones',
        relanzando: 'reiniciando las sesiones',
        terminado: 'terminando'
      },
      tituloEnCurso: (tuEquipo: string, fase: string) =>
        `Actualizando los agentes de ${tuEquipo}: ${fase}. Haga clic para ver el progreso.`,
      sesiones: sesionesEs,
      lista: (partes: string[]) =>
        partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`,
      actualizar: (lista: string) => `actualizar ${lista}`,
      reparar: (lista: string) => `reparar ${lista}`,
      reiniciar: (sesiones: string) => `reiniciar ${sesiones}`,
      accionPorDefecto: 'Actualizar y reiniciar',
      saltoRepara: (etq: string, ultima: string | null) => `${etq} no responde: se puede reparar con ${ultima}`,
      noSePudo: (lista: string) => `no se pudo actualizar ${lista}`,
      ni: ' ni ',
      noVolvio: (sesiones: string, n: number) => `${sesiones} no ${n === 1 ? 'volvió' : 'volvieron'} a iniciarse`,
      errorTitulo: (detalle: string) => `La actualización de los agentes tuvo problemas${detalle}. Haga clic para ver qué ocurrió.`,
      reiniciadas: (sesiones: string, n: number) => `${sesiones} ${n === 1 ? 'reiniciada' : 'reiniciadas'}`,
      okTitulo: (detalle: string) => `Agentes actualizados${detalle}. Haga clic para ver el resumen.`,
      corre: (sesiones: string, n: number) => `${sesiones} ${n === 1 ? 'usa' : 'usan'} una versión anterior`,
      avisoTitulo: (tuEquipo: string, partes: string, espera: string) =>
        `Hay novedades en los agentes de ${tuEquipo}: ${partes}.${espera} Haga clic para verlas.`,
      reposoSinEstado: (tuEquipo: string) => `Comprobar las versiones de Claude Code y Codex en ${tuEquipo}.`,
      reposoManual: (partes: string) => `Hay una versión nueva que debe instalarse manualmente: ${partes}. Haga clic para ver cómo.`,
      reposoAlDia: (tuEquipo: string) =>
        `Los agentes de ${tuEquipo} están al día. Haga clic para comprobarlo o reiniciarlos.`
    },
    popover: {
      etiqueta: (tuEquipo: string) => `Agentes de ${tuEquipo}`,
      comprobandoVersiones: 'Comprobando las versiones…',
      sinDatos: 'Aún no hay datos de versiones.',
      comprobando: 'Comprobando…',
      comprobarAhora: 'Comprobar ahora',
      todoAlDia: 'Todo al día',
      nadaQueInstalar: 'Nada que Tessera pueda instalar ahora',
      reiniciarIgualmente: (n: number) => `Reiniciar igualmente (${n})`,
      reparacion: (a: string | null) => `No responde: se reinstalará ${a}. `,
      faseB:
        'Se detendrán sus sesiones antes de instalar, porque el ejecutable en uso bloquea la carpeta, y se reiniciarán automáticamente en la misma conversación.',
      faseA: 'Se instala con sus sesiones abiertas; después se reinician.',
      binarioPendiente: (ultima: string | null, tuEquipo: string) =>
        `${ultima ?? 'La versión nueva'} aún no está lista para ${tuEquipo}: el registro todavía no ofrece su binario. Vuelva a comprobar en unos minutos.`,
      manualConOrden: '. Ejecute manualmente esta orden:',
      manualSinOrden: '.',
      bloqueado: 'No se instalará: otros programas tienen abierta su carpeta. Ciérrelos y vuelva a comprobar.',
      noInstalado: 'No está instalado o no responde.',
      atrasadas: (n: number) =>
        `Ya está instalada; ${n === 1 ? 'hay 1 sesión' : `hay ${n} sesiones`} con una versión anterior.`,
      sinUltima: 'No se pudo consultar la última versión.',
      alDia: 'Al día.',
      canal: (canal: string) => `canal ${canal}`,
      demonio: (etq: string, nombre: string) => `demonio de ${etq} (${nombre})`,
      copiada: 'Copiada',
      copiar: 'Copiar',
      notaTrabajando: 'trabajando',
      notaEspera: 'espera su respuesta',
      notaTextoSinEnviar: 'puede tener texto sin enviar',
      notaSinRevisar: 'terminó y aún no se ha revisado',
      seReiniciara: 'Se reiniciará',
      seReiniciaran: (n: number) => `Se reiniciarán ${n}`
    },
    progreso: {
      salida: (n: number) => `Salida (${n} ${n === 1 ? 'línea' : 'líneas'})`,
      reiniciando: 'Reiniciando',
      actualizando: 'Actualizando',
      titulo: (verbo: string, tuEquipo: string) => `${verbo} los agentes de ${tuEquipo}`,
      noCierres: 'No cierre Tessera hasta que termine: puede haber sesiones detenidas que aún no se han reiniciado.',
      descartar: 'Descartar',
      noSeHizoNada: 'No se hizo nada',
      noSePudoActualizar: 'no se pudo actualizar',
      sesionesReiniciadas: 'Sesiones reiniciadas',
      agentesActualizados: 'Agentes actualizados',
      conProblemas: 'La actualización tuvo problemas',
      ningunaReiniciada: 'No se reinició ninguna sesión.',
      reiniciadas: (sesiones: string, n: number) => `${sesiones} ${n === 1 ? 'reiniciada' : 'reiniciadas'}.`
    },
    pasos: {
      ventanaAgente: 'Ventana de agente',
      comprobando: 'Comprobando versiones…',
      deteniendo: (etq: string | null) => `Deteniendo las sesiones de ${etq ?? 'los agentes'}…`,
      instalando: (etq: string | null) => `Instalando ${etq ?? 'la versión nueva'}…`,
      relanzando: 'Reiniciando las sesiones…',
      instalado: (etq: string, despues: string | null) => `${etq} instalado${despues ? ` (${despues})` : ''}`,
      falloInstalar: (etq: string, detalle: string | undefined) => `${etq}: no se pudo actualizar${detalle ? ` — ${detalle}` : ''}`,
      reiniciada: (nombre: string) => `${nombre}: reiniciada`,
      falloArrancar: (nombre: string, motivo: string | undefined) => `${nombre}: ${motivo ?? 'no volvió a iniciarse'}`,
      sinReiniciar: (nombre: string, motivo: string | undefined) => `${nombre}: sin reiniciar${motivo ? ` (${motivo})` : ''}`
    },
    motivos: {
      panelCambio: 'el panel cambió o se cerró',
      empezoATrabajar: 'empezó a trabajar',
      esperaRespuesta: 'espera su respuesta',
      textoNuevo: 'se empezó a escribir en ella',
      noArranco: 'no volvió a iniciarse',
      cerrada: 'se cerró antes de reiniciarla',
      sinResondeo: 'no se pudo volver a comprobar su versión',
      versionDesconocida: 'no se sabe con qué versión arrancó',
      alDia: 'ya corre la versión instalada',
      noNativa: 'ya no corre en modo nativo',
      seCerro: 'se cerró',
      muerta: 'su proceso ya había terminado',
      ocupada: 'estaba en medio de otro reinicio',
      noSePudoDetener: 'no se pudo detener',
      noSePudoDetenerCon: (detalle: string) => `no se pudo detener: ${detalle}`,
      noSePudoActualizarCli: (etq: string) => `no se pudo actualizar ${etq}`,
      otraSesion: (etq: string, espera: boolean) => `otra sesión de ${etq} ${espera ? 'espera su respuesta' : 'estaba trabajando'}`
    },
    plan: {
      brew: 'Está instalado con Homebrew: se actualiza con la orden de Homebrew',
      gestor: 'Está instalado con un gestor de paquetes del sistema que Tessera no admite',
      desconocido: 'No se sabe cómo se instaló: actualícelo con el mismo método con que lo instaló',
      sinOrden: 'Tessera no tiene una orden automática para esta instalación en este equipo',
      yaEnCurso: 'Ya hay una actualización en curso',
      nadaQueHacer: 'No hay nada que actualizar ni reiniciar',
      espera: (trabajando: number, esperando: number): string => {
        const agentes = (n: number): string => (n === 1 ? '1 agente' : `${n} agentes`)
        const esperan = (n: number): string => (n === 1 ? 'espera' : 'esperan')
        if (esperando === 0) return `Espera: ${agentes(trabajando)} trabajando`
        if (trabajando === 0) return `Espera: ${agentes(esperando)} ${esperan(esperando)} su respuesta`
        return `Espera: ${agentes(trabajando)} trabajando y ${esperando} que ${esperan(esperando)} su respuesta`
      }
    },
    orquestador: {
      noSePudoPedir: (detalle: string) => `No se pudo pedir la instalación: ${detalle}`,
      noSeComprobo: (detalle: string) => `No se pudieron comprobar las versiones: ${detalle}`,
      noSePuede: 'No se puede actualizar ahora',
      noSeRecomprobo: (detalle: string) => `No se pudieron volver a comprobar las versiones: ${detalle}`,
      interrumpida: (detalle: string) => `La actualización se interrumpió: ${detalle}`
    },
    banner: {
      sigue: (etq: string, sigue: string) => `── ${etq} sigue en ${sigue}: no se pudo actualizar ──`,
      sinVersion: (etq: string) => `── ${etq}: no se pudo actualizar ──`,
      noResponde: (etq: string) => `── ${etq} no responde tras actualizar ──`,
      salto: (etq: string, de: string, a: string) => `── ${etq} ${de} → ${a} ──`,
      reiniciadoEn: (etq: string, v: string) => `── ${etq} reiniciado en ${v} ──`,
      reiniciado: (etq: string) => `── ${etq} reiniciado ──`
    }
  },
  {
    modal: {
      titulo: 'Update agents',
      cerrar: 'Close',
      introA: 'Downloads and installs the latest version of ',
      introY: ' and ',
      introB:
        ', rebuilding the base image (a few minutes) and restarting the containers. Open agents restart automatically on the new version.',
      okAntes: '✓ Agents updated. Now: ',
      okSep: ' · ',
      okDespues: '.',
      fallo: '✕ Could not update: ',
      cancelar: 'Cancel',
      actualizar: 'Update',
      trabajando: 'Updating… Do not close the app.'
    },
    boton: {
      etiqueta: (tuEquipo: string) => `Update agents on ${tuEquipo}`,
      actualizando: 'Updating…',
      fases: {
        comprobando: 'checking versions',
        instalando: 'installing the new version',
        deteniendo: 'stopping the sessions',
        relanzando: 'restarting the sessions',
        terminado: 'finishing'
      },
      tituloEnCurso: (tuEquipo: string, fase: string) =>
        `Updating the agents on ${tuEquipo}: ${fase}. Click to view progress.`,
      sesiones: sesionesEn,
      lista: (partes: string[]) => {
        if (partes.length <= 1) return partes.join('')
        if (partes.length === 2) return `${partes[0]} and ${partes[1]}`
        return `${partes.slice(0, -1).join(', ')}, and ${partes[partes.length - 1]}`
      },
      actualizar: (lista: string) => `update ${lista}`,
      reparar: (lista: string) => `repair ${lista}`,
      reiniciar: (sesiones: string) => `restart ${sesiones}`,
      accionPorDefecto: 'Update and restart',
      saltoRepara: (etq: string, ultima: string | null) => `${etq} is not responding: you can repair it with ${ultima}`,
      noSePudo: (lista: string) => `could not update ${lista}`,
      ni: ' or ',
      noVolvio: (sesiones: string) => `${sesiones} did not start again`,
      errorTitulo: (detalle: string) => `The agent update had problems${detalle}. Click to see what happened.`,
      reiniciadas: (sesiones: string) => `${sesiones} restarted`,
      okTitulo: (detalle: string) => `Agents updated${detalle}. Click to see the summary.`,
      corre: (sesiones: string, n: number) => `${sesiones} ${n === 1 ? 'is' : 'are'} running an older version`,
      avisoTitulo: (tuEquipo: string, partes: string, espera: string) =>
        `The agents on ${tuEquipo} have updates: ${partes}.${espera} Click to see them.`,
      reposoSinEstado: (tuEquipo: string) => `Check the Claude Code and Codex versions on ${tuEquipo}.`,
      reposoManual: (partes: string) => `A new version is available that you install manually: ${partes}. Click to see how.`,
      reposoAlDia: (tuEquipo: string) =>
        `The agents on ${tuEquipo} are up to date. Click to check or restart them.`
    },
    popover: {
      etiqueta: (tuEquipo: string) => `Agents on ${tuEquipo}`,
      comprobandoVersiones: 'Checking versions…',
      sinDatos: 'No version data yet.',
      comprobando: 'Checking…',
      comprobarAhora: 'Check now',
      todoAlDia: 'Everything is up to date',
      nadaQueInstalar: 'Nothing Tessera can install right now',
      reiniciarIgualmente: (n: number) => `Restart anyway (${n})`,
      reparacion: (a: string | null) => `It is not responding: Tessera will reinstall ${a}. `,
      faseB:
        'Tessera stops its sessions before installing (the running executable locks the folder) and restarts each one in its conversation.',
      faseA: 'It installs while its sessions stay open; they restart afterward.',
      binarioPendiente: (ultima: string | null, tuEquipo: string) =>
        `${ultima ?? 'The new version'} is not ready for ${tuEquipo} yet: the registry does not provide its binary yet. Check again in a few minutes.`,
      manualConOrden: '. Run this command manually:',
      manualSinOrden: '.',
      bloqueado: 'Tessera cannot install it: other programs have its folder open. Close them and check again.',
      noInstalado: 'It is not installed or is not responding.',
      atrasadas: (n: number) =>
        `It is already installed; ${n === 1 ? '1 session is' : `${n} sessions are`} running an older version.`,
      sinUltima: 'Could not look up the latest version.',
      alDia: 'Up to date.',
      canal: (canal: string) => `${canal} channel`,
      demonio: (etq: string, nombre: string) => `${etq} daemon (${nombre})`,
      copiada: 'Copied',
      copiar: 'Copy',
      notaTrabajando: 'working',
      notaEspera: 'waiting for your reply',
      notaTextoSinEnviar: 'may have unsent text',
      notaSinRevisar: 'finished, not reviewed',
      seReiniciara: 'Will restart',
      seReiniciaran: (n: number) => `Will restart ${n}`
    },
    progreso: {
      salida: (n: number) => `Output (${n} ${n === 1 ? 'line' : 'lines'})`,
      reiniciando: 'Restarting',
      actualizando: 'Updating',
      titulo: (verbo: string, tuEquipo: string) => `${verbo} the agents on ${tuEquipo}`,
      noCierres: 'Do not close Tessera until it finishes: some stopped sessions may still be waiting to restart.',
      descartar: 'Discard',
      noSeHizoNada: 'Nothing was done',
      noSePudoActualizar: 'could not update',
      sesionesReiniciadas: 'Sessions restarted',
      agentesActualizados: 'Agents updated',
      conProblemas: 'The update had problems',
      ningunaReiniciada: 'No session was restarted.',
      reiniciadas: (sesiones: string) => `${sesiones} restarted.`
    },
    pasos: {
      ventanaAgente: 'Agent window',
      comprobando: 'Checking versions…',
      deteniendo: (etq: string | null) => `Stopping the sessions of ${etq ?? 'the agents'}…`,
      instalando: (etq: string | null) => `Installing ${etq ?? 'the new version'}…`,
      relanzando: 'Restarting the sessions…',
      instalado: (etq: string, despues: string | null) => `${etq} installed${despues ? ` (${despues})` : ''}`,
      falloInstalar: (etq: string, detalle: string | undefined) => `${etq}: could not update${detalle ? ` — ${detalle}` : ''}`,
      reiniciada: (nombre: string) => `${nombre}: restarted`,
      falloArrancar: (nombre: string, motivo: string | undefined) => `${nombre}: ${motivo ?? 'did not start again'}`,
      sinReiniciar: (nombre: string, motivo: string | undefined) => `${nombre}: not restarted${motivo ? ` (${motivo})` : ''}`
    },
    motivos: {
      panelCambio: 'the panel changed or was closed',
      empezoATrabajar: 'started working',
      esperaRespuesta: 'is waiting for your reply',
      textoNuevo: 'you started typing in it',
      noArranco: 'did not start again',
      cerrada: 'was closed before it could restart',
      sinResondeo: 'its version could not be checked again',
      versionDesconocida: 'the version it started with is unknown',
      alDia: 'already runs the installed version',
      noNativa: 'no longer runs in native mode',
      seCerro: 'was closed',
      muerta: 'its process had already exited',
      ocupada: 'was in the middle of another restart',
      noSePudoDetener: 'could not be stopped',
      noSePudoDetenerCon: (detalle: string) => `could not be stopped: ${detalle}`,
      noSePudoActualizarCli: (etq: string) => `could not update ${etq}`,
      otraSesion: (etq: string, espera: boolean) => `another ${etq} session ${espera ? 'is waiting for your reply' : 'was working'}`
    },
    plan: {
      brew: 'It is installed with Homebrew: update it with the Homebrew command',
      gestor: 'It is installed with a system package manager that Tessera does not support',
      desconocido: 'Tessera cannot tell how it was installed: update it the same way you installed it',
      sinOrden: 'Tessera has no automatic command for this installation on this computer',
      yaEnCurso: 'An update is already in progress',
      nadaQueHacer: 'There is nothing to update or restart',
      espera: (trabajando: number, esperando: number): string => {
        const agentes = (n: number): string => (n === 1 ? '1 agent' : `${n} agents`)
        const estan = (n: number): string => (n === 1 ? 'is' : 'are')
        if (esperando === 0) return `Wait: ${agentes(trabajando)} working`
        if (trabajando === 0) return `Wait: ${agentes(esperando)} ${estan(esperando)} waiting for your reply`
        return `Wait: ${agentes(trabajando)} working and ${esperando} waiting for your reply`
      }
    },
    orquestador: {
      noSePudoPedir: (detalle: string) => `Could not request the installation: ${detalle}`,
      noSeComprobo: (detalle: string) => `Could not check the versions: ${detalle}`,
      noSePuede: 'Cannot update right now',
      noSeRecomprobo: (detalle: string) => `Could not check the versions again: ${detalle}`,
      interrumpida: (detalle: string) => `The update was interrupted: ${detalle}`
    },
    banner: {
      sigue: (etq: string, sigue: string) => `── ${etq} stays on ${sigue}: could not update ──`,
      sinVersion: (etq: string) => `── ${etq}: could not update ──`,
      noResponde: (etq: string) => `── ${etq} is not responding after updating ──`,
      salto: (etq: string, de: string, a: string) => `── ${etq} ${de} → ${a} ──`,
      reiniciadoEn: (etq: string, v: string) => `── ${etq} restarted on ${v} ──`,
      reiniciado: (etq: string) => `── ${etq} restarted ──`
    }
  }
)
