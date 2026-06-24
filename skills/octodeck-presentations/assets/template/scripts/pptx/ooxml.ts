// IR + ResolvedTheme → a complete set of OOXML parts (path → content).
// Emits real grouped shapes (p:grpSp), rounded rects, lines, and styled text.
import type { ResolvedTheme, Paint } from './theme.ts'
import type { SlideIR, Shape, Run, Para, Grad, Path } from './ir.ts'

const EMU = (px: number) => Math.round(px * 9525) // 1px @96dpi = 9525 EMU
const SLIDE_W = EMU(1280), SLIDE_H = EMU(720)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

let _id = 1
const nextId = () => ++_id

// ── paint / line ──────────────────────────────────────────────────────────────
function clr(p: Paint): string {
  const a = p.alpha < 100000 ? `<a:alpha val="${p.alpha}"/>` : ''
  return `<a:srgbClr val="${p.hex}">${a}</a:srgbClr>`
}
const fill = (p?: Paint) => (p ? `<a:solidFill>${clr(p)}</a:solidFill>` : '<a:noFill/>')
function gradXml(g: Grad): string {
  const gs = g.stops.map((s) => `<a:gs pos="${Math.max(0, Math.min(100000, Math.round(s.pos * 1000)))}">${clr(s.color)}</a:gs>`).join('')
  const ang = Math.round((((g.angle % 360) + 360) % 360) * 60000)
  return `<a:gradFill><a:gsLst>${gs}</a:gsLst><a:lin ang="${ang}" scaled="1"/></a:gradFill>`
}
const paintFill = (p?: Paint, g?: Grad) => (g ? gradXml(g) : fill(p))
function lnXml(color: Paint, w: number, dash = false, arrow = false): string {
  return `<a:ln w="${EMU(w)}" cap="rnd"><a:solidFill>${clr(color)}</a:solidFill>${dash ? '<a:prstDash val="dash"/>' : '<a:prstDash val="solid"/>'}${arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}</a:ln>`
}

// ── text ──────────────────────────────────────────────────────────────────────
const ALGN = (a?: string) => (a === 'c' ? 'ctr' : a === 'r' ? 'r' : 'l')
function runXml(r: Run): string {
  const sp = r.spacingPt ? ` spc="${Math.round(r.spacingPt * 100)}"` : ''
  return `<a:r><a:rPr lang="en-US" sz="${Math.round(r.sizePt * 100)}" b="${r.bold ? 1 : 0}" i="${r.italic ? 1 : 0}"${sp} dirty="0"><a:solidFill>${clr(r.color)}</a:solidFill><a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/></a:rPr><a:t>${esc(r.text)}</a:t></a:r>`
}
function paraXml(p: Para, fallbackAlign?: string): string {
  const bu = p.bullet
    ? `<a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="&#8226;"/>`
    : '<a:buNone/>'
  const marL = p.bullet ? ' marL="216000" indent="-216000"' : ''
  const ln = p.linePct ? `<a:lnSpc><a:spcPct val="${p.linePct}"/></a:lnSpc>` : ''
  const aft = p.spaceAfterPt ? `<a:spcAft><a:spcPts val="${Math.round(p.spaceAfterPt * 100)}"/></a:spcAft>` : ''
  return `<a:p><a:pPr algn="${ALGN(p.align ?? fallbackAlign)}"${marL}>${ln}${aft}${bu}</a:pPr>${p.runs.map(runXml).join('')}</a:p>`
}
function txBody(s: { runs?: Run[]; paras?: Para[]; align?: string; valign?: string; pad?: number; tight?: boolean }): string {
  const anchor = s.valign === 'm' ? 'ctr' : s.valign === 'b' ? 'b' : 't'
  // tight = a single measured line placed at exact coords: no wrap, no autofit, zero insets
  const wrap = s.tight ? 'none' : 'square'
  const ins = s.tight ? 0 : s.pad != null ? EMU(s.pad) : 36000
  const tins = s.tight ? 0 : s.pad != null ? EMU(s.pad) : 18000
  const autofit = s.tight ? '<a:noAutofit/>' : '<a:normAutofit/>'
  let body: string
  if (s.paras && s.paras.length) body = s.paras.map((p) => paraXml(p, s.align)).join('')
  else if (s.runs && s.runs.length) body = `<a:p><a:pPr algn="${ALGN(s.align)}"><a:buNone/></a:pPr>${s.runs.map(runXml).join('')}</a:p>`
  else body = '<a:p><a:endParaRPr lang="en-US"/></a:p>'
  return `<p:txBody><a:bodyPr wrap="${wrap}" anchor="${anchor}" lIns="${ins}" rIns="${ins}" tIns="${tins}" bIns="${tins}">${autofit}</a:bodyPr><a:lstStyle/>${body}</p:txBody>`
}

