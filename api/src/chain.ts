/**
 * NEAR transport for the gateway. A signing session supplies the RPC, network,
 * contract accounts and role keys. Sandbox sessions remain the default; a
 * testnet signing session must be provisioned separately from deployment metadata.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
// @ts-ignore -- near-api-js ships no types in this install; the surface used
// here is narrow and declared below.
import * as nearAPI from "near-api-js";

export const TGAS = 30_000_000_000_000n; // 30 Tgas per call

export interface Role {
  account: string;
  secret?: string;
}

export interface Session {
  rpc: string;
  network?: string;
  admin: Role;
  roles?: Record<string, Role>;
  contracts: { options: string; token: string; oracle: string };
}

/** NEAR amounts are u128 and the SDK reads them as strings; a BigInt would make
 * JSON.stringify throw, so every argument crosses the boundary as a string. */
function encode(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
}

export interface CallResult {
  hash: string;
  gas: bigint;
  value: unknown;
}

/** NEAR nests a panic several envelopes deep, and near-api-js throws before the
 * status can be read: the sentence the contract chose — "pool full: this worst
 * case does not fit the equity left" — is in there somewhere, and a trader
 * reading `{"index":0,"kind":{...}}` learns nothing. */
export function failureText(value: unknown): string {
  const panic = findExecutionError(value) ?? findExecutionError(jsonOf(value));
  if (panic === null) return (value instanceof Error ? value.message : String(value ?? "")).slice(0, 240);
  return panic.replace(/^Smart contract panicked:\s*/, "");
}

function jsonOf(value: unknown): unknown {
  const text = value instanceof Error ? value.message : String(value ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findExecutionError(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "ExecutionError" && typeof value === "string") return value;
    const nested = findExecutionError(value);
    if (nested !== null) return nested;
  }
  return null;
}

/** Resolve the SDK network and reject incomplete deployment metadata before
 * attempting to sign. Testnet metadata contains no private keys by design. */
export function sessionNetwork(session: Session): string {
  if (!session.rpc || !session.contracts?.options || !session.contracts?.token || !session.contracts?.oracle) {
    throw new Error("session must include RPC and all three contract accounts");
  }
  if (!session.admin?.account) throw new Error("session needs an admin account");
  return !session.network || session.network === "local-sandbox" ? "sandbox" : session.network;
}

export class Chain {
  readonly session: Session;
  private readonly near: any;
  readonly options: string;
  readonly token: string;
  readonly oracle: string;
  transactions = 0;
  gasBurnt = 0n;
  private readonly cache = new Map<string, any>();
  private readonly reads = new Map<string, { expires: number; value: Promise<unknown> }>();

  private constructor(session: Session, near: any) {
    this.session = session;
    this.near = near;
    this.options = session.contracts.options;
    this.token = session.contracts.token;
    this.oracle = session.contracts.oracle;
  }

  static async connect(sessionPath = "data/chain-session.json"): Promise<Chain> {
    const session = JSON.parse(readFileSync(sessionPath, "utf8")) as Session;
    const network = sessionNetwork(session);
    const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
    const credentialPath = process.env.NEAR_ADMIN_CREDENTIALS;
    if (credentialPath) {
      const credential = JSON.parse(readFileSync(credentialPath, "utf8"));
      if ((credential.account_id ?? basename(credentialPath, ".json")) !== session.admin.account) throw new Error("admin credential account does not match deployment");
      session.admin.secret = credential.private_key ?? credential.secret_key;
    }
    for (const entry of [session.admin, ...Object.values(session.roles ?? {})]) {
      if (entry.secret) await keyStore.setKey(network, entry.account, nearAPI.utils.key_pair.KeyPair.fromString(entry.secret as `ed25519:${string}`));
    }
    const near = await nearAPI.connect({
      networkId: network,
      nodeUrl: session.rpc,
      keyStore,
      masterAccount: session.admin.account,
    });
    return new Chain(session, near);
  }

  id(role: string): string {
    const entry = role === "admin" ? this.session.admin : this.session.roles?.[role];
    if (!entry) throw new Error(`no configured account for ${role}`);
    return entry.account;
  }

