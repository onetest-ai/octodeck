# Octodeck (project template)

Bundled by the `octodeck-presentations` skill. To use:

```bash
npm install
npx playwright install chromium      # for capture + pdf/pptx export
npm run dev                          # http://localhost:9001
npm run new:deck -- <name>           # scaffold a deck → /<name>.html
# export:
npm run build:pdf  -- octo-glass --deck <name>
npm run build:pptx -- octo-glass --deck <name>
DECK=<name> npm run build:single
```

See the skill's SKILL.md and references/ for the deck-building methodology.
