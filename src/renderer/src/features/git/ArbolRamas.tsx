// =============================================================================
// ArbolRamas: la primera columna del panel Git·Log. HEAD arriba, luego «Local» y
// «Remoto» con carpetas por prefijo. Un clic en una rama FILTRA el log; nunca hace
// checkout. La cabecera lleva un selector de repo cuando hay varios. La agrupación es el
// módulo puro `modelo/arbolRamas`; aquí solo se pinta y se lleva el estado de expansión.
// Decisiones: docs/decisiones/git/log-columnas-y-filas.md
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { ContextMenu } from '../../comun/ContextMenu'
import { IconoDesplegar, IconoRama } from './iconos'
import { ChevronArbol } from '../../comun/iconosArbol'
import { construirArbolRamas, type NodoRama } from './modelo/arbolRamas'
import type { Branch } from '../../../../shared/git-ipc'
import type { DetectedRepo } from '../../../../shared/workspace-ipc'

/** Alterna `ruta` en un conjunto inmutable. */
function alternarEn(prev: Set<string>, ruta: string): Set<string> {
  const next = new Set(prev)
  if (next.has(ruta)) next.delete(ruta)
  else next.add(ruta)
  return next
}

interface Plegado {
  cerradas: Set<string>
  gruposCerrados: Set<string>
  alternar: (ruta: string) => void
  alternarGrupo: (id: string) => void
}

/**
 * Carpetas y grupos cerrados A MANO: se guarda lo CERRADO, para que una rama nueva salga a
 * la vista. Cambiar de repo lo invalida: son rutas de OTRO repo.
 */
function usePlegado(repoActivo: string | null): Plegado {
  // Inicializador perezoso: este componente se repinta con cada commit seleccionado.
  const [cerradas, setCerradas] = useState<Set<string>>(() => new Set())
  const [gruposCerrados, setGruposCerrados] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setCerradas(new Set())
    setGruposCerrados(new Set())
  }, [repoActivo])
  const alternar = (ruta: string): void => setCerradas((prev) => alternarEn(prev, ruta))
  const alternarGrupo = (id: string): void => setGruposCerrados((prev) => alternarEn(prev, id))
  return { cerradas, gruposCerrados, alternar, alternarGrupo }
}

interface ContextoNodos {
  cerradas: Set<string>
  alternar: (ruta: string) => void
  ramaActiva: string | null
  onSeleccionarRama: (rama: string | null) => void
}

/** Pinta un nivel del árbol, sangrando por profundidad. */
function renderNodos(nodos: readonly NodoRama[], nivel: number, c: ContextoNodos): React.JSX.Element[] {
  return nodos.flatMap((nodo) => {
    // 10px por nivel + el hueco del chevron, para alinear las hojas con el texto del padre.
    const sangria = 8 + nivel * 10
    if (nodo.tipo === 'carpeta') {
      const abierta = !c.cerradas.has(nodo.ruta)
      return [
        <button
          key={`c:${nodo.ruta}`}
          className="git-rama-fila"
          style={{ paddingLeft: sangria }}
          onClick={() => c.alternar(nodo.ruta)}
          aria-expanded={abierta}
          title={`${nodo.ruta} (${nodo.total} rama${nodo.total === 1 ? '' : 's'})`}
        >
          <ChevronArbol abierto={abierta} />
          <span className="git-rama-nombre">{nodo.nombre}</span>
          <span className="git-rama-total">{nodo.total}</span>
        </button>,
        ...(abierta ? renderNodos(nodo.hijos, nivel + 1, c) : [])
      ]
    }
    const activa = c.ramaActiva === nodo.rama.name
    return [
      <button
        key={`r:${nodo.ruta}`}
        className={`git-rama-fila${activa ? ' activa' : ''}`}
        // +14px: el hueco donde iría el chevron de una carpeta hermana.
        style={{ paddingLeft: sangria + 14 }}
        onClick={() => c.onSeleccionarRama(activa ? null : nodo.rama.name)}
        aria-pressed={activa}
        title={
          activa
            ? `${nodo.rama.name} — clic para quitar el filtro`
            : `Filtrar el historial por ${nodo.rama.name}`
        }
      >
        <IconoRama />
        <span className="git-rama-nombre">{nodo.nombre}</span>
      </button>
    ]
  })
}

function GrupoRamas(p: {
  id: string
  etiqueta: string
  nodos: readonly NodoRama[]
  plegado: Plegado
  contexto: ContextoNodos
}): React.JSX.Element | null {
  if (p.nodos.length === 0) return null
  const abierto = !p.plegado.gruposCerrados.has(p.id)
  return (
    <>
      <button
        className="git-ramas-grupo"
        onClick={() => p.plegado.alternarGrupo(p.id)}
        aria-expanded={abierto}
      >
        <ChevronArbol abierto={abierto} />
        {p.etiqueta}
      </button>
      {abierto && renderNodos(p.nodos, 0, p.contexto)}
    </>
  )
}

