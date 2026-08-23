// ============================================================
// ULV 超低容量空间喷雾计算模块
//
// 核心公式：
//   rawSpeed = flow / (swath * height * doseMlPerM3)
//   theoreticalDilution = rawSpeed / targetSpeed
//   finalSpeed = rawSpeed / dilutionFactor
//
// 所有内部单位：
//   流量 mL/s, 喷幅 m, 雾层高度 m, 制剂剂量 mL/m³, 速度 m/s
// ============================================================

import type {
  Drug,
  DrugDose,
  DrugUse,
  Machine,
  ULVCalculationRequest,
  ULVCalculationResult,
  CalculationWarning,
  TankSplit,
} from '@/types';
import {
  normalizeIngredients,
  activeDoseToFormulationVolume,
  formatVolume,
} from './conversion';
import { calculateTankSplit } from './tank';
import { getMachineFlow, getMachineSwath } from '@/rules/machine';

const DEFAULT_FOG_HEIGHT = 2; // m
const DEFAULT_TARGET_SPEED = 0.75; // m/s
const SPEED_LOWER_BOUND = 0.5; // m/s
const SPEED_UPPER_BOUND = 1.0; // m/s

/** 是否为开发环境 */
const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * 计算ULV超低容量空间喷雾方案
 */
export function calculateULV(
  request: ULVCalculationRequest,
  drug: Drug,
  machine: Machine
): ULVCalculationResult {
  const warnings: CalculationWarning[] = [];
  const explanation: string[] = [];
  const dataSources: string[] = [];

  // ── 1. 参数准备 ──
  const fogHeight = request.fogHeight || DEFAULT_FOG_HEIGHT;
  const targetSpeed = request.targetSpeed || DEFAULT_TARGET_SPEED;
  const area = request.area;
  const flowMlPerSec = getMachineFlow(machine, request.profileId);
  const swathMeter = getMachineSwath(machine, request.profileId) || machine.swathMeter;
  const isVehicle = machine.machineType === 'ULV_VEHICLE';

  dataSources.push(`药物: ${drug.productName} (${drug.registrationNo})`);
  dataSources.push(`药物来源: ${drug.labelSource}`);
  dataSources.push(`器械: ${machine.machineName} (${machine.source})`);

  // ── 2. 处理体积 ──
  const volume = area * fogHeight;
  explanation.push(`处理体积 = 面积 × 雾层高度 = ${area}m² × ${fogHeight}m = ${volume}m³`);

  // ── 3. 获取标签制剂剂量（支持按体积或按面积）──
  const environment = request.environment || 'outdoor';
  const target = request.target || '蚊';
  const doseInfo = getFormulationDoseForULV(drug, explanation, environment, target);
  if (doseInfo === null) {
    throw new Error('无法获取当前场景的制剂用量，请检查药物剂量设置');
  }
  const doseValue = doseInfo.value;
  const coverageFactor = doseInfo.basis === 'volume' ? fogHeight : 1;
  const treatmentAmount = doseInfo.basis === 'volume' ? volume : area;

  // ── 4. 原药量 ──
  const rawDrugMl = doseValue * treatmentAmount;
  explanation.push(
    `原药量 = 制剂剂量 × ${doseInfo.basis === 'volume' ? '处理体积' : '处理面积'} = ` +
    `${doseValue.toFixed(4)}${doseInfo.unit} × ${treatmentAmount}${doseInfo.basis === 'volume' ? 'm³' : 'm²'} = ${formatVolume(rawDrugMl)}`
  );

  // ── 5. 原液行走速度 ──
  // 体积剂量：flow / (swath × height × dose)；面积剂量：flow / (swath × dose)
  const rawWalkingSpeed = calcSpeed(flowMlPerSec, swathMeter, coverageFactor, doseValue, 1);
  explanation.push(
    `原液行走速度 = ${flowMlPerSec}mL/s ÷ (${swathMeter}m × ` +
    `${doseInfo.basis === 'volume' ? `${fogHeight}m × ` : ''}${doseValue.toFixed(4)}${doseInfo.unit}) = ${rawWalkingSpeed.toFixed(2)}m/s`
  );

  // ── 6. 自动推荐稀释倍数 ──
  let dilutionFactor: number;
  let dilutionStatus: string;

  // 稀释区间计算：Kmin 对应最大合理速度，Kmax 对应最小合理速度
  // Kmin = rawSpeed / speedUpper, Kmax = rawSpeed / speedLower
  let dilutionRangeMin: number | undefined;
  let dilutionRangeMax: number | undefined;
  let localTrainingDilution: number | undefined;
  let labelDilution: number | undefined;

  // 获取白云区培训推荐稀释倍数
  if (drug.baiyunTraining?.recommendedDilution && drug.baiyunTraining.recommendedDilution > 1) {
    localTrainingDilution = drug.baiyunTraining.recommendedDilution;
  }

  // 获取登记标签推荐稀释倍数
  if (drug.recommendedDilution && drug.recommendedDilution > 1) {
    labelDilution = drug.recommendedDilution;
  }

  if (isVehicle) {
    // 车载ULV：不使用步行速度阈值，直接按目标速度计算稀释
    const theoreticalDilution = flowMlPerSec / (swathMeter * coverageFactor * doseValue * targetSpeed);
    dilutionFactor = Math.max(1, Math.round(theoreticalDilution * 2) / 2);
    dilutionStatus = `车载ULV模式：理论稀释 ${theoreticalDilution.toFixed(2)}倍 → 建议 ${dilutionFactor}倍`;

    // 车载模式不显示稀释区间（无步行速度约束）
  } else if (rawWalkingSpeed < SPEED_LOWER_BOUND) {
    // 原液已经偏慢，不宜稀释
    dilutionFactor = 1;
    dilutionStatus = `原液速度 ${rawWalkingSpeed.toFixed(2)}m/s 已偏慢（<${SPEED_LOWER_BOUND}m/s），不建议稀释`;
    warnings.push({
      level: 'YELLOW',
      message: `⚠ 当前原液与设备参数不匹配\n\n如果直接喷原液，为达到规定制剂剂量，理论行进速度需要 ${rawWalkingSpeed.toFixed(2)}m/s，低于白云区背负式ULV常用操作速度范围（${SPEED_LOWER_BOUND}~${SPEED_UPPER_BOUND}m/s）。\n\n可能原因：当前机器流量较小 + 该药制剂有效剂量较高。\n\n这不代表机器故障。\n\n建议解决顺序：\n① 检查机器流量设置是否正确\n② 如机器支持调流量，可适当增大\n③ 考虑更换更大流量设备`
    });
  } else if (rawWalkingSpeed <= SPEED_UPPER_BOUND) {
    // 原液速度在适宜范围
    dilutionFactor = 1;
    dilutionStatus = `原液速度 ${rawWalkingSpeed.toFixed(2)}m/s 在适宜范围（${SPEED_LOWER_BOUND}~${SPEED_UPPER_BOUND}m/s），建议原液施药`;
  } else {
    // 原液速度过快，需要稀释
    // 稀释区间：使稀释后速度落在 [SPEED_LOWER_BOUND, SPEED_UPPER_BOUND] 范围内
    dilutionRangeMin = Math.ceil(rawWalkingSpeed / SPEED_UPPER_BOUND * 2) / 2;
    dilutionRangeMax = Math.floor(rawWalkingSpeed / SPEED_LOWER_BOUND * 2) / 2;

    // 理论稀释倍数：基于目标速度计算
    const theoreticalDilution = flowMlPerSec / (swathMeter * coverageFactor * doseValue * targetSpeed);

    // 诊断型提示
    warnings.push({
      level: 'YELLOW',
      message: `⚠ 当前原液与设备参数不匹配\n\n如果直接喷原液，为达到规定制剂剂量，理论行进速度需要 ${rawWalkingSpeed.toFixed(2)}m/s，这高于白云区背负式ULV常用操作速度范围（${SPEED_LOWER_BOUND}~${SPEED_UPPER_BOUND}m/s），现场很难做到。\n\n可能原因：当前机器流量较大 + 该药制剂有效剂量较低。\n\n这不代表机器故障。\n\n建议解决顺序：\n① 登记标签是否允许稀释 → 优先计算合理稀释倍数\n② 机器是否可调流量 → 计算降低流量后的速度\n③ 是否存在其他喷嘴Profile → 推荐低流量Profile\n④ 仍无法满足 → 提示更换更低流量机器`
    });

    // 优先使用白云区培训推荐，其次使用标签推荐，最后使用理论值
    if (localTrainingDilution && localTrainingDilution >= dilutionRangeMin && localTrainingDilution <= dilutionRangeMax) {
      dilutionFactor = localTrainingDilution;
      dilutionStatus = `原液速度 ${rawWalkingSpeed.toFixed(2)}m/s 过快（>${SPEED_UPPER_BOUND}m/s），使用白云区培训推荐稀释 ${dilutionFactor}倍`;
    } else if (labelDilution && labelDilution >= dilutionRangeMin && labelDilution <= dilutionRangeMax) {
      dilutionFactor = labelDilution;
      dilutionStatus = `原液速度 ${rawWalkingSpeed.toFixed(2)}m/s 过快（>${SPEED_UPPER_BOUND}m/s），使用标签推荐稀释 ${dilutionFactor}倍`;
    } else {
      // 使用理论稀释倍数（基于目标速度），取整到0.5的倍数
      dilutionFactor = Math.max(1, Math.round(theoreticalDilution * 2) / 2);
      dilutionStatus = `原液速度 ${rawWalkingSpeed.toFixed(2)}m/s 过快（>${SPEED_UPPER_BOUND}m/s），理论稀释 ${theoreticalDilution.toFixed(2)}倍 → 建议 ${dilutionFactor}倍`;
    }

    // 如果标签有推荐稀释倍数但不在区间内，给出警告
    if (labelDilution && (labelDilution < dilutionRangeMin || labelDilution > dilutionRangeMax)) {
      warnings.push({
        level: 'YELLOW',
        message: `标签推荐稀释${labelDilution}倍，但理论可操作区间为${dilutionRangeMin}~${dilutionRangeMax}倍，请以标签为准并确认现场操作性`,
      });
    }
  }
  explanation.push(dilutionStatus);

  // ── 7. 稀释计算 ──
  const totalSolutionMl = rawDrugMl * dilutionFactor;
  const diluentMl = totalSolutionMl - rawDrugMl;
  const dilutionRatioNum = dilutionFactor - 1;

  if (dilutionFactor > 1) {
    explanation.push(`稀释倍数: ${dilutionFactor}倍`);
    explanation.push(`最终药液 = 原药量 × 稀释倍数 = ${formatVolume(rawDrugMl)} × ${dilutionFactor} = ${formatVolume(totalSolutionMl)}`);
    explanation.push(`稀释剂 = 最终药液 - 原药量 = ${formatVolume(totalSolutionMl)} - ${formatVolume(rawDrugMl)} = ${formatVolume(diluentMl)}`);
    explanation.push(`配比 = 原药 : 稀释剂 = 1 : ${dilutionRatioNum.toFixed(1)}`);
  } else {
    explanation.push(`建议原液施药，不稀释`);
  }

  // ── 8. 稀释后行走速度 ──
  const walkingSpeed = calcSpeed(flowMlPerSec, swathMeter, coverageFactor, doseValue, dilutionFactor);
  explanation.push(
    `稀释后行走速度 = ${flowMlPerSec} ÷ (${swathMeter} × ${coverageFactor} × ${doseValue.toFixed(4)} × ${dilutionFactor}) = ${walkingSpeed.toFixed(2)}m/s`
  );

  // 速度校验
  if (dilutionFactor > 1 && walkingSpeed < SPEED_LOWER_BOUND) {
    warnings.push({
      level: 'YELLOW',
      message: `稀释后速度 ${walkingSpeed.toFixed(2)}m/s 仍偏低。建议：减少稀释倍数或更换小流量设备。`
    });
  } else if (dilutionFactor > 1 && walkingSpeed > SPEED_UPPER_BOUND) {
    warnings.push({
      level: 'YELLOW',
      message: `稀释后速度 ${walkingSpeed.toFixed(2)}m/s 仍偏高。建议：增加稀释倍数或降低流量。`
    });
  }

  // ── 9. 药箱拆分 ──
  let tanks: TankSplit[] = [];
  if (request.tankCapacity && request.tankCapacity > 0) {
    tanks = calculateTankSplit(totalSolutionMl, rawDrugMl, diluentMl, request.tankCapacity);
    explanation.push(`药箱拆分: ${tanks.length}箱（含尾箱）`);
  }

  // ── 10. DEBUG 输出（仅开发环境）──
  if (IS_DEV) {
    const theoreticalDilution = rawWalkingSpeed > SPEED_UPPER_BOUND
      ? flowMlPerSec / (swathMeter * coverageFactor * doseValue * targetSpeed)
      : 1;
    explanation.push('── DEBUG ──');
    explanation.push(`flowMlPerSec = ${flowMlPerSec}`);
    explanation.push(`swathMeter = ${swathMeter}`);
    explanation.push(`fogHeightMeter = ${fogHeight}`);
    explanation.push(`dose = ${doseValue} ${doseInfo.unit}`);
    explanation.push(`doseBasis = ${doseInfo.basis}`);
    explanation.push(`rawSpeed = ${rawWalkingSpeed.toFixed(4)}`);
    explanation.push(`targetSpeed = ${targetSpeed}`);
    explanation.push(`theoreticalDilution = ${theoreticalDilution.toFixed(4)}`);
    explanation.push(`recommendedDilution = ${dilutionFactor}`);
    explanation.push(`finalSpeed = ${walkingSpeed.toFixed(4)}`);
  }

  return {
    volume,
    rawDrugMl,
    dilutionFactor,
    dilutionRatio: dilutionFactor > 1 ? `1:${dilutionRatioNum.toFixed(1)}` : '原液',
    diluentMl,
    totalSolutionMl,
    walkingSpeed,
    rawWalkingSpeed,
    dilutionRangeMin,
    dilutionRangeMax,
    localTrainingDilution,
    labelDilution,
    isVehicle,
    tanks,
    warnings,
    explanation,
    dataSources,
  };
}

