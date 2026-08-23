// ============================================================
// 有效成分计算模块
//
// 核心功能：
// 1. 根据"有效成分含量 + 登记推荐有效成分剂量"反算制剂用量
// 2. 支持多种浓度单位
// 3. 支持空间喷雾和滞留喷洒两种场景
// ============================================================

import type {
  FormulationType,
  CustomDrugInput,
  DoseType,
  DoseUnit,
} from '@/types';
import { normalizeConcentration } from './conversion';

/**
 * 有效成分反算请求
 */
export interface ActiveIngredientCalcRequest {
  /** 有效成分浓度 */
  concentration: {
    value: number;
    unit: '%' | 'g/L' | 'mg/mL' | 'g/kg' | 'mg/g';
  };
  /** 登记推荐有效成分剂量 */
  activeDose: {
    value: number;
    unit: 'mg/m3' | 'mg/m2' | 'mL/m3' | 'mL/m2';
  };
  /** 剂型 */
  formulationType: FormulationType;
  /** 施药方式场景 */
  scenario: 'space_spray' | 'residual';
}

/**
 * 有效成分反算结果
 */
export interface ActiveIngredientCalcResult {
  /** 换算后的制剂用量 */
  formulationDose: number;
  /** 制剂用量单位 */
  formulationDoseUnit: 'mL/m3' | 'mL/m2';
  /** 标准化后的有效成分浓度 */
  normalizedConcentration: number;
  /** 标准化后的浓度单位 */
  normalizedConcentrationUnit: 'mg/mL' | 'mg/g';
  /** 计算过程 */
  explanation: string[];
}

/**
 * 判断剂型是否为液体制剂
 */
function isLiquidFormulation(formulationType: FormulationType): boolean {
  const liquidTypes: FormulationType[] = ['EC', 'EW', 'SC', 'OL', 'ME', 'SL'];
  return liquidTypes.includes(formulationType);
}

/**
 * 有效成分剂量 → 制剂用量 反算
 *
 * 空间喷雾:
 *   制剂用量(mL/m³) = 有效成分剂量(mg/m³) ÷ 有效成分浓度(mg/mL)
 *
 * 滞留喷洒:
 *   制剂用量(mL/m²) = 有效成分剂量(mg/m²) ÷ 有效成分浓度(mg/mL)
 */
export function calculateFromActiveIngredient(
  request: ActiveIngredientCalcRequest
): ActiveIngredientCalcResult {
  const explanation: string[] = [];
  const isLiquid = isLiquidFormulation(request.formulationType);

  // 1. 标准化浓度
  const normalized = normalizeConcentration(
    request.concentration.value,
    request.concentration.unit,
    isLiquid
  );
  explanation.push(
    `有效成分浓度: ${request.concentration.value}${request.concentration.unit} → 标准化为 ${normalized.value}${normalized.unit}`
  );

  // 2. 验证剂量单位与场景匹配
  const isSpaceSprayDose = request.activeDose.unit === 'mg/m3' || request.activeDose.unit === 'mL/m3';
  const isResidualDose = request.activeDose.unit === 'mg/m2' || request.activeDose.unit === 'mL/m2';

  if (request.scenario === 'space_spray' && !isSpaceSprayDose) {
    throw new Error(`空间喷雾场景需要 mg/m³ 或 mL/m³ 单位，当前为 ${request.activeDose.unit}`);
  }
  if (request.scenario === 'residual' && !isResidualDose) {
    throw new Error(`滞留喷洒场景需要 mg/m² 或 mL/m² 单位，当前为 ${request.activeDose.unit}`);
  }

  // 3. 计算制剂用量
  let formulationDose: number;
  let formulationDoseUnit: 'mL/m3' | 'mL/m2';

  if (request.scenario === 'space_spray') {
    formulationDose = request.activeDose.value / normalized.value;
    formulationDoseUnit = 'mL/m3';
    explanation.push(
      `制剂用量 = 有效成分剂量 ÷ 有效成分浓度 = ${request.activeDose.value}${request.activeDose.unit} ÷ ${normalized.value}${normalized.unit} = ${formulationDose.toFixed(4)}${formulationDoseUnit}`
    );
  } else {
    formulationDose = request.activeDose.value / normalized.value;
    formulationDoseUnit = 'mL/m2';
    explanation.push(
      `制剂用量 = 有效成分剂量 ÷ 有效成分浓度 = ${request.activeDose.value}${request.activeDose.unit} ÷ ${normalized.value}${normalized.unit} = ${formulationDose.toFixed(2)}${formulationDoseUnit}`
    );
  }

  return {
    formulationDose,
    formulationDoseUnit,
    normalizedConcentration: normalized.value,
    normalizedConcentrationUnit: normalized.unit,
    explanation,
  };
}

/**
 * 从自定义药物输入构建 CustomDrugInput
 * 用于将有效成分反算结果转换为可直接参与计算的药物输入
 */
export function buildCustomDrugFromActiveResult(
  request: ActiveIngredientCalcRequest,
  result: ActiveIngredientCalcResult,
  productName?: string
): CustomDrugInput {
  const doseType: DoseType = request.scenario === 'space_spray'
    ? 'FORMULATION_VOLUME_PER_VOLUME'
    : 'FORMULATION_VOLUME_PER_AREA';
  const doseUnit: DoseUnit = request.scenario === 'space_spray'
    ? 'mL/m3'
    : 'mL/m2';

  return {
    productName: productName || '自定义药物',
    formulationType: request.formulationType,
    activeIngredients: [{
      name: '有效成分',
      value: request.concentration.value,
      unit: request.concentration.unit,
      normalizedValue: result.normalizedConcentration,
      normalizedUnit: result.normalizedConcentrationUnit,
    }],
    dose: {
      type: doseType,
      value: result.formulationDose,
      unit: doseUnit,
    },
    diluent: 'water',
  };
}
