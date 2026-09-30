/**
 * Verwaltung per Kommandozeile, z. B.:
 *   node src/cli.ts create-user wolfgang@example.com 'geheimes-passwort'
 *   node src/cli.ts create-producer "PV Dach" wolfgang@example.com
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
  create-user <email> <passwort>
  create-producer <name> <owner-email>   -> gibt das DEVICE_TOKEN für die Bridge aus
  invite <producerId>                    -> Einladungslink für einen Empfänger
  list <email>                           -> sichtbare Erzeuger eines Users`);
  process.exit(1);
}

switch (command) {
  case "create-user": {
    const [email, password] = args;
    if (!email || !password || password.length < 8) usage();
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
    console.log(`DEVICE_TOKEN=${deviceToken}`);
    console.log("Das Token wird nur jetzt angezeigt – in die .env der Bridge eintragen.");
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
