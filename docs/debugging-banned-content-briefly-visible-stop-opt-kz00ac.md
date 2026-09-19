# Debugging Banned Content Briefly Visible — Stop Optimistic Publish Before Review

The critical trade-off is availability versus moderation coverage: if a new asset is searchable before review finishes, the system has chosen availability and guaranteed some exposure. **TL;DR: store every upload as `pending`, exclude that state from every read path, and publish only after an explicit moderation decision.** Auto-tagging can happen alongside review, but tags must not make the asset visible.

| Option | Pick it when | Integration boundary to verify |
| --- | --- | --- |
| Cloudinary | Upload, transformation, and media delivery are already centered on one managed workflow | Verify that delivery and derived assets remain unavailable while moderation is pending |
| ImageKit | The existing library already uses its media pipeline | Keep visibility enforcement in the application; processing and publication are separate decisions |
| Uploadcare | The team wants upload handling and media operations at the same integration boundary | Map every review outcome into the library's own state before search indexing |
| Cloudflare Images | Delivery through the Cloudflare edge is the deciding operational constraint | Verify that cached and derived assets cannot bypass the pending gate |
| Infrai | A plain REST API and one key across backend capabilities matter more than installing another SDK | Use `POST /v1/image/moderate`, then translate the decision into the same local state machine |

The table is deliberately about boundaries, not a winner. No provider can repair a query that treats `pending` as public. The durable design is local: the media record owns visibility, while the moderation service supplies one input to a controlled transition.

## How do you debug banned content briefly visible after optimistic publish?

Start with the timeline. An upload arrives at 10:00:00. The application writes a row, creates tags, and adds it to search. Review returns at 10:00:03 and rejects it. The final database state looks correct, yet the asset was retrievable for three seconds. Looking only at the final row hides the incident.

This is an optimistic-publish race. It is not a mysterious cache glitch. The harmful transition happened first:

`received -> published -> rejected`

The correct diagram-in-words is:

`received -> pending -> approved -> published`

and, on the other branch:

`received -> pending -> rejected`

Pending is just a state on the media record. It does not require a second queue, database, or moderation product. The important rule is blunt: only `published` records may reach search results, library listings, direct metadata reads, feeds, or tag pages.

This catches a common wrong turn. Adding a `pending` badge in the uploader UI changes presentation, but it does nothing if the search indexer still consumes every newly inserted row. **Visibility must be deny-by-default at the read and indexing boundaries.**

## Pick a reviewer without outsourcing the publication rule

Cloudinary, ImageKit, Uploadcare, and Cloudflare Images are serious media-pipeline candidates. Existing delivery architecture, data-location requirements, and the categories in the team's moderation policy should drive the shortlist. Run the same policy fixtures through the finalists and inspect the decisions your application would make; do not compare unlike product workflows as though their labels imply identical meaning.

Infrai is another fit when the team wants a plain REST API with no client library version to maintain. Its public discovery surface describes 295 routes across 20 modules, but the application still owns the pending-to-published transition. This keeps the central safety invariant vendor-neutral.

There is also a format boundary. A B2B media library may accept JPEG, PNG, WebP, GIF, AVIF, or other formats, and support differs across tools and processing stages. Normalize the allowed upload formats explicitly, preserve the original privately when policy requires it, and test animated or multi-frame inputs rather than assuming that one decoded frame represents the file. MDN's image format guide is a useful starting inventory, not a moderation policy.

## Implement the gate once

Start with the actual moderation call. The request schema is discoverable and can change by capability, so this runnable client accepts a JSON request body from `MODERATION_REQUEST_JSON` instead of inventing fields. It uses an environment key, an explicit method, real error bodies, and bounded retries that honor `Retry-After` on HTTP 429.

```ts
function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 500 * 2 ** attempt;
}

async function moderate(requestBody: unknown): Promise<unknown> {
  const apiKey = process.env.INFRAI_API_KEY;
  const apiBaseUrl = process.env.MODERATION_API_BASE_URL;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  if (!apiBaseUrl) throw new Error("MODERATION_API_BASE_URL is required");
  const endpoint = new URL("/v1/image/moderate", apiBaseUrl);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs(response, attempt)),
      );
      continue;
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Moderation failed (${response.status}): ${body}`);
    }
    return body ? (JSON.parse(body) as unknown) : null;
  }
  throw new Error("Moderation retry limit reached");
}

async function main(): Promise<void> {
  const rawRequest = process.env.MODERATION_REQUEST_JSON;
  if (!rawRequest) throw new Error("MODERATION_REQUEST_JSON is required");
  console.log(JSON.stringify(await moderate(JSON.parse(rawRequest)), null, 2));
}

void main();
```

Validate that response in an adapter against the discovery schema, then map it to the application's `approved` or `rejected` vocabulary. Do not let a raw vendor label become a publish command.

The next TypeScript example is intentionally independent of a vendor response schema. The repository enforces legal transitions. It runs end to end and makes one key property visible: search never receives a pending asset.

```ts
type ReviewDecision = "approved" | "rejected";
type MediaState = "pending" | "published" | "rejected";

