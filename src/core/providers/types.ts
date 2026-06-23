export type ProviderId = "github" | "gitlab" | "bitbucket" | "azure" | "custom";
export type KeyType = "ed25519" | "rsa";

export interface ProviderApi {
  /** Build the HTTP request to upload a public key. Bitbucket needs a username lookup first. */
  buildUploadRequest(token: string, title: string, publicKey: string): UploadRequest;
  /** Token env var name, e.g. XPSSH_TOKEN_GITHUB */
  tokenEnvVar: string;
  /** Human hint for creating a token with the right scope */
  tokenHint: string;
}

export interface UploadRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  aliases: string[];
  /** real host for HostName */
  host: string;
  /** user for ssh connections (always git for these providers) */
  sshUser: string;
  /** preferred key algorithm */
  keyType: KeyType;
  /** where users paste public keys manually */
  settingsUrl: string;
  /** REST upload support; null = manual only (azure) */
  api: ProviderApi | null;
}
