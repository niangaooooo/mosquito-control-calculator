// ============================================================
// ULV 计算回归测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateULV } from '@/calculation-engine/ulv';
import type { DoseUnit, Drug, FormulationType, Machine } from '@/types';

// 辅助：构建最小药物
function makeDrug(doseValue: number, doseUnit: DoseUnit, formulationType: FormulationType = 'EW'): Drug {
  return {
    id: 'test',
    productName: '测试药物',
    registrationNo: 'WP00000000',
    manufacturer: '测试',
    category: '卫生杀虫剂',
    formulationType,
    activeIngredients: [{ name: '测试', value: 10, unit: '%' }],
    target: ['蚊'],
    environments: ['indoor', 'outdoor'],
    applicationMethods: ['ULV'],
    dose: { type: 'FORMULATION_VOLUME_PER_VOLUME', value: doseValue, unit: doseUnit },
    diluent: 'water',
    indoorAllowed: true,
    outdoorAllowed: true,
    labelSource: '测试',
    status: 'VERIFIED_CALCULABLE',
    labelDate: '2026-01-01',
    dataVersion: '2026.1',
  };
}

// 辅助：构建机器
function makeMachine(flow: number, swath: number, type: Machine['flow']['type'] = 'FIXED'): Machine {
  return {
    id: 'test_machine',
    machineName: '测试机器',
    machineType: 'ULV_BACKPACK',
    flow: type === 'FIXED'
      ? { type: 'FIXED', mlPerSecond: flow }
      : { type: 'VARIABLE', minMlPerSecond: 0, maxMlPerSecond: flow, defaultMlPerSecond: flow },
    swathMeter: swath,
    allowedScenes: ['INDOOR_SMALL', 'INDOOR_LARGE', 'OUTDOOR'],
    allowedMethods: ['ULV'],
    profiles: [],
    source: '测试',
  };
}

