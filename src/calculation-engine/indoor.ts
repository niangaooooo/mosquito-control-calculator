// ============================================================
// 室内小空间喷雾计算模块
//
// 核心公式：
// 1. 体积 = 面积 × 层高
// 2. 原药量 = 体积 × 单位体积制剂剂量
// 3. 喷雾时长 = 目标空间所需喷雾液量 ÷ 喷机流量
// ============================================================

import type {
  Drug,
  Machine,
  IndoorCalculationRequest,
  IndoorCalculationResult,
  CalculationWarning,
  TankSplit,
} from '@/types';
import {
  normalizeIngredients,
  activeDoseToFormulationVolume,
  formatVolume,
} from './conversion';
import { calculateTankSplit } from './tank';
import { getMachineFlow } from '@/rules/machine';

/**
 * 计算室内小空间喷雾方案
 */
export function calculateIndoor(
  request: IndoorCalculationRequest,
  drug: Drug,
  machine: Machine
): IndoorCalculationResult {
  const warnings: CalculationWarning[] = [];
  const explanation: string[] = [];
  const dataSources: string[] = [];

  const { area, ceilingHeight } = request;

  // 数据来源
  dataSources.push(`药物: ${drug.productName} (${drug.registrationNo})`);
  dataSources.push(`药物来源: ${drug.labelSource}`);
  dataSources.push(`器械: ${machine.machineName} (${machine.source})`);

  // 1. 室内体积
  const volume = area * ceilingHeight;
  explanation.push(`室内体积 = 面积 × 层高 = ${area}m² × ${ceilingHeight}m = ${volume}m³`);

  // 2. 获取单位体积制剂用量
  const formulationDosePerM3 = getFormulationDosePerM3(drug, explanation);
  if (formulationDosePerM3 === null) {
    throw new Error('无法获取单位体积制剂用量，请检查药物剂量设置');
  }

  // 3. 原药量
  const rawDrugMl = formulationDosePerM3 * volume;
  explanation.push(
    `原药量 = 体积 × 单位体积制剂剂量 = ${volume}m³ × ${formulationDosePerM3.toFixed(4)}mL/m³ = ${formatVolume(rawDrugMl)}`
  );

  // 4. 稀释倍数（室内一般不稀释或按标签稀释）
  const dilutionFactor = drug.recommendedDilution || 1;

  // 5. 稀释计算
  const totalSolutionMl = rawDrugMl * dilutionFactor;
  const diluentMl = totalSolutionMl - rawDrugMl;
  const dilutionRatioNum = dilutionFactor - 1;

  if (dilutionFactor > 1) {
    explanation.push(`稀释倍数: ${dilutionFactor}倍`);
    explanation.push(`最终药液 = ${formatVolume(rawDrugMl)} × ${dilutionFactor} = ${formatVolume(totalSolutionMl)}`);
    explanation.push(`稀释剂 = ${formatVolume(totalSolutionMl)} - ${formatVolume(rawDrugMl)} = ${formatVolume(diluentMl)}`);
  } else {
    explanation.push(`建议原液施药，不稀释`);
  }

  // 6. 喷雾时长
  const sprayDurationSeconds = totalSolutionMl / getMachineFlow(machine);
  explanation.push(
    `喷雾时长 = 所需药液量 ÷ 喷机流量 = ${formatVolume(totalSolutionMl)} ÷ ${getMachineFlow(machine)}mL/s = ${sprayDurationSeconds.toFixed(2)}秒`
  );

  // 7. 时长警告
  if (sprayDurationSeconds < 1) {
    warnings.push({
      level: 'YELLOW',
      message: `喷雾时长仅 ${sprayDurationSeconds.toFixed(2)}秒，实际操作过短，建议通过稀释提高可操作性`,
    });
  } else if (sprayDurationSeconds < 3) {
    warnings.push({
      level: 'YELLOW',
      message: `喷雾时长 ${sprayDurationSeconds.toFixed(2)}秒 较短，请注意均匀喷洒`,
    });
  }

  // 8. 药箱拆分
  let tanks: TankSplit[] = [];
  const tankCap = request.tankCapacity || machine.tankCapacityLiter;
  if (tankCap && tankCap > 0) {
    tanks = calculateTankSplit(totalSolutionMl, rawDrugMl, diluentMl, tankCap);
    explanation.push(`药箱拆分: ${tanks.length}箱（含尾箱）`);
  }

  return {
    volume,
    rawDrugMl,
    dilutionFactor,
    dilutionRatio: dilutionFactor > 1 ? `1:${dilutionRatioNum.toFixed(1)}` : '原液',
    diluentMl,
    totalSolutionMl,
    sprayDurationSeconds,
    tanks,
    warnings,
    explanation,
    dataSources,
  };
}

