// =============================================================================
// Categoría EXPORTAR E IMPORTAR: llevar la configuración de Tessera a otro equipo. Exportar abre
// su modal; importar elige antes el archivo (el diálogo nativo lo abre el main) y, si es una copia,
// abre el suyo con la frase. Los modales viven en `copia/`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { useState } from 'react'
import type { AbrirResult } from '../../../../../shared/copia-configuracion-ipc'
import { Fila, Grupo } from '../primitivas'
import type { PropsCategoria } from '../tipos'
import { txCategorias } from '../textosSistema.ts'
import { ModalExportar } from '../copia/ModalExportar'
import { ModalImportar } from '../copia/ModalImportar'

type Abierto = Extract<AbrirResult, { estado: 'abierto' }>

export function Copia({ ve }: PropsCategoria): React.JSX.Element | null {
  const [exportando, setExportando] = useState(false)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!ve('copia-exportar') && !ve('copia-importar')) return null
  const importar = async (): Promise<void> => {
    setError(null)
    const r = await window.tessera.copiaConfiguracion.abrir()
    if (r.estado === 'error') setError(r.error)
    else if (r.estado === 'abierto') setAbierto(r)
  }
  const t = txCategorias().copia
  return (
    <Grupo titulo={t.grupo} ayuda={t.grupoAyuda}>
      {ve('copia-exportar') && (
        <Fila
          etiqueta={t.exportar}
          ayuda={t.exportarAyuda}
          control={<button type="button" className="btn" onClick={() => setExportando(true)}>{t.exportarBoton}</button>}
        />
      )}
      {ve('copia-importar') && (
        <Fila
          etiqueta={t.importar}
          ayuda={error ?? t.importarAyuda}
          control={<button type="button" className="btn" onClick={() => void importar()}>{t.importarBoton}</button>}
        />
      )}
      {exportando && <ModalExportar onCerrar={() => setExportando(false)} />}
      {abierto && <ModalImportar abierto={abierto} onCerrar={() => setAbierto(null)} />}
    </Grupo>
  )
}
