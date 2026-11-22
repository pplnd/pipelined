import { createHash } from "node:crypto";
import { SEARCH_ITEMS } from "./nav";

export const starterSearchJson = JSON.stringify(SEARCH_ITEMS);
export const starterSearchHash = createHash("sha256").update(starterSearchJson).digest("hex").slice(0, 16);
