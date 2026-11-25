import Redis from "ioredis";
import type { RedisCommands } from "./redis-store";

type IoredisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "EX", seconds: number, condition: "NX"): Promise<"OK" | null>;
  set(key: string, value: string): Promise<"OK">;
  sismember(key: string, member: string): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  del(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<"OK">;
};

export function commandsFromIoredis(client: IoredisLike): RedisCommands {
  return {
    get: (key) => client.get(key),
    set: (key, value, options) => {
      if (options?.nx && options.ex) return client.set(key, value, "EX", options.ex, "NX");
      return client.set(key, value);
    },
    sismember: (key, member) => client.sismember(key, member),
    sadd: (key, member) => client.sadd(key, member),
    del: (key) => client.del(key),
    lrange: (key, start, stop) => client.lrange(key, start, stop),
    lpush: (key, value) => client.lpush(key, value),
    ltrim: (key, start, stop) => client.ltrim(key, start, stop),
  };
}

export function connectTcpRedis(url: string): RedisCommands {
  const client = new Redis(url, { maxRetriesPerRequest: 2 });
  return commandsFromIoredis(client);
}
