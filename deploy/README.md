# Wdrożenie na Proxmox (LXC) z Cloudflare Tunnel

Wszystko działa w jednym kontenerze LXC z Debianem 12:

```
przeglądarka ──HTTPS──▶ Cloudflare ──Tunnel──▶ LXC :8080 Caddy ─┬─ /api/*, /files/* ─▶ API (Node) :3001 ─▶ PostgreSQL
                                                                 └─ reszta ─▶ apps/web/dist (zbudowana aplikacja)
```

Adres testowy: **https://twardy.it**, maile z **noreply@twardy.it** (Resend). Zmiana domeny później: patrz „Zmiana domeny” na końcu.

---

## 1. Kontener LXC w Proxmoxie

Create CT → szablon **debian-12-standard**, kontener nieuprzywilejowany:

- 2 vCPU, 2 GB RAM, 16 GB dysku (z zapasem na historię newsów i zrzuty ekranu),
- sieć: stały adres IP w LAN, np. `192.168.1.50/24` (podasz go w tunelu),
- strefa czasowa nie ma znaczenia (aplikacja liczy w UTC i strefie użytkownika).

Wejdź do konsoli kontenera jako root.

## 2. Oprogramowanie

```sh
apt update && apt -y upgrade
apt -y install curl git ca-certificates gnupg postgresql debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs

# Caddy
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt -y install caddy

# Użytkownik aplikacji i katalog na zrzuty ekranu
useradd --system --create-home --shell /bin/bash trading
mkdir -p /var/lib/trading-app/uploads && chown -R trading:trading /var/lib/trading-app
```

## 3. Baza danych

```sh
PASS=$(openssl rand -hex 24); echo "Hasło bazy: $PASS"   # zapisz, wpiszesz je do .env
sudo -u postgres psql -c "CREATE ROLE trading LOGIN PASSWORD '$PASS';"
sudo -u postgres psql -c "CREATE DATABASE trading OWNER trading;"
```

## 4. Kod z GitHuba

Repozytorium jest prywatne, więc kontener dostaje własny klucz tylko do odczytu:

```sh
sudo -u trading ssh-keygen -t ed25519 -N "" -f /home/trading/.ssh/id_ed25519
cat /home/trading/.ssh/id_ed25519.pub
```

Wklej ten klucz w GitHubie: repozytorium **trading-app → Settings → Deploy keys → Add deploy key** (bez zaznaczania „Allow write access”). Potem:

```sh
mkdir -p /opt/trading-app && chown trading:trading /opt/trading-app
sudo -u trading git clone git@github.com:twarrdy-debug/trading-app.git /opt/trading-app
cd /opt/trading-app
sudo -u trading npm ci --no-audit --no-fund
sudo -u trading npm run build
```

## 5. Konfiguracja (.env)

```sh
cp deploy/env.production.example apps/api/.env
chown trading:trading apps/api/.env && chmod 600 apps/api/.env
openssl rand -base64 48        # → AUTH_SECRET
nano apps/api/.env
```

Uzupełnij: hasło bazy w `DATABASE_URL`, `AUTH_SECRET`, swój e-mail w `DEV_USER_EMAIL` (pierwszy admin) oraz klucz Resend w `SMTP_URL` (krok 9; do tego czasu możesz usunąć linijkę `SMTP_URL`, wtedy maile lądują w logu).

## 6. Usługi

```sh
cp deploy/trading-app.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now trading-app
journalctl -u trading-app -f      # pierwszy start: migracje bazy i dane startowe; Ctrl+C gdy zobaczysz „Server listening”

cp deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl reload caddy
curl -s http://127.0.0.1:8080/api/health   # → {"ok":true}
```

## 7. Hasło admina

Pierwszy start utworzył konto admina z adresem z `DEV_USER_EMAIL`. Nadaj mu hasło:

```sh
cd /opt/trading-app
systemctl stop trading-app    # nie jest konieczne przy PostgreSQL, ale bezpieczniejsze
sudo -u trading npm run user:login -- --user twoj@email.pl --password 'mocne-haslo'
systemctl start trading-app
```

## 8. Cloudflare Tunnel

W **Cloudflare Zero Trust → Networks → Tunnels → (Twój tunel) → Public Hostname → Add**:

