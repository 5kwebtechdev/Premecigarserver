import { asyncHandler } from '../../../utils/asyncHandler.js';
import * as dashboardService from './dashboard.service.js';

export const getMetrics = asyncHandler(async (req, res) => {
  res.json(await dashboardService.getMetrics());
});
