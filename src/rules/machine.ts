// ============================================================
// 器械校验规则
// ============================================================

import type { Machine, ApplicationMethod, FormulationType } from '@/types';

/**
 * 器械参数校验结果
 */
export interface MachineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 校验器械参数是否完整
 */
export function validateMachine(machine: Machine): MachineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!machine.machineName) {
    errors.push('器械名称不能为空');
  }
  if (!machine.machineType) {
    errors.push('器械类型不能为空');
  }

  // 校验流量
  if (machine.flow) {
    if (machine.flow.type === 'FIXED') {
      if (!machine.flow.mlPerSecond || machine.flow.mlPerSecond <= 0) {
        errors.push('器械固定流量必须大于0');
      }
    } else if (machine.flow.type === 'VARIABLE') {
      if (!machine.flow.maxMlPerSecond || machine.flow.maxMlPerSecond <= 0) {
        errors.push('器械最大流量必须大于0');
      }
    }
  } else {
    // 兼容旧数据
    if (!machine.flowMlPerSecond || machine.flowMlPerSecond <= 0) {
      errors.push('器械流量参数缺失');
    }
  }

  if (!machine.swathMeter || machine.swathMeter <= 0) {
    errors.push('喷幅必须大于0');
  }

  if (machine.isCustom) {
    warnings.push('当前使用用户自定义器械参数，请确认准确性');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 获取器械的实际流量 (mL/s)
 *
 * 优先级：指定 profile > defaultMlPerSecond > maxMlPerSecond > 旧数据
 */
export function getMachineFlow(machine: Machine, profileId?: string): number {
  // 优先使用指定的 profile
  if (profileId && machine.profiles) {
    const profile = machine.profiles.find(p => p.id === profileId);
    if (profile) return profile.flowMlPerSecond;
  }

  // 新数据结构
  if (machine.flow) {
    if (machine.flow.type === 'FIXED' && machine.flow.mlPerSecond) {
      return machine.flow.mlPerSecond;
    }
    if (machine.flow.type === 'VARIABLE') {
      // 优先使用默认流量，否则使用最大流量
      if (machine.flow.defaultMlPerSecond) return machine.flow.defaultMlPerSecond;
      if (machine.flow.maxMlPerSecond) return machine.flow.maxMlPerSecond;
    }
  }

  // 兼容旧数据
  if (machine.flowMlPerSecond) {
    return machine.flowMlPerSecond;
  }

  return 0;
}

/**
 * 获取器械的实际喷幅 (m)
 *
 * 优先级：指定 profile 的 swathMeter > 机器默认 swathMeter
 */
export function getMachineSwath(machine: Machine, profileId?: string): number {
  if (profileId && machine.profiles) {
    const profile = machine.profiles.find(p => p.id === profileId);
    if (profile && profile.swathMeter) return profile.swathMeter;
  }
  return machine.swathMeter || 0;
}

/**
 * 检查器械类型与施药方式的兼容性
 */
export function checkMachineMethodCompatibility(
  machine: Machine,
  applicationMethod: ApplicationMethod
): { compatible: boolean; reason?: string } {
  // 新数据结构：使用 allowedMethods
  if (machine.allowedMethods && machine.allowedMethods.length > 0) {
    if (!machine.allowedMethods.includes(applicationMethod)) {
      return {
        compatible: false,
        reason: `${machine.machineName} 不支持当前施药方式`,
      };
    }
    return { compatible: true };
  }

  // 兼容旧数据：按器械类型推断
  const typeMethodMap: Record<string, ApplicationMethod[]> = {
    ULV_BACKPACK: ['ULV', 'INDOOR'],
    ULV_VEHICLE: ['ULV'],
    ULV_CARRY: ['ULV', 'INDOOR'],
    ULV_PORTABLE: ['ULV', 'INDOOR'],
    THERMAL_FOG: ['THERMAL_FOG'],
    RESIDUAL_SPRAYER: ['RESIDUAL'],
    'ULV背负式': ['ULV', 'INDOOR'],
    'ULV车载式': ['ULV'],
    '热烟雾机': ['THERMAL_FOG'],
    '手动喷雾器': ['RESIDUAL', 'INDOOR'],
    '机动喷雾器': ['RESIDUAL', 'INDOOR', 'ULV'],
  };

  const supportedMethods = typeMethodMap[machine.machineType] || [];
  if (!supportedMethods.includes(applicationMethod)) {
    return {
      compatible: false,
      reason: `${machine.machineName} (${machine.machineType}) 不适合当前施药方式`,
    };
  }

  return { compatible: true };
}

/**
 * 校验剂型与器械的兼容性
 * 例如：WP(可湿性粉剂) 不能用于ULV喷机，可能堵塞喷嘴
 */
export function checkFormulationMachineCompatibility(
  formulationType: FormulationType,
  machine: Machine
): { compatible: boolean; reason?: string } {
  // WP/WG 等固体剂型不能用于ULV喷机
  const solidTypes = ['WP', 'WG', 'GR'];
  const ulvMachineTypes = ['ULV_BACKPACK', 'ULV_VEHICLE', 'ULV_CARRY', 'ULV_PORTABLE', 'ULV背负式', 'ULV车载式'];

  if (solidTypes.includes(formulationType) && ulvMachineTypes.includes(machine.machineType)) {
    return {
      compatible: false,
      reason: `${formulationType}剂型不适合${machine.machineName}，可能堵塞喷嘴`,
    };
  }

  return { compatible: true };
}
