export interface DoctorCheck {
    id: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    message: string;
    remediation?: string;
}
export interface DoctorReport {
    ready: boolean;
    root: string;
    checks: DoctorCheck[];
}
export declare function formatDoctorReport(report: DoctorReport): string;
export declare function doctor(root: string): Promise<DoctorReport>;
//# sourceMappingURL=doctor.d.ts.map