  private async account(role: string): Promise<any> {
    const accountId = this.id(role);
    if (!this.cache.has(role)) this.cache.set(role, this.near.account(accountId));
    return this.cache.get(role);
  }

  async accountExists(accountId: string): Promise<void> {
    const account = await this.near.account(accountId);
    await account.state();
  }

  private async readContract(contractId: string, methodName: string, args: Record<string, unknown>): Promise<unknown> {
    const key = JSON.stringify([contractId, methodName, args]);
    const cached = this.reads.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const item = { expires: Number.POSITIVE_INFINITY, value: Promise.resolve() as Promise<unknown> };
    item.value = (async () => {
      const account = await this.near.account(this.options);
      return account.viewFunction({ contractId, methodName, args });
    })().then((value) => { item.expires = Date.now() + 3000; return value; }, (error) => { this.reads.delete(key); throw error; });
    if (this.reads.size >= 1024) for (const [name, entry] of this.reads) if (entry.expires < Date.now()) this.reads.delete(name);
    this.reads.set(key, item);
    return item.value;
  }

  async view(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.readContract(this.options, method, args);
  }

  /** One transaction, one hash. Returns the contract's own return value.
   * `contract` overrides the destination for calls that belong to the token. */
  async call(
    role: string,
    method: string,
    args: Record<string, unknown>,
    { gas = TGAS, deposit = "0", contract = this.options }: { gas?: bigint; deposit?: string; contract?: string } = {},
  ): Promise<CallResult> {
    const account = await this.account(role);
    let outcome: any;
    try {
      outcome = await account.functionCall({
        contractId: contract,
        methodName: method,
        args: encode(args),
        gas,
        attachedDeposit: BigInt(deposit),
      });
    } catch (error) {
      // The SDK throws on a failed transaction before the status below can be
      // read, so the contract's sentence has to be unwrapped here as well.
      throw new Error(`${method} reverted: ${failureText(error)}`);
    }
    this.reads.clear();
    this.transactions += 1;
    const burnt = outcome.receipts_outcome.reduce((total: bigint, r: any) => total + BigInt(r.outcome.gas_burnt), 0n);
    this.gasBurnt += burnt;
    if (outcome.status?.Failure) {
      throw new Error(`${method} reverted: ${failureText(outcome.status.Failure)}`);
    }
    return {
      hash: outcome.transaction.hash,
      gas: burnt,
      value: outcome.status?.SuccessValue
        ? JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString())
        : null,
    };
  }

  /** Move tokens into the market and let its receiver hook act on them. `msg`
   * chooses the destination inside the contract: "deposit" credits a tradable
   * balance, "pool-deposit" mints vault shares against the pool's net assets. */
  depositTo(role: string, amountUnits: string | number | bigint, msg = "deposit"): Promise<CallResult> {
    return this.call(
      role,
      "ft_transfer_call",
      { receiver_id: this.options, amount: BigInt(amountUnits).toString(), msg },
      { contract: this.token, gas: TGAS * 2n, deposit: "1" },
    );
  }

  /** A read from the oracle. It is a separate contract from the market, and the
   * only party that knows which seats signed the price a ticket settled on. */
  async oracleView(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.readContract(this.oracle, method, args);
  }

  /** The contract returns U128, which serialises as a bare JSON string. */
  async balance(role: string): Promise<number> {
    return Number(await this.view("get_balance", { account_id: this.id(role) }));
  }

  /** What any account holds in the collateral token itself. */
  async ftBalance(accountId: string): Promise<number> {
    const value = (await this.readContract(this.token, "ft_balance_of", { account_id: accountId })) as { amount?: string } | string;
    // NEP-141 says Balance is an object; this token returns the U128 bare.
    return Number(typeof value === "object" ? value.amount : value);
  }

  /** What a role holds outside the market, used to watch an asynchronous
   * withdrawal land before spending it again. */
  tokenBalance(role: string): Promise<number> {
    return this.ftBalance(this.id(role));
  }

  /** What the contract believes it holds versus what the token says it holds. */
  async custody(): Promise<{ expected: number; held: number; conserved: boolean }> {
    const expected = Number(await this.view("expected_custody"));
    const held = await this.ftBalance(this.options);
    return { expected, held, conserved: expected === held };
  }
}
