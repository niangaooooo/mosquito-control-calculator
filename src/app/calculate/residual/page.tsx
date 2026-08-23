"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { getCalculableDrugsForMethod, searchDrugs, getDrugById, getAllActiveIngredientNames, isDrugCalculable } from "@/services/data";
import { getAllMachines, getMachineById, filterMachinesByMethod } from "@/services/data";
import { calculateResidual } from "@/calculation-engine";
import { validateAll } from "@/rules";
import { getMachineFlow } from "@/rules/machine";
import { formatVolume } from "@/calculation-engine/conversion";
import type { Drug, Machine, ResidualCalculationResult, FormulationType } from "@/types";
import { FORMULATION_LABELS, SURFACE_TYPES, DRUG_STATUS_LABELS, DRUG_STATUS_COLORS } from "@/types";

type EntryMode = "by-drug" | "by-ingredient";

const INGREDIENT_OPTIONS = getAllActiveIngredientNames();

const FORMULATION_OPTIONS: { value: FormulationType; label: string }[] = [
  { value: "SC", label: "悬浮剂 (SC)" },
  { value: "WP", label: "可湿性粉剂 (WP)" },
  { value: "EW", label: "水乳剂 (EW)" },
  { value: "EC", label: "乳油 (EC)" },
  { value: "CS", label: "微胶囊剂 (CS)" },
  { value: "ME", label: "微乳剂 (ME)" },
  { value: "WG", label: "水分散粒剂 (WG)" },
];

