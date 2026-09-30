import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import * as productService from './product.service.js';
import {
  buildProductsWorkbook,
  buildTemplateWorkbook,
  parseProductsWorkbook,
} from './product.xlsx.js';

function sendWorkbook(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

export const list = asyncHandler(async (req, res) => {
  res.json(await productService.list(req.query));
});

export const getById = asyncHandler(async (req, res) => {
  res.json({ product: await productService.getById(Number(req.params.id)) });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ product: await productService.create(req.body) });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ product: await productService.update(Number(req.params.id), req.body) });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await productService.remove(Number(req.params.id));
  res.status(200).json(result);
});

export const bulkAction = asyncHandler(async (req, res) => {
  const result = await productService.bulkAction(req.body.action, req.body.ids);
  res.json(result);
});

// ── Bulk Excel import / export ───────────────────────────
export const exportXlsx = asyncHandler(async (req, res) => {
  const rows = await productService.getExportRows();
  const buffer = await buildProductsWorkbook(rows);
  const date = new Date().toISOString().slice(0, 10);
  sendWorkbook(res, buffer, `products-${date}.xlsx`);
});

export const importTemplate = asyncHandler(async (req, res) => {
  const buffer = await buildTemplateWorkbook();
  sendWorkbook(res, buffer, 'products-import-template.xlsx');
});

export const importXlsx = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach an .xlsx file in the "file" field');
  let parsed;
  try {
    parsed = await parseProductsWorkbook(req.file.buffer);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }
  if (parsed.rows.length === 0) throw ApiError.badRequest('No data rows found in the sheet');

  const summary = await productService.bulkImport(parsed.rows, { actorUserId: req.user.id });
  summary.ignoredColumns = parsed.ignoredColumns;
  res.json(summary);
});
