/**
 * Verwaltung per Kommandozeile, z. B.:
 *   node src/cli.ts create-user wolfgang@example.com        (gibt einen Link zum Einrichten des Passkeys aus)
 *   node src/cli.ts setup-link wolfgang@example.com         (neuer Einrichtungslink, z. B. wenn das Handy weg ist)
 *   node src/cli.ts create-producer "PV Dach" wolfgang@example.com
 *   node src/cli.ts rotate-token <producerId>                 (neues Geräte-Token, z. B. für den Shelly)
 *   node src/cli.ts invite <producerId>
 */
import { resolve } from "node:path";
import { openDb } from "./db.ts";
import { Repo } from "./repo.ts";

const [command, ...args] = process.argv.slice(2);
const repo = new Repo(openDb(process.env.DB_PATH ?? resolve("data/elma.db")));
const publicUrl = (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");

function usage(): never {
  console.log(`Befehle:
  create-user <email>                    -> legt das Konto an und gibt einen Einrichtungslink für den Passkey aus
  setup-link <email>                     -> neuer Einrichtungslink (Umstellung, neues Handy, Passkey verloren)
  list-users                             -> alle User mit Anzahl ihrer Passkeys
  create-producer <name> <owner-email>   -> gibt das DEVICE_TOKEN für die Bridge aus
  rotate-token <producerId>              -> neues Geräte-Token, das alte wird ungültig
  rename-producer <producerId> <name>    -> Erzeuger umbenennen
  invite <producerId>                    -> Einladungslink für einen Empfänger
  list <email>                           -> sichtbare Erzeuger eines Users`);
  process.exit(1);
}

function printDeviceToken(deviceToken: string): void {
  // eigene Zeile ohne Zusatztext, damit sie 1:1 in die .env der Bridge kopiert werden kann
  console.log(`DEVICE_TOKEN=${deviceToken}`);
  console.log("  ↳ diese Zeile für die Bridge in die .env übernehmen");
  console.log(`Shelly-URL: ${publicUrl.replace(/^http/, "ws")}/ingest/shelly/${deviceToken}`);
  console.log("Wird nur jetzt angezeigt. Nur über einen sicheren Kanal weitergeben.");
}

function printSetupLink(userId: string): void {
  const { token } = repo.createSetupLink(userId);
  console.log(`${publicUrl}/?setup=${token}`);
  console.log("  ↳ 7 Tage gültig, einmal verwendbar. Damit richtet der User am Handy seinen Passkey ein.");
  console.log("Wer den Link hat, kann sich als dieser User anmelden – nur über einen sicheren Kanal weitergeben.");
}

switch (command) {
  case "create-user": {
    const [email] = args;
    if (!email) usage();
    if (repo.userByEmail(email)) throw new Error(`User ${email} gibt es schon – für einen neuen Passkey: setup-link`);
    const user = repo.createUser(email);
    console.log(`User angelegt: ${user.email} (${user.id})`);
    printSetupLink(user.id);
    break;
  }
  case "setup-link": {
    const [email] = args;
    const user = email ? repo.userByEmail(email) : undefined;
    if (!user) usage();
    printSetupLink(user.id);
    break;
  }
  case "list-users": {
    for (const u of repo.usersWithPasskeyCount()) console.log(`${u.email}  ${u.passkeys === 0 ? "kein Passkey" : `${u.passkeys} Passkey(s)`}`);
    break;
  }
  case "create-producer": {
    const [name, email] = args;
    if (!name || !email) usage();
    const owner = repo.userByEmail(email);
    if (!owner) throw new Error(`User ${email} nicht gefunden – zuerst create-user`);
    const { producer, deviceToken } = repo.createProducer(name, owner.id);
    console.log(`Erzeuger angelegt: ${producer.name} (${producer.id})`);
    printDeviceToken(deviceToken);
    break;
  }
  case "rotate-token": {
    const [producerId] = args;
    if (!producerId) usage();
    const deviceToken = repo.rotateDeviceToken(producerId);
    if (!deviceToken) throw new Error(`Erzeuger ${producerId} nicht gefunden`);
    console.log("Neues Geräte-Token erzeugt, das alte ist ab sofort ungültig.");
    printDeviceToken(deviceToken);
    break;
  }
  case "rename-producer": {
    const [producerId, name] = args;
    if (!producerId || !name?.trim()) usage();
    if (!repo.producerById(producerId)) throw new Error(`Erzeuger ${producerId} nicht gefunden`);
    repo.renameProducer(producerId, name.trim());
    console.log(`Erzeuger umbenannt: ${name.trim()}`);
    break;
  }
  case "invite": {
    const [producerId] = args;
    if (!producerId) usage();
    const { code } = repo.createInvite(producerId);
    console.log(`${publicUrl}/?invite=${code}  (7 Tage gültig, einmal verwendbar)`);
    break;
  }
  case "list": {
    const [email] = args;
    const user = email ? repo.userByEmail(email) : undefined;
    if (!user) usage();
    for (const p of repo.visibleProducers(user.id)) console.log(`${p.id}  ${p.name}${p.owner_id === user.id ? "  (eigener)" : ""}`);
    break;
  }
  default:
    usage();
}
