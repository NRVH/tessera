# Editar o borrar una conexión: se bloquea antes de tocar el registro y los ganchos no deshacen nada

- **Estado:** vigente
- **Ámbito:** `src/main/db/controlador/edicionRegistro.ts`, `src/main/db/DbController.ts`

## Contexto

Guardar una conexión retira las sesiones del explorador que la usan, y una sesión con una transacción
pendiente la revierte el servidor sin que nadie lo decida. El explorador vive fuera de `DbController` y se
construye después, así que se le habla por ganchos opcionales.

## Decisión

- El orden de la edición es fijo: `soloCambiaLaCasillaDeAgentes` → `puedeEditarConexion` (bloquea con el
  mensaje del explorador si hay una transacción pendiente) → leer el registro previo → `update` → gancho
  `onConexionEditada` → `onChanged` → aviso a las vistas. El bloqueo va ANTES de tocar el registro. Si solo
  cambia la casilla de los agentes no se retira nada y no se bloquea.
- Un fallo de un gancho se registra y se traga: el registro ya está escrito, y propagarlo haría creer al
  renderer que la edición o el borrado fallaron.
- Se borra la entrada pedida (`tipo`, alias y perfil de la fila): una conocida y una ajena solo comparten id
  por una edición a mano. Lo que cuelga del id (sesiones, consolas, historial, caché) es de la conocida:
  `limpiezaTrasBorrar` decide entre `borrada`, `cambiada` (queda otra con ese id, es un cambio) y `delPerfil`
  (la conocida vive en otro perfil: solo se limpia lo de este, con un gancho aparte).
- Las cuatro escrituras van por `sinRutasDelHost`: al renderer solo el mensaje del error, con el original en
  el log del main.

## Consecuencias

- Quien conecte solo `onConexionBorrada` y no `onConexionOlvidadaEnPerfil` no limpia nada en el caso `delPerfil`
  (como antes), nunca la limpieza entera de la conocida del otro perfil.
- Instalar u olvidar un cliente espera antes al explorador (`antesDeCambiarDriver`): en Windows sobrescribir
  DLL cargadas da EBUSY, y en los dos sistemas un proceso seguiría con el cliente viejo.
