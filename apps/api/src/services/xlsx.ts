import { strFromU8, unzipSync } from 'fflate';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) =>
    code[0] === '#'
      ? String.fromCodePoint(code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : (ENTITIES[code] ?? whole),
  );

/** Text of all <t> runs inside an element (shared string or inline string). */
const runsText = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');

/** "C12" → 2 (zero-based column). */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/**
 * Most the read parts may take once unpacked. An MT5 report of years of trades is a few MB; a tiny
 * archive that unpacks to gigabytes (a "zip bomb") would otherwise exhaust the server's memory.
 */
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/**
 * Cell texts of every worksheet in an .xlsx file, row by row, with empty cells kept in place.
 * Enough for reading exported reports; formulas and styles are ignored.
 */
export function xlsxRows(bytes: Uint8Array): string[][] {
  let unpacked = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      const wanted = f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name);
      // fflate unpacks each file into a buffer of its declared size, so the declared sizes bound the memory.
      if (wanted && (unpacked += f.originalSize) > MAX_UNPACKED_BYTES) throw new Error('xlsx too large when unpacked');
      return wanted;
    },
  });
  const sharedXml = files['xl/sharedStrings.xml'];
  const shared = sharedXml ? [...strFromU8(sharedXml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]!)) : [];
  const sheets = Object.keys(files)
    .filter((name) => name.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const rows: string[][] = [];
  for (const sheet of sheets) {
    const xml = strFromU8(files[sheet]!);
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1]!;
        const body = cell[2] ?? '';
        const index = columnIndex(attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? '') ;
        const type = attrs.match(/\bt="(\w+)"/)?.[1];
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value =
          type === 's' ? (shared[Number(raw)] ?? '') : type === 'inlineStr' ? runsText(body) : raw != null ? decodeXml(raw) : '';
        while (cells.length < index) cells.push('');
        cells[index >= 0 ? index : cells.length] = value;
      }
      rows.push(cells);
    }
  }
  return rows;
}

/** .xlsx files are zip archives: they start with "PK". */
export const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;
