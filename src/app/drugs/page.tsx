"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  getAllDrugs, searchDrugs, groupDrugs, getVerificationSummary,
  getConfidenceStats,
  getEffectiveDrugStatus, isDrugCalculable,
  DRUG_GROUPS,
} from "@/services/data";
import type { DrugGroupKey } from "@/services/data";
import {
  FORMULATION_LABELS, APPLICATION_METHOD_LABELS,
  DRUG_STATUS_LABELS, DRUG_STATUS_COLORS,
} from "@/types";
import type { Drug } from "@/types";
import { checkExpiryStatus } from "@/verification";
import {
  parseICAMAJson, batchImportDrugs,
  generateDiscoverySummary, generateICAMASearchQueries,
} from "@/services/discovery";

export default function DrugsPage() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");

  const allDrugs = useMemo(() => getAllDrugs(), []);

  const drugs = useMemo(() => {
    let list = search ? searchDrugs(search) : allDrugs;
    if (statusFilter !== "all") {
      list = list.filter(d => statusFilter === "VERIFIED_CALCULABLE"
        ? isDrugCalculable(d)
        : getEffectiveDrugStatus(d) === statusFilter);
    }
    return list;
  }, [search, statusFilter, allDrugs]);

  const groups = useMemo(() => groupDrugs(drugs), [drugs]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allDrugs.length };
    for (const d of allDrugs) {
      const effectiveStatus = getEffectiveDrugStatus(d);
      counts[effectiveStatus] = (counts[effectiveStatus] || 0) + 1;
    }
    return counts;
  }, [allDrugs]);

  const summary = useMemo(() => getVerificationSummary(), []);
  const confidenceStats = useMemo(() => getConfidenceStats(), []);

  const statusFilters = [
    "all", "VERIFIED_CALCULABLE", "BAIYUN_LOCAL_ONLY", "AUTO_DISCOVERY",
    "AUTO_LABEL_SEARCH", "VERIFIED_REGISTRATION", "CONFLICT",
    "NEEDS_REVIEW", "EXPIRED",
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-gray-700">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">药物核验与查询</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* 核验摘要卡片 */}
        <div className="card bg-gradient-to-r from-teal-50 to-blue-50 border-teal-200">
          <h2 className="text-sm font-semibold text-teal-800 mb-2">核验摘要</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <StatBox label="可计算" value={summary.verifiedCalculable} color="text-green-700 bg-green-100" />
            <StatBox label="白云本地" value={summary.baiyunLocal} color="text-blue-700 bg-blue-100" />
            <StatBox label="自动核验中" value={summary.autoDiscovery + summary.autoLabelSearch + summary.conflict} color="text-amber-700 bg-amber-100" />
            <StatBox label="登记确认" value={summary.verifiedRegistration} color="text-teal-700 bg-teal-100" />
          </div>
          {summary.expiring > 0 && (
            <div className="mt-2 text-xs text-orange-700 bg-orange-50 rounded px-2 py-1">
              {summary.expiring} 个药物登记将在90天内到期
            </div>
          )}
          <div className="mt-2 flex gap-3 text-xs text-gray-500">
            <span>置信度:</span>
            <span className="text-green-600">高 {confidenceStats.HIGH}</span>
            <span className="text-yellow-600">中 {confidenceStats.MEDIUM}</span>
            <span className="text-orange-600">低 {confidenceStats.LOW}</span>
            <span className="text-gray-400">无 {confidenceStats.NONE}</span>
          </div>
        </div>

        {/* 搜索 */}
        <input
          type="text"
          placeholder="搜索药品名称、登记证号、有效成分..."
          className="input-field"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* ICAMA 导入 */}
        <ImportSection existingDrugs={allDrugs} />

        {/* 视图模式切换 + 状态筛选 */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <button
              className={`text-xs px-2.5 py-1 rounded-l-lg border ${viewMode === "grouped" ? "bg-teal-500 text-white border-teal-500" : "bg-white text-gray-600 border-gray-200"}`}
              onClick={() => setViewMode("grouped")}
            >
              分组
            </button>
            <button
              className={`text-xs px-2.5 py-1 rounded-r-lg border-t border-b border-r ${viewMode === "flat" ? "bg-teal-500 text-white border-teal-500" : "bg-white text-gray-600 border-gray-200"}`}
              onClick={() => setViewMode("flat")}
            >
              列表
            </button>
          </div>
          <span className="text-xs text-gray-400">共 {drugs.length} 个药物</span>
        </div>

        {/* 状态筛选 */}
        <div className="flex flex-wrap gap-1.5">
          {statusFilters.map(s => (
            (statusCounts[s] || 0) > 0 && (
              <button
                key={s}
                className={`text-xs px-2 py-0.5 rounded-full border ${
                  statusFilter === s
                    ? "bg-teal-500 text-white border-teal-500"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                }`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "全部" : DRUG_STATUS_LABELS[s]}
                <span className="ml-0.5 opacity-70">{statusCounts[s]}</span>
              </button>
            )
          ))}
        </div>

        {/* 列表内容 */}
        {drugs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">未找到匹配药物</div>
        ) : viewMode === "grouped" ? (
          <GroupedDrugList
            groups={groups}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
          />
        ) : (
          <FlatDrugList
            drugs={drugs}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
          />
        )}
      </div>
    </div>
  );
}

