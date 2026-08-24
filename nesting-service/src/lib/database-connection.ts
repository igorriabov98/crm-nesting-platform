export function withPrismaConnectionLimit(connectionString: string, maxConnections: number): string {
  const url = new URL(connectionString);
  url.searchParams.set('connection_limit', String(maxConnections));
  return url.toString();
}

export function toPgBossConnectionString(connectionString: string): string {
  const url = new URL(connectionString);

  if (url.searchParams.get('sslaccept') === 'accept_invalid_certs') {
    url.searchParams.delete('sslaccept');
    url.searchParams.set('sslmode', 'no-verify');
  }

  return url.toString();
}
