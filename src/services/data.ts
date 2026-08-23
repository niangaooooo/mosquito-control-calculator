// ============================================================
// 数据服务 — 加载药物和器械数据 (V2.5)
// ============================================================

import type { Drug, DrugUse, Machine, ApplicationMethod, DrugStatus } from '@/types';
import drugsData from '@/data/drugs.json';
import { ICAMA_COMMON_DRUGS } from '@/data/common-drugs-icama';
import machinesData from '@/data/machines.json';
import { checkExpiryStatus, generateVerificationReport, isCalculable, isAutoVerifying } from '@/verification';

export { isCalculable, isAutoVerifying };

/** 获取所有药物 */
export function getAllDrugs(): Drug[] {
  return [...(drugsData as unknown as Drug[]), ...ICAMA_COMMON_DRUGS];
}

/** 获取可用于自动计算的药物 */
export function getCalculableDrugs(): Drug[] {
  return getAllDrugs().filter(d => isDrugCalculable(d));
}

/** 获取指定施药方式下真正具备完整计算数据的药物 */
export function getCalculableDrugsForMethod(method: ApplicationMethod, environment?: 'indoor' | 'outdoor'): Drug[] {
  return getAllDrugs()
    .filter(d => isDrugCalculable(d, method, environment))
    .sort((a, b) => {
      const localA = a.baiyunTraining || a.localEfficacy?.length ? 1 : 0;
      const localB = b.baiyunTraining || b.localEfficacy?.length ? 1 : 0;
      return localB - localA || a.productName.localeCompare(b.productName, 'zh-CN');
    });
}

/** 根据ID获取药物 */
export function getDrugById(id: string): Drug | undefined {
  return getAllDrugs().find(d => d.id === id);
}

/** 搜索药物（按商品名、登记证号、有效成分、别名） */
export function searchDrugs(query: string): Drug[] {
  const q = query.toLowerCase();
  return getAllDrugs().filter(
    d =>
      d.productName.toLowerCase().includes(q) ||
      d.registrationNo.toLowerCase().includes(q) ||
      (d.registeredName && d.registeredName.toLowerCase().includes(q)) ||
      d.activeIngredients.some(ai => ai.name.toLowerCase().includes(q)) ||
      d.synonyms?.some(s => s.toLowerCase().includes(q))
  );
}

