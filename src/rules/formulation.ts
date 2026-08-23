// ============================================================
// 剂型—施药方式兼容性规则引擎
// ============================================================

import type { FormulationType, ApplicationMethod } from '@/types';

/**
 * 剂型—施药方式兼容性矩阵
 * true = 兼容, false = 不兼容
 */
const COMPATIBILITY_MATRIX: Record<string, Record<string, boolean>> = {
  EC: { ULV: true, INDOOR: true, RESIDUAL: true, THERMAL_FOG: true },
  EW: { ULV: true, INDOOR: true, RESIDUAL: true, THERMAL_FOG: false },
  WP: { ULV: false, INDOOR: false, RESIDUAL: true, THERMAL_FOG: false },
  SC: { ULV: false, INDOOR: false, RESIDUAL: true, THERMAL_FOG: false },
  CS: { ULV: false, INDOOR: false, RESIDUAL: true, THERMAL_FOG: false },
  OL: { ULV: true, INDOOR: true, RESIDUAL: false, THERMAL_FOG: true },
  WG: { ULV: false, INDOOR: false, RESIDUAL: true, THERMAL_FOG: false },
  GR: { ULV: false, INDOOR: false, RESIDUAL: false, THERMAL_FOG: false },
  ME: { ULV: true, INDOOR: true, RESIDUAL: true, THERMAL_FOG: false },
  SL: { ULV: false, INDOOR: false, RESIDUAL: true, THERMAL_FOG: false },
};

/**
 * 检查剂型与施药方式是否兼容
 *
 * @returns { compatible: boolean, reason?: string }
 */
export function checkFormulationCompatibility(
  formulationType: FormulationType,
  applicationMethod: ApplicationMethod
): { compatible: boolean; reason?: string } {
  const formulationRow = COMPATIBILITY_MATRIX[formulationType];

  if (!formulationRow) {
    return {
      compatible: false,
      reason: `未知剂型: ${formulationType}`,
    };
  }

  if (formulationRow[applicationMethod] === false) {
    const methodLabels: Record<string, string> = {
      ULV: '超低容量空间喷雾',
      INDOOR: '室内小空间喷雾',
      RESIDUAL: '滞留喷洒',
      THERMAL_FOG: '热烟雾',
    };
    const formulationLabels: Record<string, string> = {
      EC: '乳油',
      EW: '水乳剂',
      WP: '可湿性粉剂',
      SC: '悬浮剂',
      CS: '微胶囊剂',
      OL: '油剂',
      WG: '水分散粒剂',
      GR: '颗粒剂',
      ME: '微乳剂',
      SL: '可溶液剂',
    };
    return {
      compatible: false,
      reason: `${formulationLabels[formulationType] || formulationType}剂型不适合${methodLabels[applicationMethod] || applicationMethod}方式施药`,
    };
  }

  return { compatible: true };
}

/**
 * 获取剂型支持的施药方式列表
 */
export function getSupportedMethods(formulationType: FormulationType): ApplicationMethod[] {
  const row = COMPATIBILITY_MATRIX[formulationType];
  if (!row) return [];
  return (Object.keys(row) as ApplicationMethod[]).filter(m => row[m]);
}
