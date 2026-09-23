import { resetSqlite } from "../src/lib/db/sqlite";

resetSqlite();
console.log("Database removed. It will be recreated and seeded on next start.");
