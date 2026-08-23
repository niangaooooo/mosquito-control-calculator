// ============================================================
// 单位换算模块
// 所有浓度内部标准化为 mg/mL (液体) 或 mg/g (固体)
// ============================================================

import type { ConcentrationUnit, ActiveIngredient } from '@/types';

/**
 * 将有效成分浓度标准化为 mg/mL (液体) 或 mg/g (固体)
 *
 * 换算规则：
 * - g/L      → 1000 mg / 1000 mL = 1 mg/mL  (即 g/L == mg/mL 数值相同)
 * - mg/mL    → 直接使用
 * - %        → 需要确认是 w/v 还是 w/w，此处默认按 w/v (g/100mL) 处理
 *              5% = 5 g/100mL = 5000 mg/100mL = 50 mg/mL
 * - g/kg     → 1000 mg / 1000 g = 1 mg/g  (即 g/kg == mg/g 数值相同)
 * - mg/g     → 直接使用
 *
 * @param value 浓度数值
 * @param unit  浓度单位
 * @param isLiquid 是否为液体制剂（默认 true）
 * @returns { value: number, unit: 'mg/mL' | 'mg/g' }
 */
export function normalizeConcentration(
  value: number,
  unit: ConcentrationUnit,
  isLiquid: boolean = true
): { value: number; unit: 'mg/mL' | 'mg/g' } {
  const targetUnit = isLiquid ? 'mg/mL' : 'mg/g';

  switch (unit) {
    case 'g/L':
      // g/L = 1000mg / 1000mL = 1 mg/mL (数值相同)
      return { value, unit: targetUnit };

    case 'mg/mL':
      if (!isLiquid) {
        throw new Error('mg/mL 单位仅适用于液体制剂');
      }
      return { value, unit: 'mg/mL' };

    case '%':
      // 默认按 w/v (g/100mL) 处理
      // 5% = 5 g/100mL = 5000 mg/100mL = 50 mg/mL
      if (isLiquid) {
        return { value: value * 10, unit: 'mg/mL' };
      }
      // w/w: 5% = 5 g/100g = 5000 mg/100g = 50 mg/g
      return { value: value * 10, unit: 'mg/g' };

    case 'g/kg':
      // g/kg = 1000mg / 1000g = 1 mg/g (数值相同)
      return { value, unit: targetUnit === 'mg/mL' ? 'mg/mL' : 'mg/g' };

    case 'mg/g':
      if (isLiquid) {
        throw new Error('mg/g 单位仅适用于固体制剂');
      }
      return { value, unit: 'mg/g' };

    default:
      throw new Error(`不支持的浓度单位: ${unit}`);
  }
}

/**
 * 标准化有效成分数组
 */
export function normalizeIngredients(
  ingredients: ActiveIngredient[],
  isLiquid: boolean = true
): ActiveIngredient[] {
  return ingredients.map(ing => {
    const normalized = normalizeConcentration(ing.value, ing.unit, isLiquid);
    return {
      ...ing,
      normalizedValue: normalized.value,
      normalizedUnit: normalized.unit,
    };
  });
}

/**
 * 有效成分剂量 → 制剂用量 换算
 *
 * 制剂用量(mL/m³) = 有效成分剂量(mg/m³) ÷ 有效成分浓度(mg/mL)
 *
 * @param activeDoseMgPerM3 有效成分剂量 mg/m³
 * @param concentrationMgPerMl 有效成分浓度 mg/mL
 * @returns 制剂用量 mL/m³
 */
export function activeDoseToFormulationVolume(
  activeDoseMgPerM3: number,
  concentrationMgPerMl: number
): number {
  if (concentrationMgPerMl <= 0) {
    throw new Error('有效成分浓度必须大于0');
  }
  return activeDoseMgPerM3 / concentrationMgPerMl;
}

/**
 * 百云区 PPT 兼容公式：百分比浓度 → 制剂用量
 *
 * D_formulation(mL/m³) = D_active(mg/m³) / (C × 1000)
 * 其中 C 为小数浓度：4% = 0.04, 5% = 0.05
 *
 * 示例：1.67 mg/m³, 5% → 1.67 / (0.05×1000) = 0.0334 mL/m³
 *
 * @param activeDoseMgPerM3 有效成分剂量 mg/m³
 * @param percentValue 百分比浓度数值 (如 5 表示 5%)
 * @returns 制剂用量 mL/m³
 */
export function baiyunPercentToFormulationVolume(
  activeDoseMgPerM3: number,
  percentValue: number
): number {
  if (percentValue <= 0) {
    throw new Error('百分比浓度必须大于0');
  }
  return activeDoseMgPerM3 / (percentValue / 100 * 1000);
}

/**
 * 有效成分剂量 → 制剂用量 换算 (滞留喷洒)
 *
 * 制剂用量(mL/m²) = 有效成分剂量(mg/m²) ÷ 有效成分浓度(mg/mL)
 */
export function activeDoseToFormulationVolumePerArea(
  activeDoseMgPerM2: number,
  concentrationMgPerMl: number
): number {
  if (concentrationMgPerMl <= 0) {
    throw new Error('有效成分浓度必须大于0');
  }
  return activeDoseMgPerM2 / concentrationMgPerMl;
}

/**
 * mL → L 换算（用于显示）
 */
export function mlToL(ml: number): number {
  return ml / 1000;
}

/**
 * L → mL 换算
 */
export function lToMl(l: number): number {
  return l * 1000;
}

/**
 * 智能格式化体积显示
 * 大量用 L，小量用 mL
 */
export function formatVolume(ml: number): string {
  if (ml >= 1000) {
    return `${(ml / 1000).toFixed(2)}L`;
  }
  return `${ml.toFixed(1)}mL`;
}

/**
 * 智能格式化面积显示
 */
export function formatArea(m2: number): string {
  if (m2 >= 10000) {
    return `${(m2 / 10000).toFixed(2)}公顷 (${m2}m²)`;
  }
  return `${m2}m²`;
}
