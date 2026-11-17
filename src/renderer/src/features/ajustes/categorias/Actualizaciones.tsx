// =============================================================================
// Categoría ACTUALIZACIONES de Configuración: tres grupos, «Tessera» (buscar,
// descargar e instalar la app), «Agentes» (los CLIs nativos) y «Preferencias»
// (aplicar al cerrar). Los bloques viven en `./bloquesActualizacion/`.
// Depende del catálogo (`ve()` sale ya filtrado por capacidad) y de los hooks de App.
// Decisiones: docs/decisiones/renderer/actualizaciones-de-la-app.md
// =============================================================================

import { Fila, Grupo, Interruptor } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { txCategorias } from '../textosSistema.ts'
import { BloqueAgentes } from './bloquesActualizacion/BloqueAgentes'
import { BloqueActualizacion } from './bloquesActualizacion/BloqueActualizacion'

export function Actualizaciones({
  ve,
  aplicarUpdateAlCerrar,
  onAlternarAplicarActualizacionAlCerrar,
  actualizacionAgentes,
  onAbrirActualizacionAgentes
}: PropsCategoria): React.JSX.Element | null {
  const veVersion = ve('update')
  // No se mira la plataforma aquí a propósito: `ve()` ya viene filtrado por capacidad,
  // y si se mirara, el buscador (que no pasa por este componente) seguiría contando la fila.
  const veAlCerrar = ve('update-al-cerrar')
  const veAgentes = ve('update-agentes')
  if (!veVersion && !veAlCerrar && !veAgentes) return null
  const t = txCategorias().actualizaciones
  // Las dos tarjetas que BUSCAN actualizaciones van seguidas; la preferencia de cuándo
  // se aplica, al final y en su propio grupo.
  return (
    <>
      {veVersion ? (
        <Grupo titulo={t.grupoTessera}>
          <BloqueActualizacion />
        </Grupo>
      ) : null}
      {veAgentes ? (
        <Grupo titulo={t.grupoAgentes}>
          <BloqueAgentes act={actualizacionAgentes} onAbrir={onAbrirActualizacionAgentes} />
        </Grupo>
      ) : null}
      {veAlCerrar ? (
        <GrupoPreferencias
          aplicarUpdateAlCerrar={aplicarUpdateAlCerrar}
          onAlternarAplicarActualizacionAlCerrar={onAlternarAplicarActualizacionAlCerrar}
        />
      ) : null}
    </>
  )
}

function GrupoPreferencias({
  aplicarUpdateAlCerrar,
  onAlternarAplicarActualizacionAlCerrar
}: {
  aplicarUpdateAlCerrar: boolean
  onAlternarAplicarActualizacionAlCerrar: () => void
}): React.JSX.Element {
  const t = txCategorias().actualizaciones
  return (
    <Grupo titulo={t.grupoPreferencias}>
      <Fila
        etiqueta={t.alCerrar}
        // La segunda frase dice la diferencia observable con el botón, que sí relanza la app.
        ayuda={t.alCerrarAyuda}
        control={
          <Interruptor
            activo={aplicarUpdateAlCerrar}
            onCambio={onAlternarAplicarActualizacionAlCerrar}
            etiqueta={t.alCerrarEtiqueta}
          />
        }
      />
    </Grupo>
  )
}
