import { Client } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. For prod, run `vercel env pull .env.local` first; for local dev, ensure your local Postgres URL is in .env.local.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  const dir = join(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const text = await readFile(join(dir, file), "utf8");
    // pg's Client.query handles multi-statement SQL natively when no params are passed.
    await client.query(text);
    console.log(`  ok`);
  }
  await client.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