/**
 * 从药物数据获取单位体积制剂用量 (mL/m³)
 */
function getFormulationDosePerM3(drug: Drug, explanation: string[]): number | null {
  // 优先从 uses[] 中获取 INDOOR 剂量
  let dose = drug.dose;

  if (drug.uses && drug.uses.length > 0) {
    // 室内小空间页允许登记为 INDOOR，或明确限定室内环境的 ULV 使用场景。
    const indoorUse = drug.uses.find(u =>
      (u.method === 'INDOOR' || u.method === 'ULV') &&
      u.environments.includes('indoor') &&
      u.target.some(t => t.includes('蚊'))
    );
    if (indoorUse) {
      dose = indoorUse.dose;
      explanation.push(`从 uses[] 获取 INDOOR 剂量`);
    }
  }

  if (!dose) return null;

  switch (dose.type) {
    case 'FORMULATION_VOLUME_PER_VOLUME':
      explanation.push(`标签剂量: ${dose.value}${dose.unit}`);
      return dose.value;

    case 'ACTIVE_MASS_PER_VOLUME': {
      const ingredients = normalizeIngredients(drug.activeIngredients, true);

      if (dose.ingredientIndex !== undefined) {
        // 场景C：指定某一成分剂量
        const ingredient = ingredients[dose.ingredientIndex];
        if (!ingredient || !ingredient.normalizedValue || ingredient.normalizedValue <= 0) {
          return null;
        }
        const formulationDose = activeDoseToFormulationVolume(dose.value, ingredient.normalizedValue);
        explanation.push(
          `有效成分剂量: ${dose.value}${dose.unit}（${ingredient.name}），` +
          `有效成分浓度: ${ingredient.value}${ingredient.unit}（${ingredient.normalizedValue}${ingredient.normalizedUnit}），` +
          `换算制剂用量: ${formulationDose.toFixed(4)}mL/m³`
        );
        return formulationDose;
      }

      // 场景D：总有效成分剂量，合计所有成分浓度
      if (ingredients.length > 1) {
        let totalConc = 0;
        for (const ing of ingredients) {
          if (ing.normalizedValue && ing.normalizedValue > 0) {
            totalConc += ing.normalizedValue;
          }
        }
        if (totalConc <= 0) return null;
        const formulationDose = activeDoseToFormulationVolume(dose.value, totalConc);
        explanation.push(
          `总有效成分剂量: ${dose.value}${dose.unit}，` +
          `总浓度: ${totalConc.toFixed(2)}${ingredients[0].normalizedUnit}，` +
          `换算制剂用量: ${formulationDose.toFixed(4)}mL/m³`
        );
        return formulationDose;
      }

      // 单成分
      const ingredient = ingredients[0];
      if (!ingredient || !ingredient.normalizedValue || ingredient.normalizedValue <= 0) {
        return null;
      }
      const formulationDose = activeDoseToFormulationVolume(dose.value, ingredient.normalizedValue);
      explanation.push(
        `有效成分剂量: ${dose.value}${dose.unit}，` +
        `有效成分浓度: ${ingredient.value}${ingredient.unit}（${ingredient.normalizedValue}${ingredient.normalizedUnit}），` +
        `换算制剂用量: ${formulationDose.toFixed(4)}mL/m³`
      );
      return formulationDose;
    }

    default:
      return null;
  }
}
