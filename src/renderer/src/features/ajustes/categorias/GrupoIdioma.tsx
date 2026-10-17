// =============================================================================
// Grupo IDIOMA de Apariencia: el del sistema, español o inglés. El idioma se lee al arrancar, así
// que elegir otro no cambia nada hasta reiniciar, y la fila lo dice y ofrece hacerlo ya.
// Depende del store de ajustes, `shared/i18n` y `appInfo.reiniciar` del preload.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos, normalizarPreferenciaIdioma } from '../../../../../shared/i18n.ts'
import { Fila, Grupo, Selector } from '../primitivas'
import { fijarAjuste, useStoreAjustes } from '../store'
import { guardarAjustes } from '../usePersistenciaAjustes'

const tx = crearTextos(
  {
    grupo: 'Idioma',
    etiqueta: 'Idioma',
    sistema: 'El del sistema',
    ayuda: 'El de la interfaz y el de las órdenes tdb y tssh. Vale al reiniciar Tessera.',
    pendiente: 'Tessera cambiará de idioma al reiniciar.',
    reiniciar: 'Reiniciar ahora'
  },
  {
    grupo: 'Language',
    etiqueta: 'Language',
    sistema: 'System default',
    ayuda: 'Used by the interface and by the tdb and tssh commands. Takes effect when Tessera restarts.',
    pendiente: 'Tessera will switch language when it restarts.',
    reiniciar: 'Restart now'
  }
)

const fijarIdioma = fijarAjuste('idioma')

function reiniciar(): void {
  // Guarda ya, sin esperar al guardado del cambio: el main lee el idioma al volver a arrancar.
  guardarAjustes('idioma')
  void window.tessera.appInfo.reiniciar()
}

export function GrupoIdioma(): React.JSX.Element {
  const idioma = useStoreAjustes((s) => s.idioma)
  const alArrancar = useStoreAjustes((s) => s.idiomaAlArrancar)
  const t = tx()
  // Los nombres de los idiomas van en su propio idioma: es como los busca quien no entiende el otro.
  const opciones = [
    { label: t.sistema, value: 'sistema' },
    { label: 'Español', value: 'es' },
    { label: 'English', value: 'en' }
  ] as const
  return (
    <Grupo titulo={t.grupo}>
      <Fila
        etiqueta={t.etiqueta}
        ayuda={idioma === alArrancar ? t.ayuda : t.pendiente}
        control={
          <>
            <Selector valor={idioma} opciones={opciones} onChange={(v) => fijarIdioma(normalizarPreferenciaIdioma(v))} etiqueta={t.etiqueta} />
            {idioma !== alArrancar && (
              <button type="button" className="btn primary" onClick={reiniciar}>
                {t.reiniciar}
              </button>
            )}
          </>
        }
      />
    </Grupo>
  )
}
