// ============================================================
// 药箱拆分模块
//
// 将总药液拆分成整箱和尾箱，按同一比例计算每箱原药与稀释剂
// 示例：总药液37L、药箱10L、药:水=1:4
//   3箱 × 10L：每箱原药2L + 水8L
//   最后1箱 × 7L：原药1.4L + 水5.6L
// ============================================================

import type { TankSplit } from '@/types';

/**
 * 计算药箱拆分
 *
 * @param totalSolutionMl 总药液量 (mL)
 * @param totalRawDrugMl  总原药量 (mL)
 * @param totalDiluentMl  总稀释剂量 (mL)
 * @param tankCapacityL   单箱容量 (L)
 * @returns 药箱拆分数组
 */
export function calculateTankSplit(
  totalSolutionMl: number,
  totalRawDrugMl: number,
  totalDiluentMl: number,
  tankCapacityL: number
): TankSplit[] {
  const tanks: TankSplit[] = [];
  const tankCapacityMl = tankCapacityL * 1000;

  if (tankCapacityMl <= 0) return tanks;

  // 计算原药在总药液中的比例
  const drugRatio = totalRawDrugMl / totalSolutionMl;
  const diluentRatio = totalDiluentMl / totalSolutionMl;

  let remaining = totalSolutionMl;
  let tankIndex = 1;

  while (remaining > 0) {
    const currentTankMl = Math.min(remaining, tankCapacityMl);
    const isRemainder = remaining < tankCapacityMl;

    tanks.push({
      tankIndex,
      solutionL: currentTankMl / 1000,
      drugL: (currentTankMl * drugRatio) / 1000,
      diluentL: (currentTankMl * diluentRatio) / 1000,
      isRemainder,
    });

    remaining -= currentTankMl;
    tankIndex++;
  }

  return tanks;
}
