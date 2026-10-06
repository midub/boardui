declare module 'gltf-validator' {
  export interface ValidationIssue {
    code: string;
    message: string;
    severity: number;
    pointer?: string;
  }
  export interface ValidationReport {
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      numHints: number;
      messages: ValidationIssue[];
    };
  }
  export function validateBytes(
    data: Uint8Array,
    options?: { uri?: string; format?: 'glb' | 'gltf'; maxIssues?: number },
  ): Promise<ValidationReport>;
}
