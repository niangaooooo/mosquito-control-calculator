// ============================================================
// 滞留喷洒计算模块
//
// 核心公式：
// 1. 原药量 = 处置面积 × 标签制剂使用剂量(mL/m²)
// 2. 稀释倍数 = 靶标吸水量(mL/m²) ÷ 制剂使用剂量(mL/m²)
// 3. 最终药液 = 处置面积 × 靶标吸水量
// 4. 稀释剂 = 最终药液 - 原药量
// ============================================================

import type {
  Drug,
  Machine,
  ResidualCalculationRequest,
  ResidualCalculationResult,
  CalculationWarning,
  TankSplit,
} from '@/types';
import {
  normalizeIngredients,
  activeDoseToFormulationVolumePerArea,
  formatVolume,
} from './conversion';
import { calculateTankSplit } from './tank';
import { SURFACE_TYPES } from '@/types';

/**
 * 计算滞留喷洒方案
 */
export function calculateResidual(
  request: ResidualCalculationRequest,
  drug: Drug,
  machine: Machine
): ResidualCalculationResult {
  const warnings: CalculationWarning[] = [];
  const explanation: string[] = [];
  const dataSources: string[] = [];

  const { area } = request;

  // 数据来源
  dataSources.push(`药物: ${drug.productName} (${drug.registrationNo})`);
  dataSources.push(`药物来源: ${drug.labelSource}`);
  dataSources.push(`器械: ${machine.machineName} (${machine.source})`);

  // 1. 获取表面吸水量
  const surfaceType = SURFACE_TYPES.find(s => s.id === request.surfaceTypeId);
  const absorptionMlPerM2 = request.customAbsorption ||
    (surfaceType ? surfaceType.defaultAbsorption : 50); // 默认50

  if (surfaceType) {
    dataSources.push(`表面类型: ${surfaceType.name} (${surfaceType.examples})，参考吸水量 ${surfaceType.defaultAbsorption}mL/m²`);
    explanation.push(`靶标吸水量: ${absorptionMlPerM2}mL/m² (${surfaceType.name})`);
  } else {
    explanation.push(`靶标吸水量: ${absorptionMlPerM2}mL/m² (自定义)`);
  }

  // 2. 获取单位面积制剂用量
  const formulationDosePerM2 = getFormulationDosePerM2(drug, explanation);
  if (formulationDosePerM2 === null) {
    throw new Error('无法获取单位面积制剂用量，请检查药物剂量设置');
  }

  // 3. 原药量
  const rawDrugMl = area * formulationDosePerM2;
  explanation.push(
    `原药量 = 处置面积 × 制剂使用剂量 = ${area}m² × ${formulationDosePerM2.toFixed(2)}mL/m² = ${formatVolume(rawDrugMl)}`
  );

  // 4. 稀释倍数
  const dilutionFactor = absorptionMlPerM2 / formulationDosePerM2;
  explanation.push(
    `稀释倍数 = 靶标吸水量 ÷ 制剂使用剂量 = ${absorptionMlPerM2}mL/m² ÷ ${formulationDosePerM2.toFixed(2)}mL/m² = ${dilutionFactor.toFixed(1)}倍`
  );

  // 5. 最终药液
  const totalSolutionMl = area * absorptionMlPerM2;
  explanation.push(
    `最终药液 = 处置面积 × 靶标吸水量 = ${area}m² × ${absorptionMlPerM2}mL/m² = ${formatVolume(totalSolutionMl)}`
  );

  // 6. 稀释剂
  const diluentMl = totalSolutionMl - rawDrugMl;
  explanation.push(
    `稀释剂 = 最终药液 - 原药量 = ${formatVolume(totalSolutionMl)} - ${formatVolume(rawDrugMl)} = ${formatVolume(diluentMl)}`
  );

  const dilutionRatioNum = dilutionFactor - 1;
  explanation.push(`配比 = 原药 : 稀释剂 = 1:${dilutionRatioNum.toFixed(1)}`);

  // 7. 药箱拆分
  let tanks: TankSplit[] = [];
  if (machine.tankCapacityLiter && machine.tankCapacityLiter > 0) {
    tanks = calculateTankSplit(
      totalSolutionMl,
      rawDrugMl,
      diluentMl,
      machine.tankCapacityLiter
    );
    explanation.push(`药箱拆分: ${tanks.length}箱（含尾箱）`);
  }

  return {
    rawDrugMl,
    dilutionFactor,
    dilutionRatio: `1:${dilutionRatioNum.toFixed(1)}`,
    diluentMl,
    totalSolutionMl,
    tanks,
    warnings,
    explanation,
    dataSources,
  };
}

