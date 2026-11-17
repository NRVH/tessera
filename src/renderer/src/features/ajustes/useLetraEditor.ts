// =============================================================================
// Lleva la apariencia del código del ajuste a lo que lo pinta: la letra a los editores de Monaco
// (`comun/letraEditor`) y el tema a Monaco y a la vista previa (`comun/temaCodigo`). Lo abierto cambia al
// momento y lo nuevo nace así. Lo monta `useDensidad`, que App llama una sola vez.
// =============================================================================
import { useLayoutEffect } from 'react'
import { fijarLetraEditor } from '../../comun/letraEditor'
import { fijarTemaCodigo } from '../../comun/temaCodigo'
import { useStoreAjustes } from './store'

/** Aplica la letra y el tema del código cada vez que cambian, antes del pintado. */
export function useLetraEditor(): void {
  const apariencia = useStoreAjustes((s) => s.aparienciaEditor)
  const tema = useStoreAjustes((s) => s.editorTema)
  useLayoutEffect(() => {
    fijarLetraEditor(apariencia)
  }, [apariencia])
  useLayoutEffect(() => {
    fijarTemaCodigo(tema)
  }, [tema])
}
