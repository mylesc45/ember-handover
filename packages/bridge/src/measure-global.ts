// Headless-only entry (capture package). Never injected into the user's page.
import { measure } from "./measure.js";

(globalThis as unknown as { __handoffMeasure: typeof measure }).__handoffMeasure = measure;
