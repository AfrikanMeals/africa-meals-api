import tls from 'node:tls';
import type { MemcachedTlsConfig } from './memcached-connection.util';

function readResponse(socket: tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (
        buffer.includes('\r\nEND\r\n') ||
        buffer.includes('\r\nSTORED\r\n') ||
        buffer.includes('\r\nDELETED\r\n') ||
        buffer.includes('\r\nNOT_FOUND\r\n') ||
        buffer.includes('\r\nOK\r\n') ||
        buffer.includes('\r\nVERSION ')
      ) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error('Memcached TLS timeout'));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
  });
}

async function connectTls(config: MemcachedTlsConfig): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.servername,
      rejectUnauthorized: config.rejectUnauthorized,
    });
    socket.setTimeout(config.timeoutMs);
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Memcached TLS connect timeout'));
    });
  });
}

async function runCommand(
  config: MemcachedTlsConfig,
  command: string,
): Promise<string> {
  const socket = await connectTls(config);
  try {
    socket.write(command);
    return await readResponse(socket);
  } finally {
    socket.end();
  }
}

export async function tlsMemcachedGet(
  config: MemcachedTlsConfig,
  key: string,
): Promise<string | undefined> {
  const raw = await runCommand(config, `get ${key}\r\n`);
  const lines = raw.split('\r\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('VALUE ')) {
      const valueLine = lines[i + 1];
      return valueLine ?? undefined;
    }
  }
  return undefined;
}

export async function tlsMemcachedSet(
  config: MemcachedTlsConfig,
  key: string,
  value: string,
  ttlSec: number,
): Promise<void> {
  const payload = `set ${key} 0 ${ttlSec} ${Buffer.byteLength(value)}\r\n${value}\r\n`;
  const raw = await runCommand(config, payload);
  if (!raw.includes('STORED')) {
    throw new Error('Memcached TLS set failed');
  }
}

export async function tlsMemcachedDel(
  config: MemcachedTlsConfig,
  key: string,
): Promise<void> {
  await runCommand(config, `delete ${key}\r\n`);
}

export async function tlsMemcachedPing(
  config: MemcachedTlsConfig,
): Promise<void> {
  const key = `__wise_eat_tls_${Date.now()}`;
  await tlsMemcachedSet(config, key, '1', 10);
  const val = await tlsMemcachedGet(config, key);
  if (val !== '1') {
    throw new Error('Memcached TLS ping mismatch');
  }
  await tlsMemcachedDel(config, key);
}
