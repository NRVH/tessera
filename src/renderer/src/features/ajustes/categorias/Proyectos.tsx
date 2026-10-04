// =============================================================================
// Categoría PROYECTOS: con qué modo NACE un proyecto recién abierto (radios: tres
// opciones excluyentes) y qué herramientas lleva horneada la imagen del sandbox de
// Docker (global, no por perfil: la imagen base es una sola).
// El campo de paquetes lleva estado LOCAL en crudo: con el valor normalizado como
// `value` el espacio final se recorta en el mismo render y el cursor se come la
// palabra siguiente. Depende de `shared/sandboxExtras` y `shared/nombresSistema`.
// =============================================================================

import { useState } from 'react'
import type { DefaultProjectMode } from '../../../../../shared/workspace-state-ipc'
import { nombresSistema } from '../../../../../shared/nombresSistema'
import type { Plataforma } from '../../../../../shared/plataforma'
import {
  conDocumentos,
  normalizarPaquetes,
  sinDocumentos,
  tieneDocumentos
} from '../../../../../shared/sandboxExtras'
import {
  AGENTE_INACTIVIDAD_MIN_POR_DEFECTO,
  AGENTE_INACTIVIDAD_NUNCA,
  AGENTE_INACTIVIDAD_OPCIONES,
  AYUDA_INACTIVIDAD_AGENTE,
  AYUDA_INACTIVIDAD_AGENTE_NUNCA,
  normalizarInactividadAgenteMin
} from '../../../../../shared/ajustesAgente'
import { CampoTexto, Fila, Grupo, Interruptor, Radios, Selector } from '../primitivas'
import type { PropsCategoria } from '../tipos'

/**
 * Las tres opciones, con el nombre del sistema de quien mira.
 *
 * El id `'windows'` está persistido en `workspace-state.json` y viaja por el IPC: solo
 * cambia el rótulo. La plataforma es un PARÁMETRO sin defecto: este módulo corre en el
 * renderer, donde `plataformaActual()` revienta la app empaquetada.
 */
function modosDe(plataforma: Plataforma): readonly {
  id: DefaultProjectMode
  label: string
  hint: string
}[] {
  const n = nombresSistema(plataforma)
  return [
    {
      id: 'windows',
      label: `${n.sistema} (nativo)`,
      hint: `Abre en ${n.tuEquipo} con tu cuenta personal, sin Docker. La terminal es ${n.shellNativa}.`
    },
    {
      id: 'docker',
      label: 'Docker (aislado)',
      hint: 'Abre en el contenedor del perfil, con su cuenta privada.'
    },
    {
      id: 'ask',
      label: 'Preguntar siempre',
      hint: 'Pregunta el modo con un modal cada vez que abres un proyecto.'
    }
  ]
}

function FilaDocumentos({
  paquetesSandbox,
  onChangePaquetesSandbox
}: Pick<PropsCategoria, 'paquetesSandbox' | 'onChangePaquetesSandbox'>): React.JSX.Element {
  return (
    <Fila
      etiqueta="Herramientas de documentos"
      ayuda="LibreOffice y poppler, para convertir y capturar PDF, Word, Excel y PowerPoint. Añade en torno a 1 GB a la imagen."
      control={
        <Interruptor
          activo={tieneDocumentos(paquetesSandbox)}
          onChange={() =>
            onChangePaquetesSandbox(
              tieneDocumentos(paquetesSandbox)
                ? sinDocumentos(paquetesSandbox)
                : conDocumentos(paquetesSandbox)
            )
          }
          etiqueta="Hornear las herramientas de documentos"
        />
      }
    />
  )
}

