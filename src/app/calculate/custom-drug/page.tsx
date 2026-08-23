"use client";

import { useState } from "react";
import Link from "next/link";
import { calculateFromActiveIngredient } from "@/calculation-engine/activeIngredient";
import type { ActiveIngredientCalcResult } from "@/calculation-engine/activeIngredient";
import type { FormulationType, ConcentrationUnit } from "@/types";

const FORMULATION_OPTIONS: { value: FormulationType; label: string }[] = [
  { value: "EC", label: "乳油 (EC)" },
  { value: "EW", label: "水乳剂 (EW)" },
  { value: "SC", label: "悬浮剂 (SC)" },
  { value: "OL", label: "油剂 (OL)" },
  { value: "ME", label: "微乳剂 (ME)" },
  { value: "WP", label: "可湿性粉剂 (WP)" },
  { value: "CS", label: "微胶囊剂 (CS)" },
  { value: "WG", label: "水分散粒剂 (WG)" },
];

const CONCENTRATION_UNITS: { value: ConcentrationUnit; label: string }[] = [
  { value: "g/L", label: "g/L" },
  { value: "mg/mL", label: "mg/mL" },
  { value: "%", label: "%" },
  { value: "g/kg", label: "g/kg" },
  { value: "mg/g", label: "mg/g" },
];

export default function CustomDrugPage() {
  const [productName, setProductName] = useState("");
  const [formulationType, setFormulationType] = useState<FormulationType>("EW");
  const [concentrationValue, setConcentrationValue] = useState("");
  const [concentrationUnit, setConcentrationUnit] = useState<ConcentrationUnit>("g/L");
  const [activeDoseValue, setActiveDoseValue] = useState("");
  const [activeDoseUnit, setActiveDoseUnit] = useState("mg/m3");
  const [scenario, setScenario] = useState<"space_spray" | "residual">("space_spray");
  const [result, setResult] = useState<ActiveIngredientCalcResult | null>(null);
  const [error, setError] = useState("");

  const handleCalculate = () => {
    setError("");
    setResult(null);

    if (!concentrationValue || !activeDoseValue) {
      setError("请填写有效成分浓度和登记推荐剂量");
      return;
    }

    try {
      const calcResult = calculateFromActiveIngredient({
        concentration: {
          value: parseFloat(concentrationValue),
          unit: concentrationUnit,
        },
        activeDose: {
          value: parseFloat(activeDoseValue),
          unit: activeDoseUnit as "mg/m3" | "mg/m2",
        },
        formulationType,
        scenario,
      });
      setResult(calcResult);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "计算出错");
    }
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
          <h1 className="text-lg font-semibold">自定义药物 / 有效成分计算</h1>
          <p className="text-xs text-gray-500">有效成分剂量 → 制剂用量换算</p>
        </div>
      </div>

      {/* 安全提示 */}
      <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        ⚠️ 该功能仅用于根据产品登记标签中的有效成分含量和推荐有效成分剂量换算制剂使用量，不用于自行确定杀虫剂推荐剂量。
      </div>

      <div className="p-4 space-y-4">
        {/* 商品名称 */}
        <div className="card">
          <label className="label">商品名称（选填）</label>
          <input type="text" placeholder="例如: XX杀虫剂" className="input-field" value={productName} onChange={e => setProductName(e.target.value)} />
        </div>

        {/* 剂型 */}
        <div className="card">
          <label className="label">剂型</label>
          <select className="input-field" value={formulationType} onChange={e => setFormulationType(e.target.value as FormulationType)}>
            {FORMULATION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 施药场景 */}
        <div className="card">
          <label className="label">施药场景</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`p-3 rounded-lg border-2 text-center text-sm ${scenario === "space_spray" ? "border-teal-500 bg-teal-50" : "border-gray-200"}`}
              onClick={() => { setScenario("space_spray"); setActiveDoseUnit("mg/m3"); }}
            >
              空间喷雾
              <div className="text-xs text-gray-500 mt-1">mg/m³</div>
            </button>
            <button
              className={`p-3 rounded-lg border-2 text-center text-sm ${scenario === "residual" ? "border-teal-500 bg-teal-50" : "border-gray-200"}`}
              onClick={() => { setScenario("residual"); setActiveDoseUnit("mg/m2"); }}
            >
              滞留喷洒
              <div className="text-xs text-gray-500 mt-1">mg/m²</div>
            </button>
          </div>
        </div>

        {/* 有效成分浓度 */}
        <div className="card">
          <label className="label">有效成分含量</label>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <input
              type="number"
              placeholder="例如: 25"
              className="input-field"
              value={concentrationValue}
              onChange={e => setConcentrationValue(e.target.value)}
            />
            <select
              className="input-field"
              value={concentrationUnit}
              onChange={e => setConcentrationUnit(e.target.value as ConcentrationUnit)}
            >
              {CONCENTRATION_UNITS.map(u => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
          {concentrationValue && concentrationUnit === "g/L" && (
            <div className="text-xs text-gray-500 mt-1">
              ≈ {parseFloat(concentrationValue) || 0} mg/mL
            </div>
          )}
        </div>

        {/* 登记推荐有效成分剂量 */}
        <div className="card">
          <label className="label">登记推荐有效成分剂量</label>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
            <input
              type="number"
              placeholder={scenario === "space_spray" ? "例如: 1.67" : "例如: 50"}
              className="input-field"
              value={activeDoseValue}
              onChange={e => setActiveDoseValue(e.target.value)}
            />
            <span className="input-field flex items-center justify-center bg-gray-50 text-gray-600">
              {activeDoseUnit}
            </span>
          </div>
        </div>

        <button className="btn-primary w-full" onClick={handleCalculate}>
          换算制剂用量
        </button>

        {error && <div className="warning-red">❌ {error}</div>}

        {result && (
          <div className="space-y-4">
            <div className="card bg-teal-50 border-teal-200">
              <h3 className="text-lg font-semibold text-teal-800 mb-2 text-center">换算结果</h3>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1">制剂用量</div>
                <div className="result-value">
                  {result.formulationDose.toFixed(4)}
                  <span className="result-unit">{result.formulationDoseUnit}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-teal-200 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">标准化浓度</span>
                  <span className="font-semibold">{result.normalizedConcentration} {result.normalizedConcentrationUnit}</span>
                </div>
              </div>
            </div>

            <details className="card">
              <summary className="collapsible-header"><span className="font-medium text-sm">📝 计算过程</span></summary>
              <div className="collapsible-content">
                {result.explanation.map((line, i) => (
                  <div key={i} className="py-1 border-b border-gray-100 last:border-0">{line}</div>
                ))}
              </div>
            </details>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
              💡 换算得到的制剂用量 <strong>{result.formulationDose.toFixed(4)} {result.formulationDoseUnit}</strong> 可直接用于{scenario === "space_spray" ? "空间喷雾" : "滞留喷洒"}计算。
              请核对农药登记标签确认数据准确性。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
