"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50 to-white">
      {/* Header */}
      <div className="px-6 pt-8 pb-6 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600 rounded-2xl mb-4">
          <span className="text-3xl">🦟</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          媒介伊蚊消杀配药计算器
        </h1>
        <p className="text-sm text-gray-500">
          登革热 · 基孔肯雅热
        </p>
      </div>

      {/* 施药方式选择 */}
      <div className="px-6 pb-8">
        <p className="text-sm font-medium text-gray-500 mb-4 text-center">
          请选择施药方式：
        </p>

        <div className="space-y-3">
          {/* ULV超低容量空间喷雾 */}
          <Link href="/calculate/ulv" className="block">
            <div className="card hover:shadow-md transition-shadow active:scale-[0.98]">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">💨</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    超低容量空间喷雾
                  </h2>
                  <p className="text-sm text-gray-500">
                    ULV · 室外大面积 / 大型室内
                  </p>
                </div>
                <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* 室内小空间喷雾 */}
          <Link href="/calculate/indoor" className="block">
            <div className="card hover:shadow-md transition-shadow active:scale-[0.98]">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🏠</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    室内小空间喷雾
                  </h2>
                  <p className="text-sm text-gray-500">
                    中小型室内场所
                  </p>
                </div>
                <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* 滞留喷洒 */}
          <Link href="/calculate/residual" className="block">
            <div className="card hover:shadow-md transition-shadow active:scale-[0.98]">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🧱</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    滞留喷洒
                  </h2>
                  <p className="text-sm text-gray-500">
                    表面滞留处理
                  </p>
                </div>
                <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* 底部工具入口 */}
      <div className="px-6 pb-8">
        <div className="border-t border-gray-200 pt-6">
          <div className="grid grid-cols-3 gap-3">
            <Link href="/drugs" className="block">
              <div className="text-center py-3 rounded-lg hover:bg-gray-50 transition-colors">
                <span className="text-xl block mb-1">💊</span>
                <span className="text-xs text-gray-600">药物查询</span>
              </div>
            </Link>
            <Link href="/machines" className="block">
              <div className="text-center py-3 rounded-lg hover:bg-gray-50 transition-colors">
                <span className="text-xl block mb-1">🔧</span>
                <span className="text-xs text-gray-600">器械查询</span>
              </div>
            </Link>
            <Link href="/history" className="block">
              <div className="text-center py-3 rounded-lg hover:bg-gray-50 transition-colors">
                <span className="text-xl block mb-1">📋</span>
                <span className="text-xs text-gray-600">计算历史</span>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* 自定义药物入口 */}
      <div className="px-6 pb-8">
        <Link href="/calculate/custom-drug" className="block">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-sm text-amber-800 font-medium">
              没有找到我的药物？
            </p>
            <p className="text-xs text-amber-600 mt-1">
              自定义药物 / 有效成分计算
            </p>
          </div>
        </Link>
      </div>

      {/* 底部声明 */}
      <div className="px-6 pb-8">
        <p className="text-xs text-gray-400 text-center leading-relaxed">
          本工具仅用于根据农药登记标签进行配药计算，<br />
          不用于自行确定杀虫剂推荐剂量。<br />
          实际用药请以当前有效农药登记标签为准。
        </p>
      </div>
    </div>
  );
}
