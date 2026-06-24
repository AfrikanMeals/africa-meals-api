import tls from 'node:tls';
import type { MemcachedTlsConfig } from './memcached-connection.util';

function readResponse(
  socket: tls.TLSSocket,
  timeoutMs: number,
): Promise<string> {
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
      clearTimeout(commandTimer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };
    const commandTimer = setTimeout(onTimeout, timeoutMs);
    socket.setTimeout(timeoutMs);
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
    const connectTimer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Memcached TLS connect timeout'));
    }, config.timeoutMs);
    const onFail = (err: Error) => {
      clearTimeout(connectTimer);
      reject(err);
    };
    socket.once('secureConnect', () => {
      clearTimeout(connectTimer);
      resolve(socket);
    });
    socket.once('error', onFail);
  });
}

async function runCommand(
  config: MemcachedTlsConfig,
  command: string,
): Promise<string> {
  const socket = await connectTls(config);
  try {
    socket.write(command);
    return await readResponse(socket, config.timeoutMs);
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

/** SET + GET + DEL sur une seule session TLS (évite 3 handshakes distants). */
export async function tlsMemcachedPing(
  config: MemcachedTlsConfig,
): Promise<void> {
  const key = `__wise_eat_tls_${Date.now()}`;
  const value = '1';
  const socket = await connectTls(config);
  try {
    const setPayload = `set ${key} 0 10 ${Buffer.byteLength(value)}\r\n${value}\r\n`;
    socket.write(setPayload);
    const setRaw = await readResponse(socket, config.timeoutMs);
    if (!setRaw.includes('STORED')) {
      throw new Error('Memcached TLS set failed');
    }
    socket.write(`get ${key}\r\n`);
    const getRaw = await readResponse(socket, config.timeoutMs);
    const lines = getRaw.split('\r\n');
    let got: string | undefined;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('VALUE ')) {
        got = lines[i + 1];
        break;
      }
    }
    if (got !== value) {
      throw new Error('Memcached TLS ping mismatch');
    }
    socket.write(`delete ${key}\r\n`);
    await readResponse(socket, config.timeoutMs);
  } finally {
    socket.end();
  }
}
