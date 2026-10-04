/**
 * Probes get_provisional_result across every promise to distinguish "correct contract
 * behaviour for an unresolved promise" from a genuine read defect.
 */
import { createClient, chains } from "genlayer-js";

const ADDRESS = process.argv[2] ?? "0x6B340D9C6230b31652aAbDC08acDAd763635A82b";
const c = createClient({ chain: chains.studionet });
const read = (m, a = []) => c.readContract({ address: ADDRESS, functionName: m, args: a });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = await read("get_all_promise_ids");
for (const id of ids) {
  const n = Number(id);
  const lifecycle = await read("get_lifecycle_status", [n]);
  let prov = "—", fin = "—";
  try {
    const p = await read("get_provisional_result", [n]);
    prov = `${p.delivery}/${p.integrity}`;
  } catch (e) {
    prov = `ERR(${String(e.message).slice(0, 46)})`;
  }
  try {
    const f = await read("get_final_result", [n]);
    fin = `${f.delivery}/${f.integrity}`;
  } catch (e) {
    fin = `ERR(${String(e.message).slice(0, 40)})`;
  }
  console.log(`id=${n} lifecycle=${lifecycle.padEnd(17)} provisional=${prov.padEnd(42)} final=${fin}`);
  await sleep(2600);
}