// ============================================================
// 药物自动发现服务 (V2.5)
//
// 功能：
// 1. 定义 ICAMA 搜索查询结构
// 2. 解析 ICAMA 搜索结果格式
// 3. 验证并评分发现的药物
// 4. 与核验流水线集成（评分 + UNIQUE 约束）
// 5. 批量导入验证
//
// 由于 ICAMA 官网可能无法直接访问，本模块支持：
// - 手动粘贴 ICAMA 数据（JSON 格式）
// - 导入 CSV/JSON 数据文件
// - 通过搜索引擎发现的结构化数据
// ============================================================

import type { Drug, DrugStatus, FormulationType, ApplicationMethod, DiluentType, ActiveIngredient, DrugDose } from '@/types';
import {
  calculateMatchScore,
  checkRegistrationConflict,
  FORMULATION_SYNONYMS,
} from '@/verification';

/** 发现来源类型 */
export type DiscoverySource =
  | 'ICAMA_SEARCH'        // ICAMA 表单查询
  | 'ICAMA_LABEL'         // ICAMA 标签页
  | 'MOA_ANNOUNCEMENT'    // 农业农村部登记公告
  | 'NONGCHACHA'          // 农查查第三方
  | 'MANUAL_IMPORT'       // 手动导入
  | 'BATCH_IMPORT';       // 批量导入

/** ICAMA 搜索查询 */
export interface ICAMASearchQuery {
  /** 卫生杀虫剂类别 */
  category?: '卫生杀虫剂';
  /** 有效成分名称 */
  activeIngredient?: string;
  /** 登记证号 */
  registrationNo?: string;
  /** 产品名称 */
  productName?: string;
  /** 防治对象 */
  target?: string;
}

/** ICAMA 原始记录格式 */
export interface ICAMARawRecord {
  /** 登记证号 (WP...) */
  registrationNo: string;
  /** 产品名称 */
  productName: string;
  /** 登记证持有人 */
  holder: string;
  /** 有效成分 */
  activeIngredients: { name: string; value: string; unit: string }[];
  /** 剂型 */
  formulationType: string;
  /** 防治对象 */
  target: string[];
  /** 毒性 */
  toxicity?: string;
  /** 有效期至 */
  validUntil?: string;
  /** 登记状态 */
  registrationStatus?: string;
  /** 使用范围/场所 */
  usageScope?: string[];
  /** 使用方法 */
  usageMethods?: string[];
  /** 制剂用药量 (可能有多个) */
  dosageInfo?: { method: string; dose: string; unit: string; target?: string }[];
  /** 来源URL */
  sourceUrl?: string;
}

/** 发现结果 */
export interface DiscoveryResult {
  /** 是否成功解析 */
  success: boolean;
  /** 转换后的药物数据（待入库） */
  drug?: Partial<Drug>;
  /** 匹配评分 */
  matchScore?: number;
  /** 核验状态 */
  status?: DrugStatus;
  /** 警告信息 */
  warnings: string[];
  /** 错误信息 */
  errors: string[];
  /** 冲突的已有药物 */
  conflictDrug?: Drug;
}

/** 批量导入结果 */
export interface BatchImportResult {
  total: number;
  imported: number;
  skipped: number;
  conflicted: number;
  errors: { index: number; error: string }[];
  results: DiscoveryResult[];
}

/**
 * 卫生杀虫剂常用有效成分列表
 * 用于 ICAMA 搜索和验证
 */
export const PUBLIC_HEALTH_INGREDIENTS = [
  '高效氯氰菊酯',
  '高效氯氟氰菊酯',
  '高效氟氯氰菊酯',
  '溴氰菊酯',
  '氯菊酯',
  '四氟醚菊酯',
  '氯氟醚菊酯',
  'Es-生物烯丙菊酯',
  '残杀威',
  '右旋苯醚氰菊酯',
  '右旋苯醚菊酯',
  '四氟苯菊酯',
  '氯丙炔菊酯',
  '噁虫酮',
  '醚菊酯',
  '吡丙醚',
  '双硫磷',
  '倍硫磷',
  'S-烯虫酯',
  '苏云金杆菌以色列亚种',
  '甲基嘧啶磷',
  '呋虫胺',
  '吡虫啉',
  '氟氯氰菊酯',
] as const;

