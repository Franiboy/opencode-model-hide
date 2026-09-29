# AGENTS.md — opencode-model-hide

npm-Paket `@franiboy/opencode-model-hide`: ein OpenCode-Plugin, das Modelle aus dem
Picker versteckt und die Auswahl über einen TUI-Dialog verwaltet. Öffentliches
Repository, öffentliche npm-Registry.

## Layout

```
src/index.ts   Server-Plugin (Bridge-Datei lesen, Modelle filtern, Catalog schreiben)
src/tui.ts     TUI-Selektor, wird aus dem Server-Plugin heraus geladen
tests/         Vitest, bootet das echte Plugin-Entrypoint gegen ein minimales ctx
scripts/       release.mjs, die Release-Transaktion
model-hide.ts  entfernt (2026-09-29): die Einzeldatei-Variante ist Geschichte,
               Installation läuft immer über npm
```

Das Paket verschifft rohes TypeScript (`exports` zeigt auf `./src/index.ts`).
Es gibt keinen Build-Schritt und keinen `dist/`.

## Befehle

```bash
npm ci
npm run check            # format:check + typecheck + test, das ist die CI-Bedingung
npm run format           # prettier --write .
npm run release -- 0.1.7        # Release, siehe unten
npm run release -- 0.1.7 --dry-run
```

Nach jeder Änderung an `src/` gilt: `npm run check` muss grün sein. Der Typecheck
läuft `strict` gegen das aufgelöste `@opencode/plugin`; genau darin liegt der Wert,
denkt man an eine paketinterne Änderung an der Plugin-API.

## Release

`npm run release -- <version>` ist die einzige Art, zu veröffentlichen. Die
Reihenfolge ist die Transaktion und nicht verhandelbar:

1. Prüfungen — auf `main`, sauberer Baum, `main` deckungsgleich mit `origin/main`,
   Version größer als die aktuelle, noch nicht auf npm, CI auf HEAD grün, `npm run check`.
2. `CHANGELOG.md`: der Abschnitt `## [Unreleased]` wird zu `## [<version>] - <datum>`.
3. `npm version --no-git-tag-version` — bumped `package.json` **und** `package-lock.json`.
4. Commit `Release v<x.y.z>` und annotierter Tag `v<x.y.z>`, noch lokal.
5. `npm publish`.
6. Erst jetzt der Push: erst `main`, dann der Tag.

Warum der Publish **vor** dem Push kommt: der Fehler, den dieses Paket einmal
hatte, war eine in `package.json` committete und gemeldete Version, die nie
veröffentlicht wurde (0.1.6 lag so Tage). Ein Commit, der `main` noch nicht
verlassen hat, kann zurückgerollt werden, ein Tag auf dem Remote nicht.

Schlägt `npm publish` fehl, macht das Skript `git reset --hard` und löscht den Tag
— `main` bleibt exakt wie vorher, nichts wurde gepusht. **Nicht** mit
`npm publish` und loslaufen; genau das erzeugt den halben Zustand.

Der Commit des Releases entsteht direkt auf `main` und umgeht ein Review
bewusst: er ist mechanisch (Versionsbump, Lockfile, Changelog) und entsteht aus
dem skriptgeprüften Zustand. Codeänderungen gehen weiterhin per PR.

### Bedingungen, an denen das Skript scheitert (bewusst fail-closed)

- `npm` hat 2FA für Schreibzugriffe. `npm publish` gibt eine URL aus, die im Browser
  zu bestätigen ist. Ein Automation-Token würde das umgehen, ist aber nicht eingerichtet.
- Fehlender `## [Unreleased]`-Abschnitt im Changelog → Abbruch. Erst die
  Release-Notes schreiben, dann freigeben.
- `gh` schreibt API-Fehlerkörper auf **stdout**. Das Skript prüft deshalb den
  Exit-Status _und_ die Antwortform und wertet eine leere Check-Liste **nicht**
  als grün.

## Git-Tags

`v0.1.1`, `v0.1.2` und `v0.1.3` fehlen absichtlich und dürfen nicht nachträglich
erfunden werden. Die drei Registry-Versionen haben byte-identisches `src/`, haben
aber zusätzlich ein `src/probe.ts` ausgeliefert, das in **keinem** Commit
existiert. Ein Tag auf `0c1e0e8` würde einen Baum behaupten, der die Datei nicht
enthält. `v0.1.4` und `v0.1.5` sind exakt rekonstruierbar und getaggt.

Ein Tag wird ausschließlich vom Release-Skript erzeugt. Nachträglich Tags zu
setzen ist nur zulässig, wenn der veröffentlichte Inhalt byteweise aus einem
Commit rekonstruierbar ist.

## Runtime-Dateien

| Datei                                        | Zweck                                             |
| -------------------------------------------- | ------------------------------------------------- |
| `~/.config/opencode/model-hide.json`         | Bridge: `hidden: string[]`, `favorite: string`    |
| `~/.config/opencode/model-hide.catalog.json` | wird vom Server-Plugin geschrieben, liest der TUI |

`MODEL_HIDE_BRIDGE_FILE` und `MODEL_HIDE_CATALOG_FILE` überschreiben beide Pfade.
Keine dieser Dateien gehört je committet oder ins Tarball — der `pack`-Job in der
CI prüft, dass im npm-Tarball nichts außer `src/`, `README.md`, `LICENSE` und
`package.json` liegt.

## CI

`.github/workflows/ci.yml`, zwei Jobs: `check` auf Node 22 und 24
(Prettier, Typecheck, Vitest) und `pack` (Tarball-Inhalt). Dependabot meldet
`@opencode/plugin` getrennt von den übrigen devDependencies, weil ein Bruch dort
die CI rot werden lässt.

Kein Branch-Protection-Ruleset und kein Review-Zwang auf diesem Repository. Deshalb
gilt: **Merges bitte ansagen, nicht ungefragt durchführen.** PRs eröffnen und
pushed werden ist unproblematisch.

## Fallen, die bereits einmal zugeschlagen haben

- Ein Hand-Bump in `package.json` ohne Publish — der Grund für 0.1.6. Das Release-Skript
  ist die Antwort darauf.
- Eine handgepflegte Dublette von `src/index.ts` (`model-hide.ts`), die still auf 0.1.5
  stand, während das Paket 0.1.6 war, und die nicht mal den Typecheck bestand.
  Sie ist entfernt, statt sie zu synchronisieren.
- Tests, die nie rot werden, sind wertlos. Die drei Guards in `tests/plugin.test.ts`
  (verstecktes Favorit, deaktivierte Modelle, kein Rewrite bei gleichem Catalog)
  wurden einzeln durch Entfernen der jeweiligen Bedingung als fehlschlagend
  verifiziert. Bei neuen Tests gilt dasselbe.
