import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

// Uploaded files live on the local disk under server/uploads/ and are served
// back statically (see app.js). Swap this for S3 / a CDN later without
// touching callers — the response is always { url }.
const UPLOAD_DIR = path.join(fileURLToPath(new URL('../../../uploads', import.meta.url)));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new ApiError(400, 'Only image files (jpg, png, webp, gif, avif) are allowed'));
  },
});

const router = Router();

// POST /uploads — admin-only, single file under the `image` field.
router.post(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  (req, res, next) =>
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new ApiError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : err.message));
      }
      if (err) return next(err);
      next();
    }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file was uploaded (field name must be "image")');
    const url = `${env.serverPublicUrl}/uploads/${req.file.filename}`;
    res.status(201).json({ url, filename: req.file.filename, size: req.file.size });
  })
);

// POST /uploads/avatar — any signed-in user, for their own profile picture (2 MB max).
const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ALLOWED_MIME.has(file.mimetype) ? cb(null, true) : cb(new ApiError(400, "Only image files are allowed")),
});

router.post(
  '/avatar',
  authenticate,
  (req, res, next) =>
    avatarUpload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new ApiError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 2 MB or smaller' : err.message));
      }
      if (err) return next(err);
      next();
    }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file was uploaded (field name must be "image")');
    res.status(201).json({ url: `${env.serverPublicUrl}/uploads/${req.file.filename}` });
  })
);

export default router;
export { UPLOAD_DIR };
