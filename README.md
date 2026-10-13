# Statistiky pořadů Carina – v10

Dashboard pro statistiky proběhlých školních (modrých) a veřejných (hnědých) pořadů v Carině.

## Změny v10

- návštěvnost se počítá z pole `sold` vráceného Carinou, nikoli z `total - available`,
- hodnota návštěvnosti je bezpečnostně omezena na maximálně 278 míst,
- obsazenost = návštěvnost (`sold`) / efektivní kapacita,
- historická kapacita 290 se pro výpočty omezuje na 278,
- diagnostická tabulka v detailu pořadu zůstává k dispozici, ale je standardně sbalená,
- graf „Nejnavštěvovanější pořady“ při filtru Všechny výrazně odlišuje školní (modré) a veřejné (hnědé) pořady barevným pruhem i štítkem,
- zachovány jsou předchozí funkce: historie od 06/2025, měnitelné období, rozbalovací měsíční historie a zvýraznění tří nejlepších hodnot v tabulce Den × čas.

## Důležitá interpretace

Pole `sold` je nejlepší dostupný údaj Cariny pro evidovanou návštěvnost/prodaná místa. Nemusí být totožné s fyzickým počtem lidí, kteří skutečně prošli do sálu.

## Verze v11
- Statistiky zahrnují pouze projekce do včerejšího dne včetně. Dnešní projekce se nezapočítávají ani po skončení, takže se výsledky během dne nemění.
- U žebříčku „Nejnavštěvovanější pořady“ je typ pořadu zobrazen pouze jako text `(školní)` / `(veřejnost)` bez barevné bubliny; barevné rozlišení názvu a sloupce zůstává.

## v14 – zvolené období v detailu
- Detail konkrétního pořadu respektuje datumový filtr Od–Do z hlavního přehledu.
- KPI, rozpad podle dnů/časů, měsíční grafy, heatmapa a seznam projekcí jsou jen za zvolené období.
- První a poslední vysílání zůstávají informací z celé dostupné historie od 1. 6. 2025.
