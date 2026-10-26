// =============================================================================
// Categoría CONTENEDORES DOCKER: cuántos contenedores aguanta el equipo a la vez (deslizador con
// semáforo según la memoria de Docker, y un último paso «Sin límite») y qué se para primero al
// llegar a él, cuándo se considera saturado Docker y las últimas paradas que hizo Tessera. Sin respuesta de Docker no hay cortes que calcular: el deslizador queda
// deshabilitado. Lógica del deslizador en `limiteContenedores.ts`.
// Decisiones: docs/decisiones/sandbox/limite-de-contenedores.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConstanciaParada } from '../../../../../shared/agent-terminal-ipc'
import { localeActual } from '../../../../../shared/i18n'
import { AVISO_PREVIO_MS, SEGUNDOS_SATURACION, UMBRALES_SATURACION } from '../../../../../shared/saturacionDocker'
import {
  SIN_LIMITE,
  colorDe,
  cortesSemaforo,
  limiteEfectivo,
  type ColorSemaforo,
  type CortesSemaforo,
  type PrimeroEnPararse
} from '../../../../../shared/semaforoContenedores'
import { Fila, Grupo, Interruptor, Radios, Selector } from '../primitivas'
import { filaDeConstancia, masRecientes } from '../constanciasParadas'
import { degradadoPista, limiteDePaso, PASO_MINIMO, pasoDeLimite, pasoMaximo } from '../limiteContenedores'
import { refrescarRecursosDocker, useStoreRecursosDocker } from '../storeRecursosDocker'
import { txContenedores } from '../textosContenedores.ts'
import type { PropsCategoria } from '../tipos'

const GB = 1024 ** 3
const ORDEN_PRIMERO: readonly PrimeroEnPararse[] = ['ultimos', 'primeros', 'inactivos']

/** Los gigas de Docker con un decimal solo si hace falta, en el idioma de la interfaz. */
function gigas(bytes: number): string {
  return (bytes / GB).toLocaleString(localeActual(), { maximumFractionDigits: 1 })
}

/** Lo que dice el semáforo del límite vigente; sin memoria de Docker no hay color ni aviso. */
function lecturaDelLimite(limite: number, memoria: number | null, cortes: CortesSemaforo): {
  texto: string
  color: ColorSemaforo | null
  aviso: string | null
} {
  const t = txContenedores()
  const color = memoria === null ? null : colorDe(limite, cortes)
  const aviso = color === null ? null : limite === SIN_LIMITE ? t.avisoSinLimite : t.aviso[color]
  return { texto: limite === SIN_LIMITE ? t.sinLimite : t.contenedores(limite), color, aviso }
}

function GrupoLimite({ limiteContenedores, onChangeLimiteContenedores }: PropsCategoria): React.JSX.Element {
  const recursos = useStoreRecursosDocker((s) => s.recursos)
  // Al abrir la sección: lo que se ve es lo de ahora, no lo del arranque.
  useEffect(() => {
    void refrescarRecursosDocker()
  }, [])
  const t = txContenedores()
  const memoria = recursos?.memoriaBytes ?? null
  const cortes = cortesSemaforo(memoria ?? 0)
  const limite = limiteEfectivo(limiteContenedores, cortes)
  const lectura = lecturaDelLimite(limite, memoria, cortes)
  // Sin memoria conocida el recomendado no existe: el main no limita hasta que Docker responda.
  const texto = memoria === null && limiteContenedores === undefined ? t.sinLimiteHastaDocker : lectura.texto
  const { color, aviso } = lectura
  return (
    <Grupo titulo={t.grupoLimite} ayuda={t.grupoLimiteAyuda}>
      <div className="limite-bloque">
        <div className="limite-cabecera">
          <span className={`limite-valor${color ? ` ${color}` : ''}`} data-color={color ?? 'ninguno'}>
            <span className="limite-punto" aria-hidden="true" />
            <span className="limite-valor-texto">{texto}</span>
          </span>
          {limiteContenedores !== undefined && (
            <button type="button" className="limite-enlace" onClick={() => onChangeLimiteContenedores(undefined)}>
              {t.usarRecomendado}
            </button>
          )}
        </div>
        <input
          type="range"
          className="limite-barra"
          style={{ ['--limite-pista' as string]: degradadoPista(cortes) }}
          min={PASO_MINIMO}
          max={pasoMaximo(cortes)}
          step={1}
          value={pasoDeLimite(limite, cortes)}
          disabled={memoria === null}
          aria-label={t.limite}
          aria-valuetext={texto}
          onChange={(e) => onChangeLimiteContenedores(limiteDePaso(Number(e.target.value), cortes))}
        />
        <div className="limite-escala" aria-hidden="true">
          <span>{PASO_MINIMO}</span>
          <span>{t.sinLimite}</span>
        </div>
        {aviso !== null && (
          <p className={`limite-aviso ${color}`} role="status">
            {aviso}
          </p>
        )}
        {memoria === null ? (
          <p className="limite-maquina">{t.noResponde}</p>
        ) : (
          <p className="limite-maquina">
            {t.maquina(gigas(memoria), recursos?.cpus ?? null, cortes.verdeHasta)} {t.ahora(recursos?.vivos ?? 0)}
          </p>
        )}
      </div>
    </Grupo>
  )
}