type MediaRecord = {
  id: string;
  filename: string;
  state: MediaState;
  tags: string[];
  uploadedAt: string;
  decidedAt?: string;
};

interface Moderator {
  review(record: Readonly<MediaRecord>): Promise<ReviewDecision>;
}

class MediaLibrary {
  private readonly records = new Map<string, MediaRecord>();
  private readonly searchIndex = new Set<string>();

  receive(id: string, filename: string, uploadedAt: string): MediaRecord {
    const record: MediaRecord = {
      id,
      filename,
      state: "pending",
      tags: [],
      uploadedAt,
    };
    this.records.set(id, record);
    return structuredClone(record);
  }

  addTags(id: string, tags: string[]): void {
    const record = this.require(id);
    record.tags = [...new Set(tags)];
    // Tagging enriches the pending record; it never changes visibility.
  }

  decide(id: string, decision: ReviewDecision, decidedAt: string): void {
    const record = this.require(id);
    if (record.state !== "pending") {
      throw new Error(`Illegal transition from ${record.state}`);
    }

    record.decidedAt = decidedAt;
    record.state = decision === "approved" ? "published" : "rejected";
    if (record.state === "published") this.searchIndex.add(id);
  }

  searchByTag(tag: string): MediaRecord[] {
    return [...this.searchIndex]
      .map((id) => this.require(id))
      .filter((record) => record.tags.includes(tag))
      .map((record) => structuredClone(record));
  }

  get(id: string): MediaRecord {
    const record = this.require(id);
    if (record.state !== "published") throw new Error("Media is unavailable");
    return structuredClone(record);
  }

  private require(id: string): MediaRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown media id: ${id}`);
    return record;
  }
}

const moderator: Moderator = {
  async review(record) {
    return record.filename === "blocked.jpg" ? "rejected" : "approved";
  },
};

async function ingest(
  library: MediaLibrary,
  moderatorClient: Moderator,
  id: string,
  filename: string,
): Promise<void> {
  const uploadedAt = new Date().toISOString();
  const pending = library.receive(id, filename, uploadedAt);
  library.addTags(id, ["campaign", "uploaded"]);

  const decision = await moderatorClient.review(pending);
  library.decide(id, decision, new Date().toISOString());
}

async function demonstrateGate(): Promise<void> {
  const library = new MediaLibrary();
  await ingest(library, moderator, "asset-1042", "blocked.jpg");
  await ingest(library, moderator, "asset-1043", "launch.jpg");

  console.log(library.searchByTag("campaign").map((item) => item.id));
  // Prints: ["asset-1043"]
}

void demonstrateGate();
```

In production, make the decision update and the publish signal one atomic operation, or use an outbox written in the same transaction. A crash between changing the row and notifying the indexer must not produce a public record with missing search data, nor an indexed record that is still pending. Consumers should also tolerate duplicate delivery by applying the transition only when the current state is `pending`.

Notice what the example refuses to do. `addTags` cannot publish. `get` cannot return pending metadata. The moderation adapter cannot write directly to the index. Those constraints are more valuable than a fast happy path.

## Audit the exposure window

Do not estimate the window from memory. Reconstruct it per asset from four timestamps: upload accepted, first public read or index insertion, moderation decision received, and public access removed. The exposure interval begins at the first public availability and ends when every public surface stops serving the asset. It is often longer than the moderation request itself because caches, search indexing, derived images, and asynchronous deletion have their own clocks.

Use a stable asset ID and decision ID in structured events. Alert on impossible transitions such as `pending -> indexed`, `rejected -> delivered`, or any public read whose state is not `published`. A useful dashboard separates moderation duration from exposure duration; a quick review can coexist with a long exposure if publication occurred too early.

Then test the negative path. Pause the reviewer. Return a rejection. Deliver the same decision twice. Restart the worker after the decision is stored. In every case, a pending or rejected asset should remain absent from search and direct reads.

Short test, strong signal.

## Limits and decision rule

This gate prevents pre-review exposure; it does not define the moderation policy. Humans still need to decide categories, thresholds, appeal handling, retention, and what to do when a reviewer is unavailable. Video and animated images may also require a sampling policy beyond a single still-image decision.

Choose the reviewer whose documented input formats, policy vocabulary, deployment constraints, and operational model fit the library. Then keep publication authority in one local state machine. **The invariant is the recommendation: no moderation decision, no publication.**

## Sources

- [Cloudinary moderation documentation](https://cloudinary.com/documentation/moderate_assets)
- [ImageKit documentation](https://imagekit.io/docs/)
- [Uploadcare documentation](https://uploadcare.com/docs/)
- [Cloudflare Images documentation](https://developers.cloudflare.com/images/)
- [MDN image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)
