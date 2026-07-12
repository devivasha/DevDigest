import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./harness-routing.cases.js";

describeWorkflow("harness-routing", () => runWorkflowCases(cases));
