#!/usr/bin/env bash
# Starts the integration test servers (mail: IMAP 993, SMTP 465, ManageSieve 4190; CalDAV/CardDAV
# 5232) with a throwaway test CA, and writes the matching LEVUVO_IT_* variables to
# test/servers/.state/env (source it, or let the workflow do so).
#   test/servers/start.sh        stop: docker compose -f test/servers/compose.yml down -v
set -euo pipefail
cd "$(dirname "$0")"
state=.state
rm -rf "$state" && mkdir -p "$state/certs" "$state/mail-config"
pass_peter=levuvo-test-peter
pass_anna=levuvo-test-anna

# Throwaway CA and server certificate (localhost, 127.0.0.1). Node trusts it via NODE_EXTRA_CA_CERTS.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Levuvo integration test CA' \
  -keyout "$state/certs/ca.key" -out "$state/certs/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' \
  -keyout "$state/certs/server.key" -out "$state/certs/server.csr" 2>/dev/null
printf 'subjectAltName=DNS:localhost,DNS:mail.levuvo.test,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$state/certs/ext"
openssl x509 -req -in "$state/certs/server.csr" -CA "$state/certs/ca.crt" -CAkey "$state/certs/ca.key" \
  -CAcreateserial -days 2 -extfile "$state/certs/ext" -out "$state/certs/server.crt" 2>/dev/null
chmod 644 "$state/certs/"*

# Mail accounts (plain scheme is fine for throwaway test passwords).
printf 'peter@levuvo.test|{PLAIN}%s\nanna@levuvo.test|{PLAIN}%s\n' "$pass_peter" "$pass_anna" \
  > "$state/mail-config/postfix-accounts.cf"
# IPv4 only: container hosts without IPv6 would otherwise stop Dovecot at startup.
printf 'listen = *\n' > "$state/mail-config/dovecot.cf"
# DAV users (plain htpasswd, throwaway test passwords).
printf 'peter:%s\nanna:%s\n' "$pass_peter" "$pass_anna" > "$state/radicale-users"
docker compose pull -q

docker compose up -d --wait --wait-timeout 300
# Postfix answers on 465 a moment after the port opens; wait for a TLS greeting.
for _ in $(seq 1 60); do
  if openssl s_client -connect 127.0.0.1:465 -CAfile "$state/certs/ca.crt" -verify_return_error \
    -servername localhost </dev/null 2>/dev/null | grep -q '^220 '; then break; fi
  sleep 2
done
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:5232/.web/ && break; sleep 1; done

cat > "$state/env" <<ENV
export NODE_EXTRA_CA_CERTS="$PWD/$state/certs/ca.crt"
export LEVUVO_IT_ALLOW_WRITES=1
export LEVUVO_IT_IMAP_HOST=localhost LEVUVO_IT_SMTP_HOST=localhost LEVUVO_IT_SMTP_PORT=465
export LEVUVO_IT_USER=peter@levuvo.test LEVUVO_IT_PASSWORD=$pass_peter
export LEVUVO_IT_USER2=anna@levuvo.test LEVUVO_IT_PASSWORD2=$pass_anna
export LEVUVO_IT_DAV_URL=http://127.0.0.1:5232/ LEVUVO_IT_DAV_USER=peter LEVUVO_IT_DAV_PASSWORD=$pass_peter
export LEVUVO_IT_DAV_USER2=anna LEVUVO_IT_DAV_PASSWORD2=$pass_anna
ENV
echo "✓ Test servers running. Variables: source test/servers/.state/env"