/**
 * 生成 ICAMA 搜索查询列表
 * 遍历所有常用有效成分 × 卫生杀虫剂
 */
export function generateICAMASearchQueries(): ICAMASearchQuery[] {
  const queries: ICAMASearchQuery[] = [];

  for (const ingredient of PUBLIC_HEALTH_INGREDIENTS) {
    queries.push({
      category: '卫生杀虫剂',
      activeIngredient: ingredient,
      target: '蚊',
    });
  }

  return queries;
}

/**
 * 标准化剂型名称
 */
function normalizeFormulation(raw: string): FormulationType | null {
  const upper = raw.toUpperCase().trim();

  // 直接匹配代码
  if (['EC', 'EW', 'WP', 'SC', 'CS', 'OL', 'WG', 'GR', 'ME', 'SL'].includes(upper)) {
    return upper as FormulationType;
  }

  // 匹配中文
  for (const [code, names] of Object.entries(FORMULATION_SYNONYMS)) {
    if (names.some(n => raw.includes(n))) {
      return code as FormulationType;
    }
  }

  return null;
}

/**
 * 将登记标签中常见的剂量单位统一为计算引擎支持的单位。
 * 无法确认的单位不做猜测，避免把面积剂量误当成空间剂量。
 */
function normalizeDose(value: number, rawUnit: string): DrugDose | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const unit = rawUnit
    .trim()
    .replace(/[³]/g, '3')
    .replace(/[²]/g, '2')
    .replace(/[μµ]/g, 'u')
    .replace(/\s+/g, '')
    .toLowerCase();

  const definitions: Record<string, { type: DrugDose['type']; unit: DrugDose['unit']; scale: number }> = {
    'ml/m3': { type: 'FORMULATION_VOLUME_PER_VOLUME', unit: 'mL/m3', scale: 1 },
    '毫升/立方米': { type: 'FORMULATION_VOLUME_PER_VOLUME', unit: 'mL/m3', scale: 1 },
    'ul/m3': { type: 'FORMULATION_VOLUME_PER_VOLUME', unit: 'mL/m3', scale: 0.001 },
    '微升/立方米': { type: 'FORMULATION_VOLUME_PER_VOLUME', unit: 'mL/m3', scale: 0.001 },
    'mg/m3': { type: 'ACTIVE_MASS_PER_VOLUME', unit: 'mg/m3', scale: 1 },
    '毫克/立方米': { type: 'ACTIVE_MASS_PER_VOLUME', unit: 'mg/m3', scale: 1 },
    'g/m3': { type: 'ACTIVE_MASS_PER_VOLUME', unit: 'mg/m3', scale: 1000 },
    '克/立方米': { type: 'ACTIVE_MASS_PER_VOLUME', unit: 'mg/m3', scale: 1000 },
    'ug/m3': { type: 'ACTIVE_MASS_PER_VOLUME', unit: 'mg/m3', scale: 0.001 },
    '微克/立方米': { type: 'ACTIVE_MASS_PER_VOLUME', unit: 'mg/m3', scale: 0.001 },
    'ml/m2': { type: 'FORMULATION_VOLUME_PER_AREA', unit: 'mL/m2', scale: 1 },
    '毫升/平方米': { type: 'FORMULATION_VOLUME_PER_AREA', unit: 'mL/m2', scale: 1 },
    'ul/m2': { type: 'FORMULATION_VOLUME_PER_AREA', unit: 'mL/m2', scale: 0.001 },
    '微升/平方米': { type: 'FORMULATION_VOLUME_PER_AREA', unit: 'mL/m2', scale: 0.001 },
    'g/m2': { type: 'FORMULATION_MASS_PER_AREA', unit: 'g/m2', scale: 1 },
    '克/平方米': { type: 'FORMULATION_MASS_PER_AREA', unit: 'g/m2', scale: 1 },
    'mg/m2': { type: 'ACTIVE_MASS_PER_AREA', unit: 'mg/m2', scale: 1 },
    '毫克/平方米': { type: 'ACTIVE_MASS_PER_AREA', unit: 'mg/m2', scale: 1 },
    'ug/m2': { type: 'ACTIVE_MASS_PER_AREA', unit: 'mg/m2', scale: 0.001 },
    '微克/平方米': { type: 'ACTIVE_MASS_PER_AREA', unit: 'mg/m2', scale: 0.001 },
    '倍': { type: 'DILUTION_RATIO', unit: '倍', scale: 1 },
    '倍液': { type: 'DILUTION_RATIO', unit: '倍', scale: 1 },
  };

  const definition = definitions[unit];
  if (!definition) return undefined;

  return {
    type: definition.type,
    value: value * definition.scale,
    unit: definition.unit,
  };
}

