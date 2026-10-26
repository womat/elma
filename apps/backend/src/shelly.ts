/**
 * Reads the surplus from a JSON-RPC message of a Shelly Pro 3EM (outbound WebSocket).
 * Expects NotifyStatus/NotifyFullStatus with params["em:0"]: total_act_power is import (+) or export (−),
 * so the sign is flipped to make surplus positive.
 * Returns null if the message contains no power value.
 */
export function parseShellyFrame(raw: string): number | null {
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(frame) || (frame.method !== "NotifyStatus" && frame.method !== "NotifyFullStatus")) return null;
  const params = frame.params;
  if (!isObject(params)) return null;
  const em = params["em:0"];
  if (!isObject(em)) return null;

  let power = num(em.total_act_power);
  if (power === null) {
    // some firmware reports only the changed phases in NotifyStatus
    const phases = [em.a_act_power, em.b_act_power, em.c_act_power].map(num);
    if (phases.some((p) => p === null)) return null;
    power = (phases as number[]).reduce((sum, p) => sum + p, 0);
  }
  return Math.round(-power) || 0; // || 0 avoids -0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
