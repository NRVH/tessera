// =============================================================================
// Carga las conexiones SSH del main al montar la ventana y las vuelve a pedir cada vez que el main
// avisa de un cambio (alta, edición, baja, grupos, una huella). Lo compone `App.tsx`: las pestañas SSH,
// la lista y los diálogos leen el store, y los tres necesitan las conexiones aunque nadie abra la lista.
// Una respuesta vieja nunca pisa a una nueva: solo vale la de la última petición. Y cuando una pestaña
// se abre sin la contraseña guardada (sin puente, ilegible…), lo dice en un aviso.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
import { useEffect } from 'react'
import { notify } from '../../comun/notifications'
import { accionesSsh } from './store'

/** Mantiene el store de las conexiones SSH al día y avisa de las pestañas que no usarán su contraseña guardada. */
export function useConexionesSsh(): void {
  useEffect(() => {
    let ultima = 0
    let vivo = true
    const cargar = (): void => {
      const esta = ++ultima
      window.tessera.ssh
        .listar()
        .then((lista) => {
          if (vivo && esta === ultima) accionesSsh.cargar(lista)
        })
        .catch((err) => console.error('[ssh] listar falló:', err))
    }
    cargar()
    const baja = window.tessera.ssh.onCambio(cargar)
    const bajaAviso = window.tessera.ssh.onAviso((aviso) => notify('warn', `Conexión SSH «${aviso.alias}»`, aviso.texto))
    return () => {
      vivo = false
      baja()
      bajaAviso()
    }
  }, [])
}
