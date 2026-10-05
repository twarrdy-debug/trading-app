# Wdrożenie w Dockerze (maszyna wirtualna Debian na Proxmoxie)

Aplikacja działa w trzech kontenerach z `docker-compose.yml` w głównym katalogu repozytorium:

```
przeglądarka ──HTTPS──▶ Cloudflare ──Tunnel (osobny LXC z cloudflared)──▶ VM :8080
                                                                          │
   web (Caddy: zbudowana aplikacja + przekierowanie /api, /files) ◀───────┘
     └─▶ api (Node, port 3001 tylko w sieci Dockera) ─▶ db (PostgreSQL 16, dane w wolumenie)
```

Adres testowy **https://twardy.it**, maile z **noreply@twardy.it** (Resend). Wszystko, co wpisujesz w terminalu maszyny, wykonujesz jako root (albo z `sudo`).

---

## 1. Maszyna wirtualna w Proxmoxie

Proxmox zaleca Dockera w maszynie wirtualnej (w LXC też działa, ale bywa kłopotliwy przy aktualizacjach), więc stawiamy VM.

1. **Obraz instalacyjny:** w Proxmoxie wybierz magazyn **local → ISO Images → Download from URL** i wklej adres najnowszego obrazu **netinst** Debiana 13 (amd64) ze strony https://www.debian.org/distrib/netinst (plik `debian-13.x.x-amd64-netinst.iso`). Kliknij **Query URL**, potem **Download**.
2. **Create VM:**
   - *OS:* wybrany obraz ISO, typ Linux,
   - *System:* zaznacz **Qemu Agent**,
   - *Disks:* **32 GB** (obrazy Dockera, baza, zrzuty ekranu),
   - *CPU:* **2 rdzenie**, typ **host**,
   - *Memory:* **4096 MB** (budowanie aplikacji potrzebuje ok. 2 GB),
   - *Network:* most `vmbr0`, jak inne maszyny.
3. **Instalacja Debiana** (konsola maszyny): język i strefa wedle uznania, nazwa hosta np. `trading`, hasło roota i jeden zwykły użytkownik. Przy wyborze oprogramowania **odznacz środowisko graficzne**, zostaw **SSH server** i **standard system utilities**.
4. **Stały adres IP:** najprościej zarezerwować go dla tej maszyny w routerze (DHCP reservation), np. `192.168.1.60`. Ten adres wpiszesz w tunelu.
5. Po pierwszym uruchomieniu:
   ```sh
   apt update && apt -y upgrade
   apt -y install qemu-guest-agent git curl ca-certificates
   systemctl enable --now qemu-guest-agent
   ```

Dalej możesz pracować przez SSH: `ssh twoj-uzytkownik@192.168.1.60`, potem `su -`.

## 2. Docker

Oficjalny skrypt instaluje Docker Engine i wtyczkę Compose:

```sh
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

Opcjonalnie dodaj swojego użytkownika do grupy `docker` (`usermod -aG docker twoj-uzytkownik`, potem wyloguj się i zaloguj ponownie), żeby nie pisać `sudo` przed każdą komendą.

## 3. Kod z GitHuba

Repozytorium jest prywatne, więc maszyna dostaje własny klucz tylko do odczytu:

```sh
ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519
cat /root/.ssh/id_ed25519.pub
```

Wklej klucz w GitHubie: **trading-app → Settings → Deploy keys → Add deploy key** (bez „Allow write access”). Potem:

```sh
git clone git@github.com:twarrdy-debug/trading-app.git /opt/trading-app
cd /opt/trading-app
```

## 4. Konfiguracja (.env)

```sh
cp deploy/docker/env.example .env && chmod 600 .env
openssl rand -hex 24       # → POSTGRES_PASSWORD
openssl rand -base64 48    # → AUTH_SECRET
nano .env
```

Uzupełnij `POSTGRES_PASSWORD`, `AUTH_SECRET`, swój e-mail w `DEV_USER_EMAIL` (pierwszy admin) i klucz Resend w `SMTP_URL` (krok 8; do tego czasu możesz usunąć linijkę `SMTP_URL`, wtedy maile są widoczne w `docker compose logs api`).

## 5. Uruchomienie

```sh
docker compose up -d --build
docker compose ps                 # db i api powinny dojść do stanu "healthy" (ok. minuty)
docker compose logs -f api        # pierwszy start: migracje bazy i dane startowe; Ctrl+C, gdy zobaczysz „Server listening”
curl -s http://127.0.0.1:8080/api/health    # → {"ok":true}
```

Pierwsze budowanie trwa kilka minut (pobranie obrazów i zależności, build aplikacji). Kontenery uruchamiają się same po restarcie maszyny.

## 6. Hasło admina

Pierwszy start utworzył konto admina z adresem z `DEV_USER_EMAIL`. Nadaj mu hasło:

```sh
docker compose exec api npm run user:login -- --user twoj@email.pl --password 'mocne-haslo'
```

## 7. Cloudflare Tunnel (cloudflared w osobnym LXC)

W **Cloudflare Zero Trust → Networks → Tunnels → (Twój tunel) → Public Hostname → Add**:

| Pole | Wartość |
|---|---|
| Subdomain | puste (sama domena) albo np. `dziennik` |
| Domain | `twardy.it` |
| Service | `HTTP` · `192.168.1.60:8080` (IP maszyny z Dockerem) |

Kontener LXC z `cloudflared` musi widzieć maszynę w sieci: z jego konsoli `curl -s http://192.168.1.60:8080/api/health` powinien zwrócić `{"ok":true}`.

