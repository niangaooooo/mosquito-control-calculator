"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { getCalculableDrugsForMethod, searchDrugs, getDrugById, getAllActiveIngredientNames, isDrugCalculable } from "@/services/data";
import { getAllMachines, getMachineById, filterMachinesByScene, filterMachinesByMethod } from "@/services/data";
import { calculateIndoor } from "@/calculation-engine";
import { validateAll } from "@/rules";
import { getMachineFlow } from "@/rules/machine";
import { formatVolume } from "@/calculation-engine/conversion";
import type { Drug, Machine, IndoorCalculationResult, FormulationType } from "@/types";
import { FORMULATION_LABELS, DRUG_STATUS_LABELS, DRUG_STATUS_COLORS } from "@/types";

type EntryMode = "by-drug" | "by-ingredient";

const INGREDIENT_OPTIONS = getAllActiveIngredientNames();

const FORMULATION_OPTIONS: { value: FormulationType; label: string }[] = [
  { value: "EC", label: "乳油 (EC)" },
  { value: "EW", label: "水乳剂 (EW)" },
  { value: "SC", label: "悬浮剂 (SC)" },
  { value: "ME", label: "微乳剂 (ME)" },
  { value: "OL", label: "油剂 (OL)" },
  { value: "SL", label: "可溶液剂 (SL)" },
];

