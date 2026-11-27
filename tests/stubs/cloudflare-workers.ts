// `cloudflare:workers` only exists inside the Workers runtime. Unit tests resolve it here (see vitest.config.ts).
export class DurableObject<Env = unknown> {
  ctx: unknown
  env: Env

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}

export const env = {}
