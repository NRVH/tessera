// =============================================================================
// API pública de la feature del explorador SFTP de una conexión SSH para las demás features: el
// explorador que monta la pestaña y su icono. No importa ninguna otra feature: lo que necesita de las terminales y de
// las conexiones SSH (el texto de un motivo de fallo, confirmar la huella del servidor) se lo da quien lo monta.
// =============================================================================
export { ExploradorSftp, type PropsExploradorSftp } from './ExploradorSftp'
export { IconoSftp } from './iconosSftp'
