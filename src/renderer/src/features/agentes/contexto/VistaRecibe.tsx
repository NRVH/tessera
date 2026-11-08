// =============================================================================
// Lo que Tessera añade al contexto de un agente del perfil: las reglas globales y las del perfil, en ese orden, las
// carpetas de documentos que puede consultar con su origen, cuánto suman las reglas, con un aviso si el
// contexto es extenso, y lo que añade Tessera por su cuenta. Solo lectura: se edita en las secciones.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import { contextoEfectivo, type ContextoGlobal, type PerfilConContexto } from '../../../../../shared/contexto'
import { largoReglas, UMBRAL_CONTEXTO_EXTENSO } from './modeloContexto.ts'
import { txContexto } from './textosContexto.ts'

const nombreDe = (ruta: string): string => ruta.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ruta

function Bloque({ titulo, texto, vacio }: { titulo: string; texto: string; vacio: string }): React.JSX.Element {
  return (
    <section className="contexto-recibe-bloque">
      <h3 className="contexto-recibe-titulo">{titulo}</h3>
      {texto.trim() === '' ? <p className="dbc-ayuda">{vacio}</p> : <pre className="contexto-recibe-texto">{texto}</pre>}
    </section>
  )
}

export function VistaRecibe({ perfil, global }: { perfil: PerfilConContexto; global: ContextoGlobal }): React.JSX.Element {
  const t = txContexto()
  const c = contextoEfectivo(perfil, global)
  const delGlobal = new Set(c.usaGlobal ? global.documentos.map((d) => d.toLowerCase()) : [])
  const largo = largoReglas(c)
  return (
    <div className="contexto-panel contexto-recibe" data-testid="contexto-recibe">
      <p className="dbc-ayuda">{t.recibeAyuda}</p>
      {c.usaGlobal ? (
        <Bloque titulo={t.recibeReglasGlobales} texto={c.reglasGlobales} vacio={t.recibeSinReglas} />
      ) : (
        <p className="config-agente-aviso">{t.recibeNoUsaGlobal}</p>
      )}
      <Bloque titulo={t.recibeReglasPerfil} texto={c.reglasPerfil} vacio={t.recibeSinReglas} />
      <section className="contexto-recibe-bloque">
        <h3 className="contexto-recibe-titulo">{t.recibeDocumentos}</h3>
        {c.documentos.length === 0 ? (
          <p className="dbc-ayuda">{t.recibeSinDocumentos}</p>
        ) : (
          <ul className="contexto-recibe-docs">
            {c.documentos.map((d) => (
              <li key={d} title={d}>
                {nombreDe(d)}
                <span className="niveles-detalle">{t.recibeOrigen[delGlobal.has(d.toLowerCase()) ? 'global' : 'perfil']}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="dbc-ayuda">
        {t.recibeTamano(largo)} {c.usaGlobal ? t.recibeDocker : t.recibeDockerSinGlobal}
      </p>
      {largo > UMBRAL_CONTEXTO_EXTENSO && <p className="config-agente-aviso">{t.recibeTamanoAlto}</p>}
      {/* Lo que no escribe el usuario, a la vista para que el resumen esté completo; no se edita. */}
      <section className="contexto-recibe-bloque" data-testid="contexto-recibe-tessera">
        <h3 className="contexto-recibe-titulo">{t.recibeTessera}</h3>
        <ul className="contexto-recibe-tessera">
          <li>{t.recibeTesseraTodas}</li>
          <li>{t.recibeTesseraDocker}</li>
        </ul>
        <p className="dbc-ayuda">{t.recibeTesseraNota}</p>
      </section>
    </div>
  )
}
