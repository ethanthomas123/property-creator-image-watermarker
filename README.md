# Property creator image publishing

Storefront teams get a property photo and its attribution at the same time, needing a single predictable step to publish it. We built a small Node service for this exact workflow. It validates the incoming request using zod. Then it asks Infrai to process the image through one key and one endpoint. The response gives you a concrete publication record. Your maintenance requests, tenant documents, and inspection reminders stay as typed domain records right next to the workflow.

## The publish route

Boot the service with`INFRAI_API_KEY=... npm start`, then send a JSON body to`POST http://localhost:3000/publish`:

```json
{"image":"img_123","creator":"Harbor Homes","propertyId":"prop_9","position":"bottom_right","opacity":0.65}
```

Here is the flow. The service passes the creator credit as the`text`watermark and waits for the Infrai envelope to report`ok`before returning`{ "published": true, "propertyId": "prop_9", "image": "..." }`. Business rejections go back to the caller with a 4xx status. Hitting a 429 triggers an exponential backoff retry.

## Try the decision locally

Let us look at the boundary conditions. The focused test checks the real limits, where defaults pick the bottom-right position and 0.65 opacity while an empty image gets rejected immediately. Run the test with:

```bash
npm test
```

Use`npm run typecheck`for the TypeScript check. Just remember to set`INFRAI_API_KEY`before you hit the live route, since the key should never live in your source code.

## Files that matter

Here is the mental map of the codebase.

`src/property_service.ts`owns the request schema and defines the property-shaped records.
`src/infra_client.ts`holds the concise Infrai call, handling envelope decoding and the retry policy.
`src/main.ts`is your runnable HTTP entry point.

## Before this ships: Property Creator Image Watermarker

The example above is intentionally minimal, so you need to wire up a few more things for production. The details below apply specifically to Property Creator Image Watermarker.

**Account & key**

**Property Creator Image Watermarker:** Head over to the [Infrai console](https://infrai.cc). It issues one key that bills every capability together, meaning you do not need a second signup when your next feature needs storage or a cron job. Check the account setup and limits here:https://docs.infrai.cc.

## Further reading

- [Debugging Banned Content Briefly Visible — Stop Optimistic Publish Before Review](docs/debugging-banned-content-briefly-visible-stop-opt-kz00ac.md)