export default function ResidualPage() {
  const [entryMode, setEntryMode] = useState<EntryMode>("by-drug");

  // === 按具体药物 ===
  const [drugSearch, setDrugSearch] = useState("");
  const [selectedDrugId, setSelectedDrugId] = useState("");

  // === 按有效成分 ===
  interface IngredientInput {
    name: string;
    customName: string;
    value: string;
    unit: "%" | "g/L" | "mg/mL";
  }
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { name: "", customName: "", value: "", unit: "%" }
  ]);
  const [formulationType, setFormulationType] = useState<FormulationType>("SC");
  const [activeDoseValue, setActiveDoseValue] = useState("");
  const [activeDoseUnit, setActiveDoseUnit] = useState<"mg/m2" | "mL/m2" | "g/m2">("mg/m2");
  const [formulationDensity, setFormulationDensity] = useState("");

  // === 公共 ===
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [customFlow, setCustomFlow] = useState("");
  const [area, setArea] = useState("");
  const [surfaceTypeId, setSurfaceTypeId] = useState("semi_absorbent");
  const [customAbsorption, setCustomAbsorption] = useState("");
  const [tankCapacity, setTankCapacity] = useState("");

  // === 自定义机器 ===
  const [showCustomMachine, setShowCustomMachine] = useState(false);
  const [customMachineFlow, setCustomMachineFlow] = useState("");
  const [customMachineTank, setCustomMachineTank] = useState("");

  // === 吸水量校准 ===
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationMeasurements, setCalibrationMeasurements] = useState<string[]>(["", "", ""]);

  const [result, setResult] = useState<ResidualCalculationResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const drugResults = drugSearch
    ? searchDrugs(drugSearch).slice(0, 20)
    : getCalculableDrugsForMethod("RESIDUAL").slice(0, 10);

  const selectedDrug = selectedDrugId ? getDrugById(selectedDrugId) : null;

  const machines = useMemo(() => {
    return filterMachinesByMethod(getAllMachines(), "RESIDUAL");
  }, []);

  const selectedMachine = selectedMachineId ? getMachineById(selectedMachineId) : null;

  const selectedSurface = SURFACE_TYPES.find(st => st.id === surfaceTypeId);
  const effectiveAbsorption = customAbsorption
    ? parseFloat(customAbsorption)
    : selectedSurface?.defaultAbsorption || 50;

  // 构建自定义药物对象
  const buildCustomDrug = (): Drug | null => {
    const validIngredients = ingredients.filter(ing => ing.name && ing.value);
    if (validIngredients.length === 0 || !activeDoseValue) return null;

    const activeIngredients = validIngredients.map(ing => {
      const val = parseFloat(ing.value);
      return {
        name: ing.name === "other" ? ing.customName : ing.name,
        value: val,
        unit: ing.unit,
      };
    });

    let doseType: "FORMULATION_VOLUME_PER_AREA" | "ACTIVE_MASS_PER_AREA" | "FORMULATION_MASS_PER_AREA";
    let doseUnit: "mL/m2" | "mg/m2" | "g/m2";

    if (activeDoseUnit === "mL/m2") {
      doseType = "FORMULATION_VOLUME_PER_AREA";
      doseUnit = "mL/m2";
    } else if (activeDoseUnit === "g/m2") {
      doseType = "FORMULATION_MASS_PER_AREA";
      doseUnit = "g/m2";
    } else {
      doseType = "ACTIVE_MASS_PER_AREA";
      doseUnit = "mg/m2";
    }

    return {
      id: "custom-residual",
      productName: activeIngredients.map(i => `${i.name}${i.value}${i.unit}`).join(" + "),
      registrationNo: "自定义",
      manufacturer: "用户输入",
      formulationType,
      activeIngredients,
      target: ["蚊"],
      environments: ["indoor", "outdoor"],
      applicationMethods: ["RESIDUAL"],
      dose: {
        type: doseType,
        value: parseFloat(activeDoseValue),
        unit: doseUnit,
      },
      diluent: "water",
      indoorAllowed: true,
      outdoorAllowed: true,
      status: "CUSTOM",
      labelSource: "用户自定义",
      dataVersion: "custom",
      formulationDensity: formulationDensity ? parseFloat(formulationDensity) : undefined,
    } as Drug;
  };

  // 构建自定义机器对象
  const buildCustomMachine = (): Machine | null => {
    const flow = customMachineFlow ? parseFloat(customMachineFlow) : 0;
    if (flow <= 0) return null;
    return {
      id: "custom-residual-machine",
      machineName: "自定义常量喷雾器",
      machineType: "RESIDUAL_SPRAYER",
      flow: { type: "FIXED" as const, mlPerSecond: flow },
      swathMeter: 1,
      tankCapacityLiter: customMachineTank ? parseFloat(customMachineTank) : undefined,
      source: "USER_INPUT",
    } as Machine;
  };

  const handleCalculate = () => {
    setErrors([]);
    setWarnings([]);
    setResult(null);

    let drugForCalc: Drug | null = null;
    let machineForCalc: Machine | null = null;

    if (entryMode === "by-drug") {
      drugForCalc = selectedDrug || null;
      machineForCalc = selectedMachine || null;
    } else {
      drugForCalc = buildCustomDrug();
      machineForCalc = showCustomMachine ? buildCustomMachine() : (selectedMachine || null);
    }

    const validation = validateAll(drugForCalc, machineForCalc, "RESIDUAL", area ? parseFloat(area) : undefined);
    if (!validation.canCalculate) {
      setErrors(validation.errors);
      setWarnings(validation.warnings);
      return;
    }

    if (!drugForCalc) return;

    // 滞留喷洒：机器可选，无机器时用默认
    const machineForEngine = machineForCalc || {
      id: "no-machine",
      machineName: "无需器械",
      machineType: "RESIDUAL_SPRAYER",
      flow: { type: "FIXED" as const, mlPerSecond: 0 },
      swathMeter: 1,
      source: "N/A",
    } as Machine;

    try {
      const calcResult = calculateResidual(
        {
          drugId: drugForCalc.id,
          machineId: machineForEngine.id,
          area: parseFloat(area),
          surfaceTypeId,
          customAbsorption: customAbsorption ? parseFloat(customAbsorption) : undefined,
        },
        drugForCalc,
        machineForEngine
      );
      setResult(calcResult);
      setWarnings(validation.warnings);
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "计算出错"]);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const drugName = entryMode === "by-drug" ? selectedDrug?.productName : buildCustomDrug()?.productName;
    const lines = [
      "滞留喷洒方案",
      "────────────────",
      `药物: ${drugName || "—"}`,
      `面积: ${area}m²`,
      `表面: ${selectedSurface?.name || "自定义"} (${effectiveAbsorption}mL/m²)`,
      `原药量: ${formatVolume(result.rawDrugMl)}`,
      `最终药液: ${formatVolume(result.totalSolutionMl)}`,
      `稀释: ${result.dilutionFactor.toFixed(1)}倍 (${result.dilutionRatio})`,
      `稀释剂: ${formatVolume(result.diluentMl)}`,
    ];
    if (result.tanks.length > 0) {
      lines.push(`药箱: ${result.tanks.length}箱`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-gray-700">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold">滞留喷洒</h1>
          <p className="text-xs text-gray-500">表面滞留处理</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* 入口切换 */}
        <div className="card">
          <label className="label">计算依据</label>
          <div className="flex gap-2">
            <button
              className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${entryMode === "by-drug" ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-600"}`}
              onClick={() => setEntryMode("by-drug")}
            >
              按具体药物
            </button>
            <button
              className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${entryMode === "by-ingredient" ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-600"}`}
              onClick={() => setEntryMode("by-ingredient")}
            >
              按有效成分
            </button>
          </div>
        </div>

        {/* === 按具体药物 === */}
        {entryMode === "by-drug" && (
          <div className="card">
            <label className="label">选择药物</label>
            <input
              type="text"
              placeholder="搜索药品名称、登记证号或有效成分..."
              className="input-field mb-2"
              value={drugSearch}
              onChange={e => { setDrugSearch(e.target.value); setSelectedDrugId(""); }}
            />
            {!selectedDrugId && (
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {drugResults.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500 text-center">
                    未找到匹配药物
                    <Link href="/calculate/custom-drug" className="text-teal-600 ml-1">使用登记标签自行计算</Link>
                  </div>
                ) : (
                  drugResults.map(d => {
                    const canUse = isDrugCalculable(d, "RESIDUAL");
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={!canUse}
                        className={`w-full text-left p-3 border-b border-gray-100 last:border-0 ${canUse ? "hover:bg-gray-50" : "bg-gray-50/60 cursor-not-allowed"}`}
                        onClick={() => { setSelectedDrugId(d.id); setDrugSearch(d.productName); }}
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
                  {selectedDrug.registrationNo} · {selectedDrug.dose?.value}{selectedDrug.dose?.unit}
                </div>
              </div>
            )}
          </div>
        )}

        {/* === 按有效成分 === */}
        {entryMode === "by-ingredient" && (
          <div className="card">
            <label className="label">有效成分</label>
            {ingredients.map((ing, idx) => (
              <div key={idx} className="flex gap-2 mb-2 items-end">
                <div className="flex-1">
                  {idx === 0 && <div className="text-xs text-gray-400 mb-1">成分名称</div>}
                  <select
                    className="input-field"
                    value={ing.name}
                    onChange={e => {
                      const newIngs = [...ingredients];
                      newIngs[idx].name = e.target.value;
                      setIngredients(newIngs);
                    }}
                  >
                    <option value="">选择成分...</option>
                    {INGREDIENT_OPTIONS.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                    <option value="other">其他...</option>
                  </select>
                  {ing.name === "other" && (
                    <input
                      type="text"
                      placeholder="输入成分名称"
                      className="input-field mt-1"
                      value={ing.customName}
                      onChange={e => {
                        const newIngs = [...ingredients];
                        newIngs[idx].customName = e.target.value;
                        setIngredients(newIngs);
                      }}
                    />
                  )}
                </div>
                <div className="w-24">
                  {idx === 0 && <div className="text-xs text-gray-400 mb-1">含量</div>}
                  <input
                    type="number"
                    placeholder="4.0"
                    className="input-field"
                    value={ing.value}
                    onChange={e => {
                      const newIngs = [...ingredients];
                      newIngs[idx].value = e.target.value;
                      setIngredients(newIngs);
                    }}
                  />
                </div>
                <div className="w-20">
                  {idx === 0 && <div className="text-xs text-gray-400 mb-1">单位</div>}
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
                {ingredients.length > 1 && (
                  <button
                    className="text-red-400 hover:text-red-600 pb-0.5"
                    onClick={() => setIngredients(ingredients.filter((_, i) => i !== idx))}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button
              className="text-sm text-teal-600 flex items-center gap-1 mt-1"
              onClick={() => setIngredients([...ingredients, { name: "", customName: "", value: "", unit: "%" }])}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加复配成分
            </button>

            <div className="mt-3">
              <label className="label">剂型</label>
              <select className="input-field" value={formulationType} onChange={e => setFormulationType(e.target.value as FormulationType)}>
                {FORMULATION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <label className="label">制剂使用剂量</label>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                <input
                  type="number"
                  placeholder={activeDoseUnit === "mg/m2" ? "例如: 25" : activeDoseUnit === "mL/m2" ? "例如: 5" : "例如: 0.5"}
                  className="input-field"
                  value={activeDoseValue}
                  onChange={e => setActiveDoseValue(e.target.value)}
                />
                <select
                  className="input-field"
                  value={activeDoseUnit}
                  onChange={e => setActiveDoseUnit(e.target.value as "mg/m2" | "mL/m2" | "g/m2")}
                >
                  <option value="mg/m2">mg/m²</option>
                  <option value="mL/m2">mL/m²</option>
                  <option value="g/m2">g/m²</option>
                </select>
              </div>
              <p className="text-xs text-gray-400 mt-1">来自标签或白云区培训推荐</p>
              {activeDoseUnit === "g/m2" && (
                <div className="mt-2">
                  <label className="label">制剂密度 (g/mL)（可选，默认≈1）</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      placeholder="1.0"
                      step="0.1"
                      className="input-field flex-1"
                      value={formulationDensity}
                      onChange={e => setFormulationDensity(e.target.value)}
                    />
                    <span className="text-xs text-gray-500">g/mL</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">用于将 g/m² 换算为 mL/m²。水基制剂一般≈1，油基可能≈0.8-0.9</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 器械选择 */}
        <div className="card">
          <label className="label">选择喷洒器械（可选）</label>
          <p className="text-xs text-gray-400 mb-2">滞留喷洒只需药物和面积即可计算，器械用于计算作业参数</p>

          {!showCustomMachine ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {machines.map(m => (
                  <button
                    key={m.id}
                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                      selectedMachineId === m.id ? "border-teal-500 bg-teal-50" : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => { setSelectedMachineId(m.id); setCustomFlow(""); }}
                  >
                    <div className="font-medium text-sm">{m.machineName}</div>
                    <div className="text-xs text-gray-500">
                      {m.flow.type === "VARIABLE" ? `0-${m.flow.maxMlPerSecond}mL/s` : `${m.flow.mlPerSecond}mL/s`}
                    </div>
                  </button>
                ))}
              </div>

              {selectedMachine && (
                <div className="mt-3">
                  <label className="label">现场实测流量 (mL/s)（可选）</label>
                  <input
                    type="number"
                    placeholder={`默认 ${getMachineFlow(selectedMachine).toFixed(2)}`}
                    className="input-field"
                    value={customFlow}
                    onChange={e => setCustomFlow(e.target.value)}
                  />
                </div>
              )}

              <button
                className="text-sm text-teal-600 mt-3 flex items-center gap-1"
                onClick={() => setShowCustomMachine(true)}
              >
                找不到器械 / 不知道型号？直接填写参数
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label">流量 (mL/s 或 mL/min)</label>
                <input
                  type="number"
                  placeholder="例如: 200 (mL/s)"
                  className="input-field"
                  value={customMachineFlow}
                  onChange={e => setCustomMachineFlow(e.target.value)}
                />
              </div>

              <div>
                <label className="label">药箱容量 (L)（可选）</label>
                <input
                  type="number"
                  placeholder="例如: 8"
                  className="input-field"
                  value={customMachineTank}
                  onChange={e => setCustomMachineTank(e.target.value)}
                />
              </div>

              <button
                className="text-sm text-gray-500 flex items-center gap-1"
                onClick={() => { setShowCustomMachine(false); setCustomMachineFlow(""); setCustomMachineTank(""); }}
              >
                返回选择已有器械
              </button>
            </div>
          )}
        </div>

        {/* 面积和表面类型 */}
        <div className="card">
          <label className="label">处置面积 (m²)</label>
          <input type="number" placeholder="例如: 100" className="input-field" value={area} onChange={e => setArea(e.target.value)} />

          <label className="label mt-3">表面类型</label>
          <div className="space-y-2">
            {SURFACE_TYPES.map(st => (
              <button
                key={st.id}
                className={`w-full p-3 rounded-lg border-2 text-left transition-colors ${
                  surfaceTypeId === st.id ? "border-teal-500 bg-teal-50" : "border-gray-200"
                }`}
                onClick={() => setSurfaceTypeId(st.id)}
              >
                <div className="font-medium text-sm">{st.name}</div>
                <div className="text-xs text-gray-500">
                  {st.examples} · {st.absorptionRange[0]}-{st.absorptionRange[1]}mL/m² (默认{st.defaultAbsorption})
                </div>
              </button>
            ))}
          </div>

          <div className="mt-3">
            <label className="label">吸水量确定方式</label>
            <div className="space-y-2">
              <div>
                <button
                  className="text-sm text-teal-600 flex items-center gap-1"
                  onClick={() => setShowCalibration(!showCalibration)}
                >
                  {showCalibration ? "收起" : "现场实测（推荐）"}
                </button>
                {showCalibration && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-2">
                    <div className="text-xs text-gray-600 mb-2">
                      在 1m² 同类表面做 3 次喷量测试，记录每次喷出量：
                    </div>
                    {calibrationMeasurements.map((val, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <span className="text-xs text-gray-500 w-12">第{idx + 1}次</span>
                        <input
                          type="number"
                          placeholder="mL"
                          className="input-field flex-1"
                          value={val}
                          onChange={e => {
                            const newVals = [...calibrationMeasurements];
                            newVals[idx] = e.target.value;
                            setCalibrationMeasurements(newVals);
                          }}
                        />
                        <span className="text-xs text-gray-500">mL</span>
                      </div>
                    ))}
                    {calibrationMeasurements.filter(v => v).length >= 2 && (
                      <div className="text-xs text-teal-700 mt-2">
                        平均吸水量: {
                          (() => {
                            const validVals = calibrationMeasurements.filter(v => v).map(Number);
                            const avg = validVals.reduce((a, b) => a + b, 0) / validVals.length;
                            return avg.toFixed(1);
                          })()
                        } mL/m²
                        <button
                          className="ml-2 text-teal-600 underline"
                          onClick={() => {
                            const validVals = calibrationMeasurements.filter(v => v).map(Number);
                            const avg = validVals.reduce((a, b) => a + b, 0) / validVals.length;
                            setCustomAbsorption(avg.toFixed(1));
                            setShowCalibration(false);
                          }}
                        >
                          使用此值
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-gray-500">或手动输入：</span>
                <input
                  type="number"
                  placeholder={`默认 ${effectiveAbsorption}`}
                  className="input-field flex-1"
                  value={customAbsorption}
                  onChange={e => setCustomAbsorption(e.target.value)}
                />
                <span className="text-xs text-gray-500">mL/m²</span>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <label className="label">药箱容量 (L)（可选，用于药箱拆分）</label>
            <input
              type="number"
              placeholder="例如: 8"
              className="input-field"
              value={tankCapacity}
              onChange={e => setTankCapacity(e.target.value)}
            />
          </div>
        </div>

        <button className="btn-primary w-full" onClick={handleCalculate}>计算配药方案</button>

        {errors.length > 0 && (
          <div className="warning-red">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>
        )}
        {warnings.length > 0 && (
          <div className="warning-yellow">{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="card bg-orange-50 border-orange-200">
              <h3 className="text-lg font-semibold text-orange-800 mb-4 text-center">滞留喷洒方案</h3>

              {entryMode === "by-drug" && selectedDrug && (
                <div className="mb-4 pb-3 border-b border-orange-200">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">药物</span>
                    <span className="font-semibold">{selectedDrug.productName}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-gray-600">状态</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${DRUG_STATUS_COLORS[selectedDrug.status]}`}>
                      {DRUG_STATUS_LABELS[selectedDrug.status]}
                    </span>
                  </div>
                </div>
              )}
              {entryMode === "by-ingredient" && (
                <div className="mb-4 pb-3 border-b border-orange-200">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">药物</span>
                    <span className="font-semibold">{buildCustomDrug()?.productName || "自定义"}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-gray-600">来源</span>
                    <span className="text-xs px-1.5 py-0.5 rounded border text-purple-700 bg-purple-50 border-purple-200">自定义</span>
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
                  <div className="result-value">{result.dilutionFactor.toFixed(1)}倍</div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-orange-200 text-sm">
                <div className="flex justify-between"><span>配比</span><span className="font-semibold">{result.dilutionRatio}</span></div>
                <div className="flex justify-between mt-1">
                  <span>吸水量</span>
                  <span className="font-semibold">{effectiveAbsorption} mL/m²</span>
                </div>
              </div>
            </div>

            {result.tanks.length > 0 && (
              <div className="card">
                <h4 className="font-semibold text-sm mb-3">药箱拆分</h4>
                {result.tanks.map((tank, i) => (
                  <div key={i} className="flex justify-between text-sm py-2 border-b border-gray-100 last:border-0">
                    <span>{tank.isRemainder ? "尾箱" : `第${tank.tankIndex}箱`} <span className="text-gray-400">({tank.solutionL.toFixed(1)}L)</span></span>
                    <span>原药 {tank.drugL.toFixed(2)}L + 稀释剂 {tank.diluentL.toFixed(2)}L</span>
                  </div>
                ))}
              </div>
            )}

            <details className="card">
              <summary className="collapsible-header"><span className="font-medium text-sm">计算过程</span></summary>
              <div className="collapsible-content">{result.explanation.map((line, i) => <div key={i} className="py-1 border-b border-gray-100 last:border-0">{line}</div>)}</div>
            </details>

            <div className="card bg-amber-50 border-amber-200">
              <p className="text-xs text-amber-800">最终执行以当前有效农药登记标签及主管部门要求为准。</p>
            </div>

            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={handleCopy}>复制结果</button>
              <button className="btn-secondary flex-1" onClick={() => { setResult(null); setErrors([]); setWarnings([]); }}>重新计算</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