describe('ULV Calculation', () => {
  it('按面积剂量计算原药量和速度时不乘雾层高度', () => {
    const drug = makeDrug(0.1, 'mL/m2');
    drug.dose = { type: 'FORMULATION_VOLUME_PER_AREA', value: 0.1, unit: 'mL/m2' };
    const machine = makeMachine(0.83, 10);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 1000, fogHeight: 2, environment: 'outdoor' },
      drug,
      machine
    );

    expect(result.rawDrugMl).toBeCloseTo(100, 6);
    expect(result.rawWalkingSpeed).toBeCloseTo(0.83, 6);
  });

  // TEST 1: 宝特星 + 多飞剋 (rawSpeed < 0.5 → dilution = 1)
  it('TEST 1: 宝特星 0.83mL/s + 多飞剋 0.1mL/m³ → rawSpeed=0.415, dilution=1', () => {
    const drug = makeDrug(0.1, 'mL/m3');
    const machine = makeMachine(0.83, 10);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 10000, fogHeight: 2 },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeCloseTo(0.415, 3);
    expect(result.dilutionFactor).toBe(1);
    expect(result.walkingSpeed).toBeCloseTo(0.415, 3);
  });

  // TEST 2: 616A + 多飞剋 (rawSpeed > 1.0 → theoretical dilution)
  it('TEST 2: 616A 7.5mL/s + 多飞剋 0.1mL/m³ → rawSpeed=3.75, dilution=5, finalSpeed=0.75', () => {
    const drug = makeDrug(0.1, 'mL/m3');
    const machine = makeMachine(7.5, 10);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 10000, fogHeight: 2, targetSpeed: 0.75 },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeCloseTo(3.75, 2);
    expect(result.dilutionFactor).toBe(5);
    expect(result.walkingSpeed).toBeCloseTo(0.75, 2);
  });

  // TEST 3: L30 + 多飞剋
  it('TEST 3: L30 9.8mL/s + 多飞剋 0.1mL/m³ → rawSpeed=2.45, theoreticalDilution≈3.27', () => {
    const drug = makeDrug(0.1, 'mL/m3');
    const machine = makeMachine(9.8, 20);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 10000, fogHeight: 2, targetSpeed: 0.75 },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeCloseTo(2.45, 2);
    // theoretical = 2.45 / 0.75 = 3.2667, rounds to 3.5
    expect(result.dilutionFactor).toBe(3.5);
    expect(result.walkingSpeed).toBeCloseTo(2.45 / 3.5, 2);
  });

  // TEST 4: 雾必达 + 多飞剋
  it('TEST 4: 雾必达 13.8mL/s + 多飞剋 0.1mL/m³ → rawSpeed=1.38, theoreticalDilution≈1.84', () => {
    const drug = makeDrug(0.1, 'mL/m3');
    const machine = makeMachine(13.8, 50);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 10000, fogHeight: 2, targetSpeed: 0.75 },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeCloseTo(1.38, 2);
    // theoretical = 1.38 / 0.75 = 1.84, rounds to 2.0
    expect(result.dilutionFactor).toBe(2);
    expect(result.walkingSpeed).toBeCloseTo(1.38 / 2, 2);
  });

  // TEST 5: 宝特星 + 列喜镇 (dose=0.0125 → rawSpeed=3.32, must dilute)
  it('TEST 5: 宝特星 0.83mL/s + 列喜镇 0.0125mL/m³ → rawSpeed=3.32, dilution≠1', () => {
    const drug = makeDrug(0.0125, 'mL/m3');
    const machine = makeMachine(0.83, 10);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 10000, fogHeight: 2, targetSpeed: 0.75 },
      drug,
      machine
    );

    // rawSpeed = 0.83 / (10 * 2 * 0.0125) = 3.32
    expect(result.rawWalkingSpeed).toBeCloseTo(3.32, 2);
    // theoretical = 3.32 / 0.75 = 4.4267, rounds to 4.5
    expect(result.dilutionFactor).toBe(4.5);
    expect(result.dilutionFactor).not.toBe(1);
    expect(result.walkingSpeed).toBeCloseTo(3.32 / 4.5, 2);
  });

  // 边界：rawSpeed 恰好在边界
  it('边界: rawSpeed=1.0 → dilution=1 (适宜范围)', () => {
    // flow / (swath * height * dose) = 1.0
    // dose = flow / (swath * height * 1.0) = 10 / (10 * 2 * 1.0) = 0.5
    const drug = makeDrug(0.5, 'mL/m3');
    const machine = makeMachine(10, 10);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 1000, fogHeight: 2 },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeCloseTo(1.0, 2);
    expect(result.dilutionFactor).toBe(1);
  });

  // 边界：rawSpeed 略大于 1.0
  it('边界: rawSpeed=1.01 → dilution > 1', () => {
    // dose = flow / (swath * height * 1.01) = 10 / (10 * 2 * 1.01) ≈ 0.495
    const drug = makeDrug(0.495, 'mL/m3');
    const machine = makeMachine(10, 10);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 1000, fogHeight: 2 },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeGreaterThan(1.0);
    expect(result.dilutionFactor).toBeGreaterThan(1);
  });

  // 验证公式方向：flow / (swath * height * dose * targetSpeed)
  it('公式验证: theoreticalDilution = flow / (swath * height * dose * targetSpeed)', () => {
    const flow = 7.5;
    const swath = 10;
    const height = 2;
    const dose = 0.1;
    const targetSpeed = 0.75;

    const expectedTheoretical = flow / (swath * height * dose * targetSpeed);
    // = 7.5 / (10 * 2 * 0.1 * 0.75) = 7.5 / 1.5 = 5

    const drug = makeDrug(dose, 'mL/m3');
    const machine = makeMachine(flow, swath);
    const result = calculateULV(
      { drugId: 'test', machineId: 'test', area: 10000, fogHeight: height, targetSpeed },
      drug,
      machine
    );

    expect(result.rawWalkingSpeed).toBeCloseTo(flow / (swath * height * dose), 2);
    expect(result.dilutionFactor).toBeCloseTo(expectedTheoretical, 0);
  });
});