// ── geometry / bbox ─────────────────────────────────────────────────────────────
function bbox(s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.kind === 'line') return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1) || 1, h: Math.abs(s.y2 - s.y1) || 1 }
  if (s.kind === 'path') {
    const xs: number[] = [], ys: number[] = []
    for (const g of s.segs) { if (g.c === 'C') { xs.push(g.x1, g.x2, g.x); ys.push(g.y1, g.y2, g.y) } else { xs.push(g.x); ys.push(g.y) } }
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 }
  }
  if (s.kind === 'group') {
    const bs = s.children.map(bbox)
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
    const x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h))
    return { x, y, w: x2 - x, h: y2 - y }
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h }
}
const xfrm = (b: { x: number; y: number; w: number; h: number }, flipH = false, flipV = false) =>
  `<a:xfrm${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}><a:off x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:ext cx="${EMU(b.w)}" cy="${EMU(b.h)}"/></a:xfrm>`

// ── shapes ──────────────────────────────────────────────────────────────────────
function shapeXml(s: Shape): string {
  if (s.kind === 'group') {
    const b = bbox(s), id = nextId()
    const ch = `<a:off x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:ext cx="${EMU(b.w)}" cy="${EMU(b.h)}"/><a:chOff x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:chExt cx="${EMU(b.w)}" cy="${EMU(b.h)}"/>`
    return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${esc(s.name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>${ch}</a:xfrm></p:grpSpPr>${s.children.map(shapeXml).join('')}</p:grpSp>`
  }
  if (s.kind === 'line') {
    const id = nextId(), b = bbox(s)
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(b, s.x2 < s.x1, s.y2 < s.y1)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lnXml(s.color, s.w, s.dash, s.arrow)}</p:spPr></p:cxnSp>`
  }
  if (s.kind === 'path') {
    const id = nextId(), b = bbox(s)
    const W = EMU(b.w), H = EMU(b.h)
    const P = (x: number, y: number) => `<a:pt x="${EMU(x - b.x)}" y="${EMU(y - b.y)}"/>`
    const cmds = s.segs.map((g) => g.c === 'M' ? `<a:moveTo>${P(g.x, g.y)}</a:moveTo>` : g.c === 'L' ? `<a:lnTo>${P(g.x, g.y)}</a:lnTo>` : `<a:cubicBezTo>${P(g.x1, g.y1)}${P(g.x2, g.y2)}${P(g.x, g.y)}</a:cubicBezTo>`).join('') + (s.closed ? '<a:close/>' : '')
    const geom = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="${W}" b="${H}"/><a:pathLst><a:path w="${W}" h="${H}"${s.fill || s.grad ? '' : ' fill="none"'}>${cmds}</a:path></a:pathLst></a:custGeom>`
    const lineX = s.line ? lnXml(s.line.color, s.line.w, s.line.dash, s.line.arrow) : '<a:ln><a:noFill/></a:ln>'
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="path"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${EMU(b.x)}" y="${EMU(b.y)}"/><a:ext cx="${W}" cy="${H}"/></a:xfrm>${geom}${paintFill(s.fill, s.grad)}${lineX}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
  }
  // rect or text → p:sp
  const id = nextId()
  const isRect = s.kind === 'rect'
  const prst = isRect ? (s.prst ?? (s.rx ? 'roundRect' : 'rect')) : 'rect'
  const geom = prst === 'roundRect'
    ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round(((isRect && s.rx ? s.rx : 8) / Math.min(s.w, s.h)) * 100000))}"/></a:avLst></a:prstGeom>`
    : `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>`
  const fillX = isRect ? paintFill(s.fill, s.grad) : '<a:noFill/>'
  const lineX = isRect && s.line ? lnXml(s.line.color, s.line.w, s.line.dash) : ''
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${s.kind}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(s)}${geom}${fillX}${lineX}</p:spPr>${txBody(s as any)}</p:sp>`
}

function slideXml(slide: SlideIR, inheritBg = false): string {
  _id = 1
  const tree = slide.shapes.map(shapeXml).join('')
  // rich themes: slide omits its own <p:bg> so the baked master backdrop shows through.
  const bg = inheritBg ? '' : `<p:bg><p:bgPr>${fill(slide.bg)}<a:effectLst/></p:bgPr></p:bg>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

// ── static parts (theme / master / layout / presentation / content-types) ─────
function themeXml(t: ResolvedTheme): string {
  const c = t.color, hx = (p: Paint) => p.hex
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Octodeck ${esc(t.id)}"><a:themeElements><a:clrScheme name="Octodeck"><a:dk1><a:srgbClr val="${hx(c.bg)}"/></a:dk1><a:lt1><a:srgbClr val="${hx(c.fg)}"/></a:lt1><a:dk2><a:srgbClr val="${hx(c.surface ?? c.bg)}"/></a:dk2><a:lt2><a:srgbClr val="${hx(c['fg-muted'] ?? c.fg)}"/></a:lt2><a:accent1><a:srgbClr val="${hx(c.accent)}"/></a:accent1><a:accent2><a:srgbClr val="${hx(c['accent-2'] ?? c.accent)}"/></a:accent2><a:accent3><a:srgbClr val="${hx(c.accent)}"/></a:accent3><a:accent4><a:srgbClr val="${hx(c.accent)}"/></a:accent4><a:accent5><a:srgbClr val="${hx(c.accent)}"/></a:accent5><a:accent6><a:srgbClr val="${hx(c.accent)}"/></a:accent6><a:hlink><a:srgbClr val="${hx(c.accent)}"/></a:hlink><a:folHlink><a:srgbClr val="${hx(c.accent)}"/></a:folHlink></a:clrScheme><a:fontScheme name="Octodeck"><a:majorFont><a:latin typeface="${esc(t.font.heading)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(t.font.body)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Octodeck"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

function masterXml(bgEmbedRId?: string): string {
  // rich themes embed the baked aurora PNG (stretched full-bleed); else a solid dk1.
  const bgPr = bgEmbedRId
    ? `<p:bgPr><a:blipFill><a:blip r:embed="${bgEmbedRId}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr>`
    : `<p:bgPr><a:solidFill><a:schemeClr val="dk1"/></a:solidFill><a:effectLst/></p:bgPr>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg>${bgPr}</p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
}

const layoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>`

export interface EmbedFont { typeface: string; regular: Buffer; bold?: Buffer }

function presentationXml(n: number, fonts: EmbedFont[]): string {
  const sldIds = Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')
  let fi = 0
  const fontLst = fonts.length
    ? `<p:embeddedFontLst>${fonts.map((f) => {
        const reg = `<p:regular r:id="rIdF${++fi}"/>`
        const bold = f.bold ? `<p:bold r:id="rIdF${++fi}"/>` : ''
        return `<p:embeddedFont><p:font typeface="${esc(f.typeface)}"/>${reg}${bold}</p:embeddedFont>`
      }).join('')}</p:embeddedFontLst>`
    : ''
  const embedAttr = fonts.length ? ' embedTrueTypeFonts="1" saveSubsetFonts="0"' : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"${embedAttr}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/>${fontLst}</p:presentation>`
}

export function buildPptx(slides: SlideIR[], t: ResolvedTheme, backdrop?: Buffer, fonts: EmbedFont[] = []): Record<string, string | Buffer> {
  const files: Record<string, string | Buffer> = {}
  const rich = t.backdrop.rich && !!backdrop // bake aurora as master bg image
  // font parts (raw TTF as .fntdata) + their presentation relationships
  const fontParts: { rid: string; target: string; buf: Buffer }[] = []
  let fk = 0, fr = 0
  for (const f of fonts) {
    for (const buf of [f.regular, f.bold].filter(Boolean) as Buffer[]) {
      fk++; const name = `font${fk}.fntdata`
      fontParts.push({ rid: `rIdF${++fr}`, target: `fonts/${name}`, buf })
      files[`ppt/fonts/${name}`] = buf
    }
  }
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${rich ? '<Default Extension="png" ContentType="image/png"/>' : ''}${fontParts.length ? '<Default Extension="fntdata" ContentType="application/x-fontdata"/>' : ''}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  files['ppt/presentation.xml'] = presentationXml(slides.length, fonts)
  files['ppt/_rels/presentation.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdM" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}${fontParts.map((f) => `<Relationship Id="${f.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="${f.target}"/>`).join('')}</Relationships>`
  files['ppt/theme/theme1.xml'] = themeXml(t)
  files['ppt/slideMasters/slideMaster1.xml'] = masterXml(rich ? 'rIdBg' : undefined)
  if (rich) files['ppt/media/image1.png'] = backdrop!
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>${rich ? '<Relationship Id="rIdBg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' : ''}</Relationships>`
  files['ppt/slideLayouts/slideLayout1.xml'] = layoutXml
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s, rich)
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  })
  return files
}
