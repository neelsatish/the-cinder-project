import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./session";

export { hostAddressLabel, isHostOutdated } from "./hostTransport";

export type HostIdentity = {
  fingerprint: string;
  code: string;
  status: "trusted" | "new" | "changed";
};

export async function inspectHostIdentity(baseUrl: string): Promise<HostIdentity> {
  if (!isTauriRuntime()) return { fingerprint: "", code: "", status: "trusted" };
  return invoke<HostIdentity>("inspect_host_identity", { baseUrl });
}

export function hostCodesMatch(entered: string, shown: string) {
  return Boolean(shown) && entered.replace(/[\s-]/g, "").toUpperCase() === shown.replace(/[\s-]/g, "").toUpperCase();
}

export async function trustHostIdentity(baseUrl: string, fingerprint: string) {
  if (isTauriRuntime())
    await invoke("trust_host_identity", { baseUrl, fingerprint });
}
