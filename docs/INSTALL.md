# Installing Royal Red

This guide assumes you have never used a terminal. Every step is written out.
If you already know your way around, the short version is:

```
curl -fsSL https://raw.githubusercontent.com/royal-red/royal-red/main/install.sh | bash
royal-red
```

The long version follows. There is also a print-ready manual with
screenshots in `docs/Royal-Red-Installation-Guide.pdf`, produced by Royal
Red's own PDF engine.

No emojis and no em dashes appear anywhere in this project, including this
guide and every message the installer prints.

---

## Contents

- [What you need](#what-you-need)
- [Installing on Linux (Ubuntu or Debian)](#installing-on-linux-ubuntu-or-debian)
- [Installing on Linux (Fedora or RHEL)](#installing-on-linux-fedora-or-rhel)
- [Installing on Windows 11 (via WSL2)](#installing-on-windows-11-via-wsl2)
- [First launch](#first-launch)
- [The royal-red command](#the-royal-red-command)
- [Docker](#docker)
- [Troubleshooting: the five most common errors](#troubleshooting-the-five-most-common-errors)
- [Uninstalling](#uninstalling)

---

## What you need

- A computer running Ubuntu 22.04 or newer, Debian 12 or newer, Fedora 38 or
  newer, or Windows 11 with WSL2.
- About 500 MB of free disk space.
- An internet connection for the initial install.
- A normal user account that can install software (sudo).

What you do NOT need: an API key (Royal Red runs in fallback mode without
one), a powerful machine, or any terminal experience.

---

## Installing on Linux (Ubuntu or Debian)

### Step 1: Open a terminal

Press the Super key (the one with the Windows or Command logo), type
`terminal`, and press Enter. A window with a blinking cursor appears.

### Step 2: Run the installer

Paste this line (Ctrl+Shift+V pastes into most terminals) and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/royal-red/royal-red/main/install.sh | bash
```

What you should see: a series of lines, each ending in `ok`, and finally:

```
Royal Red installed.
Run: royal-red
Or open the Applications menu and click Royal Red.
```

If curl is missing, the installer prints the exact command to install it:

```
sudo apt install curl
```

Run that, then run the installer line again.

### Step 3: Verify

Close the terminal, open a new one, and run:

```
royal-red --version
```

What you should see: `Royal Red 1.8.1`.

---

## Installing on Linux (Fedora or RHEL)

The same two commands work. The installer detects Fedora and uses `dnf`
instead of `apt` when it needs to add `curl` or `git`:

```
curl -fsSL https://raw.githubusercontent.com/royal-red/royal-red/main/install.sh | bash
royal-red
```

Everything else (the desktop entry, the icons, the data directory) is
identical.

---

## Installing on Windows 11 (via WSL2)

WSL2 runs a real Ubuntu system inside Windows 11. Royal Red supports it as a
first-class path.

### Step 1: Install WSL2

Click Start, type `powershell`, right click **Windows PowerShell**, choose
**Run as administrator**, then run:

```
wsl --install
```

Restart when it asks. After the restart, an Ubuntu window asks you to create
a Linux username and password. Pick anything you like; this is separate from
your Windows login.

### Step 2: Open Ubuntu and install

Click Start, type `Ubuntu`, press Enter, then run the same installer line as
on Linux. The installer detects WSL and also installs `wslu`, which lets the
Linux side open pages in your Windows browser.

### Step 3: Launch

```
royal-red
```

Your Windows browser opens at `http://localhost:3000`. WSL2 forwards
localhost automatically; there is nothing to configure.

Notes:

- Royal Red installs inside the WSL filesystem (`~/.royal-red`), which is
  much faster than working under `/mnt/c`. The installer already handles
  this; do not move the folder to `/mnt/c`.
- If Windows Firewall asks, allow access on private networks. The server
  binds to localhost only.

---

## First launch

Run:

```
royal-red
```

The first run shows the boot screen in your browser: a dark field, a gold
crown, a short sequence of sealed boot lines, and one engraved button:
**INITIALIZE**. Click it. The console opens. Type a prompt such as `build me
a landing page for a coffee shop` and watch the plan, the build, the
verification, and the receipt.

The terminal returns control immediately after launching; the server keeps
running in the background and survives closing the terminal.

---

## The royal-red command

```
royal-red            start the server and open the console
royal-red stop       stop the server
royal-red restart    stop, then start
royal-red status     is it running, which port, since when
royal-red logs       follow the server log (Ctrl C to stop following)
royal-red update     pull the latest code, migrate the database, restart
royal-red uninstall  remove Royal Red (asks before deleting your data)
royal-red --version  print the version
royal-red --help     list every command
```

Configuration lives in `~/.royal-red/config.toml`:

```
port = "3000"     # the first port tried; the launcher walks up to 3010
mode = "auto"     # auto, prod (needs a build), or dev (no build step)
```

Your data lives in `~/.royal-red/data` (database, uploads, artifacts).
Back it up by copying that folder while the server is stopped.

---

## Docker

```
docker build -t royalred/royal-red:latest .
docker run -d --name royal-red -p 3000:3000 -v royal-red-data:/data royalred/royal-red:latest
```

Then open `http://localhost:3000`. The container runs as a non-root user
(uid 1000), keeps all state on the `/data` volume, and answers a health
check at `/api/health`. Your data survives container restarts because it
lives on the volume.

---

## Troubleshooting: the five most common errors

### 1. `royal-red: command not found`

The PATH was updated by the installer, but your current terminal still uses
the old PATH. Close the terminal and open a new one. If it still fails, run:

```
export PATH="$HOME/.local/bin:$PATH"
```

and add that same line to the end of `~/.bashrc` to make it permanent.

### 2. `curl: command not found`

Install curl with `sudo apt install curl` (Ubuntu/Debian) or
`sudo dnf install curl` (Fedora), then run the installer again.

### 3. Port already in use

The launcher tries ports 3000 through 3010 in order and prints the one it
picked. If every port is busy it fails with a clear message. Stop the other
service, or set a starting port in `~/.royal-red/config.toml`.

### 4. The browser does not open

On a minimal system there may be no `xdg-open`. The launcher prints the URL;
open `http://localhost:3000` manually. On WSL2, run
`sudo apt install wslu` so `wslview` can reach the Windows browser.

### 5. `EACCES` or permission errors

If a previous run ever used sudo, some files may be owned by root. Fix with:

```
sudo chown -R "$USER" "$HOME/.royal-red"
```

The installer itself never needs sudo except when it installs `curl` or
`git` through your package manager, and it prints the exact command first.

---

## Uninstalling

Either command works:

```
royal-red uninstall
```

or from a copy of the repository:

```
bash install.sh --uninstall
```

Both stop the server, remove the application, the command, the desktop
entry, and the icons, and ask before deleting your data in
`~/.royal-red/data`. Nothing outside your home directory is touched.

---

## Verified limits

Royal Red never ships a claim it cannot back. Three install paths are fully
implemented and structurally validated, but this project's sandbox has no
Docker daemon, no Windows host, and no desktop environment. Here is exactly
what was verified, what was not, and the single next step for each.

### Docker

Verified in this environment:

- The multi-stage `Dockerfile` builds a standalone Next.js output and copies
  only what the runtime needs.
- The first-boot schema path (`prisma db push` on an empty data volume) runs
  clean when exercised standalone against a fresh SQLite file.
- The health endpoint `/api/health` returns structured status.

Not verified (needs a real Docker host):

- `docker build` and `docker run` on a real daemon.
- Volume persistence across container restarts.
- The container `HEALTHCHECK` actually firing inside Docker.

Next step on a real machine: `docker build -t royal-red . && docker run -p
3000:3000 -v royalred-data:/data royal-red`, then restart the container once
and confirm the data in the volume survives.

### WSL2

Verified in this environment:

- Windows/WSL2 detection logic (unit-tested against `/proc/version` shapes).
- The `wslview` browser opener used to launch the console on the Windows side.
- The install path for `wslu` (which provides `wslview`) on Ubuntu.

Not verified (needs a real Windows 11 machine with WSL2):

- The end-to-end installer run inside a WSL2 Ubuntu 22.04 distribution.
- The browser actually opening on the Windows side after install.
- The console running under WSL2 networking from a Windows browser.

Next step on a real machine: on Windows 11, install Ubuntu 22.04 from the
Microsoft Store, open it, and run `bash install.sh` from a clone of this
repository. Confirm the browser opens to the console.

### Desktop icon

Verified in this environment:

- The `royal-red.desktop` file deploys to the correct applications directory
  and parses as a valid desktop entry.
- The crown icon ships in the required sizes and the `.desktop` file
  references the installed path correctly.

Not verified (needs a real desktop environment):

- The crown appearing in the GNOME or KDE Applications menu.
- Clicking the entry launching the console.

Next step on a real machine: on Ubuntu with GNOME, run `bash install.sh`,
open the Activities overview, search for "Royal Red", and confirm the crown
icon appears and launches the console.
