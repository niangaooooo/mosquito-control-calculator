"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { getCalculableDrugsForMethod, getDrugById, searchDrugs, getAllActiveIngredientNames, isDrugCalculable } from "@/services/data";
import { getAllMachines, getMachineById, filterMachinesByScene, filterMachinesByMethod } from "@/services/data";
import { calculateULV } from "@/calculation-engine";
import { validateAll } from "@/rules";
import { getMachineFlow } from "@/rules/machine";
import { formatVolume, activeDoseToFormulationVolume } from "@/calculation-engine/conversion";
import type { Drug, Machine, ULVCalculationResult, FormulationType } from "@/types";
import { FORMULATION_LABELS, DRUG_STATUS_LABELS, DRUG_STATUS_COLORS } from "@/types";

type EntryMode = "by-drug" | "by-ingredient";

const INGREDIENT_OPTIONS = getAllActiveIngredientNames();

// 剂型选项
const FORMULATION_OPTIONS: { value: FormulationType; label: string }[] = [
  { value: "EC", label: "乳油 (EC)" },
  { value: "EW", label: "水乳剂 (EW)" },
  { value: "SC", label: "悬浮剂 (SC)" },
  { value: "ME", label: "微乳剂 (ME)" },
  { value: "OL", label: "油剂 (OL)" },
  { value: "SL", label: "可溶液剂 (SL)" },
];

// 剂量来源
type DoseSource = "registration" | "baiyun-training" | "custom";