function GroupedDrugList({
  groups, expandedId, onToggle,
}: {
  groups: Record<DrugGroupKey, Drug[]>;
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      {DRUG_GROUPS.map(g => {
        const drugs = groups[g.key];
        if (!drugs || drugs.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-gray-800">{g.label}</h3>
              <span className="text-xs text-gray-400">{drugs.length}</span>
            </div>
            <div className="space-y-2">
              {drugs.map(drug => (
                <DrugCard
                  key={drug.id}
                  drug={drug}
                  expanded={expandedId === drug.id}
                  onToggle={() => onToggle(drug.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlatDrugList({
  drugs, expandedId, onToggle,
}: {
  drugs: Drug[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {drugs.map(drug => (
        <DrugCard
          key={drug.id}
          drug={drug}
          expanded={expandedId === drug.id}
          onToggle={() => onToggle(drug.id)}
        />
      ))}
    </div>
  );
}

function DrugCard({ drug, expanded, onToggle }: { drug: Drug; expanded: boolean; onToggle: () => void }) {
  const expiry = drug.registrationValidUntil ? checkExpiryStatus(drug.registrationValidUntil) : null;
  const effectiveStatus = getEffectiveDrugStatus(drug);

  return (
    <div className={`card ${effectiveStatus === "DISABLED" ? "opacity-60" : ""}`}>
      <div className="flex justify-between items-start cursor-pointer" onClick={onToggle}>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base">{drug.productName}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${DRUG_STATUS_COLORS[effectiveStatus]}`}>
              {DRUG_STATUS_LABELS[effectiveStatus]}
            </span>
            {drug.verification?.confidence && drug.verification.confidence !== 'NONE' && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                drug.verification.confidence === 'HIGH' ? 'bg-green-100 text-green-700' :
                drug.verification.confidence === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                'bg-orange-100 text-orange-700'
              }`}>
                {drug.verification.confidence === 'HIGH' ? '高置信' :
                 drug.verification.confidence === 'MEDIUM' ? '中置信' : '低置信'}
              </span>
            )}
            {expiry?.isExpiring && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                {expiry.daysUntilExpiry}天后到期
              </span>
            )}
            {expiry?.isExpired && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">已过期</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {drug.registrationNo} · {FORMULATION_LABELS[drug.formulationType] || drug.formulationType}
            {drug.manufacturer && drug.manufacturer !== "待核验" && drug.manufacturer !== "某农药公司" ? ` · ${drug.manufacturer}` : ""}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {drug.activeIngredients.map(ai => `${ai.name} ${ai.value}${ai.unit}`).join(" + ")}
          </div>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-2 text-sm">
          {drug.registeredName && drug.registeredName !== drug.productName && (
            <DetailRow label="登记名称" value={drug.registeredName} />
          )}
          <DetailRow label="有效成分" value={drug.activeIngredients.map(ai => `${ai.name} ${ai.value}${ai.unit}`).join(" + ")} />
          <DetailRow label="剂型" value={FORMULATION_LABELS[drug.formulationType] || drug.formulationType} />
          <DetailRow label="登记防治对象" value={drug.target.join("、")} />
          <DetailRow label="适用施药方式" value={(drug.applicationMethods || []).map(m => APPLICATION_METHOD_LABELS[m] || m).join("、") || "见使用场景"} />
          {drug.dose && <DetailRow label="登记剂量" value={`${drug.dose.value} ${drug.dose.unit}`} />}
          {drug.uses && drug.uses.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-gray-600 mb-1">使用场景:</div>
              {drug.uses.map(use => (
                <div key={use.id} className="text-xs text-gray-500 ml-2 mb-1">
                  • {APPLICATION_METHOD_LABELS[use.method] || use.method}: {use.dose.value} {use.dose.unit}
                  {use.dilution ? ` (稀释${use.dilution}倍)` : ""}
                </div>
              ))}
            </div>
          )}
          {drug.doseBasis && <DetailRow label="剂量基准" value={drug.doseBasis} />}
          {drug.recommendedDilution && <DetailRow label="推荐稀释倍数" value={`${drug.recommendedDilution}倍`} />}
          <DetailRow label="稀释剂" value={drug.diluent === "water" ? "水" : drug.diluent === "deodorizedKerosene" ? "脱臭煤油" : drug.diluent} />
          <DetailRow label="室内/室外" value={`${drug.indoorAllowed ? "室内✓" : "室内✗"} ${drug.outdoorAllowed ? "室外✓" : "室外✗"}`} />
          <DetailRow label="数据来源" value={drug.labelSource} />
          {drug.holder && <DetailRow label="登记持有人" value={drug.holder} />}
          {drug.registrationValidUntil && <DetailRow label="登记有效期至" value={drug.registrationValidUntil} />}
          {drug.synonyms && drug.synonyms.length > 0 && <DetailRow label="别名" value={drug.synonyms.join("、")} />}

          {/* 核验信息 */}
          {drug.verification && (
            <div className="mt-2 p-2 bg-blue-50 rounded-lg space-y-1">
              <div className="text-xs font-medium text-blue-800">核验信息</div>
              <div className="text-xs text-blue-700">
                方法: {drug.verification.verificationMethod || "未指定"} ·
                置信度: {drug.verification.confidence || "无"}
                {drug.verification.verifiedAt ? ` · 核验时间: ${drug.verification.verifiedAt}` : ""}
                {drug.verification.nextCheckAt ? ` · 下次检查: ${drug.verification.nextCheckAt}` : ""}
              </div>
              {drug.verification.warnings && drug.verification.warnings.length > 0 && (
                <div className="text-xs text-amber-700 mt-1">
                  {drug.verification.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
            </div>
          )}

          {/* 本地药效 */}
          {drug.localEfficacy && drug.localEfficacy.length > 0 && (
            <div className="mt-2 p-2 bg-green-50 rounded-lg">
              <div className="text-xs font-medium text-green-800">本地药效评价</div>
              {drug.localEfficacy.map((le, i) => (
                <div key={i} className="text-xs text-green-700 mt-1">
                  {le.district}{le.year}年：效果{le.result}{le.reductionRate ? `（蚊密度下降${le.reductionRate}%）` : ""}
                </div>
              ))}
            </div>
          )}

          {/* 培训数据 */}
          {drug.baiyunTraining && (
            <div className="mt-2 p-2 bg-purple-50 rounded-lg">
              <div className="text-xs font-medium text-purple-800">白云区培训数据</div>
              <div className="text-xs text-purple-700 mt-1">
                来源: {drug.baiyunTraining.source} ({drug.baiyunTraining.year}年)
              </div>
              {drug.baiyunTraining.recommendedFormulationDose && (
                <div className="text-xs text-purple-700">推荐制剂用量: {drug.baiyunTraining.recommendedFormulationDose} mL/m³</div>
              )}
              {drug.baiyunTraining.recommendedDilution && (
                <div className="text-xs text-purple-700">推荐稀释倍数: {drug.baiyunTraining.recommendedDilution}倍</div>
              )}
              {drug.baiyunTraining.notes && (
                <div className="text-xs text-purple-600 mt-1 italic">{drug.baiyunTraining.notes}</div>
              )}
            </div>
          )}

          {drug.notes && <DetailRow label="备注" value={drug.notes} />}
          <div className="text-xs text-gray-400 mt-2">
            数据版本: {drug.dataVersion} | 核验: {drug.verifiedAt || "未核验"} {drug.verifiedBy || ""}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="text-gray-500 w-24 flex-shrink-0">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

function ImportSection({ existingDrugs }: { existingDrugs: Drug[] }) {
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const handleImport = () => {
    if (!importJson.trim()) {
      setImportResult("请粘贴 ICAMA JSON 数据");
      return;
    }
    try {
      const records = parseICAMAJson(importJson);
      if (records.length === 0) {
        setImportResult("无法解析数据，请检查格式");
        return;
      }
      const result = batchImportDrugs(records, existingDrugs, { minScore: 0 });
      setImportResult(generateDiscoverySummary(result));
    } catch {
      setImportResult("解析出错，请检查数据格式");
    }
  };

  const searchQueries = generateICAMASearchQueries();

  return (
    <div className="card">
      <button
        className="w-full flex items-center justify-between text-sm font-medium text-gray-700"
        onClick={() => setShowImport(!showImport)}
      >
        <span>ICAMA 数据导入</span>
        <svg className={`w-4 h-4 transition-transform ${showImport ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showImport && (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-gray-500">
            <p>粘贴从 ICAMA 查询到的 JSON 数据（单条或数组），系统将自动解析、评分并检查登记号冲突。</p>
            <p className="mt-1">常用搜索关键词: {searchQueries.length} 个有效成分 × 卫生杀虫剂 + 蚊</p>
          </div>

          <textarea
            className="input-field font-mono text-xs h-32 resize-y"
            placeholder={`[{"registrationNo":"WP2023XXXX","productName":"...","holder":"...","formulationType":"EW","activeIngredients":[{"name":"高效氯氰菊酯","value":"4.5","unit":"%"}],"target":["蚊"],"validUntil":"2028-01-01"}]`}
            value={importJson}
            onChange={e => setImportJson(e.target.value)}
          />

          <button
            className="btn-primary text-sm w-full"
            onClick={handleImport}
          >
            解析并验证
          </button>

          {importResult && (
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {importResult}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg py-1.5 px-2 ${color}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}
