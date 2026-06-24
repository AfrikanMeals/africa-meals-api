import tls from 'node:tls';
import type { MemcachedTlsConfig } from './memcached-connection.util';

const RESPONSE_TERMINATOR =
  /(?:^|\r\n)(?:STORED|NOT_STORED|EXISTS|NOT_FOUND|DELETED|TOUCHED|OK|END|ERROR|RESET|STAT|VERSION[^\r\n]*|CLIENT_ERROR[^\r\n]*|SERVER_ERROR[^\r\n]*)\r\n$/;

function readResponse(
  socket: tls.TLSSocket,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (RESPONSE_TERMINATOR.test(buffer)) {
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

/** Session TLS réutilisable — évite un handshake par commande (latence VPS distante). */
class TlsMemcachedSession {
  private socket: tls.TLSSocket | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly config: MemcachedTlsConfig) {}

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.socket?.destroy();
      this.socket = null;
    }, 30_000);
  }

  private async ensureSocket(): Promise<tls.TLSSocket> {
    if (this.socket && !this.socket.destroyed) {
      return this.socket;
    }
    this.socket = await connectTls(this.config);
    this.socket.on('error', () => {
      this.socket?.destroy();
      this.socket = null;
    });
    this.socket.on('close', () => {
      if (this.socket && this.socket.destroyed) {
        this.socket = null;
      }
    });
    return this.socket;
  }

  async runCommand(command: string): Promise<string> {
    const run = async (): Promise<string> => {
      this.clearIdleTimer();
      try {
        const socket = await this.ensureSocket();
        socket.write(command);
        return await readResponse(socket, this.config.timeoutMs);
      } catch (err) {
        this.socket?.destroy();
        this.socket = null;
        throw err;
      } finally {
        this.scheduleIdleClose();
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const sessionCache = new Map<string, TlsMemcachedSession>();

function sessionFor(config: MemcachedTlsConfig): TlsMemcachedSession {
  const key = `${config.host}:${config.port}:${config.servername}`;
  let session = sessionCache.get(key);
  if (!session) {
    session = new TlsMemcachedSession(config);
    sessionCache.set(key, session);
  }
  return session;
}

export async function tlsMemcachedGet(
  config: MemcachedTlsConfig,
  key: string,
): Promise<string | undefined> {
  const raw = await sessionFor(config).runCommand(`get ${key}\r\n`);
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
  const raw = await sessionFor(config).runCommand(payload);
  if (!raw.includes('STORED')) {
    throw new Error('Memcached TLS set failed');
  }
}

export async function tlsMemcachedDel(
  config: MemcachedTlsConfig,
  key: string,
): Promise<void> {
  await sessionFor(config).runCommand(`delete ${key}\r\n`);
}

export async function tlsMemcachedPing(
  config: MemcachedTlsConfig,
): Promise<void> {
  const session = sessionFor(config);
  const key = `__wise_eat_tls_${Date.now()}`;
  const value = '1';
  const setPayload = `set ${key} 0 10 ${Buffer.byteLength(value)}\r\n${value}\r\n`;
  const setRaw = await session.runCommand(setPayload);
  if (!setRaw.includes('STORED')) {
    throw new Error('Memcached TLS set failed');
  }
  const getRaw = await session.runCommand(`get ${key}\r\n`);
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
  await session.runCommand(`delete ${key}\r\n`);
}
