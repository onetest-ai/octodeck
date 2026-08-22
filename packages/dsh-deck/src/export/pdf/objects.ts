/**
 * Escape a PDF literal string.
 *
 * Only three characters are special inside `( … )`. Text drawn through an
 * embedded CID font uses hex strings instead, so this is for names and
 * metadata rather than slide content.
 * @param text - the raw text.
 * @returns the parenthesised, escaped literal.
 */
export function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, ch => `\\${ch}`)})`
}

/**
 * Assemble a PDF file: indirect objects, a cross-reference table, a trailer.
 *
 * Hand-rolled because the writer needs only these primitives, and the whole
 * point of this export path is that a deck leaves the harness without pulling
 * a browser or a document toolkit into a plugin install.
 *
 * Everything is latin1 on the way out: PDF syntax is byte-oriented, and binary
 * payloads — font programs above all — must survive unchanged.
 */
export class PdfBuilder {
  private readonly objects: Buffer[] = []

  /**
   * Append an indirect object.
   * @param body - the object body, without the `N 0 obj` wrapper.
   * @returns the object number, for use in an `N 0 R` reference.
   */
  add(body: string | Buffer): number {
    this.objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body)
    return this.objects.length
  }

  /**
   * Replace a previously added object's body.
   *
   * A `/Pages` node and its `/Page` children reference each other, so one of
   * the two must be reserved before its contents are known. Reserving the
   * parent and filling it in afterwards keeps object numbering sequential,
   * which the xref table depends on.
   * @param ref - the object number returned by {@link add}.
   * @param body - the replacement body.
   */
  replace(ref: number, body: string | Buffer): void {
    this.objects[ref - 1] = typeof body === 'string' ? Buffer.from(body, 'latin1') : body
  }

  /**
   * Append a stream object, filling in `/Length` from the payload.
   * @param dict - the complete stream dictionary; `/Length` is spliced in.
   * @param data - the stream payload.
   * @returns the object number.
   */
  stream(dict: string, data: Buffer | string): number {
    const payload = typeof data === 'string' ? Buffer.from(data, 'latin1') : data
    const withLength = `${dict.replace(/>>\s*$/, '')} /Length ${payload.length} >>`
    return this.add(Buffer.concat([
      Buffer.from(`${withLength}\nstream\n`, 'latin1'),
      payload,
      Buffer.from('\nendstream', 'latin1'),
    ]))
  }

  /**
   * Serialise the whole file.
   * @param rootRef - the object number of the document catalogue.
   * @returns the complete PDF.
   */
  build(rootRef: number): Buffer {
    // The binary comment on line 2 is what marks the file as binary to tools
    // that would otherwise mangle line endings in transit.
    const header = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')
    const chunks: Buffer[] = [header]
    const offsets: number[] = []
    let at = header.length
    this.objects.forEach((body, index) => {
      const chunk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ])
      offsets.push(at)
      chunks.push(chunk)
      at += chunk.length
    })
    const count = this.objects.length + 1
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
    xref += `trailer\n<< /Size ${count} /Root ${rootRef} 0 R >>\nstartxref\n${at}\n%%EOF\n`
    chunks.push(Buffer.from(xref, 'latin1'))
    return Buffer.concat(chunks)
  }
}