Jeśli użyjesz subdomeny, ustaw ten sam adres w `PUBLIC_URL` i `CORS_ORIGIN` w `.env` i wykonaj `docker compose up -d`.

Wejdź na **https://twardy.it**, zaloguj się i w **Ustawieniach → Zaproszenia** zaproś pierwszą osobę.

## 8. Maile przez Resend

Tak samo jak w [README.md, krok 9](README.md#9-maile-przez-resend-noreplytwardyit): domena `twardy.it` w Resend, rekordy DNS w Cloudflare, klucz API do `SMTP_URL` w `.env`, potem:

```sh
docker compose up -d     # przeładowuje api z nowym .env
```

## Aktualizacje

Po wypchnięciu zmian na GitHub (`main`):

```sh
cd /opt/trading-app
git pull --ff-only
docker compose up -d --build
docker image prune -f      # usuwa stare wersje obrazów
```

Migracje bazy i nowe dane startowe wchodzą przy starcie api.

## Kopie zapasowe

- **Cała maszyna:** Proxmox → Datacenter → Backup → zadanie dla tej VM (np. co noc).
- **Baza osobno**, codziennie o 3:00, 14 dni wstecz:
  ```sh
  mkdir -p /var/backups/trading
  echo '0 3 * * * root cd /opt/trading-app && docker compose exec -T db pg_dump -U trading -Fc trading > /var/backups/trading/trading-$(date +\%F).dump && find /var/backups/trading -mtime +14 -delete' > /etc/cron.d/trading-backup
  ```
  Przywrócenie: `docker compose exec -T db pg_restore -U trading -d trading --clean < plik.dump`.
- **Zrzuty ekranu** są w wolumenie `trading-app_uploads` (w kopii maszyny).

## Portainer później

Można go doinstalować w dowolnym momencie (`docker volume create portainer_data` i kontener `portainer/portainer-ce`, instrukcja na portainer.io). Ten stos pojawi się w nim jako „trading-app”. Aktualizacje nadal najlepiej robić komendami z sekcji wyżej, bo Portainer nie zbuduje obrazu z repozytorium bez dodatkowej konfiguracji.

## Gdy coś nie działa

| Objaw | Sprawdź |
|---|---|
| strona się nie ładuje | `docker compose ps`, `curl http://127.0.0.1:8080/` na maszynie, adres w tunelu, `curl` z LXC z cloudflared |
| „Błąd 502” / dane się nie ładują | `docker compose logs --tail 100 api` |
| api się restartuje | `docker compose logs api`: zwykle brak lub błąd w `.env` (np. `AUTH_SECRET` krótszy niż 32 znaki) |
| nie da się zalogować („Invalid origin”) | `PUBLIC_URL` i `CORS_ORIGIN` muszą być dokładnie adresem z paska przeglądarki (https, bez `/` na końcu) |
| maile nie dochodzą | `docker compose logs api | grep -i mail`, status domeny w Resend, folder spam |
| newsy „niedostępne (429)” | inny serwer z tego samego IP też pobiera FinancialJuice (np. dev na Macu): ustaw tam `NEWS_INTERVAL_SECONDS=0` |