function GrupoSandbox({
  props,
  otrosCrudo,
  onCambiarOtros
}: {
  props: PropsCategoria
  otrosCrudo: string
  onCambiarOtros: (texto: string) => void
}): React.JSX.Element {
  const { ve, depsNavegadorSandbox, onToggleDepsNavegadorSandbox } = props
  return (
    <Grupo
      titulo="Sandbox de Docker"
      ayuda={
        <>
          El agente ya puede instalar lo que quiera dentro del contenedor (tiene <code>sudo</code>),
          pero eso se pierde al hibernar el perfil o al cerrar Tessera. Lo que se marque aquí se
          hornea en la imagen y sobrevive. Se aplica al reconstruirla: la próxima vez que se abra un
          agente, o al pulsar «Actualizar agentes».
        </>
      }
    >
      {ve('sandbox-docs') && <FilaDocumentos {...props} />}
      {ve('sandbox-navegador') && (
        <Fila
          etiqueta="Navegador de pruebas"
          ayuda="Las libs de sistema que necesita Chromium (playwright install-deps). No incluye el navegador: ese se instala dentro del proyecto."
          control={
            <Interruptor
              activo={depsNavegadorSandbox}
              onChange={onToggleDepsNavegadorSandbox}
              etiqueta="Hornear las libs de sistema de Chromium"
            />
          }
        />
      )}
      {ve('sandbox-otros') && (
        <Fila
          etiqueta="Otros paquetes"
          ayuda="Nombres de paquetes de Debian separados por espacios."
          control={
            <CampoTexto
              valor={otrosCrudo}
              onChange={onCambiarOtros}
              etiqueta="Otros paquetes a hornear en la imagen del sandbox"
              placeholder="p. ej. jq ripgrep"
            />
          }
        />
      )}
    </Grupo>
  )
}

const OPCIONES_INACTIVIDAD_AGENTE = AGENTE_INACTIVIDAD_OPCIONES.map((o) => ({ label: o.etiqueta, value: String(o.min) }))

/** Tras cuánto tiempo sin actividad se hiberna el agente de un proyecto que no está en pantalla. */
function FilaInactividadAgente({
  agenteInactividadMin,
  onChangeAgenteInactividadMin
}: PropsCategoria): React.JSX.Element {
  const minutos = normalizarInactividadAgenteMin(agenteInactividadMin)
  return (
    <Fila
      etiqueta="Hibernar el agente inactivo tras"
      ayuda={minutos === AGENTE_INACTIVIDAD_NUNCA ? AYUDA_INACTIVIDAD_AGENTE_NUNCA : AYUDA_INACTIVIDAD_AGENTE}
      modificado={minutos !== AGENTE_INACTIVIDAD_MIN_POR_DEFECTO}
      onRestablecer={() => onChangeAgenteInactividadMin(AGENTE_INACTIVIDAD_MIN_POR_DEFECTO)}
      tituloRestablecer="Volver a 5 minutos"
      control={
        <Selector
          valor={String(minutos)}
          opciones={OPCIONES_INACTIVIDAD_AGENTE}
          onChange={(v) => onChangeAgenteInactividadMin(normalizarInactividadAgenteMin(Number(v)))}
          etiqueta="Hibernar el agente inactivo tras"
        />
      }
    />
  )
}

export function Proyectos(props: PropsCategoria): React.JSX.Element | null {
  const {
    ve,
    defaultProjectMode,
    onChangeDefaultProjectMode,
    paquetesSandbox,
    onChangePaquetesSandbox
  } = props
  const otros = sinDocumentos(paquetesSandbox)
  const [otrosCrudo, setOtrosCrudo] = useState(() => otros.join(' '))

  const veModo = ve('modo-proyecto')
  const veInactividad = ve('agente-inactividad')
  const veSandbox = ve('sandbox-docs') || ve('sandbox-navegador') || ve('sandbox-otros')
  if (!veModo && !veInactividad && !veSandbox) return null

  /** Reescribe la lista conservando lo que no toca este control. */
  function cambiarOtros(texto: string): void {
    setOtrosCrudo(texto)
    const base = tieneDocumentos(paquetesSandbox) ? conDocumentos([]) : []
    onChangePaquetesSandbox([...new Set([...base, ...normalizarPaquetes(texto)])].sort())
  }

  return (
    <>
      {veModo && (
        <Grupo
          titulo="Al abrir un proyecto nuevo"
          ayuda="Solo decide con qué modo NACE. El de un proyecto ya abierto se cambia desde el menú de su pestaña."
        >
          <Radios
            nombre="defaultProjectMode"
            valor={defaultProjectMode}
            opciones={modosDe(window.tessera.plataforma)}
            onChange={onChangeDefaultProjectMode}
          />
        </Grupo>
      )}
      {veInactividad && (
        <Grupo titulo="Agentes en segundo plano">
          <FilaInactividadAgente {...props} />
        </Grupo>
      )}
      {veSandbox && <GrupoSandbox props={props} otrosCrudo={otrosCrudo} onCambiarOtros={cambiarOtros} />}
    </>
  )
}
