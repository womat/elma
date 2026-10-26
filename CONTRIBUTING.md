# Mitmachen

Danke für dein Interesse an ELMA!

## Ideen und Fehler

- **Fehler:** bitte als [Issue](https://github.com/womat/elma/issues/new/choose) mit Version, Gerät/Browser und Schritten zum Nachvollziehen.
- **Ideen:** ebenfalls als Issue. Am besten mit dem Anwendungsfall, also was du erreichen willst.
- **Sicherheitslücken:** nicht als Issue, siehe [SECURITY.md](SECURITY.md).

Deutsch und Englisch sind beide in Ordnung.

## Pull Requests

Bei größeren Änderungen bitte vorher ein Issue aufmachen, damit wir die Richtung abstimmen können.

Entwicklung und Tests stehen im [README](README.md#entwicklung):

```bash
pnpm install
pnpm test
pnpm typecheck
```

- Code, Kommentare und Texte in der App sind auf Deutsch.
- Neue Funktionen bitte mit Tests (Vitest).
- Commit-Betreff englisch nach [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docu:`, `chore:`, `refactor:`).
  Daraus entstehen die Release-Notes; [CHANGELOG.md](CHANGELOG.md) wird seit 0.11.1 nicht mehr ergänzt.

## Rechte an Beiträgen

ELMA steht unter der [PolyForm Noncommercial License 1.0.0](LICENSE.md).
Mit einem Pull Request bestätigst du, dass du den Beitrag selbst erstellt hast und ihn einreichen darfst.
Du stellst ihn unter dieser Lizenz zur Verfügung und räumst Wolfgang Mathe zusätzlich das unbefristete, unwiderrufliche Recht ein,
den Beitrag als Teil von ELMA auch unter anderen Lizenzbedingungen zu nutzen und weiterzugeben, auch kommerziell.
Dein Urheberrecht bleibt davon unberührt.
