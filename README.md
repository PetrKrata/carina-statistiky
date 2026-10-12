# Carina – statistiky pořadů

Statistický dashboard pro proběhlé pořady v Carině.

## Funkce

- období **od–do** po měsících,
- filtry **Vše / modré školní / hnědé veřejné**,
- jen **proběhlé projekce**,
- souhrn: projekce, tituly, návštěvníci, průměr, medián, obsazenost,
- srovnání modrých a hnědých,
- tabulka pořadů s řazením,
- detail pořadu: počet projekcí, návštěvnost, min/max, první/poslední projekce,
- rozpad podle dnů v týdnu a časů,
- měsíční trend,
- heatmapa den × čas,
- export CSV.

## Princip načítání

Skript běží přímo na stránce Cariny, aby mohl použít aktuální přihlášení uživatele. Měsíční stránky načítá přes `fetch(..., credentials: 'same-origin')` a kapacity přes `POST /!capacities@schedule`.

Typ pořadu se rozlišuje barvou:

- modrá `#000075` → školní/dětské,
- hnědá `#800000` → veřejnost/dospělí.

Počet návštěvníků je v této verzi odvozen jako:

`návštěvníci = total - available`

Proto dashboard v poznámce uvádí, že jde o **evidovanou návštěvnost/obsazená místa**. Pokud Carina poskytuje samostatné pole skutečně odbavených návštěvníků, je vhodné později přepnout výpočet na něj.

## Nasazení na GitHub Pages

1. Nahraj všechny soubory do jednoho repozitáře.
2. V GitHubu otevři **Settings → Pages**.
3. Publikuj větev `main` z kořenové složky.
4. Otevři vzniklou GitHub Pages stránku.
5. Přetáhni tlačítko **Statistiky Carina** do lišty záložek.

`index.html` generuje bookmarklet automaticky podle své vlastní adresy, takže do souborů není potřeba ručně doplňovat uživatelské jméno ani název repozitáře.

## Soubory

- `index.html` – instalační stránka,
- `app.js` – automaticky vytvoří bookmarklet,
- `style.css` – vzhled dashboardu,
- `carina-statistiky.js` – vlastní načítání dat a statistiky,
- `bookmarklet.txt` – obecná šablona pro ruční instalaci.
