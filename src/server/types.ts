export type ServiceState = "ready" | "waiting" | "unreachable";

export interface ServiceProbe {
  id: "napcat" | "astrbot" | "onebot";
  label: string;
  state: ServiceState;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
}

export interface StackStatus {
  overall: "ready" | "attention" | "starting";
  checkedAt: string;
  services: ServiceProbe[];
}

export interface PublicConfig {
  astrbotUrl: string;
  napcatUrl: string;
  onebotUrl: string;
  bindMode: "local" | "network";
}
