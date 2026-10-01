/**
 * Liest den Überschuss aus einer JSON-RPC-Nachricht eines Shelly Pro 3EM (Outbound WebSocket).
 * Erwartet NotifyStatus/NotifyFullStatus mit params["em:0"]: total_act_power ist Bezug (+) bzw. Einspeisung (−),
 * daher wird das Vorzeichen gedreht, damit Überschuss positiv ist.
 * Gibt null zurück, wenn die Nachricht keinen Leistungswert enthält.
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
    // manche Firmware meldet in NotifyStatus nur die geänderten Phasen
    const phases = [em.a_act_power, em.b_act_power, em.c_act_power].map(num);
    if (phases.some((p) => p === null)) return null;
    power = (phases as number[]).reduce((sum, p) => sum + p, 0);
  }
  return Math.round(-power) || 0; // || 0 vermeidet -0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
