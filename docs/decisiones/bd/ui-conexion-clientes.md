# Los clientes de base de datos del diálogo: solo con un motor que los usa, y siempre con salida a mano

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DriversLista.tsx`, `DbConexionDialogo.tsx`, `camposConexionClientes.ts`

## Contexto

Los packs del Instant Client son de Oracle, así que la lista de drivers nunca está vacía: decidir la sección
por «hay drivers» la enseñaba también con motores que no los usan. Y una red que bloquee el dominio de
Oracle, o un pack que ya no se publica, dejan la descarga sin camino.

## Decisión

- `mostrarClientes` decide primero por el MOTOR (`conexion.usaClientes`) y luego por los motivos: clientes de
  ese motor, una prueba que pidió uno o haber llegado desde «Instalar cliente…» con ese motor. El aviso de
  «falta este driver» sigue la misma regla (`requiereAplica`).
- Cambiar de motor OCULTA la sección sin reiniciarla: lista, descarga en curso y progreso son estado del
  diálogo y vuelven tal como iban.
- «Descargar (N MB)» solo si el pack es `descargable`; si no, la nota con el porqué de ESTE sistema
  (`noDisponible`) o el genérico. «Seleccionar carpeta…» siempre: es la salida cuando la descarga no puede.
- «instalado (tuyo)» distingue lo que registró el usuario de lo que descargó Tessera.
- `DriversLista` es presentacional: el progreso tiene un solo dueño (el diálogo), porque el aviso de la
  prueba también lo pinta.
- La ayuda del pie nombra los motores sin clientes con sus etiquetas del registro (`ayudaSinClientes`).
- El aviso de soporte de un pack va en tono de aviso: el pack se ofrece igual.

## Consecuencias

- Los textos que nombran a Oracle en `DriversLista.tsx` y `DbConexionDialogo.tsx` están exentos POR RUTA en
  `src/shared/test-motores-sueltos.mts`: no se mudan de archivo.
- Catálogo, descarga y plataformas: `drivers-catalogo-y-matriz-oracle.md`, `drivers-descarga-y-plataformas.md`.

## Descartes

- Dos dueños del progreso (lista y aviso): pintaban dos porcentajes distintos.
- Ofrecer el botón de descarga de un pack retirado: acaba en un 404 que se lee como un bloqueo de la red.