/**
 * 推断施药方式
 */
function inferApplicationMethods(
  record: ICAMARawRecord,
  formulationType: FormulationType
): ApplicationMethod[] {
  const methods: ApplicationMethod[] = [];
  const scopeStr = (record.usageScope || []).join(' ');
  const methodStr = (record.usageMethods || []).join(' ');
  const combined = `${scopeStr} ${methodStr} ${record.productName}`.toLowerCase();

  // 水乳剂/微乳剂/油剂/可溶液剂 → ULV
  if (['EW', 'ME', 'OL', 'SL', 'EC'].includes(formulationType)) {
    methods.push('ULV');
  }

  // 室内关键词
  if (combined.includes('室内') || combined.includes('空间') || combined.includes('喷雾')) {
    if (!methods.includes('INDOOR')) methods.push('INDOOR');
  }

  // 滞留关键词
  if (combined.includes('滞留') || combined.includes('喷洒') || combined.includes('表面')) {
    if (!methods.includes('RESIDUAL')) methods.push('RESIDUAL');
  }

  // 热烟雾关键词
  if (combined.includes('热烟雾') || combined.includes('热力')) {
    if (!methods.includes('THERMAL_FOG')) methods.push('THERMAL_FOG');
  }

  // 默认：如果没匹配到任何方式，给 ULV + INDOOR
  if (methods.length === 0) {
    methods.push('ULV', 'INDOOR');
  }

  return methods;
}

/**
 * 解析 ICAMA 原始记录为药物数据
 */
