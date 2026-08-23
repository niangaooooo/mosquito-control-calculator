"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { CalculationHistory } from "@/types";
import { APPLICATION_METHOD_LABELS } from "@/types";
import { formatVolume } from "@/calculation-engine/conversion";

export default function HistoryPage() {
  const [history, setHistory] = useState<CalculationHistory[]>([]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = localStorage.getItem("calculation_history");
        if (stored) {
          setHistory(JSON.parse(stored));
        }
      } catch {
        // 本地历史损坏时保持空列表，不影响计算功能。
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearHistory = () => {
    localStorage.removeItem("calculation_history");
    setHistory([]);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-gray-700">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">📋 计算历史</h1>
      </div>

      <div className="p-4 space-y-3">
        {history.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-gray-500">暂无计算记录</div>
            <Link href="/" className="text-teal-600 text-sm mt-2 inline-block">
              去计算 →
            </Link>
          </div>
        ) : (
          <>
            <div className="flex justify-end">
              <button className="text-sm text-red-500" onClick={clearHistory}>
                清空历史
              </button>
            </div>
            {history.map(item => (
              <div key={item.id} className="card">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-sm">{item.drugName}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {APPLICATION_METHOD_LABELS[item.method] || item.method} · {item.machineName}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">
                    {new Date(item.timestamp).toLocaleString("zh-CN")}
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-600">
                  <span>面积: {item.area}m²</span>
                  {"rawDrugMl" in item.result && <span>原药: {formatVolume(item.result.rawDrugMl)}</span>}
                  {"totalSolutionMl" in item.result && <span>药液: {formatVolume(item.result.totalSolutionMl)}</span>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