function GrupoPolitica({
  primeroEnPararse,
  onChangePrimeroEnPararse,
  protegerTrabajando,
  onChangeProtegerTrabajando,
  ve
}: PropsCategoria): React.JSX.Element {
  const t = txContenedores()
  const opciones = ORDEN_PRIMERO.map((id) => ({ id, label: t.primero[id].label, hint: t.primero[id].hint }))
  return (
    <Grupo titulo={t.grupoPolitica} ayuda={t.politicaAyuda}>
      {ve('limite-politica') && (
        <>
          <Radios nombre="primeroEnPararse" valor={primeroEnPararse} opciones={opciones} onChange={onChangePrimeroEnPararse} />
          <Fila
            etiqueta={t.proteger}
            ayuda={t.protegerAyuda}
            control={
              <Interruptor
                activo={protegerTrabajando}
                onChange={() => onChangeProtegerTrabajando(!protegerTrabajando)}
                etiqueta={t.proteger}
              />
            }
          />
        </>
      )}
    </Grupo>
  )
}

function GrupoSaturacion({
  saturacionUmbral,
  onChangeSaturacionUmbral,
  saturacionSegundos,
  onChangeSaturacionSegundos,
  avisarAntesDeParar,
  onChangeAvisarAntesDeParar,
  ve
}: PropsCategoria): React.JSX.Element {
  const t = txContenedores()
  const umbrales = UMBRALES_SATURACION.map((u) => ({ value: String(u), label: t.umbralValor(u) }))
  const duraciones = SEGUNDOS_SATURACION.map((s) => ({ value: String(s), label: t.duracionValor(s) }))
  const textoAviso = t.avisar(AVISO_PREVIO_MS / 1000)
  return (
    <Grupo titulo={t.grupoSaturacion} ayuda={t.saturacionAyuda}>
      {ve('saturacion-umbral') && (
        <Fila
          etiqueta={t.umbral}
          control={
            <Selector
              valor={String(saturacionUmbral)}
              opciones={umbrales}
              onChange={(v) => onChangeSaturacionUmbral(Number(v))}
              etiqueta={t.umbral}
            />
          }
        />
      )}
      {ve('saturacion-segundos') && (
        <Fila
          etiqueta={t.duracion}
          control={
            <Selector
              valor={String(saturacionSegundos)}
              opciones={duraciones}
              onChange={(v) => onChangeSaturacionSegundos(Number(v))}
              etiqueta={t.duracion}
            />
          }
        />
      )}
      {ve('saturacion-aviso') && (
        <Fila
          etiqueta={textoAviso}
          ayuda={t.avisarAyuda}
          control={
            <Interruptor
              activo={avisarAntesDeParar}
              onChange={() => onChangeAvisarAntesDeParar(!avisarAntesDeParar)}
              etiqueta={textoAviso}
            />
          }
        />
      )}
    </Grupo>
  )
}

function GrupoParadas(): React.JSX.Element {
  const t = txContenedores()
  const [paradas, setParadas] = useState<ConstanciaParada[] | null>(null)
  const vivo = useRef(true)
  const cargar = useCallback(async (): Promise<void> => {
    let lista: ConstanciaParada[] = []
    try {
      lista = await window.tessera.agentTerminal.registroParadas()
    } catch {
      // Sin registro que leer se enseña vacío: no hay nada que el usuario pueda hacer.
    }
    if (vivo.current) setParadas(masRecientes(lista))
  }, [])
  useEffect(() => {
    vivo.current = true
    void cargar()
    return () => {
      vivo.current = false
    }
  }, [cargar])
  const filas = (paradas ?? []).map((c) => ({ clave: c.en, fila: filaDeConstancia(c, localeActual()) }))
  return (
    <Grupo titulo={t.grupoParadas}>
      <div className="paradas-cabecera">
        <button type="button" className="limite-enlace paradas-actualizar" onClick={() => void cargar()}>
          {t.actualizar}
        </button>
      </div>
      {paradas !== null && filas.length === 0 ? (
        <p className="limite-maquina paradas-vacio">{t.sinParadas}</p>
      ) : (
        <ul className="paradas-lista">
          {filas.map(({ clave, fila }, i) => (
            <li key={`${clave}-${i}`} className="parada-fila">
              <span className="parada-cuando">{fila.cuando}</span>
              <span className="parada-motivo">{fila.motivo}</span>
              <span className="parada-que">{fila.que}</span>
              <span className="parada-regla">{fila.regla}</span>
            </li>
          ))}
        </ul>
      )}
    </Grupo>
  )
}

export function Contenedores(props: PropsCategoria): React.JSX.Element | null {
  const veLimite = props.ve('limite-contenedores')
  const vePolitica = props.ve('limite-politica')
  const veSaturacion = props.ve('saturacion-umbral') || props.ve('saturacion-segundos') || props.ve('saturacion-aviso')
  const veParadas = props.ve('paradas-registro')
  if (!veLimite && !vePolitica && !veSaturacion && !veParadas) return null
  return (
    <>
      {veLimite && <GrupoLimite {...props} />}
      {vePolitica && <GrupoPolitica {...props} />}
      {veSaturacion && <GrupoSaturacion {...props} />}
      {veParadas && <GrupoParadas />}
    </>
  )
}
