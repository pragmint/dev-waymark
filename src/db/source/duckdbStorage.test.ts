import { describe, expect, it } from 'bun:test';
import { secretStatements } from './duckdbStorage';

describe('secretStatements', () => {
  it('needs nothing for local paths', () => {
    expect(secretStatements('/tmp/bucket', { AWS_ENDPOINT_URL: 'http://x' })).toEqual([]);
    expect(secretStatements('file:///tmp/bucket', {})).toEqual([]);
  });

  it('uses the AWS credential chain, with no endpoint on AWS itself', () => {
    expect(secretStatements('s3://bucket/acme', {})).toEqual([
      'CREATE OR REPLACE SECRET waymark_storage (TYPE s3, PROVIDER credential_chain)',
    ]);
  });

  it('passes an S3-compatible endpoint explicitly, path style', () => {
    const [statement] = secretStatements('s3://bucket', {
      AWS_REGION: 'auto',
      AWS_ENDPOINT_URL: 'https://acct.r2.cloudflarestorage.com',
    });
    expect(statement).toContain("REGION 'auto'");
    expect(statement).toContain("ENDPOINT 'acct.r2.cloudflarestorage.com'");
    expect(statement).toContain("URL_STYLE 'path'");
    expect(statement).toContain('USE_SSL true');
  });

  it('prefers an Azure connection string, quoting it', () => {
    const [statement] = secretStatements('az://container', {
      AZURE_STORAGE_CONNECTION_STRING: "AccountName=a;AccountKey=it's",
    });
    expect(statement).toContain("CONNECTION_STRING 'AccountName=a;AccountKey=it''s'");
  });

  it('falls back to the Azure credential chain for an account, and needs one', () => {
    const [statement] = secretStatements('az://container', { AZURE_STORAGE_ACCOUNT: 'acct' });
    expect(statement).toContain("PROVIDER credential_chain, ACCOUNT_NAME 'acct'");
    expect(() => secretStatements('az://container', {})).toThrow('AZURE_STORAGE_ACCOUNT');
  });
});