export default function ULVPage() {
  // 入口模式
  const [entryMode, setEntryMode] = useState<EntryMode>("by-drug");

  // === 按具体药物模式 ===
  const [drugSearch, setDrugSearch] = useState("");
  const [selectedDrugId, setSelectedDrugId] = useState("");

  // === 按有效成分模式 ===
  interface IngredientInput {
    name: string;
    customName: string;
    value: string;
    unit: "%" | "g/L" | "mg/mL";
  }
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { name: "", customName: "", value: "", unit: "%" }
  ]);
  const [formulationType, setFormulationType] = useState<FormulationType>("EW");
  const [doseSource, setDoseSource] = useState<DoseSource>("baiyun-training");
  const [activeDoseValue, setActiveDoseValue] = useState("");
  const [activeDoseUnit, setActiveDoseUnit] = useState<"mg/m3" | "mL/m3">("mg/m3");
  const [doseBasis, setDoseBasis] = useState<"FORMULATION_DOSE" | "ACTIVE_TOTAL" | "ACTIVE_COMPONENT">("FORMULATION_DOSE");
  const [selectedComponentIndex, setSelectedComponentIndex] = useState(0);

  // === 公共状态 ===
  const [environment, setEnvironment] = useState<"outdoor" | "indoor">("outdoor");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [customFlow, setCustomFlow] = useState("");
  const [area, setArea] = useState("");

  // === 自定义机器 ===
  const [showCustomMachine, setShowCustomMachine] = useState(false);
  const [customMachineFlow, setCustomMachineFlow] = useState("");
  const [customMachineSwath, setCustomMachineSwath] = useState("");
  const [customMachineTank, setCustomMachineTank] = useState("");

  // === 60秒流量校准 ===
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationVolume, setCalibrationVolume] = useState("");
  const [fogHeight, setFogHeight] = useState("2");
  const [tankCapacity, setTankCapacity] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [targetSpeed, setTargetSpeed] = useState("0.75");
  const [outdoorChecks, setOutdoorChecks] = useState([false, false, false, false, false]);

  // 结果状态
  const [result, setResult] = useState<ULVCalculationResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  // 默认推荐可计算药物；主动搜索时展示整个资料库，未核验产品只可查看。
  const drugResults = useMemo(() => {
    const calculable = getCalculableDrugsForMethod("ULV", environment);
    if (!drugSearch) return calculable.slice(0, 10);
    return searchDrugs(drugSearch).slice(0, 20);
  }, [drugSearch, environment]);

  const selectedDrug = selectedDrugId ? getDrugById(selectedDrugId) : null;

  // 按有效成分模式：计算制剂用量
  const ingredientDoseResult = useMemo(() => {
    if (entryMode !== "by-ingredient") return null;
    const doseVal = parseFloat(activeDoseValue);
    if (!doseVal || doseVal <= 0) return null;

    // 过滤有效成分
    const validIngredients = ingredients.filter(ing => {
      const name = ing.name === "other" ? ing.customName : ing.name;
      const val = parseFloat(ing.value);
      return name && val > 0;
    });

    if (validIngredients.length === 0) return null;

    try {
      let formulationDose: number;
      let formulaUsed: string;

      // 辅助：将成分输入转为 mg/mL 浓度
      const toMgPerMl = (ing: typeof validIngredients[number]) => {
        const val = parseFloat(ing.value);
        if (ing.unit === "%") return val * 10; // % → mg/mL
        return val; // g/L == mg/mL, mg/mL 直接
      };

      if (doseBasis === "FORMULATION_DOSE") {
        // 场景A：用户直接输入制剂剂量 mL/m³
        if (activeDoseUnit === "mL/m3") {
          formulationDose = doseVal;
          formulaUsed = `制剂剂量: ${doseVal}mL/m³`;
        } else {
          // mg/m³ → mL/m³：需要选一个成分做基准
          const refIng = validIngredients[Math.min(selectedComponentIndex, validIngredients.length - 1)];
          const conc = toMgPerMl(refIng);
          if (conc <= 0) return null;
          formulationDose = activeDoseToFormulationVolume(doseVal, conc);
          const refName = refIng.name === "other" ? refIng.customName : refIng.name;
          formulaUsed = `${doseVal}mg/m³ ÷ ${conc.toFixed(2)}mg/mL(${refName}) = ${formulationDose.toFixed(4)}mL/m³`;
        }
      } else if (doseBasis === "ACTIVE_COMPONENT") {
        // 场景C：指定某一有效成分剂量
        const compIdx = Math.min(selectedComponentIndex, validIngredients.length - 1);
        const compIng = validIngredients[compIdx];
        const conc = toMgPerMl(compIng);
        if (conc <= 0) return null;
        const compName = compIng.name === "other" ? compIng.customName : compIng.name;
        if (activeDoseUnit === "mg/m3") {
          formulationDose = activeDoseToFormulationVolume(doseVal, conc);
          formulaUsed = `${compName}: ${doseVal}mg/m³ ÷ ${conc.toFixed(2)}mg/mL = ${formulationDose.toFixed(4)}mL/m³`;
        } else {
          // 用户直接给了 mL/m³
          formulationDose = doseVal;
          formulaUsed = `${compName} 制剂剂量: ${doseVal}mL/m³`;
        }
      } else {
        // ACTIVE_TOTAL：总有效成分剂量
        let totalConcMgPerMl = 0;
        for (const ing of validIngredients) {
          totalConcMgPerMl += toMgPerMl(ing);
        }
        if (totalConcMgPerMl <= 0) return null;
        if (activeDoseUnit === "mg/m3") {
          formulationDose = activeDoseToFormulationVolume(doseVal, totalConcMgPerMl);
          formulaUsed = `${doseVal}mg/m³ ÷ ${totalConcMgPerMl.toFixed(2)}mg/mL(总浓度) = ${formulationDose.toFixed(4)}mL/m³`;
        } else {
          formulationDose = doseVal;
          formulaUsed = `总制剂剂量: ${doseVal}mL/m³`;
        }
      }

      return { formulationDose, formulaUsed };
    } catch {
      return null;
    }
  }, [entryMode, ingredients, activeDoseValue, activeDoseUnit, doseBasis, selectedComponentIndex]);

  // 器械列表 — 按场景和施药方式过滤
  const machines = useMemo(() => {
    let list = getAllMachines();
    list = filterMachinesByMethod(list, "ULV");
    list = filterMachinesByScene(list, "OUTDOOR");
    return list;
  }, []);

  const selectedMachine = selectedMachineId ? getMachineById(selectedMachineId) : null;

  // 当前实际使用的流量
  const effectiveFlow = useMemo(() => {
    // 自定义机器模式
    if (showCustomMachine && customMachineFlow) {
      return parseFloat(customMachineFlow) || 0;
    }
    if (!selectedMachine) return 0;
    if (customFlow) return parseFloat(customFlow) || 0;
    return getMachineFlow(selectedMachine, selectedProfileId || undefined);
  }, [showCustomMachine, customMachineFlow, selectedMachine, selectedProfileId, customFlow]);

  // 按有效成分模式：构建临时药物对象
  const buildIngredientDrug = useMemo(() => {
    if (entryMode !== "by-ingredient" || !ingredientDoseResult) return null;

    const validIngredients = ingredients.filter(ing => {
      const name = ing.name === "other" ? ing.customName : ing.name;
      const val = parseFloat(ing.value);
      return name && val > 0;
    }).map(ing => ({
      name: ing.name === "other" ? ing.customName : ing.name,
      value: parseFloat(ing.value),
      unit: ing.unit as "%" | "g/L" | "mg/mL",
    }));

    if (validIngredients.length === 0) return null;

    const productName = validIngredients.map(i => i.name).join("·") + " (有效成分模式)";

    // 根据 doseBasis 构建正确的剂量类型
    let dose;
    if (doseBasis === "FORMULATION_DOSE") {
      // 场景A：已反算为制剂剂量，直接用 FORMULATION_VOLUME_PER_VOLUME
      dose = {
        type: "FORMULATION_VOLUME_PER_VOLUME" as const,
        value: ingredientDoseResult.formulationDose,
        unit: "mL/m3" as const,
      };
    } else if (doseBasis === "ACTIVE_COMPONENT") {
      // 场景C：指定某一成分剂量，用 ACTIVE_MASS_PER_VOLUME + ingredientIndex
      dose = {
        type: "ACTIVE_MASS_PER_VOLUME" as const,
        value: parseFloat(activeDoseValue) || 0,
        unit: "mg/m3" as const,
        ingredientIndex: Math.min(selectedComponentIndex, validIngredients.length - 1),
      };
    } else {
      // ACTIVE_TOTAL：总有效成分剂量，用 ACTIVE_MASS_PER_VOLUME（引擎取第一个成分，但用户输入的是总量）
      dose = {
        type: "ACTIVE_MASS_PER_VOLUME" as const,
        value: parseFloat(activeDoseValue) || 0,
        unit: "mg/m3" as const,
      };
    }

    return {
      id: "ingredient-mode",
      productName,
      registrationNo: "—",
      manufacturer: "—",
      category: "卫生杀虫剂" as const,
      formulationType,
      activeIngredients: validIngredients,
      target: ["蚊"],
      environments: ["outdoor" as const],
      applicationMethods: ["ULV" as const],
      dose,
      diluent: "water" as const,
      indoorAllowed: false,
      outdoorAllowed: true,
      labelSource: "有效成分反算",
      status: "CUSTOM" as const,
      labelDate: new Date().toISOString().slice(0, 10),
      dataVersion: "用户输入",
    } satisfies Drug;
  }, [entryMode, ingredientDoseResult, ingredients, formulationType, doseBasis, activeDoseValue, selectedComponentIndex]);

  // 计算
  const handleCalculate = () => {
    setErrors([]);
    setWarnings([]);
    setResult(null);

    const drug = entryMode === "by-drug" ? selectedDrug : buildIngredientDrug;

    // 自定义机器或选择的机器
    let machine: Machine | undefined = selectedMachine ?? undefined;
    let machineId = selectedMachineId;

    // 自定义机器模式
    if (showCustomMachine) {
      const flow = parseFloat(customMachineFlow);
      const swath = parseFloat(customMachineSwath);
      if (!flow || flow <= 0) {
        setErrors(["请输入有效的流量 (mL/s)"]);
        return;
      }
      if (!swath || swath <= 0) {
        setErrors(["请输入有效的喷幅 (m)"]);
        return;
      }
      // 创建临时机器对象
      machine = {
        id: "custom-machine",
        machineName: "自定义器械",
        machineType: "ULV_BACKPACK",
        flow: { type: "VARIABLE", minMlPerSecond: 0, maxMlPerSecond: flow, defaultMlPerSecond: flow },
        swathMeter: swath,
        tankCapacityLiter: customMachineTank ? parseFloat(customMachineTank) : undefined,
        allowedScenes: [environment === "outdoor" ? "OUTDOOR" : "INDOOR_LARGE"],
        allowedMethods: ["ULV"],
        profiles: [],
        source: "用户自定义",
        isCustom: true,
      };
      machineId = "custom-machine";
    }

    // 基本校验
    if (!drug) {
      setErrors(entryMode === "by-drug" ? ["请选择药物"] : ["请填写有效成分和浓度信息"]);
      return;
    }
    if (!machine) {
      setErrors(["请选择喷雾器械"]);
      return;
    }
    if (!area || parseFloat(area) <= 0) {
      setErrors(["请输入有效的处置面积"]);
      return;
    }
    if (environment === "outdoor" && outdoorChecks.some(checked => !checked)) {
      setErrors(["请完成全部室外作业条件确认后再计算"]);
      return;
    }

    // 按具体药物模式：走完整校验链（跳过自定义机器）
    if (entryMode === "by-drug" && !showCustomMachine) {
      const validation = validateAll(drug, machine, "ULV", parseFloat(area), undefined, environment);
      if (!validation.canCalculate) {
        setErrors(validation.errors);
        setWarnings(validation.warnings);
        return;
      }
      setWarnings(validation.warnings);
    }

    try {
      // 车辆模式：km/h → m/s
      const isVehicleMode = machine.machineType === 'ULV_VEHICLE';
      const speedValue = parseFloat(targetSpeed) || (isVehicleMode ? 15 : 0.75);
      const speedMs = isVehicleMode ? speedValue / 3.6 : speedValue;

      const calcResult = calculateULV(
        {
          drugId: drug.id,
          machineId: machineId,
          area: parseFloat(area),
          fogHeight: parseFloat(fogHeight) || 2,
          targetSpeed: speedMs,
          tankCapacity: tankCapacity ? parseFloat(tankCapacity) : undefined,
          profileId: selectedProfileId || undefined,
          environment,
        },
        drug,
        machine
      );
      setResult(calcResult);
      // 显示引擎诊断警告
      if (calcResult.warnings.length > 0) {
        setWarnings(prev => [
          ...prev,
          ...calcResult.warnings.map(w => w.message),
        ]);
      }
      if (entryMode === "by-ingredient") {
        setWarnings(prev => [
          ...prev,
          "有效成分模式：当前为用户输入参数计算，最终执行以农药登记标签及主管部门要求为准。",
        ]);
      }
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "计算出错"]);
    }
  };

  // 当前使用的药物（用于结果显示）
  const displayDrug = entryMode === "by-drug" ? selectedDrug : buildIngredientDrug;

  // 复制方案
  const handleCopy = () => {
    if (!result || !displayDrug) return;
    const machineName = showCustomMachine ? "自定义器械" : selectedMachine?.machineName || "—";
    const text = [
      `【ULV施药方案】`,
      `药物：${displayDrug.productName}`,
      entryMode === "by-drug" ? `登记证号：${selectedDrug?.registrationNo || "—"}` : `模式：有效成分反算`,
      entryMode === "by-drug" ? `状态：${selectedDrug ? DRUG_STATUS_LABELS[selectedDrug.status] : "—"}` : `有效成分剂量：${activeDoseValue}mg/m³`,
      `设备：${machineName}`,
      `参数来源：${showCustomMachine ? "用户输入" : customFlow ? "现场实测流量" : "厂家参数"}`,
      ``,
      `面积：${area}m²`,
      `雾层高度：${fogHeight}m`,
      `处理空间：${result.volume}m³`,
      ``,
      `原药：${formatVolume(result.rawDrugMl)}`,
      `稀释剂：${formatVolume(result.diluentMl)}`,
      `最终药液：${formatVolume(result.totalSolutionMl)}`,
      `稀释倍数：${result.dilutionFactor}倍`,
      `配比：${result.dilutionRatio}`,
      ``,
      `原液速度：${result.rawWalkingSpeed.toFixed(2)}m/s`,
      `目标速度：${parseFloat(targetSpeed) || 0.75}m/s`,
      `稀释后速度：${result.walkingSpeed.toFixed(2)}m/s`,
    ].join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-gray-700">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold">超低容量空间喷雾</h1>
          <p className="text-xs text-gray-500">ULV · 室外大面积 / 大型室内</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="card">
          <label className="label">作业环境</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              { value: "outdoor", label: "室外大面积" },
              { value: "indoor", label: "大型室内" },
            ] as const).map(option => (
              <button
                key={option.value}
                type="button"
                className={`flex-1 py-2.5 text-sm font-medium ${environment === option.value ? "bg-teal-500 text-white" : "bg-white text-gray-600"}`}
                onClick={() => {
                  setEnvironment(option.value);
                  setSelectedDrugId("");
                  setDrugSearch("");
                  setResult(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {environment === "outdoor" && getCalculableDrugsForMethod("ULV", "outdoor").length === 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-2 mt-2">
              当前药物库暂无剂量完整、适用于室外 ULV 的官方登记产品；请补齐官方标签后再开放正式计算。
            </p>
          )}
        </div>

        {/* 入口模式切换 */}
        <div className="card">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                entryMode === "by-drug"
                  ? "bg-teal-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setEntryMode("by-drug")}
            >
              按具体药物
            </button>
            <button
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                entryMode === "by-ingredient"
                  ? "bg-teal-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setEntryMode("by-ingredient")}
            >
              按有效成分
            </button>
          </div>
        </div>

        {/* ===== 按具体药物模式 ===== */}
        {entryMode === "by-drug" && (
          <div className="card">
            <label className="label">选择药物</label>
            <input
              type="text"
              placeholder="搜索药品名称、登记证号或有效成分..."
              className="input-field mb-2"
              value={drugSearch}
              onChange={e => {
                setDrugSearch(e.target.value);
                setSelectedDrugId("");
              }}
            />
            {!selectedDrugId && (
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {drugResults.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500 text-center">
                    未找到匹配药物
                    <Link href="/calculate/custom-drug" className="text-teal-600 ml-1">
                      使用登记标签自行计算
                    </Link>
                  </div>
                ) : (
                  drugResults.map(d => {
                    const canUse = isDrugCalculable(d, "ULV", environment);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={!canUse}
                        className={`w-full text-left p-3 border-b border-gray-100 last:border-0 ${canUse ? "hover:bg-gray-50" : "bg-gray-50/60 cursor-not-allowed"}`}
                        onClick={() => {
                          setSelectedDrugId(d.id);
                          setDrugSearch(d.productName);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{d.productName}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${DRUG_STATUS_COLORS[d.status]}`}>
                            {DRUG_STATUS_LABELS[d.status]}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {d.registrationNo} · {FORMULATION_LABELS[d.formulationType] || d.formulationType}
                          {d.dose && ` · ${d.dose.value}${d.dose.unit}`}
                        </div>
                        {!canUse && <div className="text-xs text-amber-700 mt-1">已收录，当前模式暂不可计算</div>}
                      </button>
                    );
                  })
                )}
              </div>
            )}
            {selectedDrug && (
              <div className="bg-teal-50 rounded-lg p-3 mt-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-teal-800">{selectedDrug.productName}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${DRUG_STATUS_COLORS[selectedDrug.status]}`}>
                    {DRUG_STATUS_LABELS[selectedDrug.status]}
                  </span>
                </div>
                <div className="text-xs text-teal-600 mt-1">
                  {selectedDrug.registrationNo} · {FORMULATION_LABELS[selectedDrug.formulationType] || selectedDrug.formulationType}
                  {selectedDrug.dose && ` · ${selectedDrug.dose.value}${selectedDrug.dose.unit}`}
                </div>
                {selectedDrug.localEfficacy && selectedDrug.localEfficacy.length > 0 && (
                  <div className="text-xs text-teal-700 mt-1">
                    白云区{selectedDrug.localEfficacy[0].year}现场评价：效果{selectedDrug.localEfficacy[0].result}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== 按有效成分模式 ===== */}
        {entryMode === "by-ingredient" && (
          <div className="card space-y-3">
            <label className="label">有效成分（支持复配制剂）</label>
            {ingredients.map((ing, idx) => (
              <div key={idx} className="p-2 bg-gray-50 rounded-lg space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">成分 {idx + 1}</span>
                  {ingredients.length > 1 && (
                    <button
                      className="text-xs text-red-500"
                      onClick={() => setIngredients(ingredients.filter((_, i) => i !== idx))}
                    >
                      删除
                    </button>
                  )}
                </div>
                <select
                  className="input-field"
                  value={ing.name}
                  onChange={e => {
                    const newIngs = [...ingredients];
                    newIngs[idx].name = e.target.value;
                    setIngredients(newIngs);
                  }}
                >
                  <option value="">请选择有效成分</option>
                  {INGREDIENT_OPTIONS.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value="other">其他（自定义）</option>
                </select>
                {ing.name === "other" && (
                  <input
                    type="text"
                    placeholder="输入有效成分名称"
                    className="input-field"
                    value={ing.customName}
                    onChange={e => {
                      const newIngs = [...ingredients];
                      newIngs[idx].customName = e.target.value;
                      setIngredients(newIngs);
                    }}
                  />
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                  <input
                    type="number"
                    placeholder="浓度"
                    className="input-field"
                    value={ing.value}
                    onChange={e => {
                      const newIngs = [...ingredients];
                      newIngs[idx].value = e.target.value;
                      setIngredients(newIngs);
                    }}
                  />
                  <select
                    className="input-field"
                    value={ing.unit}
                    onChange={e => {
                      const newIngs = [...ingredients];
                      newIngs[idx].unit = e.target.value as "%" | "g/L" | "mg/mL";
                      setIngredients(newIngs);
                    }}
                  >
                    <option value="%">%</option>
                    <option value="g/L">g/L</option>
                    <option value="mg/mL">mg/mL</option>
                  </select>
                </div>
              </div>
            ))}
            <button
              className="text-sm text-teal-600 flex items-center gap-1"
              onClick={() => setIngredients([...ingredients, { name: "", customName: "", value: "", unit: "%" }])}
            >
              + 添加有效成分
            </button>

            {/* 剂量依据 */}
            <div>
              <label className="label">剂量依据</label>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="doseBasis" checked={doseBasis === "FORMULATION_DOSE"} onChange={() => setDoseBasis("FORMULATION_DOSE")} />
                  <span>产品制剂剂量（推荐）</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="doseBasis" checked={doseBasis === "ACTIVE_TOTAL"} onChange={() => setDoseBasis("ACTIVE_TOTAL")} />
                  <span>总有效成分剂量（标签明确时使用）</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="doseBasis" checked={doseBasis === "ACTIVE_COMPONENT"} onChange={() => setDoseBasis("ACTIVE_COMPONENT")} />
                  <span>指定某一有效成分剂量</span>
                </label>
              </div>
              {/* 场景C：选择哪个成分 */}
              {doseBasis === "ACTIVE_COMPONENT" && ingredients.filter(ing => {
                const name = ing.name === "other" ? ing.customName : ing.name;
                return name && parseFloat(ing.value) > 0;
              }).length > 1 && (
                <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                  <label className="text-xs text-amber-700 font-medium">选择目标成分</label>
                  <select
                    className="input-field mt-1"
                    value={selectedComponentIndex}
                    onChange={e => setSelectedComponentIndex(parseInt(e.target.value))}
                  >
                    {ingredients.map((ing, idx) => {
                      const name = ing.name === "other" ? ing.customName : ing.name;
                      if (!name || parseFloat(ing.value) <= 0) return null;
                      return <option key={idx} value={idx}>{name} ({ing.value}{ing.unit})</option>;
                    })}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="label">剂型</label>
              <select
                className="input-field"
                value={formulationType}
                onChange={e => setFormulationType(e.target.value as FormulationType)}
              >
                {FORMULATION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">有效成分剂量</label>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="例如: 1.67"
                  className="input-field"
                  value={activeDoseValue}
                  onChange={e => {
                    // 只允许数字和小数点
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setActiveDoseValue(val);
                    }
                  }}
                />
                <select
                  className="input-field"
                  value={activeDoseUnit}
                  onChange={e => setActiveDoseUnit(e.target.value as "mg/m3" | "mL/m3")}
                >
                  <option value="mg/m3">mg/m³</option>
                  <option value="mL/m3">mL/m³</option>
                </select>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  className={`text-xs px-2 py-1 rounded border ${doseSource === "registration" ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-500"}`}
                  onClick={() => setDoseSource("registration")}
                >
                  登记推荐
                </button>
                <button
                  className={`text-xs px-2 py-1 rounded border ${doseSource === "baiyun-training" ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-500"}`}
                  onClick={() => setDoseSource("baiyun-training")}
                >
                  白云培训
                </button>
                <button
                  className={`text-xs px-2 py-1 rounded border ${doseSource === "custom" ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-500"}`}
                  onClick={() => setDoseSource("custom")}
                >
                  自定义
                </button>
              </div>
            </div>

            {/* 公式预览 */}
            {ingredientDoseResult && (
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-xs text-blue-600 font-medium mb-1">
                  制剂用量
                  {doseBasis === "FORMULATION_DOSE" && "（场景A：直接制剂剂量）"}
                  {doseBasis === "ACTIVE_COMPONENT" && "（场景C：指定成分剂量）"}
                  {doseBasis === "ACTIVE_TOTAL" && "（场景D：总有效成分剂量）"}
                </div>
                <div className="text-lg font-semibold text-blue-800">
                  {ingredientDoseResult.formulationDose.toFixed(4)} mL/m³
                </div>
                <div className="text-xs text-blue-500 mt-1">{ingredientDoseResult.formulaUsed}</div>
              </div>
            )}
          </div>
        )}

        {/* 器械选择 */}
        <div className="card">
          <label className="label">选择喷雾器械</label>
          <div className="grid grid-cols-2 gap-2">
            {machines.map(m => (
              <button
                key={m.id}
                className={`p-3 rounded-lg border-2 text-left transition-colors ${
                  selectedMachineId === m.id
                    ? "border-teal-500 bg-teal-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
                onClick={() => {
                  setSelectedMachineId(m.id);
                  setSelectedProfileId("");
                  setCustomFlow("");
                }}
              >
                <div className="font-medium text-sm">{m.machineName}</div>
                <div className="text-xs text-gray-500">
                  {m.flow.type === "VARIABLE"
                    ? `0-${m.flow.maxMlPerSecond}mL/s`
                    : `${m.flow.mlPerSecond}mL/s`}
                  {m.tankCapacityLiter ? ` · ${m.tankCapacityLiter}L药箱` : ""}
                </div>
              </button>
            ))}
          </div>

          {/* 找不到机器？手动输入 */}
          <div className="mt-3">
            <button
              className="text-sm text-teal-600 flex items-center gap-1"
              onClick={() => {
                setShowCustomMachine(!showCustomMachine);
                if (!showCustomMachine) {
                  setSelectedMachineId("");
                  setSelectedProfileId("");
                }
              }}
            >
              {showCustomMachine ? "收起" : "找不到机器？手动输入参数"}
            </button>

            {showCustomMachine && (
              <div className="mt-2 space-y-2 p-3 bg-gray-50 rounded-lg">
                <div>
                  <label className="label">流量 (mL/s)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="例如: 7.5"
                      className="input-field flex-1"
                      value={customMachineFlow}
                      onChange={e => setCustomMachineFlow(e.target.value)}
                    />
                    <button
                      className="text-xs px-2 py-1 rounded border border-teal-500 text-teal-600"
                      onClick={() => setShowCalibration(!showCalibration)}
                    >
                      60秒校准
                    </button>
                  </div>
                </div>

                {/* 60秒流量校准 */}
                {showCalibration && (
                  <div className="bg-blue-50 rounded-lg p-2.5">
                    <div className="text-xs text-blue-700 font-medium mb-2">60秒量杯校准</div>
                    <div className="text-xs text-blue-600 mb-2">
                      1. 开启机器保持当前喷嘴/档位<br/>
                      2. 向量杯喷60秒<br/>
                      3. 输入喷出体积
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        placeholder="喷出体积"
                        className="input-field flex-1"
                        value={calibrationVolume}
                        onChange={e => setCalibrationVolume(e.target.value)}
                      />
                      <span className="text-xs text-gray-500">mL</span>
                    </div>
                    {calibrationVolume && (
                      <div className="text-xs text-blue-700 mt-2">
                        实测流量: {(parseFloat(calibrationVolume) / 60).toFixed(2)} mL/s
                        <button
                          className="ml-2 text-teal-600 underline"
                          onClick={() => {
                            setCustomMachineFlow((parseFloat(calibrationVolume) / 60).toFixed(2));
                            setShowCalibration(false);
                          }}
                        >
                          使用此值
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="label">喷幅 (m)</label>
                  <input
                    type="number"
                    placeholder="例如: 10"
                    className="input-field"
                    value={customMachineSwath}
                    onChange={e => setCustomMachineSwath(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">药箱容量 (L)（可选）</label>
                  <input
                    type="number"
                    placeholder="例如: 10"
                    className="input-field"
                    value={customMachineTank}
                    onChange={e => setCustomMachineTank(e.target.value)}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  自定义参数仅本次计算有效，不会保存到器械库
                </p>
              </div>
            )}
          </div>

          {/* 器械Profile选择 */}
          {selectedMachine && selectedMachine.profiles && selectedMachine.profiles.length > 0 && (
            <div className="mt-3">
              <label className="label">喷嘴/档位</label>
              <div className="grid grid-cols-1 gap-2">
                {selectedMachine.profiles.map(p => (
                  <button
                    key={p.id}
                    className={`px-3 py-2 rounded-lg text-sm border text-left ${
                      selectedProfileId === p.id
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => {
                      setSelectedProfileId(p.id);
                      setCustomFlow("");
                    }}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {p.flowMlPerSecond}mL/s
                      {p.swathMeter && ` · ${p.swathMeter}m喷幅`}
                      {p.description && ` · ${p.description}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 现场实测流量 */}
          {selectedMachine && (
            <div className="mt-3">
              <div className="bg-gray-50 rounded-lg p-2.5 mb-2">
                <div className="text-xs text-gray-500">当前参数</div>
                <div className="text-sm font-medium">
                  流量: {effectiveFlow.toFixed(2)} mL/s
                  {selectedProfileId && selectedMachine.profiles?.find(p => p.id === selectedProfileId)?.swathMeter && (
                    <span className="ml-2">
                      喷幅: {selectedMachine.profiles.find(p => p.id === selectedProfileId)!.swathMeter}m
                    </span>
                  )}
                </div>
              </div>
              <label className="label">现场实测流量 (mL/s)（可选）</label>
              <input
                type="number"
                placeholder={`默认 ${effectiveFlow.toFixed(2)}`}
                className="input-field"
                value={customFlow}
                onChange={e => setCustomFlow(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                如已做一分钟流量校准，输入实测值；否则使用{customFlow ? "自定义" : "厂家"}参数
              </p>
            </div>
          )}
        </div>

        {/* 面积和雾层高度 */}
        <div className="card">
          <label className="label">处置面积 (m²)</label>
          <input
            type="number"
            placeholder="例如: 10000"
            className="input-field"
            value={area}
            onChange={e => setArea(e.target.value)}
          />

          <label className="label mt-3">雾层高度 (m)</label>
          <input
            type="number"
            placeholder="默认2m"
            className="input-field"
            value={fogHeight}
            onChange={e => setFogHeight(e.target.value)}
          />

          {/* 高级设置 */}
          <button
            className="text-sm text-teal-600 mt-3 flex items-center gap-1"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? "收起" : "展开"}高级设置
            <svg className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showAdvanced && (
            <div className="mt-2 space-y-3">
              <div>
                <label className="label">药箱容量 (L)</label>
                <input
                  type="number"
                  placeholder="例如: 10"
                  className="input-field"
                  value={tankCapacity}
                  onChange={e => setTankCapacity(e.target.value)}
                />
              </div>
              <div>
                <label className="label">
                  {selectedMachine?.machineType === 'ULV_VEHICLE' ? '车辆速度 (km/h)' : '目标行走速度 (m/s)'}
                </label>
                <input
                  type="number"
                  placeholder={selectedMachine?.machineType === 'ULV_VEHICLE' ? '例如: 15' : '默认0.75'}
                  className="input-field"
                  value={targetSpeed}
                  onChange={e => setTargetSpeed(e.target.value)}
                />
                {selectedMachine?.machineType === 'ULV_VEHICLE' && (
                  <p className="text-xs text-gray-400 mt-1">
                    车载模式：输入计划/实测车辆速度，系统自动换算为 m/s
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 室外作业前确认 */}
        {!result && environment === "outdoor" && (
          <div className="card">
            <label className="label">室外作业前确认</label>
            <div className="space-y-2">
              {[
                "风速 < 4 m/s",
                "无降雨",
                "非强烈正午暴晒",
                "作业时段合适（日出后/日落前2小时）",
                "现场人员/动物/非靶标生物已做好保护",
              ].map((label, index) => (
                <label key={label} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={outdoorChecks[index]}
                    onChange={event => setOutdoorChecks(values => values.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {"根据国家2026两热方案：室外ULV适用于风速<4m/s，最佳时段为媒介伊蚊活动高峰期"}
            </p>
          </div>
        )}

        {/* 计算按钮 */}
        <button className="btn-primary w-full" onClick={handleCalculate}>
          计算配药方案
        </button>

        {/* 错误 */}
        {errors.length > 0 && (
          <div className="warning-red">
            {errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}

        {/* 警告 */}
        {warnings.length > 0 && (
          <div className="warning-yellow">
            {warnings.map((w, i) => (
              <div key={i} className="whitespace-pre-wrap leading-relaxed">{w}</div>
            ))}
          </div>
        )}

        {/* 结果 */}
        {result && (
          <div className="space-y-4">
            {/* 核心结果卡片 */}
            <div className="card bg-teal-50 border-teal-200">
              <h3 className="text-lg font-semibold text-teal-800 mb-4 text-center">本次施药方案</h3>

              {/* 药物信息 */}
              {displayDrug && (
                <div className="mb-4 pb-3 border-b border-teal-200">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">药物</span>
                    <span className="font-semibold">{displayDrug.productName}</span>
                  </div>
                  {entryMode === "by-drug" && selectedDrug && (
                    <>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className="text-gray-600">登记证号</span>
                        <span>{selectedDrug.registrationNo}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className="text-gray-600">状态</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${DRUG_STATUS_COLORS[selectedDrug.status]}`}>
                          {DRUG_STATUS_LABELS[selectedDrug.status]}
                        </span>
                      </div>
                    </>
                  )}
                  {entryMode === "by-ingredient" && (
                    <>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className="text-gray-600">有效成分剂量</span>
                        <span>{activeDoseValue} {activeDoseUnit}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className="text-gray-600">浓度</span>
                        <span>{ingredients.filter(ing => ing.name && ing.value).map(ing => `${ing.name === "other" ? ing.customName : ing.name} ${ing.value}${ing.unit}`).join(", ")}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 设备信息 */}
              {(selectedMachine || showCustomMachine) && (
                <div className="mb-4 pb-3 border-b border-teal-200">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">设备</span>
                    <span className="font-semibold">{showCustomMachine ? "自定义器械" : selectedMachine?.machineName}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-gray-600">参数来源</span>
                    <span>{showCustomMachine ? "用户输入" : customFlow ? "现场实测" : "厂家参数"}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">原药量</div>
                  <div className="result-value">{formatVolume(result.rawDrugMl)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">加水/稀释剂</div>
                  <div className="result-value">{formatVolume(result.diluentMl)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">最终药液</div>
                  <div className="result-value">{formatVolume(result.totalSolutionMl)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">稀释倍数</div>
                  <div className="result-value">{result.dilutionFactor}倍</div>
                </div>
              </div>

              {/* 原液速度状态 */}
              <div className="mt-3 bg-gray-50 rounded-lg p-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600">原液理论速度</span>
                  <span className={`font-semibold ${result.rawWalkingSpeed > 1.0 ? 'text-red-600' : result.rawWalkingSpeed >= 0.5 ? 'text-green-600' : 'text-amber-600'}`}>
                    {result.rawWalkingSpeed.toFixed(2)} m/s
                    {result.rawWalkingSpeed > 1.0 && ' ⚠ 过快'}
                    {result.rawWalkingSpeed < 0.5 && ' ⚠ 偏慢'}
                    {result.rawWalkingSpeed >= 0.5 && result.rawWalkingSpeed <= 1.0 && ' ✓ 适宜'}
                  </span>
                </div>
              </div>

              {/* 白云区理论可操作稀释区间 */}
              {result.dilutionRangeMin && result.dilutionRangeMax && result.dilutionRangeMin < result.dilutionRangeMax && (
                <div className="mt-2 bg-amber-50 rounded-lg p-2.5">
                  <div className="text-xs text-amber-700 font-medium">白云区理论可操作稀释区间</div>
                  <div className="text-sm text-amber-800 mt-1 font-semibold">
                    {result.dilutionRangeMin} ~ {result.dilutionRangeMax} 倍
                  </div>
                  <div className="text-xs text-amber-600 mt-1">
                    使稀释后速度在 0.5~1.0 m/s 范围内
                  </div>
                </div>
              )}

              {/* 白云区培训实例 */}
              {result.localTrainingDilution && (
                <div className="mt-2 bg-green-50 rounded-lg p-2.5">
                  <div className="text-xs text-green-700 font-medium">白云区培训实例</div>
                  <div className="text-sm text-green-800 mt-1 font-semibold">
                    约 {result.localTrainingDilution} 倍
                  </div>
                </div>
              )}

              {/* 登记标签稀释约束 */}
              {result.labelDilution && (
                <div className="mt-2 bg-blue-50 rounded-lg p-2.5">
                  <div className="text-xs text-blue-700 font-medium">登记标签稀释约束</div>
                  <div className="text-sm text-blue-800 mt-1">
                    {result.labelDilution} 倍
                  </div>
                </div>
              )}

              {/* 车载模式提示 */}
              {result.isVehicle && (
                <div className="mt-2 bg-blue-50 rounded-lg p-2.5">
                  <div className="text-xs text-blue-700 font-medium">车载ULV模式</div>
                  <div className="text-xs text-blue-600 mt-1">
                    车载喷雾无需步行速度约束，按目标速度计算稀释倍数
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-teal-200 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">配比</span>
                  <span className="font-semibold">{result.dilutionRatio}</span>
                </div>
                {!result.isVehicle && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">原液行走速度</span>
                      <span className="font-semibold">{result.rawWalkingSpeed.toFixed(2)} m/s</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">{result.isVehicle ? '车辆速度' : '目标行走速度'}</span>
                      <span className="font-semibold">
                        {result.isVehicle
                          ? `${(parseFloat(targetSpeed) || 15).toFixed(1)} km/h (${((parseFloat(targetSpeed) || 15) / 3.6).toFixed(2)} m/s)`
                          : `${parseFloat(targetSpeed) || 0.75} m/s`
                        }
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">最终预计速度</span>
                      <span className={`font-semibold ${result.walkingSpeed >= 0.5 && result.walkingSpeed <= 1.0 ? 'text-green-600' : 'text-amber-600'}`}>
                        {result.walkingSpeed.toFixed(2)} m/s
                        {result.walkingSpeed >= 0.5 && result.walkingSpeed <= 1.0 && ' ✓ 适宜'}
                        {(result.walkingSpeed < 0.5 || result.walkingSpeed > 1.0) && ' ⚠ 需确认'}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">处理空间</span>
                  <span className="font-semibold">{result.volume} m³</span>
                </div>
              </div>
            </div>

            {/* 药箱拆分 */}
            {result.tanks.length > 0 && (
              <div className="card">
                <h4 className="font-semibold text-sm mb-3">药箱拆分</h4>
                {result.tanks.map((tank, i) => (
                  <div key={i} className="flex justify-between text-sm py-2 border-b border-gray-100 last:border-0">
                    <span>
                      {tank.isRemainder ? "尾箱" : `第${tank.tankIndex}箱`}
                      <span className="text-gray-400 ml-1">({tank.solutionL.toFixed(1)}L)</span>
                    </span>
                    <span>
                      原药 {tank.drugL.toFixed(2)}L + 稀释剂 {tank.diluentL.toFixed(2)}L
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 计算过程 */}
            <details className="card">
              <summary className="collapsible-header">
                <span className="font-medium text-sm">计算过程</span>
              </summary>
              <div className="collapsible-content">
                {result.explanation.map((line, i) => (
                  <div key={i} className="py-1 border-b border-gray-100 last:border-0">{line}</div>
                ))}
              </div>
            </details>

            {/* 数据来源 */}
            <details className="card">
              <summary className="collapsible-header">
                <span className="font-medium text-sm">数据来源</span>
              </summary>
              <div className="collapsible-content">
                {result.dataSources.map((src, i) => (
                  <div key={i} className="py-1 border-b border-gray-100 last:border-0">{src}</div>
                ))}
              </div>
            </details>

            {/* 安全提示 */}
            <div className="card bg-amber-50 border-amber-200">
              <p className="text-xs text-amber-800 leading-relaxed">
                最终执行以当前有效农药登记标签及主管部门要求为准。
                {displayDrug?.status === "BAIYUN_LOCAL_ONLY" && "当前药物数据来源于本地培训资料，请以最新农药登记标签为准。"}
                {entryMode === "by-ingredient" && "有效成分模式下计算结果仅供参考，请以实际农药登记标签为准。"}
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button className="btn-outline flex-1" onClick={handleCopy}>
                复制方案
              </button>
              <button
                className="btn-secondary flex-1"
                onClick={() => {
                  setResult(null);
                  setErrors([]);
                  setWarnings([]);
                }}
              >
                重新计算
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
