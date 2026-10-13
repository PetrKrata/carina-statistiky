# Statistiky pořadů Carina – v4

Dashboard se spouští uvnitř přihlášené Cariny a načítá proběhlé modré (školní) a hnědé (veřejné) pořady.

## Co je nové ve v4

- Historická databáze se při načtení vždy bere od **června 2025** do aktuálního měsíce.
- Pole **Od měsíce / Do měsíce** už slouží jako filtr zobrazení. Po prvním načtení lze období měnit bez nového stahování celé historie.
- Odstraněn blok **Nejvyšší obsazenost**.
- Hlavní tabulka rozlišuje:
  - **Projekcí v období** – podle právě zvoleného filtru data,
  - **Projekcí celkem** – od června 2025,
  - **První vysílání** a **Poslední vysílání** – z celé dostupné historie.
- **Historie počtu projekcí** je samostatný blok:
  - standardně posledních 12 měsíců,
  - po rozbalení všechny měsíce od 06/2025,
  - zobrazuje i měsíce s nulovým počtem projekcí.
- Detail pořadu zůstává historický a používá všechna načtená data daného pořadu.

## Soubory

- `carina-statistiky.js` – hlavní dashboard a načítání Cariny
- `style.css` – vzhled
- `bookmarklet.txt` – kód záložky
- `index.html`, `app.js` – pomocná stránka pro instalaci/spuštění

## Důležitá poznámka k návštěvnosti

Návštěvnost je zatím odvozena jako `kapacita - volná místa` z kapacitního rozhraní Cariny. Je proto vhodné údaj chápat jako evidovaná obsazená místa, dokud nebude potvrzeno, že přesně odpovídá skutečně odbaveným návštěvníkům.

## Diagnostická verze návštěvnosti

V detailu pořadu se u jednotlivých projekcí zobrazují také surové hodnoty z Cariny: `sold`, `reserved`, `locked`, `blocked`, `available`, `total` a `mode`. Vedle nich je efektivní kapacita (max. 278) a současný výpočet návštěvnosti. Cílem je ověřit, které pole nejlépe odpovídá skutečné návštěvnosti historických pořadů.

Graf „Nejnavštěvovanější pořady“ při filtru Všechny používá modrou pro školní pořady a hnědou pro veřejnost; barvy jsou nastavené přímo na prvcích, aby je nepřepsalo CSS Cariny.
