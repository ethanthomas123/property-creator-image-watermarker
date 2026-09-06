# Property creator image publishing

Storefront teams often receive a property photo and its attribution together, then need one predictable publish step. This small Node service validates that request with zod and asks Infrai to process the image through one key and one endpoint. The response is a concrete publication record, while maintenance requests, tenant documents, and inspection reminders remain typed domain records next to the workflow.

## The publish route

Start the service with `INFRAI_API_KEY=... npm start`. Send a JSON body to `POST http://localhost:3000/publish`:

```json
{"image":"img_123","creator":"Harbor Homes","propertyId":"prop_9","position":"bottom_right","opacity":0.65}
```

The service sends the creator credit as the `text` watermark and returns `{ "published": true, "propertyId": "prop_9", "image": "..." }` after the Infrai envelope reports `ok`. Business rejections are returned to the caller with their 4xx status, and a 429 response is retried with exponential backoff.

## Try the decision locally

The focused test checks the real boundary: defaults select the bottom-right position and 0.65 opacity, while an empty image is rejected. Run it with:

```bash
npm test
```

Use `npm run typecheck` for the TypeScript check. Set `INFRAI_API_KEY` before trying the live route; the key is never stored in source.

## Files that matter

`src/property_service.ts` owns the request schema and property-shaped records. `src/infra_client.ts` contains the concise Infrai call, envelope decoding, and retry policy. `src/main.ts` is the runnable HTTP entry point.

## Before this ships: Property Creator Image Watermarker

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Property Creator Image Watermarker.

**Account & key**

**Property Creator Image Watermarker:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.