| Pole | Wartość |
|---|---|
| Subdomain | puste (sama domena) albo np. `dziennik` |
| Domain | `twardy.it` |
| Service | `HTTP` · `192.168.1.50:8080` (IP kontenera; `localhost:8080`, gdy `cloudflared` działa w tym samym LXC) |

Jeśli użyjesz subdomeny, ustaw ten sam adres w `PUBLIC_URL` i `CORS_ORIGIN` w `.env` i zrestartuj API.

Wejdź na **https://twardy.it**, zaloguj się i w **Ustawieniach → Zaproszenia** zaproś pierwszą osobę.

## 9. Maile przez Resend (noreply@twardy.it)

1. Załóż konto na **resend.com** (darmowo: 3000 maili miesięcznie, 100 dziennie).
2. **Domains → Add Domain → `twardy.it`**, region EU.
3. Resend pokaże rekordy DNS (MX i TXT dla `send.twardy.it`, TXT `resend._domainkey`). W **Cloudflare → twardy.it → DNS → Records** dodaj je **dokładnie tak, jak podaje Resend**, z wyłączonym pomarańczowym proxy (DNS only).
4. Dodaj też rekord DMARC: typ `TXT`, nazwa `_dmarc`, treść `v=DMARC1; p=none;`.
5. W Resend kliknij **Verify** (zwykle kilka minut).
6. **API Keys → Create API Key** (uprawnienie „Sending access”), skopiuj klucz `re_…` i wpisz go do `.env`:
   ```
   SMTP_URL=smtps://resend:re_TWOJ_KLUCZ@smtp.resend.com:465
   MAIL_FROM=Dziennik tradera <noreply@twardy.it>
   ```
7. `systemctl restart trading-app` i sprawdź: wyloguj się, kliknij „Nie pamiętasz hasła?” albo wyślij zaproszenie na swój drugi adres.

Na `noreply@twardy.it` nie trzeba zakładać skrzynki: to tylko adres nadawcy.

## Aktualizacje

Po wypchnięciu zmian na GitHub:

```sh
/opt/trading-app/deploy/update.sh
```

Skrypt pobiera kod, instaluje zależności, buduje aplikację i restartuje API (migracje i nowe dane startowe wchodzą przy starcie).

## Kopie zapasowe

- **Kontener:** Proxmox → Datacenter → Backup → zadanie dla tego CT (np. co noc, tryb snapshot).
- **Baza osobno** (łatwiej przywrócić pojedynczą bazę), codziennie o 3:00, 14 dni wstecz:
  ```sh
  mkdir -p /var/backups/trading && chown postgres /var/backups/trading
  echo '0 3 * * * postgres pg_dump -Fc trading > /var/backups/trading/trading-$(date +\%F).dump && find /var/backups/trading -mtime +14 -delete' > /etc/cron.d/trading-backup
  ```
- **Zrzuty ekranu:** katalog `/var/lib/trading-app/uploads` (jest w kopii kontenera).

## Zmiana domeny

1. Nowy Public Hostname w tunelu.
2. W `.env`: `PUBLIC_URL`, `CORS_ORIGIN` i `MAIL_FROM` na nową domenę.
3. W Resend dodaj nową domenę i jej rekordy DNS (stara może zostać do czasu przejścia).
4. `systemctl restart trading-app`. Zalogowani użytkownicy zalogują się ponownie, bo ciasteczka są przypisane do domeny.

## Gdy coś nie działa

| Objaw | Sprawdź |
|---|---|
| strona się nie ładuje | `systemctl status caddy`, `curl http://127.0.0.1:8080/` w kontenerze, adres w tunelu |
| „Błąd 502” / dane się nie ładują | `journalctl -u trading-app -n 100` |
| nie da się zalogować („Invalid origin”) | `PUBLIC_URL` i `CORS_ORIGIN` muszą być dokładnie adresem z paska przeglądarki (https, bez `/` na końcu) |
| maile nie dochodzą | `journalctl -u trading-app | grep -i mail`, status domeny w Resend, folder spam |
| newsy „niedostępne (429)” | inny serwer z tego samego IP też pobiera FinancialJuice (np. dev na Macu): ustaw tam `NEWS_INTERVAL_SECONDS=0` |
