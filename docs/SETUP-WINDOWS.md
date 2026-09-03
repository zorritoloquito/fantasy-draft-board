# Setting this up on Windows, from nothing

Written for someone who has never installed a developer tool. Every step is
copy-paste. Total time: about 15 minutes, most of it downloads.

You need three things: **Node.js** (runs the code), **Git** (gets the code), and
**Chrome** (which you almost certainly already have). That's it.

---

## 1. Install Node.js

1. Go to **<https://nodejs.org>**
2. Click the big green button on the left — the one labelled **LTS**
3. Run the downloaded `.msi`. Click Next through everything, accept the licence,
   leave every checkbox as it is. Click Install, then Finish.

**Check it worked.** Press `Win + R`, type `powershell`, press Enter. In the blue
window that opens, type:

```
node --version
```

You should see something like `v22.11.0`. Any version starting `v20`, `v22` or
higher is fine. If you get "not recognized", close PowerShell, open a new one and
try again — the installer needs a fresh window.

## 2. Install Git

1. Go to **<https://git-scm.com/download/win>**
2. It downloads automatically ("64-bit Git for Windows Setup")
3. Run it. Click Next through every screen — **all the defaults are correct**.
   There are a lot of screens. Keep clicking Next, then Install.

**Check it worked.** New PowerShell window:

```
git --version
```

Expect `git version 2.x.x`.

## 3. Get the code

In PowerShell:

```
cd ~
git clone https://github.com/zorritoloquito/fantasy-draft-board.git
cd fantasy-draft-board
```

If Git asks you to sign in to GitHub, do — the repo may be private, in which case
you need to be added as a collaborator first. Ask Luis.

## 4. Check it runs

```
node src/test-model.mjs
```

You should see a list of ticks ending in **`31 passed, 0 failed`**. If you see
that, everything is installed correctly and you're done with setup.

---

## Before your draft

### Set your league up

Open `config.json` in Notepad:

```
notepad config.json
```

Change these four values to match your league, then save and close:

```json
"league":      "My League 2026",
"teams":       10,
"budget":      200,
"rosterSlots": 15,
"myTeamName":  "your exact Yahoo team name",
```

`teams × budget` is the total money in the room, and every price the board
recommends is derived from it. **If this is wrong, every number is wrong** — and
it will look completely normal. Double-check it against the draft room.

### Do a dry run (do this at least once before draft day)

Two PowerShell windows.

**Window 1** — serve the board:

```
cd ~\fantasy-draft-board
node src/parse.mjs data/draftsheet.csv data/players.json
node src/build.mjs src/board.template.html data/players.json config.json src/model.mjs board.html
node src/serve.mjs
```

Now open <http://localhost:8777/board.html> in your browser. You should see the
board with an amber "WATCHER NOT RUNNING" bar across the top. That's correct.

**Window 2** — run a fake draft:

```
cd ~\fantasy-draft-board
node src/simulate.mjs --fast
```

Watch the board. Prices should move, the amber bar should disappear, the
positional scarcity panel should drain. That means everything works.

When you're done: click **✦ New draft** on the board, and run `.\new-draft.ps1`
(see below) to clear the fake draft out.

---

## Draft day

### Step 1 — launch the debug browser

The board reads your Yahoo draft room by watching Chrome. Chrome has to be
started a special way for that to work. In PowerShell:

```
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$HOME\fantasy-draft-profile" --no-first-run https://football.fantasysports.yahoo.com/
```

That's one long line — copy the whole thing.

This opens a **separate, empty Chrome profile**. Your normal Chrome, bookmarks
and logins are untouched. You'll need to log into Yahoo in this new window.

> If Chrome is somewhere else, try
> `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`.
> Brave works too — swap in
> `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`.

**In that new window:** log into Yahoo → open your league → enter the draft room.

> ### ⚠ Leave it on the Players tab with the position filter set to All
>
> The watcher figures out who's been sold by noticing who disappeared from the
> player list. Switching to the Team/Queue/Chat tab, or filtering by position,
> makes the list vanish and looks like a mass sale.
>
> It won't corrupt your prices — the board detects this and goes red — but it
> **stops updating** until you switch back. Sorting is fine. Filtering is not.

### Step 2 — start the watcher

New PowerShell window:

```
cd ~\fantasy-draft-board
node src\watch.mjs
```

It should print `watching draft room…`. If it says the debug browser isn't
running, go back to step 1.

### Step 3 — start the board

Third PowerShell window:

```
cd ~\fantasy-draft-board
node src/parse.mjs data/draftsheet.csv data/players.json
node src/build.mjs src/board.template.html data/players.json config.json src/model.mjs board.html
node src/serve.mjs
```

Open <http://localhost:8777/board.html> — **in your normal browser**, not the
debug one. Keep the debug window on the draft room.

You bid in Yahoo. The board is advice only; it cannot place a bid.

---

## Clearing state between drafts

Run this in the project folder:

```
.\new-draft.ps1
```

Then click **✦ New draft** on the board itself — it keeps its own copy of the
picks in the browser, and the script can't reach that.

**Do this before every draft.** Skipping it means the board starts up showing
the previous draft's players as already sold.

---

## If something goes wrong mid-draft

The board tells you. A coloured bar across the top means something is off:

| bar | what to do |
|---|---|
| **WATCHER NOT RUNNING** (amber) | Step 2 isn't running, or it crashed. Restart it. Prices shown are raw sheet values with no inflation. |
| **STALE — no update for Ns** (red) | The watcher stopped writing. Check the draft room is on Players/All, and that the watcher window is still alive. |
| **WILL NOT TRUST IT** (red) | Usually a position filter. Set it back to All. |
| **N phantom sales dropped** (amber) | Self-corrected, nothing to do. If it keeps climbing, restart the watcher. |

**No bar means everything is live.**

Other things:

- **"another watcher is already running"** — you started it twice. It prints the
  command to kill the old one; run that, then start again.
- **Board shows the wrong players as drafted** — click **✦ New draft**.
- **Nothing updates and there's no bar** — hard-refresh the board with
  `Ctrl + Shift + R`.
- **Worst case:** you can drive it entirely by hand. Type a player's name and
  press `Enter` to mark him drafted by someone else, or `Shift + Enter` for
  yourself. Everything except live inflation still works.

---

## One honest warning

This has been used in exactly one live draft, and it broke three times during
that draft. Those specific failures are fixed and tested, but it is a homemade
tool, not a product. Have Yahoo's own screen open too, and treat the board as a
second opinion rather than the source of truth.
