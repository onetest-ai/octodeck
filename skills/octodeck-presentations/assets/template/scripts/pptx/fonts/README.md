# Bundled fonts

These TTFs are committed so the PPTX exporter can embed them without a system
install (see [`../README.md`](../README.md)).

| Family | Source | License |
|---|---|---|
| Geist, Geist Mono | [Vercel](https://vercel.com/font) | SIL Open Font License 1.1 — see [`OFL.txt`](OFL.txt) |
| Inter | [rsms/inter](https://github.com/rsms/inter) v4.1 | SIL Open Font License 1.1 — see [`OFL.txt`](OFL.txt) |
| Switzer | [Fontshare](https://www.fontshare.com/fonts/switzer) (Indian Type Foundry) | ITF Free Font License |

The SIL OFL requires its license text to accompany the font files, which is
why `OFL.txt` sits beside them. Geist and Inter are both OFL 1.1, so one copy
of the license body serves both; each project's copyright line is listed at
the top.

Inter covers the `commit` and `protocol` themes and `primer`'s body text.
Before it was bundled, those themes exported with a substituted face — the
PPTX exporter warned `font not embedded` and carried on.

**Switzer is redistributed under Fontshare's free license, whose terms differ
from the OFL.** If this repository is made public, confirm that redistributing
the Switzer TTFs — rather than having users download them from Fontshare — is
permitted under the license version that applies. The exporter works without
them; a theme that names Switzer would fall back to its next family.
