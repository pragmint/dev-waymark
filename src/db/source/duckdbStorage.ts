type Env = Record<string, string | undefined>;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function s3Options(env: Env): string[] {
  const options = ['TYPE s3', 'PROVIDER credential_chain'];
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  if (region) options.push(`REGION ${sqlString(region)}`);
  const endpoint = env.AWS_ENDPOINT_URL_S3 ?? env.AWS_ENDPOINT_URL;
  if (endpoint) {
    const parsed = new URL(endpoint);
    options.push(
      `ENDPOINT ${sqlString(parsed.host)}`,
      "URL_STYLE 'path'",
      `USE_SSL ${parsed.protocol === 'https:' ? 'true' : 'false'}`
    );
  }
  return options;
}

function azureOptions(env: Env): string[] {
  const connectionString = env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) return ['TYPE azure', `CONNECTION_STRING ${sqlString(connectionString)}`];
  const account = env.AZURE_STORAGE_ACCOUNT;
  if (!account) throw new Error('Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT');
  return ['TYPE azure', 'PROVIDER credential_chain', `ACCOUNT_NAME ${sqlString(account)}`];
}

const OPTIONS_BY_SCHEME: Record<string, (env: Env) => string[]> = {
  s3: s3Options,
  az: azureOptions,
  azure: azureOptions,
  abfss: azureOptions,
};

/**
 * The DuckDB secret that reads `url`, from the standard cloud environment variables, the same
 * way pipeline/snapshot.py does. S3 uses the AWS credential chain (env, profile, SSO, instance
 * role); DuckDB's chain ignores `AWS_ENDPOINT_URL`, so an S3-compatible endpoint (MinIO, R2) is
 * passed explicitly. Azure uses `AZURE_STORAGE_CONNECTION_STRING`, or else the Azure credential
 * chain for `AZURE_STORAGE_ACCOUNT`. Local paths need nothing.
 */
export function secretStatements(url: string, env: Env): string[] {
  const scheme = /^([a-z0-9]+):\/\//.exec(url)?.[1] ?? 'file';
  const options = OPTIONS_BY_SCHEME[scheme];
  return options ? [`CREATE OR REPLACE SECRET waymark_storage (${options(env).join(', ')})`] : [];
}
