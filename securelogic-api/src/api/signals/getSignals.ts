import { runSignalPipeline } from "../../signals/runSignalPipeline";

export async function getSignals() {
  return runSignalPipeline();
}
