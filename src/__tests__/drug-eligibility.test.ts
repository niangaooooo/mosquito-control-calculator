import { describe, expect, it } from 'vitest';
import {
  getAllDrugs,
  getAllActiveIngredientNames,
  getCalculableDrugs,
  getCalculableDrugsForMethod,
  getDrugCalculabilityIssues,
  getEffectiveDrugStatus,
  getAllMachines,
  getVerificationSummary,
  isDrugCalculable,
  searchDrugs,
} from '@/services/data';
import { validateAll } from '@/rules';

describe('formal calculation eligibility', () => {
  it('never treats Baiyun-local-only records as formally calculable', () => {
    const localOnly = getAllDrugs().filter(drug => drug.status === 'BAIYUN_LOCAL_ONLY');
    expect(localOnly.length).toBeGreaterThan(0);
    expect(localOnly.every(drug => !isDrugCalculable(drug))).toBe(true);
  });

  it('keeps displayed summary equal to the actual calculable set', () => {
    expect(getVerificationSummary().verifiedCalculable).toBe(getCalculableDrugs().length);
  });

  it('downgrades records whose label dose cannot drive the selected engine', () => {
    const fixedDilution = getAllDrugs().find(drug => drug.registrationNo === 'WP20210200');
    expect(fixedDilution).toBeDefined();
    expect(isDrugCalculable(fixedDilution!, 'ULV')).toBe(false);
    expect(getDrugCalculabilityIssues(fixedDilution!, 'ULV')).toContain('当前施药方式缺少可计算的登记剂量');
    expect(getEffectiveDrugStatus(fixedDilution!)).toBe('VERIFIED_REGISTRATION');
  });

  it('only exposes engine-compatible doses in each calculator', () => {
    const ulv = getCalculableDrugsForMethod('ULV', 'indoor');
    const outdoorUlv = getCalculableDrugsForMethod('ULV', 'outdoor');
    const indoor = getCalculableDrugsForMethod('INDOOR');
    const residual = getCalculableDrugsForMethod('RESIDUAL');

    expect(ulv.length).toBeGreaterThan(0);
    expect(indoor.length).toBeGreaterThan(0);
    expect(residual.length).toBeGreaterThan(0);

    for (const drug of [...ulv, ...indoor, ...residual]) {
      expect(drug.status).toBe('VERIFIED_CALCULABLE');
      expect(drug.verification?.verificationMethod).toBe('OFFICIAL_AUTO');
      expect(drug.verification?.confidence).toBe('HIGH');
    }

    expect(ulv.some(drug => drug.registrationNo === 'WP20210032')).toBe(true);
    expect(outdoorUlv.some(drug => drug.registrationNo === 'WP20210032')).toBe(false);
    expect(residual.some(drug => drug.registrationNo === 'WP20080407')).toBe(false);
    expect(outdoorUlv.some(drug => drug.registrationNo === 'WP20210227')).toBe(true);
  });

  it('validates an indoor ULV product against the selected indoor environment', () => {
    const drug = getAllDrugs().find(item => item.registrationNo === 'WP20110071');
    const machine = getAllMachines().find(item => item.id === 'machine_baotexing');
    const result = validateAll(drug!, machine!, 'ULV', 1000, undefined, 'indoor');

    expect(result.canCalculate).toBe(true);
    expect(result.warnings).not.toContain('该药物未标记允许室外使用');
    expect(result.warnings).not.toContain('该复配制剂未标明剂量基准，计算结果仅供参考');
  });

  it('keeps newly reported registrations searchable without enabling unverified calculations', () => {
    for (const registrationNo of ['WP20180127', 'WP20090164']) {
      const drug = searchDrugs(registrationNo)[0];
      expect(drug?.registrationNo).toBe(registrationNo);
      expect(isDrugCalculable(drug!, 'ULV')).toBe(false);
    }

    const ingredientNames = getAllActiveIngredientNames();
    expect(ingredientNames).toContain('右旋苯醚氰菊酯');
    expect(ingredientNames).toContain('辛硫磷');
  });

  it('contains every unique registration number from the common-use list', () => {
    const requested = [
      'WP20110052', 'WP20230026', 'WP20210258', 'WP20180099', 'WP20250039',
      'WP20210376', 'WP20120128', 'WP20190029', 'WP20210032', 'WP20110220',
      'WP20180127', 'WP20170035', 'WP20080600', 'WP20230013', 'WP20230001',
      'WP20210002', 'WP20110071', 'WP20210116',
    ];

    for (const registrationNo of requested) {
      expect(searchDrugs(registrationNo).some(drug => drug.registrationNo === registrationNo)).toBe(true);
    }
  });

  it('enables only the newly verified registrations whose label dose can drive the selected calculator', () => {
    const enabled: Array<[string, 'ULV' | 'INDOOR', 'indoor' | 'outdoor']> = [
      ['WP20230026', 'ULV', 'indoor'],
      ['WP20210258', 'ULV', 'outdoor'],
      ['WP20180099', 'ULV', 'outdoor'],
      ['WP20210376', 'ULV', 'indoor'],
      ['WP20170035', 'ULV', 'outdoor'],
      ['WP20210002', 'ULV', 'indoor'],
      ['WP20210116', 'ULV', 'indoor'],
      ['WP20080600', 'ULV', 'outdoor'],
      ['WP20180127', 'INDOOR', 'indoor'],
    ];

    for (const [registrationNo, method, environment] of enabled) {
      const drug = searchDrugs(registrationNo).find(item => item.registrationNo === registrationNo);
      expect(drug, registrationNo).toBeDefined();
      expect(isDrugCalculable(drug!, method, environment), registrationNo).toBe(true);
    }

    for (const registrationNo of ['WP20110052', 'WP20250039', 'WP20120128', 'WP20190029']) {
      const drug = searchDrugs(registrationNo).find(item => item.registrationNo === registrationNo);
      expect(drug, registrationNo).toBeDefined();
      expect(isDrugCalculable(drug!, 'ULV'), registrationNo).toBe(false);
      expect(getEffectiveDrugStatus(drug!), registrationNo).toBe('VERIFIED_REGISTRATION');
    }
  });
});
