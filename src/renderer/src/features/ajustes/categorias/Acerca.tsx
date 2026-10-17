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
import { txCategorias } from '../textosSistema.ts'
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
  return txCategorias().acerca.puntos(n.tuEquipo)
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
      <span className="ajustes-acerca-autor-rol">{txCategorias().acerca.rol}</span>
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
  const t = txCategorias().acerca

  return (
    <section className="ajustes-acerca">
      <MarcaTessera className="ajustes-acerca-marca" />
      <h2 className="ajustes-acerca-nombre">Tessera</h2>
      <span className="ajustes-acerca-version">{info ? `v${info.version}` : '—'}</span>

      <p className="ajustes-acerca-lema">{t.lema}</p>

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
        <span>{t.licencia(LICENCIA)}</span>
        {repo ? (
          <>
            {' · '}
            <EnlaceExterno url={repo}>{t.codigoFuente}</EnlaceExterno>
          </>
        ) : null}
      </p>

      <p className="ajustes-acerca-runtime">
        {info
          ? `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`
          : t.cargando}
      </p>

      {/* Atribución de marcas: el árbol de bases de datos pinta el logo oficial de
          PostgreSQL y su política de marcas recomienda este texto. Oracle no lleva logo,
          pero su nombre sí aparece: de ahí la línea genérica. */}
      <p className="ajustes-acerca-runtime">{t.marcas}</p>
    </section>
  )
}
