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
