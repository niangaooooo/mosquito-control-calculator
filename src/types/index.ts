// ============================================================
// 媒介伊蚊消杀配药计算器 — 核心类型定义
// ============================================================

/** 剂型枚举 */
export type FormulationType =
  | 'EC'   // 乳油
  | 'EW'   // 水乳剂
  | 'WP'   // 可湿性粉剂
  | 'SC'   // 悬浮剂
  | 'CS'   // 微胶囊剂
  | 'OL'   // 油剂
  | 'WG'   // 水分散粒剂
  | 'GR'   // 颗粒剂
  | 'ME'   // 微乳剂
  | 'SL';  // 可溶液剂

/** 剂型中文映射 */
export const FORMULATION_LABELS: Record<string, string> = {
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

/** 药物核验状态 (V2.5) */
export type DrugStatus =
  | 'VERIFIED_CALCULABLE'    // 官方登记+标签+剂量+方法完整，可直接计算
  | 'VERIFIED_REGISTRATION'  // 官方登记已确认，但缺完整使用剂量
  | 'AUTO_DISCOVERY'         // 正在自动反查登记号
  | 'AUTO_LABEL_SEARCH'      // 已找到登记号，正在补标签
  | 'CONFLICT'               // 官方来源存在冲突，继续自动调查
  | 'BAIYUN_LOCAL_ONLY'      // 只有白云培训/现场资料
  | 'CUSTOM'                 // 用户自定义
  | 'EXPIRED'                // 登记过期
  | 'DISABLED'               // 禁止使用
  | 'NEEDS_REVIEW';          // 所有自动路径均失败后才出现

export const DRUG_STATUS_LABELS: Record<DrugStatus, string> = {
  VERIFIED_CALCULABLE: '已核验·可计算',
  VERIFIED_REGISTRATION: '已核验·登记确认',
  AUTO_DISCOVERY: '自动核验中',
  AUTO_LABEL_SEARCH: '自动核验中',
  CONFLICT: '自动核验中',
  BAIYUN_LOCAL_ONLY: '白云区本地',
  CUSTOM: '自定义',
  EXPIRED: '已过期',
  DISABLED: '已停用',
  NEEDS_REVIEW: '待确认',
};

export const DRUG_STATUS_COLORS: Record<DrugStatus, string> = {
  VERIFIED_CALCULABLE: 'text-green-700 bg-green-50 border-green-200',
  VERIFIED_REGISTRATION: 'text-teal-700 bg-teal-50 border-teal-200',
  AUTO_DISCOVERY: 'text-amber-700 bg-amber-50 border-amber-200',
  AUTO_LABEL_SEARCH: 'text-amber-700 bg-amber-50 border-amber-200',
  CONFLICT: 'text-orange-700 bg-orange-50 border-orange-200',
  BAIYUN_LOCAL_ONLY: 'text-blue-700 bg-blue-50 border-blue-200',
  CUSTOM: 'text-purple-700 bg-purple-50 border-purple-200',
  EXPIRED: 'text-orange-700 bg-orange-50 border-orange-200',
  DISABLED: 'text-red-700 bg-red-50 border-red-200',
  NEEDS_REVIEW: 'text-gray-500 bg-gray-50 border-gray-200',
};

/** 施药方式 */
export type ApplicationMethod = 'ULV' | 'INDOOR' | 'RESIDUAL' | 'THERMAL_FOG';

/** 施药方式中文映射 */
export const APPLICATION_METHOD_LABELS: Record<ApplicationMethod, string> = {
  ULV: '超低容量空间喷雾',
  INDOOR: '室内小空间喷雾',
  RESIDUAL: '滞留喷洒',
  THERMAL_FOG: '热烟雾',
};

/** 施药环境 */
export type Environment = 'outdoor' | 'indoor';

/** 剂量类型 */
export type DoseType =
  | 'FORMULATION_VOLUME_PER_VOLUME'   // mL制剂/m³
  | 'ACTIVE_MASS_PER_VOLUME'          // mg有效成分/m³
  | 'FORMULATION_VOLUME_PER_AREA'     // mL制剂/m²
  | 'FORMULATION_MASS_PER_AREA'       // g制剂/m²
  | 'ACTIVE_MASS_PER_AREA'            // mg有效成分/m²
  | 'DILUTION_RATIO';                 // 稀释倍数

/** 剂量单位 */
export type DoseUnit =
  | 'mL/m3'
  | 'mg/m3'
  | 'mL/m2'
  | 'g/m2'
  | 'mg/m2'
  | '倍';

/** 有效成分浓度单位 */
export type ConcentrationUnit = '%' | 'g/L' | 'mg/mL' | 'g/kg' | 'mg/g';

/** 稀释剂类型 */
export type DiluentType = 'water' | 'oil' | 'deodorizedKerosene' | 'none' | 'multiple';

/** 风险等级 */
export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';

/** 有效成分 */
export interface ActiveIngredient {
  name: string;
  value: number;
  unit: ConcentrationUnit;
  /** 标准化后的值 (mg/mL 或 mg/g) */
  normalizedValue?: number;
  /** 标准化后的单位 */
  normalizedUnit?: 'mg/mL' | 'mg/g';
}

/** 药物剂量 */
export interface DrugDose {
  type: DoseType;
  value: number;
  unit: DoseUnit;
  /** 复配制剂时，指定剂量基准对应的有效成分索引 */
  ingredientIndex?: number;
}

/** 药物使用场景 (支持同一药物多种施用方式) */
export interface DrugUse {
  /** 使用场景ID，如 "ulv_indoor", "residual_wood" */
  id: string;
  /** 施药方式 */
  method: ApplicationMethod;
  /** 适用环境 */
  environments: ('indoor' | 'outdoor')[];
  /** 防治对象 */
  target: string[];
  /** 剂量 */
  dose: DrugDose;
  /** 标签推荐稀释倍数（如有） */
  dilution?: number;
  /** 剂量范围（标签给出区间时使用） */
  doseRange?: {
    min: number;
    max: number;
  };
  /** 表面类型说明（滞留喷洒时使用，如"玻璃/木板面"） */
  surfaceNote?: string;
  /** 备注 */
  notes?: string;
}

/** 药物 */
export interface Drug {
  id: string;
  productName: string;
  registeredName?: string;
  registrationNo: string;
  holder?: string;
  manufacturer: string;
  category?: string;
  formulationType: FormulationType;
  activeIngredients: ActiveIngredient[];
  /** 使用场景列表（新版，支持多种施用方式） */
  uses?: DrugUse[];
  /** @deprecated 旧版单一剂量，优先使用 uses[] */
  dose?: DrugDose;
  target: string[];
  environments: ('indoor' | 'outdoor')[];
  /** @deprecated 旧版施用方式，优先使用 uses[] */
  applicationMethods?: ApplicationMethod[];
  /** @deprecated 旧版稀释倍数，优先使用 uses[].dilution */
  recommendedDilution?: number;
  diluent: DiluentType;
  indoorAllowed: boolean;
  outdoorAllowed: boolean;
  registrationValidUntil?: string;
  status: DrugStatus;
  source?: {
    type: string;
    url?: string;
    verifiedAt?: string;
  };
  labelSource: string;
  labelDate?: string;
  /** 白云区培训数据 */
  baiyunTraining?: BaiyunTrainingData;
  localEfficacy?: LocalEfficacy[];
  dataVersion: string;
  verifiedAt?: string;
  verifiedBy?: string;
  notes?: string;
  /** 复配制剂剂量基准说明 */
  doseBasis?: string;
  /** 制剂密度 (g/mL)，用于 g/m² → mL/m² 换算。默认≈1 */
  formulationDensity?: number;
  /** 别名/同义词，用于搜索匹配 */
  synonyms?: string[];
  /** 自动核验信息 */
  verification?: DrugVerification;
  /** 药物层级: A=白云优先, B=国家登记扩展, C=幼虫优先 */
  tier?: 'A' | 'B' | 'C';
}

/** 本地药效评价 */
/** 药物自动核验信息 (V2.5) */
export interface DrugVerification {
  status: DrugStatus;
  verificationMethod?: string;
  officialSources?: string[];
  officialRegistrationUrl?: string;
  officialLabelUrl?: string;
  verifiedAt?: string | null;
  lastOfficialCheckAt?: string;
  nextCheckAt?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  warnings?: string[];
  /** 官方登记是否已确认匹配 */
  officialMatched?: boolean;
  /** 自动匹配评分 (0-100) */
  matchScore?: number;
  /** 字段对比结果 */
  fieldsCompared?: Record<string, boolean>;
  /** 重试次数 */
  retryCount?: number;
}

export interface LocalEfficacy {
  productId: string;
  year: number;
  district: string;
  applicationMethod: ApplicationMethod;
  machine: string;
  reductionRate?: number;
  result: '显著' | '不显著' | '一般';
  source: string;
}

/** 白云区培训数据 */
export interface BaiyunTrainingData {
  /** 培训资料来源 */
  source: string;
  /** 培训年份 */
  year: number;
  /** 推荐有效成分剂量 (mg/m³ for space spray, mg/m² for residual) */
  recommendedActiveDose?: number;
  /** 推荐制剂用量 */
  recommendedFormulationDose?: number;
  /** 推荐稀释倍数 */
  recommendedDilution?: number;
  /** 推荐施药方式 */
  recommendedMethods?: ApplicationMethod[];
  /** 推荐器械 */
  recommendedMachines?: string[];
  /** 备注 */
  notes?: string;
}

/** 喷雾器械 */
export interface Machine {
  id: string;
  brand?: string;
  machineName: string;
  machineType: string;
  powerType?: 'BATTERY' | 'AC' | 'GASOLINE' | 'MANUAL' | 'MOTORIZED';
  /** 流量配置 */
  flow: MachineFlow;
  /** @deprecated 兼容早期器械数据；新记录请使用 flow */
  flowMlPerSecond?: number;
  swathMeter: number;
  tankCapacityLiter?: number;
  dropletRangeMicron?: [number, number];
  allowedScenes?: string[];
  allowedMethods?: ApplicationMethod[];
  profiles?: MachineProfile[];
  notes?: string;
  source: string;
  sourceUrl?: string;
  verifiedAt?: string;
  isCustom?: boolean;
}

/** 机器流量配置 */
export interface MachineFlow {
  type: 'FIXED' | 'VARIABLE';
  /** 固定流量 (mL/s) */
  mlPerSecond?: number;
  /** 可变流量范围 (mL/s) */
  minMlPerSecond?: number;
  maxMlPerSecond?: number;
  /** 默认/常用流量 (mL/s)，可变流量时用于计算 */
  defaultMlPerSecond?: number;
}

/** 机器配置档案 */
export interface MachineProfile {
  id: string;
  name: string;
  description?: string;
  flowMlPerSecond: number;
  /** 喷幅 (m)，覆盖机器默认喷幅 */
  swathMeter?: number;
  nozzle?: string;
  notes?: string;
}

/** 表面类型（滞留喷洒） */
export interface SurfaceType {
  id: string;
  name: string;
  examples: string;
  absorptionRange: [number, number]; // mL/m² 区间
  defaultAbsorption: number;
}

/** 表面类型预设 */
export const SURFACE_TYPES: SurfaceType[] = [
  { id: 'non_absorbent', name: '不吸收表面', examples: '玻璃、不锈钢、瓷砖', absorptionRange: [20, 35], defaultAbsorption: 28 },
  { id: 'semi_absorbent', name: '半吸收表面', examples: '油漆木板、塑料', absorptionRange: [30, 50], defaultAbsorption: 40 },
  { id: 'high_absorbent', name: '高吸收表面', examples: '水泥面、石灰面、砖墙', absorptionRange: [40, 70], defaultAbsorption: 55 },
];

// ============================================================
// 计算请求 / 结果类型
// ============================================================

/** ULV计算请求 */
export interface ULVCalculationRequest {
  drugId: string;
  machineId: string;
  area: number;           // m²
  fogHeight: number;      // m, 默认2
  targetSpeed?: number;   // m/s, 默认0.75
  tankCapacity?: number;  // L
  /** 器械配置档案ID */
  profileId?: string;
  customDrug?: CustomDrugInput;
  /** 施药环境 */
  environment?: 'indoor' | 'outdoor';
  /** 防治对象 */
  target?: string;
}

/** 室内喷雾计算请求 */
export interface IndoorCalculationRequest {
  drugId: string;
  machineId: string;
  area: number;           // m²
  ceilingHeight: number;  // m
  tankCapacity?: number;  // L
  customDrug?: CustomDrugInput;
}

/** 滞留喷洒计算请求 */
export interface ResidualCalculationRequest {
  drugId: string;
  machineId: string;
  area: number;           // m²
  surfaceTypeId: string;
  customAbsorption?: number; // mL/m², 高级设置
  customDrug?: CustomDrugInput;
}

/** 自定义药物输入 */
export interface CustomDrugInput {
  productName?: string;
  registrationNo?: string;
  formulationType: FormulationType;
  activeIngredients: ActiveIngredient[];
  dose: DrugDose;
  diluent: DiluentType;
}

/** 药箱拆分结果 */
export interface TankSplit {
  tankIndex: number;
  solutionL: number;
  drugL: number;
  diluentL: number;
  isRemainder: boolean;
}

/** 计算警告 */
export interface CalculationWarning {
  level: RiskLevel;
  message: string;
}

/** ULV计算结果 */
export interface ULVCalculationResult {
  /** 处理体积 m³ */
  volume: number;
  /** 原药量 mL */
  rawDrugMl: number;
  /** 稀释倍数 */
  dilutionFactor: number;
  /** 配比 文字 */
  dilutionRatio: string;
  /** 稀释剂量 mL */
  diluentMl: number;
  /** 最终药液 mL */
  totalSolutionMl: number;
  /** 建议行走速度 m/s */
  walkingSpeed: number;
  /** 原液行走速度 m/s (不稀释) */
  rawWalkingSpeed: number;
  /** 稀释区间最小倍数（使速度≤上限） */
  dilutionRangeMin?: number;
  /** 稀释区间最大倍数（使速度≥下限） */
  dilutionRangeMax?: number;
  /** 白云区培训推荐稀释倍数（如有） */
  localTrainingDilution?: number;
  /** 登记标签推荐稀释倍数（如有） */
  labelDilution?: number;
  /** 是否为车载模式 */
  isVehicle?: boolean;
  /** 药箱拆分 */
  tanks: TankSplit[];
  /** 警告 */
  warnings: CalculationWarning[];
  /** 计算过程说明 */
  explanation: string[];
  /** 数据来源 */
  dataSources: string[];
}

/** 室内喷雾计算结果 */
export interface IndoorCalculationResult {
  /** 室内体积 m³ */
  volume: number;
  /** 原药量 mL */
  rawDrugMl: number;
  /** 稀释倍数 */
  dilutionFactor: number;
  /** 配比 */
  dilutionRatio: string;
  /** 稀释剂量 mL */
  diluentMl: number;
  /** 最终药液 mL */
  totalSolutionMl: number;
  /** 喷雾时长 s */
  sprayDurationSeconds: number;
  /** 药箱拆分 */
  tanks: TankSplit[];
  /** 警告 */
  warnings: CalculationWarning[];
  /** 计算过程说明 */
  explanation: string[];
  /** 数据来源 */
  dataSources: string[];
}

/** 滞留喷洒计算结果 */
export interface ResidualCalculationResult {
  /** 原药量 mL */
  rawDrugMl: number;
  /** 稀释倍数 */
  dilutionFactor: number;
  /** 配比 */
  dilutionRatio: string;
  /** 稀释剂量 mL */
  diluentMl: number;
  /** 最终药液 mL */
  totalSolutionMl: number;
  /** 药箱拆分 */
  tanks: TankSplit[];
  /** 警告 */
  warnings: CalculationWarning[];
  /** 计算过程说明 */
  explanation: string[];
  /** 数据来源 */
  dataSources: string[];
}

/** 计算历史记录 */
export interface CalculationHistory {
  id: string;
  timestamp: number;
  method: ApplicationMethod;
  drugName: string;
  drugStatus?: DrugStatus;
  machineName: string;
  machineProfile?: string;
  area: number;
  result: ULVCalculationResult | IndoorCalculationResult | ResidualCalculationResult;
  paramSource?: string;
}

// ============================================================
// 辅助函数：获取药物剂量（兼容新旧数据结构）
// ============================================================

/**
 * 获取药物的剂量（兼容新旧结构）
 * @param drug 药物对象
 * @param method 施用方式（可选，用于从 uses[] 中筛选）
 * @param environment 环境（可选，用于从 uses[] 中筛选）
 * @returns 剂量对象，找不到返回 null
 */
export function getDrugDose(
  drug: Drug,
  method?: ApplicationMethod,
  environment?: 'indoor' | 'outdoor'
): DrugDose | null {
  // 优先使用新的 uses[] 结构
  if (drug.uses && drug.uses.length > 0) {
    let matchedUses = drug.uses;

    // 按施用方式筛选
    if (method) {
      matchedUses = matchedUses.filter(u => u.method === method);
    }

    // 按环境筛选
    if (environment) {
      matchedUses = matchedUses.filter(u =>
        u.environments.includes(environment)
      );
    }

    // 返回第一个匹配的剂量
    if (matchedUses.length > 0) {
      return matchedUses[0].dose;
    }
  }

  // 回退到旧的 dose 字段
  if (drug.dose) {
    return drug.dose;
  }

  return null;
}

/**
 * 获取药物的稀释倍数（兼容新旧结构）
 * @param drug 药物对象
 * @param method 施用方式（可选）
 * @returns 稀释倍数，无则返回 undefined
 */
export function getDrugDilution(
  drug: Drug,
  method?: ApplicationMethod
): number | undefined {
  // 优先使用新的 uses[] 结构
  if (drug.uses && drug.uses.length > 0) {
    let matchedUses = drug.uses;

    if (method) {
      matchedUses = matchedUses.filter(u => u.method === method);
    }

    if (matchedUses.length > 0 && matchedUses[0].dilution) {
      return matchedUses[0].dilution;
    }
  }

  // 回退到旧的 recommendedDilution 字段
  return drug.recommendedDilution;
}

/**
 * 获取药物的所有使用场景
 * @param drug 药物对象
 * @param method 施用方式（可选，筛选特定方式）
 * @returns 使用场景数组
 */
export function getDrugUses(
  drug: Drug,
  method?: ApplicationMethod
): DrugUse[] {
  if (drug.uses && drug.uses.length > 0) {
    if (method) {
      return drug.uses.filter(u => u.method === method);
    }
    return drug.uses;
  }

  // 旧结构转换为 DrugUse 格式
  if (drug.dose) {
    return [{
      id: `${drug.applicationMethods?.[0] || 'ULV'}_default`,
      method: (drug.applicationMethods?.[0] || 'ULV') as ApplicationMethod,
      environments: drug.environments,
      target: drug.target,
      dose: drug.dose,
      dilution: drug.recommendedDilution,
    }];
  }

  return [];
}

/**
 * 检查药物是否可用于指定施用方式
 */
export function isDrugAvailableFor(
  drug: Drug,
  method: ApplicationMethod,
  environment?: 'indoor' | 'outdoor'
): boolean {
  const uses = getDrugUses(drug, method);
  if (uses.length === 0) return false;

  if (environment) {
    return uses.some(u => u.environments.includes(environment));
  }

  return true;
}