export function parseICAMARecord(record: ICAMARawRecord): {
  drug: Partial<Drug>;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 验证必填字段
  if (!record.registrationNo || !record.registrationNo.startsWith('WP')) {
    errors.push(`登记证号无效: ${record.registrationNo}`);
  }
  if (!record.productName) {
    errors.push('缺少产品名称');
  }
  if (!record.activeIngredients || record.activeIngredients.length === 0) {
    errors.push('缺少有效成分信息');
  }

  if (errors.length > 0) {
    return { drug: {}, warnings, errors };
  }

  // 解析有效成分
  const ingredients: ActiveIngredient[] = record.activeIngredients.map(ai => ({
    name: ai.name,
    value: parseFloat(ai.value),
    unit: ai.unit as '%' | 'g/L' | 'mg/mL',
  }));

  // 解析剂型
  const formulationType = normalizeFormulation(record.formulationType);
  if (!formulationType) {
    warnings.push(`无法识别剂型: ${record.formulationType}，默认使用 EW`);
  }

  // 推断施药方式
  const methods = inferApplicationMethods(record, formulationType || 'EW');

  // 推断环境
  const hasIndoor = methods.some(m => ['INDOOR', 'RESIDUAL'].includes(m));
  const hasOutdoor = methods.some(m => ['ULV', 'THERMAL_FOG'].includes(m));

  // 解析剂量
  let dose: DrugDose | undefined;
  if (record.dosageInfo && record.dosageInfo.length > 0) {
    const firstDose = record.dosageInfo[0];
    const doseMatch = firstDose.dose.match(/([\d.]+)\s*(.*)/);
    if (doseMatch) {
      const doseValue = parseFloat(doseMatch[1]);
      const doseUnit = firstDose.unit || doseMatch[2];
      dose = normalizeDose(doseValue, doseUnit);
      if (!dose) {
        warnings.push(`无法确认剂量单位“${doseUnit || '空'}”，该条记录不会用于计算`);
      }
    }
  }

  // 推断稀释剂
  const diluent: DiluentType = formulationType === 'OL' ? 'oil' : 'water';

  const drug: Partial<Drug> = {
    productName: record.productName,
    registrationNo: record.registrationNo,
    holder: record.holder,
    manufacturer: record.holder, // ICAMA 只有 holder
    category: '卫生杀虫剂',
    formulationType: formulationType || 'EW',
    activeIngredients: ingredients,
    target: record.target.length > 0 ? record.target : ['蚊'],
    environments: [...(hasIndoor ? ['indoor' as const] : []), ...(hasOutdoor ? ['outdoor' as const] : [])],
    applicationMethods: methods,
    dose,
    recommendedDilution: 1,
    diluent,
    indoorAllowed: hasIndoor,
    outdoorAllowed: hasOutdoor,
    registrationValidUntil: record.validUntil,
    status: 'AUTO_DISCOVERY' as DrugStatus,
    source: {
      type: 'ICAMA_SEARCH',
      url: record.sourceUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
    },
    labelSource: 'ICAMA 国家农药登记数据库',
    labelDate: new Date().toISOString().slice(0, 10),
    dataVersion: '2026.1',
    verification: {
      status: 'AUTO_DISCOVERY' as DrugStatus,
      verificationMethod: 'ICAMA_SEARCH',
      verifiedAt: new Date().toISOString().slice(0, 10),
      confidence: 'LOW',
      warnings: ['刚从 ICAMA 发现，尚需交叉核验'],
    },
  };

  return { drug, warnings, errors };
}

/**
 * 验证发现的药物
 * 评分 + UNIQUE 约束检查
 */
export function validateDiscoveredDrug(
  discoveredDrug: Partial<Drug>,
  existingDrugs: Drug[],
  referenceDrug?: Drug
): DiscoveryResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. 基本验证
  if (!discoveredDrug.registrationNo) {
    errors.push('缺少登记证号');
    return { success: false, warnings, errors };
  }
  if (!discoveredDrug.productName) {
    errors.push('缺少产品名称');
    return { success: false, warnings, errors };
  }
  if (!discoveredDrug.activeIngredients || discoveredDrug.activeIngredients.length === 0) {
    errors.push('缺少有效成分');
    return { success: false, warnings, errors };
  }

  // 2. UNIQUE 约束检查
  const conflictCheck = checkRegistrationConflict(
    existingDrugs,
    discoveredDrug.registrationNo,
    {
      activeIngredients: discoveredDrug.activeIngredients,
      formulationType: discoveredDrug.formulationType || 'EW',
    }
  );
  if (conflictCheck.conflict) {
    errors.push(conflictCheck.reason!);
    return { success: false, warnings, errors, conflictDrug: conflictCheck.existingDrug };
  }

  // 3. 匹配评分（如果有参考药物）
  let matchScore = 0;
  if (referenceDrug) {
    const scoreResult = calculateMatchScore(
      {
        activeIngredients: discoveredDrug.activeIngredients,
        formulationType: discoveredDrug.formulationType || 'EW',
        target: discoveredDrug.target,
      },
      {
        activeIngredients: referenceDrug.activeIngredients,
        formulationType: referenceDrug.formulationType,
        target: referenceDrug.target,
      }
    );
    matchScore = scoreResult.score;
    warnings.push(`与参考药物 "${referenceDrug.productName}" 匹配度: ${matchScore}分`);

    if (matchScore < 75) {
      warnings.push('匹配度不足75分，不建议直接导入');
    }
  }

  // 4. 确定核验状态
  const hasDose = !!discoveredDrug.dose;
  const hasTarget = discoveredDrug.target && discoveredDrug.target.length > 0;
  const hasMethod = discoveredDrug.applicationMethods && discoveredDrug.applicationMethods.length > 0;
  const hasValidUntil = !!discoveredDrug.registrationValidUntil;

  let status: DrugStatus;
  if (matchScore >= 90 && hasDose && hasTarget && hasMethod && hasValidUntil) {
    status = 'VERIFIED_CALCULABLE';
  } else if (matchScore >= 90) {
    status = 'VERIFIED_REGISTRATION';
  } else if (matchScore >= 75) {
    status = 'AUTO_LABEL_SEARCH';
  } else {
    status = 'AUTO_DISCOVERY';
  }

  return {
    success: true,
    drug: { ...discoveredDrug, status },
    matchScore,
    status,
    warnings,
    errors,
  };
}