/** 从当前药物库生成有效成分候选项，避免各计算页面维护不完整的固定名单。 */
export function getAllActiveIngredientNames(): string[] {
  return Array.from(new Set(
    getAllDrugs().flatMap(drug => drug.activeIngredients.map(ingredient => ingredient.name.trim()))
  ))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 按施药方式过滤药物 */
export function filterDrugsByMethod(drugs: Drug[], method: ApplicationMethod): Drug[] {
  return drugs.filter(d => hasUseForMethod(d, method));
}

/** 获取所有器械 */
export function getAllMachines(): Machine[] {
  return machinesData as unknown as Machine[];
}

/** 根据ID获取器械 */
export function getMachineById(id: string): Machine | undefined {
  return getAllMachines().find(m => m.id === id);
}

/** 按场景过滤器械 */
export function filterMachinesByScene(machines: Machine[], scene: string): Machine[] {
  return machines.filter(m => !m.allowedScenes || m.allowedScenes.includes(scene));
}

/** 按施药方式过滤器械 */
export function filterMachinesByMethod(machines: Machine[], method: ApplicationMethod): Machine[] {
  return machines.filter(m => !m.allowedMethods || m.allowedMethods.includes(method));
}

const SPACE_DOSE_TYPES = new Set(['FORMULATION_VOLUME_PER_VOLUME', 'ACTIVE_MASS_PER_VOLUME']);
const AREA_DOSE_TYPES = new Set(['FORMULATION_VOLUME_PER_AREA', 'FORMULATION_MASS_PER_AREA', 'ACTIVE_MASS_PER_AREA']);

function hasCompatibleDose(
  drug: Drug,
  use: DrugUse,
  method: ApplicationMethod,
  environment?: 'indoor' | 'outdoor'
): boolean {
  if (!Number.isFinite(use.dose?.value) || use.dose.value <= 0) return false;

  const type = use.dose.type;
  const unit = use.dose.unit;
  const unitMatches =
    (type === 'FORMULATION_VOLUME_PER_VOLUME' && unit === 'mL/m3') ||
    (type === 'ACTIVE_MASS_PER_VOLUME' && unit === 'mg/m3') ||
    (type === 'FORMULATION_VOLUME_PER_AREA' && unit === 'mL/m2') ||
    (type === 'FORMULATION_MASS_PER_AREA' && unit === 'g/m2') ||
    (type === 'ACTIVE_MASS_PER_AREA' && unit === 'mg/m2');
  if (!unitMatches) return false;
  if ((type === 'ACTIVE_MASS_PER_VOLUME' || type === 'ACTIVE_MASS_PER_AREA') &&
      drug.activeIngredients.length > 1 &&
      !drug.doseBasis &&
      use.dose.ingredientIndex === undefined) {
    return false;
  }
  if (type === 'FORMULATION_MASS_PER_AREA' && (!drug.formulationDensity || drug.formulationDensity <= 0)) {
    return false;
  }

  if (method === 'RESIDUAL') return use.method === 'RESIDUAL' && AREA_DOSE_TYPES.has(type);
  if (method === 'INDOOR') {
    return use.environments.includes('indoor') &&
      (use.method === 'INDOOR' || use.method === 'ULV') &&
      SPACE_DOSE_TYPES.has(type);
  }
  if (method === 'ULV') {
    return use.method === 'ULV' &&
      (!environment || use.environments.includes(environment)) &&
      (SPACE_DOSE_TYPES.has(type) ||
        type === 'FORMULATION_VOLUME_PER_AREA' ||
        (type === 'FORMULATION_MASS_PER_AREA' && Boolean(drug.formulationDensity)));
  }
  return use.method === method && (SPACE_DOSE_TYPES.has(type) || AREA_DOSE_TYPES.has(type));
}

function hasUseForMethod(drug: Drug, method: ApplicationMethod): boolean {
  if (drug.uses?.some(use => {
    if (method === 'INDOOR') {
      return use.environments.includes('indoor') && (use.method === 'INDOOR' || use.method === 'ULV');
    }
    return use.method === method;
  })) return true;
  return (drug.applicationMethods || []).includes(method);
}

/** 返回阻止药物进入正式自动计算的原因 */
export function getDrugCalculabilityIssues(
  drug: Drug,
  method?: ApplicationMethod,
  environment?: 'indoor' | 'outdoor'
): string[] {
  const issues: string[] = [];
  if (!isCalculable(drug.status)) issues.push('状态不是已核验可计算');
  if (!/^WP\d+$/i.test(drug.registrationNo)) issues.push('缺少有效农药登记证号');
  if (drug.verification?.verificationMethod !== 'OFFICIAL_AUTO') issues.push('未完成国家官方自动核验');
  if (drug.verification?.confidence !== 'HIGH') issues.push('官方核验置信度不足');
  if (!drug.registrationValidUntil) {
    issues.push('缺少登记有效期');
  } else if (checkExpiryStatus(drug.registrationValidUntil).isExpired) {
    issues.push('登记已过期');
  }

  const uses = drug.uses || [];
  if (method) {
    if (!uses.some(use => hasCompatibleDose(drug, use, method, environment))) issues.push('当前施药方式缺少可计算的登记剂量');
  } else if (!uses.some(use =>
    hasCompatibleDose(drug, use, 'ULV') ||
    hasCompatibleDose(drug, use, 'INDOOR') ||
    hasCompatibleDose(drug, use, 'RESIDUAL')
  )) {
    issues.push('没有可直接计算的登记使用场景');
  }
  return issues;
}

/** 检查药物是否可以参与自动计算 */
export function isDrugCalculable(
  drug: Drug,
  method?: ApplicationMethod,
  environment?: 'indoor' | 'outdoor'
): boolean {
  return getDrugCalculabilityIssues(drug, method, environment).length === 0;
}

/** 把静态标记与当前数据完整性合并为页面实际状态 */
export function getEffectiveDrugStatus(drug: Drug): DrugStatus {
  if (drug.status === 'VERIFIED_CALCULABLE' && !isDrugCalculable(drug)) {
    return 'VERIFIED_REGISTRATION';
  }
  return drug.status;
}

/** 获取药物状态提示 */
export function getDrugStatusMessage(drug: Drug): string | null {
  const effectiveStatus = getEffectiveDrugStatus(drug);
  if (drug.status === 'VERIFIED_CALCULABLE' && effectiveStatus === 'VERIFIED_REGISTRATION') {
    return `该药物登记信息已记录，但${getDrugCalculabilityIssues(drug).join('、')}，暂不能参与正式自动计算。`;
  }
  switch (effectiveStatus) {
    case 'VERIFIED_REGISTRATION':
      return '该药物国家登记已确认，但使用剂量信息尚不完整，暂不能参与自动计算。';
    case 'AUTO_DISCOVERY':
      return '该药物正在自动核验中，系统正在反查国家登记库。';
    case 'AUTO_LABEL_SEARCH':
      return '该药物已找到登记号，系统正在补充标签信息。';
    case 'CONFLICT':
      return '该药物官方来源存在冲突，系统正在继续自动调查。';
    case 'BAIYUN_LOCAL_ONLY':
      return '该药物仅有白云区培训/现场资料，计算结果仅供参考。';
    case 'EXPIRED':
      return '该药物登记已过期，请确认最新登记信息后使用自定义药物功能。';
    case 'DISABLED':
      return '该药物已停用，不能参与计算。';
    case 'CUSTOM':
      return '这是自定义药物，计算结果仅供参考。';
    case 'NEEDS_REVIEW':
      return '该药物所有自动核验路径均未找到匹配，仅可查看。';
    default:
      return null;
  }
}

/** 药物分组类别 */
export type DrugGroupKey = 'BAIYUN_PRIORITY' | 'GUANGZHOU_2026' | 'LARVICIDE' | 'AUTO_VERIFIED' | 'AUTO_VERIFYING' | 'VIEW_ONLY';

/** 药物分组定义 */
export const DRUG_GROUPS: { key: DrugGroupKey; label: string; description: string }[] = [
  { key: 'BAIYUN_PRIORITY', label: '白云区优先', description: '白云区疾控培训常用药及药效验证药物' },
  { key: 'AUTO_VERIFIED', label: '已自动核验', description: '国家登记已确认，可直接计算' },
  { key: 'GUANGZHOU_2026', label: '广州2026常用', description: '广州2026/2025采购清单药物' },
  { key: 'LARVICIDE', label: '灭幼虫', description: '幼虫控制专用药物（Bti、倍硫磷、双硫磷、烯虫酯等）' },
  { key: 'AUTO_VERIFYING', label: '自动核验中', description: '系统正在自动搜索国家登记库' },
  { key: 'VIEW_ONLY', label: '仅查看', description: '登记确认但缺剂量、白云本地或待确认' },
];

/** 按优先级对药物进行分组 */
export function groupDrugs(drugs: Drug[]): Record<DrugGroupKey, Drug[]> {
  const groups: Record<DrugGroupKey, Drug[]> = {
    BAIYUN_PRIORITY: [],
    AUTO_VERIFIED: [],
    GUANGZHOU_2026: [],
    LARVICIDE: [],
    AUTO_VERIFYING: [],
    VIEW_ONLY: [],
  };

  for (const drug of drugs) {
    if (drug.status === 'DISABLED') continue;

    // 白云区培训/药效数据的药物
    if (drug.baiyunTraining || drug.localEfficacy?.length || drug.status === 'BAIYUN_LOCAL_ONLY') {
      groups.BAIYUN_PRIORITY.push(drug);
      continue;
    }

    // 已自动核验可计算
    if (isDrugCalculable(drug)) {
      groups.AUTO_VERIFIED.push(drug);
      continue;
    }

    // 灭幼虫药物
    if (drug.target.some(t => t.includes('幼虫'))) {
      groups.LARVICIDE.push(drug);
      continue;
    }

    // 广州采购清单药物
    if (drug.source?.type?.includes('PROCUREMENT')) {
      groups.GUANGZHOU_2026.push(drug);
      continue;
    }

    // 自动核验中
    if (isAutoVerifying(drug.status)) {
      groups.AUTO_VERIFYING.push(drug);
      continue;
    }

    // 其余归入仅查看
    groups.VIEW_ONLY.push(drug);
  }

  return groups;
}

/** 获取药物的核验摘要报告 */
export function getVerificationSummary() {
  const summary = generateVerificationReport(getAllDrugs());
  summary.verifiedCalculable = getCalculableDrugs().length;
  summary.verifiedRegistration = getAllDrugs().filter(d => getEffectiveDrugStatus(d) === 'VERIFIED_REGISTRATION').length;
  return summary;
}

/** 获取即将到期的药物列表 */
export function getExpiringDrugs(daysThreshold: number = 90): Drug[] {
  return getAllDrugs().filter(drug => {
    if (!drug.registrationValidUntil) return false;
    const { isExpiring } = checkExpiryStatus(drug.registrationValidUntil, daysThreshold);
    return isExpiring;
  });
}

/** 获取正在自动核验中的药物 */
export function getAutoVerifyingDrugs(): Drug[] {
  return getAllDrugs().filter(d => isAutoVerifying(d.status));
}

/** 获取按置信度排序的核验状态统计 */
export function getConfidenceStats(): Record<string, number> {
  const drugs = getAllDrugs();
  const stats: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
  for (const d of drugs) {
    const conf = d.verification?.confidence || 'NONE';
    stats[conf] = (stats[conf] || 0) + 1;
  }
  return stats;
}

/** 数据库完整性校验 — registrationNo 唯一性 */
export function validateDatabaseIntegrity(): { valid: boolean; errors: string[] } {
  const drugs = getAllDrugs();
  const errors: string[] = [];
  const regMap = new Map<string, Drug[]>();

  for (const d of drugs) {
    if (d.status === 'DISABLED' || d.status === 'CUSTOM') continue;
    if (!d.registrationNo || d.registrationNo === '待搜索' || d.registrationNo === '待核验') continue;

    const existing = regMap.get(d.registrationNo) || [];
    existing.push(d);
    regMap.set(d.registrationNo, existing);
  }

  for (const [regNo, drugList] of regMap) {
    if (drugList.length > 1) {
      const names = drugList.map(d => d.productName).join('、');
      errors.push(`WP号 ${regNo} 被多个产品使用: ${names}`);
    }
  }

  // 检查必填字段
  for (const d of drugs) {
    if (d.status === 'DISABLED') continue;
    if (!d.activeIngredients || d.activeIngredients.length === 0) {
      errors.push(`${d.productName}: 有效成分不能为空`);
    }
    if (d.status === 'VERIFIED_CALCULABLE') {
      if (!d.target || d.target.length === 0) errors.push(`${d.productName}: VERIFIED_CALCULABLE 状态必须有防治对象`);
      if (!d.applicationMethods || d.applicationMethods.length === 0) errors.push(`${d.productName}: VERIFIED_CALCULABLE 状态必须有施药方式`);
      if (!d.dose) errors.push(`${d.productName}: VERIFIED_CALCULABLE 状态必须有剂量信息`);
    }
  }

  return { valid: errors.length === 0, errors };
}
