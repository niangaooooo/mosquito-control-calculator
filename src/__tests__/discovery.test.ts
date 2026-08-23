import { describe, expect, it } from 'vitest';
import { parseICAMARecord, validateDiscoveredDrug, type ICAMARawRecord } from '@/services/discovery';
import type { Drug } from '@/types';

function makeRecord(unit: string): ICAMARawRecord {
  return {
    registrationNo: 'WP20990001',
    productName: '测试卫生杀虫剂',
    holder: '测试登记持有人',
    activeIngredients: [{ name: '残杀威', value: '5', unit: '%' }],
    formulationType: '水乳剂',
    target: ['蚊'],
    validUntil: '2099-12-31',
    usageScope: ['室内'],
    usageMethods: ['滞留喷洒'],
    dosageInfo: [{ method: '喷洒', dose: '50', unit }],
  };
}

describe('ICAMA discovery import safety', () => {
  it('normalizes micro-litres per square metre without changing dose dimension', () => {
    const parsed = parseICAMARecord(makeRecord('μL/m²'));

    expect(parsed.errors).toEqual([]);
    expect(parsed.drug.dose).toEqual({
      type: 'FORMULATION_VOLUME_PER_AREA',
      value: 0.05,
      unit: 'mL/m2',
    });
  });

  it('does not guess when a label dose unit is unsupported', () => {
    const parsed = parseICAMARecord(makeRecord('毫升/亩'));

    expect(parsed.drug.dose).toBeUndefined();
    expect(parsed.warnings.some(warning => warning.includes('不会用于计算'))).toBe(true);
  });

  it('requires a registration expiry date before marking an imported drug calculable', () => {
    const reference: Drug = {
      id: 'reference',
      productName: '测试卫生杀虫剂',
      registrationNo: 'WP20990002',
      manufacturer: '测试登记持有人',
      formulationType: 'EW',
      activeIngredients: [{ name: '残杀威', value: 5, unit: '%' }],
      target: ['蚊'],
      environments: ['indoor'],
      applicationMethods: ['INDOOR'],
      dose: { type: 'FORMULATION_VOLUME_PER_VOLUME', value: 0.1, unit: 'mL/m3' },
      diluent: 'water',
      indoorAllowed: true,
      outdoorAllowed: false,
      status: 'VERIFIED_CALCULABLE',
      labelSource: '测试标签',
      dataVersion: 'test',
    };

    const result = validateDiscoveredDrug(
      {
        ...reference,
        id: undefined,
        registrationNo: 'WP20990003',
        registrationValidUntil: undefined,
      },
      [],
      reference
    );

    expect(result.matchScore).toBe(100);
    expect(result.status).toBe('VERIFIED_REGISTRATION');
  });
});
