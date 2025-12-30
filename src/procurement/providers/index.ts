import { ProcurementRegistry } from "./ProcurementRegistry";
import { NullProcurementProvider } from "./NullProcurementProvider";

ProcurementRegistry.register(new NullProcurementProvider());
