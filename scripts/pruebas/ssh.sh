#!/usr/bin/env bash
# =============================================================================
# SERVIDOR SSH DE PRUEBAS en Docker: pruebas-ssh en 127.0.0.1:2222.
# Nombre «pruebas-*», NUNCA «tessera-*» (el barrido de Tessera borra esos).
#
# Uso:
#   scripts/pruebas/ssh.sh levantar [--de-cero]   construye la imagen, crea o arranca (idempotente)
#   scripts/pruebas/ssh.sh correr <orden...>       corre la orden con el destino en el entorno
#   scripts/pruebas/ssh.sh rotar-huella            regenera las claves de host (huella nueva)
#
# Usuarios: `pruebas` solo contraseña, `clave` solo clave pública y `kbd` solo
# keyboard-interactive (PAM). La contraseña sale de `ssh-pw.txt` y entra al contenedor por
# stdin (chpasswd), nunca por la línea de órdenes. Las claves cliente viven en `ssh/` dentro de
# la carpeta de secretos (ver comun.sh): `id_ed25519` (sin frase), `id_ed25519_frase` (con la
# frase de `ssh-frase.txt`) e `id_rsa.pem` (formato PEM). Se generan si faltan y nunca se imprimen.
# Las claves de host viven en el volumen pruebas-ssh-host: la huella es estable entre arranques.
#
# Variables que pone `correr`: TESSERA_TEST_SSH=127.0.0.1:2222 y TESSERA_TEST_SSH_DIR=<secretos>.
# Las pruebas leen los archivos de esa carpeta: ninguna clave viaja por el entorno.
#
# MAC (sin verificar): debian:bookworm-slim es multiarquitectura.
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
NOMBRE=pruebas-ssh
IMAGEN=pruebas-ssh-img
VOLUMEN=pruebas-ssh-host
PUERTO=2222

# Contexto de construcción en una carpeta temporal: Dockerfile + la configuración de sshd.
# Debian incluye sshd_config.d/*.conf al PRINCIPIO de su sshd_config, así que esto manda.
construir_imagen() {
  local ctx; ctx="$(mktemp -d)"
  printf '%s\n' \
    'FROM debian:bookworm-slim' \
    'RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && rm -rf /var/lib/apt/lists/* && rm -f /etc/ssh/ssh_host_*' \
    'RUN mkdir -p /run/sshd && for u in pruebas clave kbd; do useradd -m -s /bin/bash "$u"; done' \
    'COPY pruebas.conf /etc/ssh/sshd_config.d/pruebas.conf' \
    'CMD ["/bin/sh","-c","mkdir -p /hk/etc/ssh && ssh-keygen -A -f /hk >/dev/null && exec /usr/sbin/sshd -D -e -o HostKey=/hk/etc/ssh/ssh_host_ed25519_key -o HostKey=/hk/etc/ssh/ssh_host_ecdsa_key -o HostKey=/hk/etc/ssh/ssh_host_rsa_key"]' \
    > "$ctx/Dockerfile"
  printf '%s\n' \
    'PasswordAuthentication yes' \
    'KbdInteractiveAuthentication yes' \
    'PubkeyAuthentication yes' \
    'PermitRootLogin no' \
    'Match User pruebas' \
    '    AuthenticationMethods password' \
    'Match User clave' \
    '    AuthenticationMethods publickey' \
    'Match User kbd' \
    '    AuthenticationMethods keyboard-interactive' \
    > "$ctx/pruebas.conf"
  docker build -q -t "$IMAGEN" "$ctx" >/dev/null
  local r=$?
  rm -rf "$ctx"
  return $r
}

# Claves cliente de pruebas, con el ssh-keygen del sistema. Nunca se imprimen.
asegurar_claves_cliente() {
  local d="$SECRETOS/ssh"
  mkdir -p "$d"
  asegurar_clave ssh-frase.txt
  local frase; frase="$(leer_secreto ssh-frase.txt)" || return 1
  [ -s "$d/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C pruebas-tessera -f "$d/id_ed25519"
  [ -s "$d/id_ed25519_frase" ] || ssh-keygen -q -t ed25519 -N "$frase" -C pruebas-tessera -f "$d/id_ed25519_frase"
  [ -s "$d/id_rsa.pem" ] || ssh-keygen -q -t rsa -b 3072 -m PEM -N '' -C pruebas-tessera -f "$d/id_rsa.pem"
}

esperar_sshd() {
  for i in $(seq 1 30); do
    if ssh-keyscan -T 2 -p "$PUERTO" 127.0.0.1 >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "$NOMBRE no contesta tras 30 s"; docker logs --tail 20 "$NOMBRE"; return 1
}

levantar() {
  asegurar_clave ssh-pw.txt
  local pw; pw="$(leer_secreto ssh-pw.txt)" || return 1
  asegurar_claves_cliente || { echo "no se pudieron generar las claves cliente"; return 1; }
  if [ "${1:-}" = "--de-cero" ]; then
    docker rm -f "$NOMBRE" >/dev/null 2>&1
    docker volume rm "$VOLUMEN" >/dev/null 2>&1
  fi
  construir_imagen || { echo "no se pudo construir $IMAGEN"; return 1; }
  if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then
    docker start "$NOMBRE" >/dev/null
  else
    MSYS_NO_PATHCONV=1 docker run -d --name "$NOMBRE" -p "127.0.0.1:$PUERTO:22" \
      -v "$VOLUMEN:/hk" "$IMAGEN" >/dev/null || { echo "no arrancó $NOMBRE"; return 1; }
  fi
  esperar_sshd || return 1
  printf 'pruebas:%s\nkbd:%s\n' "$pw" "$pw" | MSYS_NO_PATHCONV=1 docker exec -i "$NOMBRE" chpasswd \
    || { echo "chpasswd falló"; return 1; }
  cat "$SECRETOS"/ssh/*.pub | MSYS_NO_PATHCONV=1 docker exec -i "$NOMBRE" sh -c \
    'mkdir -p /home/clave/.ssh && cat > /home/clave/.ssh/authorized_keys && chown -R clave:clave /home/clave/.ssh && chmod 700 /home/clave/.ssh && chmod 600 /home/clave/.ssh/authorized_keys' \
    || { echo "no se pudo sembrar authorized_keys"; return 1; }
  echo "$NOMBRE listo en 127.0.0.1:$PUERTO (usuarios pruebas, clave, kbd)"
}

rotar_huella() {
  MSYS_NO_PATHCONV=1 docker exec "$NOMBRE" sh -c 'rm -f /hk/etc/ssh/ssh_host_*' || return 1
  docker restart "$NOMBRE" >/dev/null || return 1
  esperar_sshd && echo "huella de $NOMBRE regenerada"
}

correr() {
  local pw; pw="$(leer_secreto ssh-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  TESSERA_TEST_SSH="127.0.0.1:${PUERTO}" TESSERA_TEST_SSH_DIR="$SECRETOS" \
    "$@" 2>&1 | sed "s/${pw}/<clave>/g"
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) shift; levantar "$@" ;;
  correr) shift; correr "$@" ;;
  rotar-huella) rotar_huella ;;
  *) echo "uso: ssh.sh levantar [--de-cero] | correr <orden...> | rotar-huella"; exit 2 ;;
esac
