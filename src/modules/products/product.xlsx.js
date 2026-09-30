import ExcelJS from 'exceljs';

// Column contract for the products import/export sheet. `key` is the internal
// field; `header` is what the admin sees in row 1. Import maps by header text
// (case-insensitive), so column order in an uploaded file doesn't matter.
export const COLUMNS = [
  { key: 'id', header: 'id', width: 8, note: 'Leave blank to create. Fill in to update an existing product.' },
  { key: 'name', header: 'name', width: 28 },
  { key: 'slug', header: 'slug', width: 24, note: 'Optional — auto-generated from name if blank.' },
  { key: 'description', header: 'description', width: 40 },
  { key: 'price', header: 'price', width: 10 },
  { key: 'compareAtPrice', header: 'compareAtPrice', width: 14 },
  { key: 'sku', header: 'sku', width: 14 },
  { key: 'type', header: 'type', width: 18, note: 'ONE_TIME | SUBSCRIPTION_ITEM | ACCESSORY | MERCHANDISE | GIFT_MEMBERSHIP' },
  { key: 'isFeatured', header: 'isFeatured', width: 11, note: 'TRUE / FALSE' },
  { key: 'isActive', header: 'isActive', width: 10, note: 'TRUE / FALSE' },
  { key: 'categories', header: 'categories', width: 26, note: 'Comma-separated category names. Missing ones are created.' },
  { key: 'imageUrls', header: 'imageUrls', width: 40, note: 'Comma-separated image URLs.' },
  { key: 'stockQty', header: 'stockQty', width: 10 },
  { key: 'lowStockThreshold', header: 'lowStockThreshold', width: 16 },
];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

// Two illustrative rows for the downloadable template.
export const TEMPLATE_ROWS = [
  {
    id: '',
    name: 'Corona Especial',
    slug: '',
    description: 'A smooth, medium-bodied corona — cedar and cream with a clean finish.',
    price: 14.5,
    compareAtPrice: 18,
    sku: 'PREME-CE',
    type: 'ONE_TIME',
    isFeatured: 'FALSE',
    isActive: 'TRUE',
    categories: 'Premium Cigars, Coronas',
    imageUrls: 'https://example.com/corona-1.jpg, https://example.com/corona-2.jpg',
    stockQty: 40,
    lowStockThreshold: 10,
  },
  {
    id: '',
    name: 'Reserve Humidor',
    slug: 'reserve-humidor',
    description: 'Spanish-cedar humidor, 50-count, with hygrometer.',
    price: 129,
    compareAtPrice: '',
    sku: 'PREME-HUM50',
    type: 'ACCESSORY',
    isFeatured: 'TRUE',
    isActive: 'TRUE',
    categories: 'Accessories',
    imageUrls: '',
    stockQty: 12,
    lowStockThreshold: 3,
  },
];

function styleSheet(ws) {
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function attachNotes(ws) {
  COLUMNS.forEach((col, i) => {
    if (col.note) ws.getCell(1, i + 1).note = col.note;
  });
}

async function workbookBuffer(wb) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// Full catalog export — `rows` is an array of plain objects keyed by COLUMNS.key.
export async function buildProductsWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'S.PREME Admin';
  wb.created = new Date();
  const ws = wb.addWorksheet('Products');
  styleSheet(ws);
  attachNotes(ws);
  rows.forEach((row) => ws.addRow(row));
  return workbookBuffer(wb);
}

// Blank template: header + the two example rows, plus a short instructions sheet.
export async function buildTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'S.PREME Admin';
  const ws = wb.addWorksheet('Products');
  styleSheet(ws);
  attachNotes(ws);
  TEMPLATE_ROWS.forEach((row) => ws.addRow(row));

  const guide = wb.addWorksheet('How to use');
  guide.columns = [{ width: 20 }, { width: 90 }];
  guide.addRow(['Column', 'Notes']).font = { bold: true };
  COLUMNS.forEach((c) => guide.addRow([c.header, c.note || '']));
  guide.addRow([]);
  guide.addRow(['Matching', 'A row updates an existing product when "id" is filled, else when "sku" matches, else when "slug" matches. Otherwise a new product is created.']);
  guide.addRow(['Delete the example rows', 'The two sample rows in the Products sheet are just examples — replace or remove them before importing.']);

  return workbookBuffer(wb);
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.hyperlink !== undefined) return String(value.text ?? value.hyperlink);
    if (value.result !== undefined) return String(value.result);
    if (value instanceof Date) return value.toISOString();
    return '';
  }
  return String(value);
}

// Reads the first worksheet of an uploaded .xlsx into
// [{ rowNumber, <key>: <trimmed string>, ... }]. Header row is matched by text
// so column order / extra columns are tolerated. Fully-blank rows are dropped.
export async function parseProductsWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('That file could not be read as an Excel workbook (.xlsx).');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');

  const headerRow = ws.getRow(1);
  const headerToCol = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = cellText(cell.value).trim().toLowerCase();
    if (key) headerToCol.set(key, colNumber);
  });

  const knownByLower = new Map(COLUMNS.map((c) => [c.header.toLowerCase(), c.key]));
  const missing = COLUMNS.filter((c) => c.key !== 'compareAtPrice' && !headerToCol.has(c.header.toLowerCase()));
  // Only `name` and `price` are truly required as columns.
  const required = ['name', 'price'];
  const missingRequired = required.filter((h) => !headerToCol.has(h));
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required column${missingRequired.length > 1 ? 's' : ''}: ${missingRequired.join(', ')}. Download the template for the correct format.`
    );
  }

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = { rowNumber };
    let hasAny = false;
    for (const [lowerHeader, colNumber] of headerToCol.entries()) {
      const key = knownByLower.get(lowerHeader);
      if (!key) continue; // ignore unknown columns
      const text = cellText(row.getCell(colNumber).value).trim();
      data[key] = text;
      if (text) hasAny = true;
    }
    if (hasAny) rows.push(data);
  });

  return { rows, ignoredColumns: [...headerToCol.keys()].filter((h) => !knownByLower.has(h)), missing };
}