/**
 * 计算行走速度
 * speed = flow / (swath * height * dose * dilution)
 */
function calcSpeed(
  flow: number,
  swath: number,
  height: number,
  dose: number,
  dilution: number
): number {
  const denominator = swath * height * dose * dilution;
  if (denominator <= 0) return 0;
  return flow / denominator;
}

/**
 * 从药物数据获取单位体积制剂用量 (mL/m³)
 *
 * 必须先将所有剂量统一转换为 mL/m³ 再进入速度计算。
 *
 * @param drug 药物对象
 * @param explanation 解释数组
 * @param environment 环境 ('indoor' | 'outdoor')
 * @param target 防治对象 (如 '蚊', '蚊幼虫')
 * @returns 制剂剂量 (mL/m³) 或 null
 */
interface ULVFormulationDose {
  value: number;
  basis: 'volume' | 'area';
  unit: 'mL/m3' | 'mL/m2';
}

function getFormulationDoseForULV(
  drug: Drug,
  explanation: string[],
  environment: 'indoor' | 'outdoor' = 'outdoor',
  target: string = '蚊'
): ULVFormulationDose | null {
  let dose: DrugDose | null = null;
  let matchedUse: DrugUse | null = null;

  // 优先从 uses[] 中获取匹配的剂量
  if (drug.uses && drug.uses.length > 0) {
    // 精确匹配：环境 + 防治对象 + 施药方式(ULV)
    matchedUse = drug.uses.find(u =>
      u.method === 'ULV' &&
      u.environments.includes(environment) &&
      u.target.some(t => target.includes(t) || t.includes(target))
    ) ?? null;

    if (matchedUse) {
      dose = matchedUse.dose;
      explanation.push(`从 uses[] 获取 ULV 剂量（场景: ${matchedUse.id}）`);
    }
  }

  // 如果 uses[] 中没有，回退到 drug.dose
  if (!dose) {
    dose = drug.dose ?? null;
  }

  if (!dose) {
    explanation.push(`❌ 当前产品在该施药场景下没有已核验制剂用量，请核对登记标签。`);
    return null;
  }

  switch (dose.type) {
    case 'FORMULATION_VOLUME_PER_VOLUME':
      // 标签直接给出 mL/m³
      explanation.push(`标签制剂剂量: ${dose.value} ${dose.unit}`);
      return { value: dose.value, basis: 'volume', unit: 'mL/m3' };

    case 'ACTIVE_MASS_PER_VOLUME': {
      // 标签给出 mg有效成分/m³，需要换算为 mL制剂/m³
      const ingredients = normalizeIngredients(drug.activeIngredients, true);

      if (dose.ingredientIndex !== undefined) {
        // 场景C：指定某一成分剂量
        const ingredient = ingredients[dose.ingredientIndex];
        if (!ingredient || !ingredient.normalizedValue || ingredient.normalizedValue <= 0) {
          return null;
        }
        const formulationDose = activeDoseToFormulationVolume(dose.value, ingredient.normalizedValue);
        explanation.push(
          `有效成分剂量: ${dose.value} ${dose.unit}（${ingredient.name}），` +
          `有效成分浓度: ${ingredient.value}${ingredient.unit} → ${ingredient.normalizedValue} ${ingredient.normalizedUnit}，` +
          `换算制剂剂量: ${formulationDose.toFixed(4)} mL/m³`
        );
        return { value: formulationDose, basis: 'volume', unit: 'mL/m3' };
      }

      // 场景D（或多成分无指定索引）：总有效成分剂量，合计所有成分浓度
      if (ingredients.length > 1) {
        let totalConc = 0;
        for (const ing of ingredients) {
          if (ing.normalizedValue && ing.normalizedValue > 0) {
            totalConc += ing.normalizedValue;
          }
        }
        if (totalConc <= 0) return null;
        const formulationDose = activeDoseToFormulationVolume(dose.value, totalConc);
        const concDesc = ingredients.map(i => `${i.name} ${i.normalizedValue}`).join(' + ');
        explanation.push(
          `总有效成分剂量: ${dose.value} ${dose.unit}，` +
          `总浓度: ${concDesc} = ${totalConc.toFixed(2)} ${ingredients[0].normalizedUnit}，` +
          `换算制剂剂量: ${formulationDose.toFixed(4)} mL/m³`
        );
        return { value: formulationDose, basis: 'volume', unit: 'mL/m3' };
      }

      // 单成分：直接换算
      const ingredient = ingredients[0];
      if (!ingredient || !ingredient.normalizedValue || ingredient.normalizedValue <= 0) {
        return null;
      }
      const formulationDose = activeDoseToFormulationVolume(dose.value, ingredient.normalizedValue);
      explanation.push(
        `有效成分剂量: ${dose.value} ${dose.unit}，` +
        `有效成分浓度: ${ingredient.value}${ingredient.unit} → ${ingredient.normalizedValue} ${ingredient.normalizedUnit}，` +
        `换算制剂剂量: ${formulationDose.toFixed(4)} mL/m³`
      );
      return { value: formulationDose, basis: 'volume', unit: 'mL/m3' };
    }

    case 'FORMULATION_VOLUME_PER_AREA': {
      explanation.push(`标签制剂面积剂量: ${dose.value} ${dose.unit}`);
      return { value: dose.value, basis: 'area', unit: 'mL/m2' };
    }

    case 'FORMULATION_MASS_PER_AREA': {
      if (!drug.formulationDensity || drug.formulationDensity <= 0) {
        explanation.push(`标签为制剂质量面积剂量（${dose.value} ${dose.unit}），但缺少制剂密度，不能换算为mL/m²。`);
        return null;
      }
      const volumeDose = dose.value / drug.formulationDensity;
      explanation.push(
        `制剂面积剂量换算: ${dose.value}g/m² ÷ ${drug.formulationDensity}g/mL = ${volumeDose.toFixed(4)}mL/m²`
      );
      return { value: volumeDose, basis: 'area', unit: 'mL/m2' };
    }

    case 'ACTIVE_MASS_PER_AREA': {
      const doseDesc = matchedUse?.notes || `${dose.value} ${dose.unit}`;
      explanation.push(`当前标签为有效成分面积剂量（${doseDesc}），本模块尚未启用该换算。`);
      return null;
    }

    case 'DILUTION_RATIO': {
      // 稀释倍数 — 无法直接确定制剂用量
      const dilutionNote = matchedUse?.notes || `${dose.value}倍`;
      explanation.push(`标签稀释倍数: ${dilutionNote}（需配合现场校准使用）`);
      return null;
    }

    default:
      explanation.push(`❌ 不支持的剂量类型: ${dose.type}`);
      return null;
  }
}
