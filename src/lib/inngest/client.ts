import "server-only";

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "riink",
  name: "Riink",
  checkpointing: { maxRuntime: "45s" },
});
