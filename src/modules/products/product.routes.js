import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import * as productController from './product.controller.js';
import {
  createProductSchema,
  updateProductSchema,
  idParamSchema,
  listProductsSchema,
  bulkActionSchema,
} from './product.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

// Small .xlsx uploads held in memory (parsed, never written to disk).
const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers send this for .xlsx
]);
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = XLSX_MIMES.has(file.mimetype) || /\.xlsx$/i.test(file.originalname);
    cb(ok ? null : new ApiError(400, 'Upload an .xlsx spreadsheet'), ok);
  },
});

// Bulk import/export — declared before `/:id` so `/export` isn't read as an id.
router.get('/export', ...adminOnly, productController.exportXlsx);
router.get('/import/template', ...adminOnly, productController.importTemplate);
router.post(
  '/import',
  ...adminOnly,
  (req, res, next) =>
    xlsxUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new ApiError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Spreadsheet must be 5 MB or smaller' : err.message));
      }
      next(err);
    }),
  productController.importXlsx
);

router.post('/bulk', ...adminOnly, validate(bulkActionSchema), productController.bulkAction);

router.get('/', validate(listProductsSchema), productController.list);
router.get('/:id', validate(idParamSchema), productController.getById);

router.post('/', ...adminOnly, validate(createProductSchema), productController.create);
router.patch('/:id', ...adminOnly, validate(updateProductSchema), productController.update);
router.delete('/:id', ...adminOnly, validate(idParamSchema), productController.remove);

export default router;