export default function IndoorPage() {
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
  const [formulationType, setFormulationType] = useState<FormulationType>("EW");
  const [activeDoseValue, setActiveDoseValue] = useState("");
  const [activeDoseUnit, setActiveDoseUnit] = useState<"mg/m3" | "mL/m3">("mg/m3");

  // === 公共 ===
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [customFlow, setCustomFlow] = useState("");
  const [area, setArea] = useState("");
  const [ceilingHeight, setCeilingHeight] = useState("3");
  const [tankCapacity, setTankCapacity] = useState("");

  // === 自定义机器 ===
  const [showCustomMachine, setShowCustomMachine] = useState(false);
  const [customMachineFlow, setCustomMachineFlow] = useState("");
  const [customMachineTank, setCustomMachineTank] = useState("");

  // === 60秒流量校准 ===
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationVolume, setCalibrationVolume] = useState("");

  const [result, setResult] = useState<IndoorCalculationResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const drugResults = drugSearch
    ? searchDrugs(drugSearch).slice(0, 20)
    : getCalculableDrugsForMethod("INDOOR").slice(0, 10);

  const selectedDrug = selectedDrugId ? getDrugById(selectedDrugId) : null;

  const machines = useMemo(() => {
    let list = getAllMachines();
    list = filterMachinesByMethod(list, "INDOOR");
    list = filterMachinesByScene(list, "INDOOR_SMALL");
    return list;
  }, []);

  const selectedMachine = selectedMachineId ? getMachineById(selectedMachineId) : null;

  const effectiveFlow = useMemo(() => {
    if (showCustomMachine) {
      if (customMachineFlow) return parseFloat(customMachineFlow) || 0;
      if (calibrationVolume) return parseFloat(calibrationVolume) / 60;
      return 0;
    }
    if (!selectedMachine) return 0;
    if (customFlow) return parseFloat(customFlow) || 0;
    return getMachineFlow(selectedMachine, selectedProfileId || undefined);
  }, [selectedMachine, selectedProfileId, customFlow, showCustomMachine, customMachineFlow, calibrationVolume]);

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

    const doseType: "FORMULATION_VOLUME_PER_VOLUME" | "ACTIVE_MASS_PER_VOLUME" = activeDoseUnit === "mL/m3" ? "FORMULATION_VOLUME_PER_VOLUME" : "ACTIVE_MASS_PER_VOLUME";

    return {
      id: "custom-indoor",
      productName: activeIngredients.map(i => `${i.name}${i.value}${i.unit}`).join(" + "),
      registrationNo: "自定义",
      manufacturer: "用户输入",
      formulationType,
      activeIngredients,
      target: ["蚊"],
      environments: ["indoor"],
      applicationMethods: ["INDOOR"],
      dose: {
        type: doseType,
        value: parseFloat(activeDoseValue),
        unit: activeDoseUnit === "mL/m3" ? "mL/m3" : "mg/m3",
      },
      diluent: "water",
      indoorAllowed: true,
      outdoorAllowed: false,
      status: "CUSTOM",
      labelSource: "用户自定义",
      dataVersion: "custom",
    } as Drug;
  };

  // 构建自定义机器对象
  const buildCustomMachine = (): Machine | null => {
    const flow = effectiveFlow;
    if (flow <= 0) return null;
    return {
      id: "custom-indoor-machine",
      machineName: "自定义器械",
      machineType: "INDOOR_SMALL",
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

    const validation = validateAll(drugForCalc, machineForCalc, "INDOOR", area ? parseFloat(area) : undefined);
    if (!validation.canCalculate) {
      setErrors(validation.errors);
      setWarnings(validation.warnings);
      return;
    }

    if (!drugForCalc || !machineForCalc) return;

    try {
      const calcResult = calculateIndoor(
        {
          drugId: drugForCalc.id,
          machineId: machineForCalc.id,
          area: parseFloat(area),
          ceilingHeight: parseFloat(ceilingHeight) || 3,
          tankCapacity: tankCapacity ? parseFloat(tankCapacity) : undefined,
        },
        drugForCalc,
        machineForCalc
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
      "室内小空间喷雾方案",
      "────────────────",
      `药物: ${drugName || "—"}`,
      `面积: ${area}m²`,
      `层高: ${ceilingHeight}m`,
      `体积: ${result.volume}m³`,
      `原药量: ${formatVolume(result.rawDrugMl)}`,
      `最终药液: ${formatVolume(result.totalSolutionMl)}`,
      `喷雾时长: ${result.sprayDurationSeconds.toFixed(1)}秒`,
    ];
    if (result.dilutionFactor > 1) {
      lines.push(`稀释: ${result.dilutionFactor}倍 (${result.dilutionRatio})`);
      lines.push(`稀释剂: ${formatVolume(result.diluentMl)}`);
    }
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
          <h1 className="text-lg font-semibold">室内小空间喷雾</h1>
          <p className="text-xs text-gray-500">中小型室内场所</p>
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
                    const canUse = isDrugCalculable(d, "INDOOR");
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
              <label className="label">有效成分剂量</label>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                <input
                  type="number"
                  placeholder={activeDoseUnit === "mg/m3" ? "例如: 1.6" : "例如: 0.04"}
                  className="input-field"
                  value={activeDoseValue}
                  onChange={e => setActiveDoseValue(e.target.value)}
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
              <p className="text-xs text-gray-400 mt-1">来自标签、白云区培训或 WS/T 832-2024</p>
            </div>
          </div>
        )}

        {/* 器械选择 */}
        <div className="card">
          <label className="label">选择喷雾器械</label>

          {!showCustomMachine ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {machines.map(m => (
                  <button
                    key={m.id}
                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                      selectedMachineId === m.id ? "border-teal-500 bg-teal-50" : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => { setSelectedMachineId(m.id); setSelectedProfileId(""); setCustomFlow(""); }}
                  >
                    <div className="font-medium text-sm">{m.machineName}</div>
                    <div className="text-xs text-gray-500">
                      {m.flow.type === "VARIABLE" ? `0-${m.flow.maxMlPerSecond}mL/s` : `${m.flow.mlPerSecond}mL/s`}
                    </div>
                  </button>
                ))}
              </div>

              {selectedMachine && selectedMachine.profiles && selectedMachine.profiles.length > 0 && (
                <div className="mt-3">
                  <label className="label">喷嘴/档位</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedMachine.profiles.map(p => (
                      <button
                        key={p.id}
                        className={`px-3 py-1.5 rounded-lg text-sm border ${
                          selectedProfileId === p.id ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 hover:border-gray-300"
                        }`}
                        onClick={() => { setSelectedProfileId(p.id); setCustomFlow(""); }}
                      >
                        {p.name}{p.nozzle && ` (${p.nozzle})`}
                        <span className="text-gray-400 ml-1">{p.flowMlPerSecond}mL/s</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedMachine && (
                <div className="mt-3">
                  <label className="label">现场实测流量 (mL/s)（可选）</label>
                  <input
                    type="number"
                    placeholder={`默认 ${effectiveFlow.toFixed(2)}`}
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
                <label className="label">流量 (mL/s)</label>
                <input
                  type="number"
                  placeholder="例如: 7.5"
                  className="input-field"
                  value={customMachineFlow}
                  onChange={e => setCustomMachineFlow(e.target.value)}
                />
              </div>

              <div>
                <button
                  className="text-sm text-teal-600 flex items-center gap-1"
                  onClick={() => setShowCalibration(!showCalibration)}
                >
                  {showCalibration ? "收起校准" : "60秒量杯法校准流量"}
                </button>
                {showCalibration && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-600 mb-2">
                      向量杯连续喷60秒，读取总喷出量：
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        placeholder="mL"
                        className="input-field flex-1"
                        value={calibrationVolume}
                        onChange={e => setCalibrationVolume(e.target.value)}
                      />
                      <span className="text-xs text-gray-500">mL</span>
                    </div>
                    {calibrationVolume && parseFloat(calibrationVolume) > 0 && (
                      <div className="text-xs text-teal-700 mt-2">
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
              </div>

              <div>
                <label className="label">药箱容量 (L)（可选）</label>
                <input
                  type="number"
                  placeholder="例如: 6"
                  className="input-field"
                  value={customMachineTank}
                  onChange={e => setCustomMachineTank(e.target.value)}
                />
              </div>

              <button
                className="text-sm text-gray-500 flex items-center gap-1"
                onClick={() => { setShowCustomMachine(false); setCustomMachineFlow(""); setCustomMachineTank(""); setCalibrationVolume(""); }}
              >
                返回选择已有器械
              </button>
            </div>
          )}
        </div>

        {/* 面积和层高 */}
        <div className="card">
          <label className="label">室内面积 (m²)</label>
          <input type="number" placeholder="例如: 15" className="input-field" value={area} onChange={e => setArea(e.target.value)} />
          <label className="label mt-3">层高 (m)</label>
          <input type="number" placeholder="默认3m" className="input-field" value={ceilingHeight} onChange={e => setCeilingHeight(e.target.value)} />
          <label className="label mt-3">药箱容量 (L)（可选，用于药箱拆分）</label>
          <input type="number" placeholder="例如: 6" className="input-field" value={tankCapacity} onChange={e => setTankCapacity(e.target.value)} />
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
            <div className="card bg-green-50 border-green-200">
              <h3 className="text-lg font-semibold text-green-800 mb-4 text-center">室内喷雾方案</h3>

              {entryMode === "by-drug" && selectedDrug && (
                <div className="mb-4 pb-3 border-b border-green-200">
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
                <div className="mb-4 pb-3 border-b border-green-200">
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
                  <div className="text-xs text-gray-500 mb-1">室内体积</div>
                  <div className="result-value">{result.volume}m³</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">原药量</div>
                  <div className="result-value">{formatVolume(result.rawDrugMl)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">最终药液</div>
                  <div className="result-value">{formatVolume(result.totalSolutionMl)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">喷雾时长</div>
                  <div className="result-value">{result.sprayDurationSeconds.toFixed(1)}秒</div>
                </div>
              </div>

              {result.dilutionFactor > 1 && (
                <div className="mt-3 pt-3 border-t border-green-200 text-sm">
                  <div className="flex justify-between"><span>稀释倍数</span><span className="font-semibold">{result.dilutionFactor}倍 ({result.dilutionRatio})</span></div>
                  <div className="flex justify-between mt-1"><span>稀释剂</span><span className="font-semibold">{formatVolume(result.diluentMl)}</span></div>
                </div>
              )}
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
