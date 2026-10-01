/**
 * Verwaltung per Kommandozeile, z. B.:
 *   node src/cli.ts create-user wolfgang@example.com        (fragt das Passwort verdeckt ab)
 *   node src/cli.ts create-producer "PV Dach" wolfgang@example.com
 *   node src/cli.ts rotate-token <producerId>                 (neues Geräte-Token, z. B. für den Shelly)
 *   node src/cli.ts invite <producerId>
 */
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { openDb } from "./db.ts";
import { Repo } from "./repo.ts";

/** Stellt Fragen, ohne die Antworten anzuzeigen (für Passwörter, damit sie nicht in der Shell-History landen). */
async function askHidden(...questions: string[]): Promise<string[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  // Eingabe nicht anzeigen, nur den Zeilenumbruch
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes("\n") || s.includes("\r")) process.stdout.write("\n");
  };
  const lines = rl[Symbol.asyncIterator](); // puffert Zeilen, auch wenn mehrere auf einmal kommen
  const answers: string[] = [];
  for (const q of questions) {
    process.stdout.write(q);
    const { value } = await lines.next();
    if (!process.stdin.isTTY) process.stdout.write("\n");
    answers.push(value ?? "");
  }
  rl.close();
  return answers;
}

const [command, ...args] = process.argv.slice(2);
const repo = new Repo(openDb(process.env.DB_PATH ?? resolve("data/elma.db")));
const publicUrl = (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");

function usage(): never {
  console.log(`Befehle:
  create-user <email> [passwort]         -> ohne Passwort wird es verdeckt abgefragt
  create-producer <name> <owner-email>   -> gibt das DEVICE_TOKEN für die Bridge aus
  rotate-token <producerId>              -> neues Geräte-Token, das alte wird ungültig
  rename-producer <producerId> <name>    -> Erzeuger umbenennen
  invite <producerId>                    -> Einladungslink für einen Empfänger
  list <email>                           -> sichtbare Erzeuger eines Users`);
  process.exit(1);
}

function printDeviceToken(deviceToken: string): void {
  console.log(`DEVICE_TOKEN=${deviceToken}          (für die Bridge, in .env eintragen)`);
  console.log(`Shelly-URL: ${publicUrl.replace(/^http/, "ws")}/ingest/shelly/${deviceToken}`);
  console.log("Wird nur jetzt angezeigt. Nur über einen sicheren Kanal weitergeben.");
}

switch (command) {
  case "create-user": {
    const [email] = args;
    if (!email) usage();
    let password = args[1];
    if (!password) {
      const [first, second] = await askHidden("Passwort (mind. 8 Zeichen): ", "Passwort wiederholen: ");
      if (first !== second) throw new Error("Passwörter stimmen nicht überein");
      password = first!;
    }
    if (password.length < 8) throw new Error("Passwort muss mindestens 8 Zeichen haben");
    const user = await repo.createUser(email, password);
    console.log(`User angelegt: ${user.email} (${user.id})`);
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
