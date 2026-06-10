import type { Provider, ProviderId } from "./types.js";

export type { Provider, ProviderApi, ProviderId, KeyType, UploadRequest } from "./types.js";

export const PROVIDERS: Provider[] = [
  {
    id: "github",
    label: "GitHub",
    aliases: ["gh", "github.com"],
    host: "github.com",
    sshUser: "git",
    keyType: "ed25519",
    settingsUrl: "https://github.com/settings/keys",
    api: {
      tokenEnvVar: "XPSSH_TOKEN_GITHUB",
      tokenHint: "Create a PAT with the admin:public_key scope at https://github.com/settings/tokens",
      buildUploadRequest: (token, title, publicKey) => ({
        url: "https://api.github.com/user/keys",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "xpssh",
        },
        body: JSON.stringify({ title, key: publicKey }),
      }),
    },
  },
  {
    id: "gitlab",
    label: "GitLab",
    aliases: ["gl", "gitlab.com"],
    host: "gitlab.com",
    sshUser: "git",
    keyType: "ed25519",
    settingsUrl: "https://gitlab.com/-/profile/keys",
    api: {
      tokenEnvVar: "XPSSH_TOKEN_GITLAB",
      tokenHint: "Create a personal access token with the api scope at https://gitlab.com/-/user_settings/personal_access_tokens",
      buildUploadRequest: (token, title, publicKey) => ({
        url: "https://gitlab.com/api/v4/user/keys",
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, key: publicKey }),
      }),
    },
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    aliases: ["bb", "bitbucket.org"],
    host: "bitbucket.org",
    sshUser: "git",
    keyType: "ed25519",
    settingsUrl: "https://bitbucket.org/account/settings/ssh-keys/",
    api: {
      tokenEnvVar: "XPSSH_TOKEN_BITBUCKET",
      tokenHint:
        "Create an API token with account:write at https://id.atlassian.com/manage-profile/security/api-tokens (used as Bearer)",
      buildUploadRequest: (token, title, publicKey) => ({
        // {uuid} placeholder is resolved by the upload service via GET /2.0/user
        url: "https://api.bitbucket.org/2.0/users/{uuid}/ssh-keys",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: title, key: publicKey }),
      }),
    },
  },
  {
    id: "azure",
    label: "Azure DevOps",
    aliases: ["ado", "azuredevops", "dev.azure.com", "ssh.dev.azure.com"],
    host: "ssh.dev.azure.com",
    sshUser: "git",
    keyType: "rsa",
    settingsUrl: "https://dev.azure.com/_usersSettings/keys",
    api: null,
  },
];

export function getProvider(idOrAlias: string): Provider | undefined {
  const needle = idOrAlias.toLowerCase();
  return PROVIDERS.find((p) => p.id === needle || p.aliases.includes(needle));
}

export function providerIds(): ProviderId[] {
  return PROVIDERS.map((p) => p.id);
}
