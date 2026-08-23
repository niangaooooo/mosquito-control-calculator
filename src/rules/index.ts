// ============================================================
// 规则引擎统一导出
// ============================================================

export {
  checkFormulationCompatibility,
  getSupportedMethods,
} from './formulation';

export {
  validateMachine,
  checkMachineMethodCompatibility,
  checkFormulationMachineCompatibility,
} from './machine';

export {
  validateAll,
  validationToWarnings,
} from './validation';

export type { ValidationResult } from './validation';
export type { MachineValidationResult } from './machine';
