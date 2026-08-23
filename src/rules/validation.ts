// ============================================================
// 综合校验规则引擎
// 集成剂型、器械、剂量、药物状态的完整校验
// ============================================================

import type {
  Drug,
  Machine,
  ApplicationMethod,
  RiskLevel,
  CalculationWarning,
} from '@/types';
import { checkFormulationCompatibility } from './formulation';
import { validateMachine, checkMachineMethodCompatibility, checkFormulationMachineCompatibility } from './machine';
import { getDrugCalculabilityIssues, getDrugStatusMessage } from '@/services/data';

/**
 * 综合校验结果
 */
export interface ValidationResult {
  /** 是否可以计算 */
  canCalculate: boolean;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 错误（阻止计算） */
  errors: string[];
  /** 警告（可以计算，但需注意） */
  warnings: string[];
}

/**
 * 综合校验：药物 + 器械 + 施药方式
 */
export function validateAll(
  drug: Drug | null,
  machine: Machine | null,
  applicationMethod: ApplicationMethod,
  area?: number,
  volume?: number,
  environment?: 'indoor' | 'outdoor'
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 基础参数校验
  if (!drug) {
    errors.push('请选择药物');
  }
  if (!machine) {
    errors.push('请选择喷雾器械');
  }
  if (area !== undefined && area <= 0) {
    errors.push('面积必须大于0');
  }
  if (volume !== undefined && volume <= 0) {
    errors.push('体积必须大于0');
  }

  if (errors.length > 0) {
    return { canCalculate: false, riskLevel: 'RED', errors, warnings };
  }

  // 以下校验需要 drug 和 machine 非空
  const d = drug!;
  const m = machine!;

  // 2. 药物状态校验 — PARTIAL/EXPIRED/DISABLED 禁止计算
  const statusMsg = getDrugStatusMessage(d);
  if (statusMsg) {
    if (d.status === 'DISABLED' || d.status === 'EXPIRED') {
      errors.push(statusMsg);
    } else if (d.status === 'VERIFIED_REGISTRATION') {
      errors.push(statusMsg);
    }
  }
  if (d.status !== 'CUSTOM') {
    const calculabilityIssues = getDrugCalculabilityIssues(d, applicationMethod, environment);
    if (calculabilityIssues.length > 0) {
      errors.push(`该药物不能用于当前正式计算：${calculabilityIssues.join('、')}`);
    }
  }

  // 3. 器械参数校验
  const machineValidation = validateMachine(m);
  errors.push(...machineValidation.errors);
  warnings.push(...machineValidation.warnings);

  // 4. 剂型—施药方式兼容性
  const formulationCompat = checkFormulationCompatibility(d.formulationType, applicationMethod);
  if (!formulationCompat.compatible) {
    errors.push(formulationCompat.reason!);
  }

  // 5. 器械—施药方式兼容性
  const machineMethodCompat = checkMachineMethodCompatibility(m, applicationMethod);
  if (!machineMethodCompat.compatible) {
    errors.push(machineMethodCompat.reason!);
  }

  // 6. 剂型—器械兼容性
  const formulationMachineCompat = checkFormulationMachineCompatibility(d.formulationType, m);
  if (!formulationMachineCompat.compatible) {
    errors.push(formulationMachineCompat.reason!);
  }

  // 7. 药物—器械场景兼容性（室内小空间过滤）
  if (applicationMethod === 'INDOOR' && m.allowedScenes) {
    if (!m.allowedScenes.includes('INDOOR_SMALL')) {
      errors.push(`器械"${m.machineName}"不适用于室内小空间场景`);
    }
  }

  // 8. 滞留喷洒器械类型检查
  if (applicationMethod === 'RESIDUAL' && m.allowedMethods) {
    if (!m.allowedMethods.includes('RESIDUAL')) {
      errors.push(`器械"${m.machineName}"不是滞留喷洒设备，请选择专用滞留喷洒器械`);
    }
  }

  // 9. 剂量检查 — 检查 dose 字段或 uses[] 数组
  const hasDoseInField = d.dose && d.dose.value > 0;
  const hasDoseInUses = d.uses && d.uses.length > 0 && d.uses.some(u => u.dose && u.dose.value > 0);

  if (!hasDoseInField && !hasDoseInUses) {
    errors.push('药物缺少剂量信息');
  } else if (d.dose && d.dose.value <= 0) {
    errors.push('药物剂量必须大于0');
  }

  // 10. 防治对象检查
  if (d.target && d.target.length > 0 && !d.target.includes('蚊')) {
    warnings.push(`该药物登记防治对象为${d.target.join('、')}，未包含"蚊"`);
  }

  // 11. 室内外限制
  if (applicationMethod === 'ULV' || applicationMethod === 'INDOOR') {
    if (!d.outdoorAllowed && applicationMethod === 'ULV' && environment !== 'indoor') {
      warnings.push('该药物未标记允许室外使用');
    }
    if (!d.indoorAllowed && (applicationMethod === 'INDOOR' || environment === 'indoor')) {
      warnings.push('该药物未标记允许室内使用');
    }
  }

  // 12. 自定义药物警告
  if (d.status === 'CUSTOM') {
    warnings.push('当前使用自定义药物，计算结果仅供参考，请核验登记标签数据');
  }

  // 13. 本地数据警告
  if (d.status === 'BAIYUN_LOCAL_ONLY') {
    warnings.push('当前药物数据来源于本地培训资料，建议以最新农药登记标签为准');
  }

  // 14. 复配制剂剂量基准检查
  const usesActiveIngredientDose = d.uses?.some(use =>
    use.dose.type === 'ACTIVE_MASS_PER_VOLUME' || use.dose.type === 'ACTIVE_MASS_PER_AREA'
  ) || d.dose?.type === 'ACTIVE_MASS_PER_VOLUME' || d.dose?.type === 'ACTIVE_MASS_PER_AREA';
  if (d.activeIngredients.length > 1 && usesActiveIngredientDose && !d.doseBasis &&
      !d.uses?.some(use => use.dose.ingredientIndex !== undefined) && d.dose?.ingredientIndex === undefined) {
    warnings.push('该复配制剂未标明剂量基准，计算结果仅供参考');
  }

  // 确定风险等级
  let riskLevel: RiskLevel = 'GREEN';
  if (errors.length > 0) {
    riskLevel = 'RED';
  } else if (warnings.length > 0) {
    riskLevel = 'YELLOW';
  }

  return {
    canCalculate: errors.length === 0,
    riskLevel,
    errors,
    warnings,
  };
}

/**
 * 将校验结果转换为计算警告
 */
export function validationToWarnings(result: ValidationResult): CalculationWarning[] {
  const warnings: CalculationWarning[] = [];

  for (const error of result.errors) {
    warnings.push({ level: 'RED', message: error });
  }
  for (const warning of result.warnings) {
    warnings.push({ level: 'YELLOW', message: warning });
  }

  return warnings;
}
