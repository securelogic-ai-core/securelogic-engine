import { updateRun } from "../run/store/RunStore";

export async function dispatchRun(runId: string) {
  updateRun(runId, { status: "RUNNING" });

  // placeholder — engine execution will live here
  console.log("PRISM ENGINE DISPATCHED:", runId);

  updateRun(runId, { status: "COMPLETED" });
}
