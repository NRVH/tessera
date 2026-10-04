// =============================================================================
// Categoría ACERCA DE: la portada de la app (qué es Tessera, quién la hizo y sobre qué
// corre). No usa `Fila` ni `Grupo` porque no es un ajuste: no hay nada que elegir ni
// que cambie de estado. La marca queda fuera de la escalera de tamaños pero relativa a
// `--ui-font`, para seguir el ajuste de tamaño de la interfaz.
// Los datos técnicos vienen por IPC (`appInfo`): en el renderer no existe `process`.
// =============================================================================

import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../../../shared/app-info-ipc'
import type { PropsCategoria } from '../tipos'
import { MarcaTessera } from '../../../comun/marcaTessera'
import { nombresSistema } from '../../../../../shared/nombresSistema'
import type { Plataforma } from '../../../../../shared/plataforma'
import { AUTOR, ENLACES_AUTOR, LICENCIA, REPO_URL } from '../../../../../shared/proyecto'

/**
 * Un enlace que se abre en el navegador del sistema. Dentro de la app una navegación
 * normal cargaría la página en la propia ventana, así que se corta y se delega en
 * `openExternal`.
 */
function EnlaceExterno({ url, children }: { url: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault()
        void window.tessera.openExternal(url)
      }}
    >
      {children}
    </a>
  )
}

/**
 * Lo que hace Tessera, en frases sueltas para editarlas de un vistazo. La segunda
 * nombra el equipo del usuario, así que la plataforma entra por parámetro y sin
 * defecto (ver `shared/nombresSistema.ts`).
 */
function queHace(plataforma: Plataforma): readonly string[] {
  const n = nombresSistema(plataforma)
  // El enfoque es «varios proyectos, varias cuentas de IA»; el mismo mensaje que el
  // README, y si cambia uno cambia el otro. El modo nativo es la excepción que se elige
  // a propósito, no la regla.
  return [
    'Cada espacio de trabajo tiene su propio sandbox y sus propias cuentas de IA: varias licencias conviven sin chocar ni mezclar conversaciones.',
    `Claude Code y Codex sólo ven los proyectos de su espacio, no ${n.tuEquipo}; sólo el proyecto que tú elijas corre en nativo, con tu cuenta.`,
    'Editor, explorador, Git, terminales y bases de datos junto a los agentes, cambiando de proyecto con una pestaña.',
    'El mosaico enseña a la vez todos los agentes que trabajan, y un botón los pone al día sin cortar a ninguno.'
  ]
}

export function Acerca({ ve }: PropsCategoria): React.JSX.Element | null {
  if (!ve('acerca')) return null
  return <TarjetaAcerca />
}

/** Datos técnicos de la app, por IPC. Guarda de cancelación: el modal se desmonta al cerrarlo. */
function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    window.tessera.appInfo
      .get()
      .then((a) => {
        if (!cancelled) setInfo(a)
      })
      .catch((err) => {
        console.error('[acerca] appInfo falló:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return info
}

function BloqueAutor(): React.JSX.Element {
  return (
    <div className="ajustes-acerca-autor">
      <span className="ajustes-acerca-autor-nombre">{AUTOR}</span>
      <span className="ajustes-acerca-autor-rol">Ingeniero de Software</span>
      {/* Los perfiles del autor: son lo que lo distingue de cualquier homónimo. */}
      <span className="ajustes-acerca-enlaces">
        {ENLACES_AUTOR.map((e, i) => (
          <span key={e.url}>
            {i > 0 ? ' · ' : null}
            <EnlaceExterno url={e.url}>{e.etiqueta}</EnlaceExterno>
          </span>
        ))}
      </span>
    </div>
  )
}

function TarjetaAcerca(): React.JSX.Element {
  const info = useAppInfo()
  // En una constante local: así el `?:` de abajo estrecha a `string`.
  const repo = REPO_URL

  return (
    <section className="ajustes-acerca">
      <MarcaTessera className="ajustes-acerca-marca" />
      <h2 className="ajustes-acerca-nombre">Tessera</h2>
      <span className="ajustes-acerca-version">{info ? `v${info.version}` : '—'}</span>

      <p className="ajustes-acerca-lema">
        El IDE de escritorio para trabajar en varios proyectos y con varias cuentas de IA.
      </p>

      {/* La lista se alinea a la IZQUIERDA dentro de un bloque centrado: varias líneas
          de dos renglones centradas no se leen, se miran. */}
      <ul className="ajustes-acerca-puntos">
        {queHace(window.tessera.plataforma).map((linea) => (
          <li key={linea}>{linea}</li>
        ))}
      </ul>

      <BloqueAutor />

      {/* Licencia siempre; el enlace al código solo cuando el repositorio exista (ver
          `shared/proyecto.ts`): un enlace a un 404 es peor que no tener enlace. */}
      <p className="ajustes-acerca-enlaces">
        <span>Código abierto · licencia {LICENCIA}</span>
        {repo ? (
          <>
            {' · '}
            <EnlaceExterno url={repo}>Código fuente</EnlaceExterno>
          </>
        ) : null}
      </p>

      <p className="ajustes-acerca-runtime">
        {info
          ? `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`
          : 'Cargando información del entorno…'}
      </p>

      {/* Atribución de marcas: el árbol de bases de datos pinta el logo oficial de
          PostgreSQL y su política de marcas recomienda este texto. Oracle no lleva logo,
          pero su nombre sí aparece: de ahí la línea genérica. */}
      <p className="ajustes-acerca-runtime">
        Postgres, PostgreSQL y el logo del elefante (Slonik) son marcas o marcas registradas
        de la PostgreSQL Community Association of Canada, y se usan con su permiso. Oracle es
        una marca registrada de Oracle y/o sus filiales. Los demás nombres de productos son
        marcas de sus titulares.
      </p>
    </section>
  )
}
