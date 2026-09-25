import type { ProjectGovernance, RiskAssessment, RiskAssessmentInput, RiskProfile } from '../shared/types.js';
export declare function maximumProfile(...profiles: RiskProfile[]): RiskProfile;
export declare function isHigherProfile(candidate: RiskProfile, current: RiskProfile): boolean;
export declare function classifyRisk(input: RiskAssessmentInput, governance: ProjectGovernance): RiskAssessment;
export declare function assertDowngradeAllowed(assessment: RiskAssessment, requested: RiskProfile): void;
//# sourceMappingURL=risk.d.ts.map