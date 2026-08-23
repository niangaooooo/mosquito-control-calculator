"use client";

import { useState } from "react";
import Link from "next/link";
import { getAllMachines } from "@/services/data";
import type { Machine } from "@/types";

const MACHINE_TYPE_LABELS: Record<string, string> = {
  ULV_BACKPACK: "ULV背负式",
  ULV_VEHICLE: "ULV车载式",
  ULV_CARRY: "ULV手提式",
  ULV_PORTABLE: "ULV便携式",
  RESIDUAL_SPRAYER: "滞留喷洒器",
  THERMAL_FOG: "热烟雾机",
};

const POWER_TYPE_LABELS: Record<string, string> = {
  BATTERY: "蓄电池",
  AC: "交流电",
  GASOLINE: "燃油",
  MANUAL: "手动",
  MOTORIZED: "机动",
};

const SCENE_LABELS: Record<string, string> = {
  INDOOR_SMALL: "室内小空间",
  INDOOR_LARGE: "大型室内",
  OUTDOOR: "室外",
};

const METHOD_LABELS: Record<string, string> = {
  ULV: "ULV喷雾",
  INDOOR: "室内喷雾",
  RESIDUAL: "滞留喷洒",
};

export default function MachinesPage() {
  const machines = getAllMachines();
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filteredMachines = typeFilter === "all"
    ? machines
    : machines.filter(m => {
        if (typeFilter === "ulv") return m.machineType.startsWith("ULV");
        if (typeFilter === "residual") return m.machineType === "RESIDUAL_SPRAYER";
        return true;
      });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-gray-700">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">器械查询</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* 筛选 */}
        <div className="flex gap-2">
          {[
            { key: "all", label: "全部" },
            { key: "ulv", label: "ULV设备" },
            { key: "residual", label: "滞留喷洒" },
          ].map(f => (
            <button
              key={f.key}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                typeFilter === f.key
                  ? "bg-teal-500 text-white border-teal-500"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
              onClick={() => setTypeFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filteredMachines.map(m => (
          <MachineCard key={m.id} machine={m} />
        ))}

        <Link href="/calculate/ulv" className="block">
          <div className="card bg-teal-50 border-teal-200 text-center py-6">
            <div className="text-sm text-teal-700">+ 添加自定义器械</div>
            <div className="text-xs text-teal-500 mt-1">（计算时可手动输入器械参数）</div>
          </div>
        </Link>
      </div>
    </div>
  );
}

function MachineCard({ machine: m }: { machine: Machine }) {
  const [expanded, setExpanded] = useState(false);

  const flowText = m.flow
    ? m.flow.type === "VARIABLE"
      ? `0 ~ ${m.flow.maxMlPerSecond} mL/s (可调)`
      : `${m.flow.mlPerSecond} mL/s (固定)`
    : `${m.flowMlPerSecond ?? 0} mL/s`;

  return (
    <div className="card">
      <div
        className="flex justify-between items-start cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <div className="font-semibold text-base">{m.machineName}</div>
          <div className="text-xs text-gray-500 mt-1">
            {MACHINE_TYPE_LABELS[m.machineType] || m.machineType}
            {m.powerType && ` · ${POWER_TYPE_LABELS[m.powerType] || m.powerType}`}
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* 基本参数 */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-xs text-gray-500">流量</div>
          <div className="font-semibold text-xs">{flowText}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-xs text-gray-500">喷幅</div>
          <div className="font-semibold">{m.swathMeter} m</div>
        </div>
        {m.tankCapacityLiter && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">药箱容量</div>
            <div className="font-semibold">{m.tankCapacityLiter} L</div>
          </div>
        )}
        {m.dropletRangeMicron && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">雾滴粒径</div>
            <div className="font-semibold">{m.dropletRangeMicron[0]}~{m.dropletRangeMicron[1]} um</div>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-200 space-y-2 text-sm">
          {/* 适用场景 */}
          {m.allowedScenes && m.allowedScenes.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs">适用场景：</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {m.allowedScenes.map(s => (
                  <span key={s} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded">
                    {SCENE_LABELS[s] || s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 适用施药方式 */}
          {m.allowedMethods && m.allowedMethods.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs">适用施药方式：</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {m.allowedMethods.map(me => (
                  <span key={me} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                    {METHOD_LABELS[me] || me}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Profile 列表 */}
          {m.profiles && m.profiles.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs">喷嘴/档位配置：</span>
              <div className="space-y-1 mt-1">
                {m.profiles.map(p => (
                  <div key={p.id} className="bg-gray-50 rounded px-3 py-2 text-xs">
                    <span className="font-medium">{p.name}</span>
                    {p.nozzle && <span className="text-gray-400 ml-1">({p.nozzle})</span>}
                    <span className="text-gray-500 ml-2">{p.flowMlPerSecond} mL/s</span>
                    {p.description && <span className="text-gray-400 ml-2">{p.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {m.notes && <div className="text-xs text-gray-500">{m.notes}</div>}
          <div className="text-xs text-gray-400">
            来源: {m.source}
            {m.sourceUrl && <a href={m.sourceUrl} target="_blank" className="text-teal-500 ml-1">[链接]</a>}
          </div>
        </div>
      )}
    </div>
  );
}
