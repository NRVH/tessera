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
  agenteInactividadOpciones,
  ayudaInactividadAgente,
  ayudaInactividadAgenteNunca,
  normalizarInactividadAgenteMin
} from '../../../../../shared/ajustesAgente'
import { CampoTexto, Fila, Grupo, Interruptor, Radios, Selector, TextoMarcado } from '../primitivas'
import { txProyectos } from '../textos.ts'
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
  const t = txProyectos()
  return [
    {
      id: 'windows',
      label: t.nativo(n.sistema),
      hint: t.nativoAyuda(n.tuEquipo, n.shellNativa)
    },
    { id: 'docker', label: t.docker, hint: t.dockerAyuda },
    { id: 'ask', label: t.preguntar, hint: t.preguntarAyuda }
  ]
}

function FilaDocumentos({
  paquetesSandbox,
  onChangePaquetesSandbox
}: Pick<PropsCategoria, 'paquetesSandbox' | 'onChangePaquetesSandbox'>): React.JSX.Element {
  return (
    <Fila
      etiqueta={txProyectos().documentos}
      ayuda={txProyectos().documentosAyuda}
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
          etiqueta={txProyectos().hornearDocumentos}
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
  const t = txProyectos()
  return (
    <Grupo titulo={t.sandbox} ayuda={<TextoMarcado partes={t.sandboxAyuda} marca="code" />}>
      {ve('sandbox-docs') && <FilaDocumentos {...props} />}
      {ve('sandbox-navegador') && (
        <Fila
          etiqueta={t.navegador}
          ayuda={t.navegadorAyuda}
          control={
            <Interruptor
              activo={depsNavegadorSandbox}
              onChange={onToggleDepsNavegadorSandbox}
              etiqueta={t.hornearNavegador}
            />
          }
        />
      )}
      {ve('sandbox-otros') && (
        <Fila
          etiqueta={t.otros}
          ayuda={t.otrosAyuda}
          control={
            <CampoTexto
              valor={otrosCrudo}
              onChange={onCambiarOtros}
              etiqueta={t.otrosEtiqueta}
              placeholder={t.otrosPlaceholder}
            />
          }
        />
      )}
    </Grupo>
  )
}

/** Tras cuánto tiempo sin actividad se hiberna el agente de un proyecto que no está en pantalla. */
function FilaInactividadAgente({
  agenteInactividadMin,
  onChangeAgenteInactividadMin
}: PropsCategoria): React.JSX.Element {
  const minutos = normalizarInactividadAgenteMin(agenteInactividadMin)
  const opciones = agenteInactividadOpciones().map((o) => ({ label: o.etiqueta, value: String(o.min) }))
  return (
    <Fila
      etiqueta={txProyectos().hibernar}
      ayuda={minutos === AGENTE_INACTIVIDAD_NUNCA ? ayudaInactividadAgenteNunca() : ayudaInactividadAgente()}
      modificado={minutos !== AGENTE_INACTIVIDAD_MIN_POR_DEFECTO}
      onRestablecer={() => onChangeAgenteInactividadMin(AGENTE_INACTIVIDAD_MIN_POR_DEFECTO)}
      tituloRestablecer={txProyectos().volver5}
      control={
        <Selector
          valor={String(minutos)}
          opciones={opciones}
          onChange={(v) => onChangeAgenteInactividadMin(normalizarInactividadAgenteMin(Number(v)))}
          etiqueta={txProyectos().hibernar}
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

  const t = txProyectos()
  return (
    <>
      {veModo && (
        <Grupo titulo={t.grupoNuevo} ayuda={t.grupoNuevoAyuda}>
          <Radios
            nombre="defaultProjectMode"
            valor={defaultProjectMode}
            opciones={modosDe(window.tessera.plataforma)}
            onChange={onChangeDefaultProjectMode}
          />
        </Grupo>
      )}
      {veInactividad && (
        <Grupo titulo={t.grupoSegundoPlano}>
          <FilaInactividadAgente {...props} />
        </Grupo>
      )}
      {veSandbox && <GrupoSandbox props={props} otrosCrudo={otrosCrudo} onCambiarOtros={cambiarOtros} />}
    </>
  )
}