/** Fila fija de la lista (paddingLeft 22): «Todas las ramas» o la rama actual (HEAD). */
function FilaFija(p: {
  clase: string
  activa: boolean
  onClick: () => void
  title: string
  texto: string
}): React.JSX.Element {
  return (
    <button
      className={p.clase}
      style={{ paddingLeft: 22 }}
      onClick={p.onClick}
      aria-pressed={p.activa}
      title={p.title}
    >
      <IconoRama />
      <span className="git-rama-nombre">{p.texto}</span>
    </button>
  )
}

function CabeceraRamas(p: {
  multiRepo: boolean
  nombreRepo: string
  onAbrirMenu: (x: number, y: number) => void
}): React.JSX.Element {
  return (
    <div className="git-log-col-header">
      {p.multiRepo ? (
        <button
          className="git-repo-btn"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            p.onAbrirMenu(r.left, r.bottom + 4)
          }}
          title="Repositorio del historial (clic para cambiar)"
        >
          <span className="git-repo-nombre">{p.nombreRepo}</span>
          <IconoDesplegar />
        </button>
      ) : (
        <span>Ramas</span>
      )}
    </div>
  )
}

interface PropsArbolRamas {
  /** Ramas del repo activo, o null mientras se enumeran. */
  branches: Branch[] | null
  /** Rama por la que se está filtrando (null = todas). */
  ramaActiva: string | null
  repos: DetectedRepo[] | null
  repoLabels: Map<string, string>
  repoActivo: string | null
  onSeleccionarRama: (rama: string | null) => void
  onSeleccionarRepo: (repoHostPath: string) => void
}

export function ArbolRamas(p: PropsArbolRamas): React.JSX.Element {
  const { branches, ramaActiva, repos, repoLabels, repoActivo, onSeleccionarRama } = p
  const arbol = useMemo(() => construirArbolRamas(branches ?? []), [branches])
  const plegado = usePlegado(repoActivo)
  const [menuRepos, setMenuRepos] = useState<{ x: number; y: number } | null>(null)
  const contexto: ContextoNodos = { cerradas: plegado.cerradas, alternar: plegado.alternar, ramaActiva, onSeleccionarRama }
  const head = arbol.head
  return (
    <div className="git-log-col git-log-ramas">
      <CabeceraRamas
        multiRepo={repos !== null && repos.length > 1}
        nombreRepo={(repoActivo && repoLabels.get(repoActivo)) ?? 'Repositorio'}
        onAbrirMenu={(x, y) => setMenuRepos({ x, y })}
      />
      <div className="git-ramas-scroll">
        {branches === null && <div className="git-state-inline">Cargando ramas…</div>}
        {branches !== null && branches.length === 0 && (
          <div className="git-state-inline">Este repositorio no tiene ramas.</div>
        )}
        {/* «Todas las ramas» es una fila más: quitar el filtro cuesta lo mismo que ponerlo. */}
        {branches !== null && branches.length > 0 && (
          <FilaFija
            clase={`git-rama-fila${ramaActiva === null ? ' activa' : ''}`}
            activa={ramaActiva === null}
            onClick={() => onSeleccionarRama(null)}
            title="Ver el historial de todas las ramas"
            texto="Todas las ramas"
          />
        )}
        {head && (
          <FilaFija
            clase={`git-rama-fila git-rama-head${ramaActiva === head.name ? ' activa' : ''}`}
            activa={ramaActiva === head.name}
            onClick={() => onSeleccionarRama(ramaActiva === head.name ? null : head.name)}
            title={`${head.name} — rama actual (HEAD)`}
            texto={head.name}
          />
        )}
        <GrupoRamas id="local" etiqueta="Local" nodos={arbol.locales} plegado={plegado} contexto={contexto} />
        <GrupoRamas id="remoto" etiqueta="Remoto" nodos={arbol.remotas} plegado={plegado} contexto={contexto} />
      </div>
      {menuRepos && repos && (
        <ContextMenu
          x={menuRepos.x}
          y={menuRepos.y}
          items={repos.map((repo) => ({
            label: repoLabels.get(repo.repoHostPath) ?? repo.name,
            checked: repo.repoHostPath === repoActivo,
            onClick: () => p.onSeleccionarRepo(repo.repoHostPath)
          }))}
          onClose={() => setMenuRepos(null)}
        />
      )}
    </div>
  )
}
