import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR or page caching to configure: the page is static and the API routes
// are dynamic and forwarded to the room's Durable Object.
export default defineCloudflareConfig({});
