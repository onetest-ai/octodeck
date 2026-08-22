# Bundled fonts

These TTFs are committed so the PPTX exporter can embed them without a system
install (see [`../README.md`](../README.md)).

| Family | Source | License |
|---|---|---|
| Geist, Geist Mono | [Vercel](https://vercel.com/font) | SIL Open Font License 1.1 — see [`OFL.txt`](OFL.txt) |
| Switzer | [Fontshare](https://www.fontshare.com/fonts/switzer) (Indian Type Foundry) | ITF Free Font License |

The SIL OFL requires its license text to accompany the font files, which is
why `OFL.txt` — the license as published with Geist, including its copyright
line — sits beside them.

**Switzer is redistributed under Fontshare's free license, whose terms differ
from the OFL.** If this repository is made public, confirm that redistributing
the Switzer TTFs — rather than having users download them from Fontshare — is
permitted under the license version that applies. The exporter works without
them; a theme that names Switzer would fall back to its next family.