/**
 * 批量导入药物
 * 接受 ICAMA 原始记录数组，返回导入结果
 */
export function batchImportDrugs(
  records: ICAMARawRecord[],
  existingDrugs: Drug[],
  options: {
    minScore?: number;
    referenceDrug?: Drug;
  } = {}
): BatchImportResult {
  const { minScore = 0, referenceDrug } = options;
  const results: DiscoveryResult[] = [];
  const errors: { index: number; error: string }[] = [];
  let imported = 0;
  let skipped = 0;
  let conflicted = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // 解析
    const parsed = parseICAMARecord(record);
    if (parsed.errors.length > 0) {
      results.push({ success: false, warnings: parsed.warnings, errors: parsed.errors });
      errors.push({ index: i, error: parsed.errors.join('; ') });
      continue;
    }

    // 验证
    const validated = validateDiscoveredDrug(parsed.drug, existingDrugs, referenceDrug);
    results.push({ ...validated, warnings: [...parsed.warnings, ...validated.warnings] });

    if (!validated.success) {
      if (validated.conflictDrug) {
        conflicted++;
      } else {
        errors.push({ index: i, error: validated.errors.join('; ') });
      }
      continue;
    }

    // 检查最低分数
    if (validated.matchScore !== undefined && validated.matchScore < minScore) {
      skipped++;
      continue;
    }

    imported++;
  }

  return {
    total: records.length,
    imported,
    skipped,
    conflicted,
    errors,
    results,
  };
}

/**
 * 从 JSON 字符串导入 ICAMA 记录
 */
export function parseICAMAJson(jsonStr: string): ICAMARawRecord[] {
  try {
    const data = JSON.parse(jsonStr);
    if (!Array.isArray(data)) {
      return [data];
    }
    return data;
  } catch {
    return [];
  }
}

/**
 * 从 CSV 文本解析 ICAMA 记录
 * 格式: registrationNo,productName,holder,formulationType,ingredient1|value1|unit1;ingredient2|value2|unit2,target1|target2,validUntil
 */
export function parseICAMACsv(csvStr: string): ICAMARawRecord[] {
  const lines = csvStr.trim().split('\n');
  if (lines.length < 2) return [];

  const records: ICAMARawRecord[] = [];
  // 跳过标题行
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 5) continue;

    const ingredients = (cols[4] || '').split(';').map(ing => {
      const parts = ing.split('|');
      return {
        name: parts[0] || '',
        value: parts[1] || '0',
        unit: parts[2] || '%',
      };
    }).filter(ing => ing.name);

    records.push({
      registrationNo: cols[0] || '',
      productName: cols[1] || '',
      holder: cols[2] || '',
      formulationType: cols[3] || '',
      activeIngredients: ingredients,
      target: (cols[5] || '').split('|').filter(Boolean),
      validUntil: cols[6] || undefined,
    });
  }

  return records;
}

/**
 * 生成发现摘要
 */
export function generateDiscoverySummary(result: BatchImportResult): string {
  const lines = [
    `批量导入结果:`,
    `  总数: ${result.total}`,
    `  已导入: ${result.imported}`,
    `  跳过(低分): ${result.skipped}`,
    `  冲突(WP号重复): ${result.conflicted}`,
    `  错误: ${result.errors.length}`,
  ];

  if (result.errors.length > 0) {
    lines.push('', '错误详情:');
    for (const err of result.errors) {
      lines.push(`  #${err.index + 1}: ${err.error}`);
    }
  }

  return lines.join('\n');
}