/**
 * 从药物数据获取单位面积制剂用量 (mL/m²)
 */
function getFormulationDosePerM2(drug: Drug, explanation: string[]): number | null {
  // 优先从 uses[] 中获取 RESIDUAL 剂量
  let dose = drug.dose;

  if (drug.uses && drug.uses.length > 0) {
    // 查找 RESIDUAL 使用场景
    const residualUse = drug.uses.find(u => u.method === 'RESIDUAL');
    if (residualUse) {
      dose = residualUse.dose;
      explanation.push(`从 uses[] 获取 RESIDUAL 剂量`);
    }
  }

  if (!dose) return null;

  switch (dose.type) {
    case 'FORMULATION_VOLUME_PER_AREA':
      explanation.push(`标签制剂使用剂量: ${dose.value}${dose.unit}`);
      return dose.value;

    case 'FORMULATION_MASS_PER_AREA': {
      // g/m² → mL/m²: mL/m² = g/m² ÷ density(g/mL)
      const density = drug.formulationDensity;
      if (!density || density <= 0) {
        explanation.push(`标签剂量为质量单位 ${dose.value}${dose.unit}，但缺少制剂密度，不能自动换算为体积。`);
        return null;
      }
      const doseMlPerM2 = dose.value / density;
      explanation.push(`标签制剂使用剂量: ${dose.value}${dose.unit}，制剂密度: ${density}g/mL → ${doseMlPerM2.toFixed(2)}mL/m²`);
      return doseMlPerM2;
    }

    case 'DILUTION_RATIO':
      explanation.push(`标签稀释倍数: ${dose.value}倍（稀释倍数无法直接换算为制剂用量 mL/m²，需配合标签制剂剂量或有效成分剂量使用）`);
      return null;

    case 'ACTIVE_MASS_PER_AREA': {
      const ingredients = normalizeIngredients(drug.activeIngredients, true);

      if (dose.ingredientIndex !== undefined) {
        // 指定某一成分剂量
        const ingredient = ingredients[dose.ingredientIndex];
        if (!ingredient || !ingredient.normalizedValue || ingredient.normalizedValue <= 0) {
          return null;
        }
        const formulationDose = activeDoseToFormulationVolumePerArea(dose.value, ingredient.normalizedValue);
        explanation.push(
          `有效成分剂量: ${dose.value}${dose.unit}（${ingredient.name}），` +
          `有效成分浓度: ${ingredient.value}${ingredient.unit}（${ingredient.normalizedValue}${ingredient.normalizedUnit}），` +
          `换算制剂用量: ${formulationDose.toFixed(2)}mL/m²`
        );
        return formulationDose;
      }

      // 总有效成分剂量，合计所有成分浓度
      if (ingredients.length > 1) {
        let totalConc = 0;
        for (const ing of ingredients) {
          if (ing.normalizedValue && ing.normalizedValue > 0) {
            totalConc += ing.normalizedValue;
          }
        }
        if (totalConc <= 0) return null;
        const formulationDose = activeDoseToFormulationVolumePerArea(dose.value, totalConc);
        explanation.push(
          `总有效成分剂量: ${dose.value}${dose.unit}，` +
          `总浓度: ${totalConc.toFixed(2)}${ingredients[0].normalizedUnit}，` +
          `换算制剂用量: ${formulationDose.toFixed(2)}mL/m²`
        );
        return formulationDose;
      }

      // 单成分
      const ingredient = ingredients[0];
      if (!ingredient || !ingredient.normalizedValue || ingredient.normalizedValue <= 0) {
        return null;
      }
      const formulationDose = activeDoseToFormulationVolumePerArea(dose.value, ingredient.normalizedValue);
      explanation.push(
        `有效成分剂量: ${dose.value}${dose.unit}，` +
        `有效成分浓度: ${ingredient.value}${ingredient.unit}（${ingredient.normalizedValue}${ingredient.normalizedUnit}），` +
        `换算制剂用量: ${formulationDose.toFixed(2)}mL/m²`
      );
      return formulationDose;
    }

    default:
      return null;
  }
}
