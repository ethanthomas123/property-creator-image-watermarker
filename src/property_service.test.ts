import assert from "node:assert/strict";
import { publishRequestSchema } from "./property_service.js";

const parsed = publishRequestSchema.parse({ image: "img_123", creator: "Harbor Homes", propertyId: "prop_9" });
assert.equal(parsed.position, "bottom_right");
assert.equal(parsed.opacity, 0.65);
assert.throws(() => publishRequestSchema.parse({ image: "", creator: "Harbor Homes", propertyId: "prop_9" }));
console.log("publish request validation passed");
