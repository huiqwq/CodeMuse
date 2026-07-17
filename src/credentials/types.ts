export interface CredentialProtector {
  readonly name: string;
  protect(secret: string): Promise<string>;
  unprotect(payload: string): Promise<string>;
  delete?(payload: string): Promise<void>;
}
